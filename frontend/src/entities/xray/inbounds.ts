import { z } from 'zod'
import { SniffingSchema, StreamSettingsSchema } from './stream'

const obj = () => z.looseObject({})

export const VlessClientSchema = z.looseObject({
  id: z.string().optional(),
  email: z.string().optional(),
  flow: z.string().optional(),
})

export const FallbackSchema = z.looseObject({
  name: z.string().optional(),
  alpn: z.string().optional(),
  path: z.string().optional(),
  dest: z.union([z.string(), z.number()]).optional(),
  xver: z.number().optional(),
})

export const TrojanClientSchema = z.looseObject({
  password: z.string().optional(),
  email: z.string().optional(),
  level: z.number().optional(),
})

export const HysteriaClientSchema = z.looseObject({
  auth: z.string().optional(),
  email: z.string().optional(),
  level: z.number().optional(),
})

export const HysteriaInboundSettingsSchema = z.looseObject({
  version: z.number().optional(),
  clients: z.array(HysteriaClientSchema).optional(),
})

export const VlessInboundSettingsSchema = z.looseObject({
  clients: z.array(VlessClientSchema).optional(),
  decryption: z.string().optional(),
  fallbacks: z.array(FallbackSchema).optional(),
})

export const TrojanInboundSettingsSchema = z.looseObject({
  clients: z.array(TrojanClientSchema).optional(),
  fallbacks: z.array(FallbackSchema).optional(),
})

export const ShadowsocksInboundSettingsSchema = z.looseObject({
  method: z.string().optional(),
  password: z.string().optional(),
  clients: z.array(obj()).optional(),
  network: z.string().optional(),
})

export const InboundSchema = z
  .looseObject({
    tag: z.string({ error: 'У inbound должен быть tag' }),
    port: z.union([z.number(), z.string()]).optional(),
    listen: z.string().optional(),
    protocol: z.string({ error: 'У inbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    sniffing: SniffingSchema.optional(),
    allocate: obj().optional(),
  })
  .superRefine((inb, ctx) => {
    const settingsSchema =
      inb.protocol === 'vless'
        ? VlessInboundSettingsSchema
        : inb.protocol === 'trojan'
          ? TrojanInboundSettingsSchema
          : inb.protocol === 'shadowsocks'
            ? ShadowsocksInboundSettingsSchema
            : inb.protocol === 'hysteria'
              ? HysteriaInboundSettingsSchema
              : null
    if (settingsSchema && inb.settings !== undefined) {
      const res = settingsSchema.safeParse(inb.settings)
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({ ...issue, path: ['settings', ...issue.path] })
        }
      }
    }
  })

export type Inbound = z.infer<typeof InboundSchema>
