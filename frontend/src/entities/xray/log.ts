import { z } from 'zod'

export const LogSchema = z.looseObject({
  access: z.string().optional(),
  error: z.string().optional(),
  loglevel: z.string().optional(),
  dnsLog: z.boolean().optional(),
})
