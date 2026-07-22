import { z } from 'zod'

export const LogSchema = z
  .object({
    access: z.string().optional(),
    error: z.string().optional(),
    loglevel: z.string().optional(),
    dnsLog: z.boolean().optional(),
  })
  .passthrough()
