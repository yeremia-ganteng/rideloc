import { describe, expect, it } from 'vitest';
import { LoginSchema, RegisterSchema } from './auth';

const rider = {
  email: 'Rina@Example.COM ',
  password: 'correct-horse-9',
  fullName: 'Rina Penumpang',
  role: 'RIDER',
};

describe('RegisterSchema', () => {
  it('menormalkan email (trim + lowercase)', () => {
    const parsed = RegisterSchema.parse(rider);
    expect(parsed.email).toBe('rina@example.com');
  });

  it('menolak role ADMIN (anti privilege escalation)', () => {
    expect(RegisterSchema.safeParse({ ...rider, role: 'ADMIN' }).success).toBe(false);
  });

  it('driver wajib punya kendaraan dan plat', () => {
    expect(RegisterSchema.safeParse({ ...rider, role: 'DRIVER' }).success).toBe(false);
    const ok = RegisterSchema.parse({
      ...rider,
      role: 'DRIVER',
      vehicleType: 'MOTORCYCLE',
      plateNumber: 'b 1234 xyz',
    });
    expect(ok.role === 'DRIVER' && ok.plateNumber).toBe('B 1234 XYZ');
  });

  it('menolak password pendek', () => {
    expect(RegisterSchema.safeParse({ ...rider, password: '1234567' }).success).toBe(false);
  });

  it('mengabaikan field tak dikenal (mass assignment)', () => {
    const parsed = RegisterSchema.parse({ ...rider, isAdmin: true });
    expect('isAdmin' in parsed).toBe(false);
  });
});

describe('LoginSchema', () => {
  it('menolak password kosong', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
