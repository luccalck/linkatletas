import { z } from 'zod'
import { GOALS, LEVELS, SLOTS, SPORTS } from '../../shared/contracts.js'
import { externalUrlSchema } from './external-url.js'
export const idSchema = z.uuid()
export const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    city: z.string().trim().max(120),
    bio: z.string().trim().max(2000),
    sports: z.array(z.enum(SPORTS)).max(5),
    goals: z.array(z.enum(GOALS)).max(5),
    levels: z.array(z.enum(LEVELS)).max(3),
    availability: z.array(z.enum(SLOTS)).max(12),
    mode: z.enum(['online', 'presencial', 'hibrido']),
    budget: z.number().finite().min(0).max(100000),
    price: z.number().finite().min(0).max(100000),
  })
  .strict()
const block = z
  .object({
    name: z.string().trim().min(2).max(150),
    instructions: z.string().trim().max(2000),
    sets: z.number().int().min(1).max(100).optional(),
    repetitions: z.number().int().min(1).max(10000).optional(),
    loadKg: z.number().finite().min(0).max(1000).optional(),
    durationMinutes: z.number().finite().min(0).max(1440).optional(),
    distanceKm: z.number().finite().min(0).max(1500).optional(),
    videoUrl: externalUrlSchema.optional(),
  })
  .strict()
export const workoutSchema = z
  .object({
    contractId: idSchema,
    title: z.string().trim().min(3).max(160),
    sport: z.enum(SPORTS),
    scheduledDate: z.iso.date(),
    instructions: z.string().trim().max(3000),
    status: z.enum(['draft', 'published']),
    blocks: z.array(block).min(1).max(50),
  })
  .strict()
export const executionSchema = z
  .object({
    completedBlocks: z.array(z.number().int().min(0)).max(50),
    effort: z.number().int().min(1).max(10),
    notes: z.string().trim().max(3000),
    metrics: z.record(z.string().max(50), z.number().finite()),
  })
  .strict()
export const bodySchema = (schema: z.ZodType) => {
  const { $schema: _schema, ...json } = z.toJSONSchema(schema, {
    target: 'draft-7',
  })
  return json
}
