import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { LoginSchema, RegisterSchema, type AuthResponse } from '@rideloc/shared';
import type { Env } from '../../config/env';
import { AppError, parseOrThrow } from '../../lib/errors';
import type { AuthService, AuthTokens } from './auth.service';

export const REFRESH_COOKIE = 'rt';

interface Options {
  auth: AuthService;
  env: Env;
}

export const authRoutes: FastifyPluginAsync<Options> = async (app, { auth, env }) => {
  const limit = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  function setRefreshCookie(reply: FastifyReply, tokens: AuthTokens): void {
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true, // not readable by JS: mitigates XSS token theft
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict', // mitigates CSRF on the cookie-authenticated endpoints
      path: '/auth', // cookie is only sent to /auth/*
      expires: tokens.refreshExpiresAt,
    });
  }

  app.post('/register', { config: limit }, async (req, reply) => {
    const input = parseOrThrow(RegisterSchema, req.body);
    const { user, tokens } = await auth.register(input);
    setRefreshCookie(reply, tokens);
    const body: AuthResponse = { user, accessToken: tokens.accessToken };
    return reply.status(201).send(body);
  });

  app.post('/login', { config: limit }, async (req, reply) => {
    const input = parseOrThrow(LoginSchema, req.body);
    const { user, tokens } = await auth.login(input);
    setRefreshCookie(reply, tokens);
    const body: AuthResponse = { user, accessToken: tokens.accessToken };
    return reply.send(body);
  });

  app.post('/refresh', { config: limit }, async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Missing refresh token');
    const { user, tokens } = await auth.refresh(raw);
    setRefreshCookie(reply, tokens);
    const body: AuthResponse = { user, accessToken: tokens.accessToken };
    return reply.send(body);
  });

  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) await auth.logout(raw);
    return reply.clearCookie(REFRESH_COOKIE, { path: '/auth' }).status(204).send();
  });
};
