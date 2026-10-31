import { z } from 'zod';

export const RoleSchema = z.enum(['RIDER', 'DRIVER', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

export const VehicleTypeSchema = z.enum(['MOTORCYCLE', 'CAR']);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

const EmailSchema = z.string().trim().toLowerCase().email().max(254);
const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters').max(128);
const FullNameSchema = z.string().trim().min(2).max(100);
const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number');
const PlateNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,2} ?[0-9]{1,4} ?[A-Z]{0,3}$/, 'Invalid plate number');

const RegisterBase = {
  email: EmailSchema,
  password: PasswordSchema,
  fullName: FullNameSchema,
  phone: PhoneSchema.optional(),
};

/**
 * Self-registration only allows RIDER and DRIVER.
 * ADMIN must never be creatable through a public endpoint (privilege escalation).
 */
export const RegisterSchema = z.discriminatedUnion('role', [
  z.object({ ...RegisterBase, role: z.literal('RIDER') }),
  z.object({
    ...RegisterBase,
    role: z.literal('DRIVER'),
    vehicleType: VehicleTypeSchema,
    plateNumber: PlateNumberSchema,
  }),
]);
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  role: RoleSchema,
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const AuthResponseSchema = z.object({
  user: UserDtoSchema,
  accessToken: z.string(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
