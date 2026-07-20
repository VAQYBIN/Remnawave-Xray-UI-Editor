import { z } from 'zod'
import { StreamSettingsSchema } from './stream'

const obj = () => z.object({}).passthrough()

export const OutboundSchema = z
  .object({
    tag: z.string({ required_error: 'У outbound должен быть tag' }),
    protocol: z.string({ required_error: 'У outbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    proxySettings: obj().optional(),
    sendThrough: z.string().optional(),
    mux: obj().optional(),
  })
  .passthrough()

export type Outbound = z.infer<typeof OutboundSchema>
