import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const registerSchema = z.object({
  name: trimmed(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const createEventSchema = z.object({
  title: trimmed(160),
  description: z.string().trim().max(2000).default(''),
  category: trimmed(60),
  venue: trimmed(160),
  isActive: z.boolean().optional(),
});

export const updateEventSchema = createEventSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update.' },
);

/** Accepts an ISO timestamp or epoch milliseconds, and requires a future time. */
const futureTimestamp = z
  .union([z.string().datetime({ offset: true }), z.string().datetime(), z.number().int()])
  .transform((value) => (typeof value === 'number' ? value : Date.parse(value)))
  .refine((value) => Number.isFinite(value), { message: 'Invalid date/time.' });

export const createShowSchema = z.object({
  startsAt: futureTimestamp.refine((value) => value > Date.now(), {
    message: 'Show time must be in the future.',
  }),
  screen: trimmed(60).default('Screen 1'),
  layoutKey: trimmed(60),
  // Rupees in, paise out: the API speaks rupees, storage is integer paise.
  basePrice: z
    .number()
    .positive('Base price must be greater than zero.')
    .max(1_000_000)
    .transform((rupees) => Math.round(rupees * 100)),
  isActive: z.boolean().optional(),
});

export const updateShowSchema = z
  .object({
    startsAt: futureTimestamp.optional(),
    screen: trimmed(60).optional(),
    basePrice: z.number().positive().max(1_000_000).transform((rupees) => Math.round(rupees * 100)).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const createHoldSchema = z.object({
  showSeatIds: z.array(z.string().uuid()).min(1, 'Select at least one seat.').max(20),
});

export const confirmBookingSchema = z.object({
  holdGroupId: z.string().uuid(),
});

export const adminBookingQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
  showId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
