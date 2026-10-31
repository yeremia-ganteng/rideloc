import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { LoginInput, RegisterInput, Role, UserDto } from '@rideloc/shared';
import type { Env } from '../../config/env';
import type { Database, UsersTable } from '../../db/types';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { getDummyHash, hashPassword, verifyPassword } from '../../lib/password';
import { generateRefreshToken, hashRefreshToken } from '../../lib/tokens';

type UserRow = Selectable<UsersTable>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface AuthResult {
  user: UserDto;
  tokens: AuthTokens;
}

export interface AuthServiceDeps {
  db: Kysely<Database>;
  env: Env;
  signAccessToken: (payload: { sub: string; role: Role }) => string;
}

export function toUserDto(row: UserRow): UserDto {
  // Explicit field mapping: password_hash can never leak through this function.
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

type RefreshOutcome = { kind: 'ok'; user: UserRow; tokens: AuthTokens } | { kind: 'invalid' };

export function createAuthService({ db, env, signAccessToken }: AuthServiceDeps) {
  async function createSession(
    executor: Kysely<Database>,
    user: UserRow,
    familyId?: string,
  ): Promise<AuthTokens> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await executor
      .insertInto('refresh_tokens')
      .values({
        user_id: user.id,
        family_id: familyId ?? randomUUID(),
        token_hash: hashRefreshToken(refreshToken),
        expires_at: refreshExpiresAt,
      })
      .execute();
    return {
      accessToken: signAccessToken({ sub: user.id, role: user.role }),
      refreshToken,
      refreshExpiresAt,
    };
  }

  return {
    async register(input: RegisterInput): Promise<AuthResult> {
      const passwordHash = await hashPassword(input.password); // CPU-heavy: outside the transaction

      return db.transaction().execute(async (trx) => {
        let user: UserRow;
        try {
          user = await trx
            .insertInto('users')
            .values({
              email: input.email,
              password_hash: passwordHash,
              full_name: input.fullName,
              phone: input.phone ?? null,
              role: input.role,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
          }
          throw err;
        }

        if (input.role === 'DRIVER') {
          await trx
            .insertInto('drivers')
            .values({
              user_id: user.id,
              vehicle_type: input.vehicleType,
              plate_number: input.plateNumber,
            })
            .execute();
        }

        const tokens = await createSession(trx, user);
        return { user: toUserDto(user), tokens };
      });
    },

    async login({ email, password }: LoginInput): Promise<AuthResult> {
      const user = await db
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst();

      // Always run one verification, even for unknown emails (timing equalization).
      const ok = await verifyPassword(user?.password_hash ?? (await getDummyHash()), password);
      if (!user || !ok) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const tokens = await createSession(db, user);
      return { user: toUserDto(user), tokens };
    },

    async refresh(rawToken: string): Promise<AuthResult> {
      const outcome = await db.transaction().execute(async (trx): Promise<RefreshOutcome> => {
        const row = await trx
          .selectFrom('refresh_tokens')
          .selectAll()
          .where('token_hash', '=', hashRefreshToken(rawToken))
          .forUpdate() // serializes concurrent refreshes of the same token
          .executeTakeFirst();
        if (!row) return { kind: 'invalid' };

        const now = new Date();

        if (row.revoked_at !== null) {
          // REUSE DETECTED: a rotated-out token was presented again. Revoke the whole family.
          // This is returned (not thrown) so the revocation commits.
          await trx
            .updateTable('refresh_tokens')
            .set({ revoked_at: now })
            .where('family_id', '=', row.family_id)
            .where('revoked_at', 'is', null)
            .execute();
          return { kind: 'invalid' };
        }

        if (row.expires_at <= now) return { kind: 'invalid' };

        const user = await trx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', row.user_id)
          .executeTakeFirst();
        if (!user) return { kind: 'invalid' };

        await trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: now })
          .where('id', '=', row.id)
          .execute();
        const tokens = await createSession(trx, user, row.family_id);
        return { kind: 'ok', user, tokens };
      });

      if (outcome.kind === 'invalid') {
        throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
      }
      return { user: toUserDto(outcome.user), tokens: outcome.tokens };
    },

    /** Idempotent: unknown or already-revoked tokens are ignored. */
    async logout(rawToken: string): Promise<void> {
      const row = await db
        .selectFrom('refresh_tokens')
        .select('family_id')
        .where('token_hash', '=', hashRefreshToken(rawToken))
        .executeTakeFirst();
      if (!row) return;
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('family_id', '=', row.family_id)
        .where('revoked_at', 'is', null)
        .execute();
    },

    async getUserById(id: string): Promise<UserDto | undefined> {
      const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
      return row ? toUserDto(row) : undefined;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
