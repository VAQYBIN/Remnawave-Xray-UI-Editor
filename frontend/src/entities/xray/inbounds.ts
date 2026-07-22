import { z } from 'zod'
import { SniffingSchema, StreamSettingsSchema } from './stream'

const obj = () => z.object({}).passthrough()

export const VlessClientSchema = z
  .object({ id: z.string().optional(), email: z.string().optional(), flow: z.string().optional() })
  .passthrough()

export const FallbackSchema = z
  .object({
    name: z.string().optional(),
    alpn: z.string().optional(),
    path: z.string().optional(),
    dest: z.union([z.string(), z.number()]).optional(),
    xver: z.number().optional(),
  })
  .passthrough()

export const TrojanClientSchema = z
  .object({ password: z.string().optional(), email: z.string().optional(), level: z.number().optional() })
  .passthrough()

export const HysteriaClientSchema = z
  .object({ auth: z.string().optional(), email: z.string().optional(), level: z.number().optional() })
  .passthrough()

export const HysteriaInboundSettingsSchema = z
  .object({
    version: z.number().optional(),
    clients: z.array(HysteriaClientSchema).optional(),
  })
  .passthrough()

export const VlessInboundSettingsSchema = z
  .object({
    clients: z.array(VlessClientSchema).optional(),
    decryption: z.string().optional(),
    fallbacks: z.array(FallbackSchema).optional(),
  })
  .passthrough()

export const TrojanInboundSettingsSchema = z
  .object({
    clients: z.array(TrojanClientSchema).optional(),
    fallbacks: z.array(FallbackSchema).optional(),
  })
  .passthrough()

export const ShadowsocksInboundSettingsSchema = z
  .object({
    method: z.string().optional(),
    password: z.string().optional(),
    clients: z.array(obj()).optional(),
    network: z.string().optional(),
  })
  .passthrough()

export const InboundSchema = z
  .object({
    tag: z.string({ required_error: 'У inbound должен быть tag' }),
    port: z.union([z.number(), z.string()]).optional(),
    listen: z.string().optional(),
    protocol: z.string({ required_error: 'У inbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    sniffing: SniffingSchema.optional(),
    allocate: obj().optional(),
  })
  .passthrough()
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
