import { z } from 'zod'
import { StreamSettingsSchema } from './stream'

const obj = () => z.looseObject({})

export const FreedomFragmentSchema = z.looseObject({
  packets: z.string().optional(),
  length: z.string().optional(),
  interval: z.string().optional(),
})

export const FreedomOutboundSettingsSchema = z.looseObject({
  domainStrategy: z.string().optional(),
  redirect: z.string().optional(),
  fragment: FreedomFragmentSchema.optional(),
  proxyProtocol: z.number().optional(),
})

export const BlackholeOutboundSettingsSchema = z.looseObject({
  response: z.looseObject({ type: z.string().optional() }).optional(),
})

export const WireguardPeerSchema = z.looseObject({
  publicKey: z.string().optional(),
  endpoint: z.string().optional(),
  allowedIPs: z.array(z.string()).optional(),
  preSharedKey: z.string().optional(),
  keepAlive: z.number().optional(),
})

export const WireguardOutboundSettingsSchema = z.looseObject({
  secretKey: z.string().optional(),
  address: z.array(z.string()).optional(),
  peers: z.array(WireguardPeerSchema).optional(),
  mtu: z.number().optional(),
  reserved: z.array(z.number()).optional(),
  workers: z.number().optional(),
  domainStrategy: z.string().optional(),
  noKernelTun: z.boolean().optional(),
})

export const VlessOutboundUserSchema = z.looseObject({
  id: z.string().optional(),
  flow: z.string().optional(),
  encryption: z.string().optional(),
  level: z.number().optional(),
})

export const VlessVnextSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  users: z.array(VlessOutboundUserSchema).optional(),
})

// Xray понимает две формы клиентского outbound'а: классическую (vnext/servers)
// и плоскую (адрес прямо в settings). Ядро проверяет запрет «без шифрования на
// публичный адрес» только для плоской — описываем обе.
export const VlessOutboundSettingsSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  id: z.string().optional(),
  flow: z.string().optional(),
  encryption: z.string().optional(),
  seed: z.string().optional(),
  vnext: z.array(VlessVnextSchema).optional(),
})

export const TrojanServerSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  password: z.string().optional(),
  email: z.string().optional(),
  flow: z.string().optional(),
})

export const TrojanOutboundSettingsSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  password: z.string().optional(),
  flow: z.string().optional(),
  servers: z.array(TrojanServerSchema).optional(),
})

export const ProxyServerUserSchema = z.looseObject({
  user: z.string().optional(),
  pass: z.string().optional(),
  level: z.number().optional(),
})

export const ProxyServerSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  users: z.array(ProxyServerUserSchema).optional(),
})

export const SocksOutboundSettingsSchema = z.looseObject({
  servers: z.array(ProxyServerSchema).optional(),
})

export const HttpOutboundSettingsSchema = z.looseObject({
  servers: z.array(ProxyServerSchema).optional(),
})

export const MuxSchema = z.looseObject({
  enabled: z.boolean().optional(),
  concurrency: z.number().optional(),
  xudpConcurrency: z.number().optional(),
  xudpProxyUDP443: z.string().optional(),
})

const OUTBOUND_SETTINGS_BY_PROTOCOL: Record<string, z.ZodTypeAny> = {
  freedom: FreedomOutboundSettingsSchema,
  blackhole: BlackholeOutboundSettingsSchema,
  wireguard: WireguardOutboundSettingsSchema,
  vless: VlessOutboundSettingsSchema,
  trojan: TrojanOutboundSettingsSchema,
  socks: SocksOutboundSettingsSchema,
  http: HttpOutboundSettingsSchema,
}

export const OutboundSchema = z
  .looseObject({
    tag: z.string({ error: 'У outbound должен быть tag' }),
    protocol: z.string({ error: 'У outbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    proxySettings: obj().optional(),
    sendThrough: z.string().optional(),
    mux: MuxSchema.optional(),
  })
  .superRefine((out, ctx) => {
    const settingsSchema = OUTBOUND_SETTINGS_BY_PROTOCOL[out.protocol]
    if (settingsSchema && out.settings !== undefined) {
      const res = settingsSchema.safeParse(out.settings)
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({ ...issue, path: ['settings', ...issue.path] })
        }
      }
    }
  })

export type Outbound = z.infer<typeof OutboundSchema>
