import { z } from 'zod'
import { StreamSettingsSchema } from './stream'

const obj = () => z.object({}).passthrough()

export const FreedomFragmentSchema = z
  .object({
    packets: z.string().optional(),
    length: z.string().optional(),
    interval: z.string().optional(),
  })
  .passthrough()

export const FreedomOutboundSettingsSchema = z
  .object({
    domainStrategy: z.string().optional(),
    redirect: z.string().optional(),
    fragment: FreedomFragmentSchema.optional(),
    proxyProtocol: z.number().optional(),
  })
  .passthrough()

export const BlackholeOutboundSettingsSchema = z
  .object({
    response: z.object({ type: z.string().optional() }).passthrough().optional(),
  })
  .passthrough()

export const WireguardPeerSchema = z
  .object({
    publicKey: z.string().optional(),
    endpoint: z.string().optional(),
    allowedIPs: z.array(z.string()).optional(),
    preSharedKey: z.string().optional(),
    keepAlive: z.number().optional(),
  })
  .passthrough()

export const WireguardOutboundSettingsSchema = z
  .object({
    secretKey: z.string().optional(),
    address: z.array(z.string()).optional(),
    peers: z.array(WireguardPeerSchema).optional(),
    mtu: z.number().optional(),
    reserved: z.array(z.number()).optional(),
    workers: z.number().optional(),
    domainStrategy: z.string().optional(),
    noKernelTun: z.boolean().optional(),
  })
  .passthrough()

export const VlessOutboundUserSchema = z
  .object({
    id: z.string().optional(),
    flow: z.string().optional(),
    encryption: z.string().optional(),
    level: z.number().optional(),
  })
  .passthrough()

export const VlessVnextSchema = z
  .object({
    address: z.string().optional(),
    port: z.number().optional(),
    users: z.array(VlessOutboundUserSchema).optional(),
  })
  .passthrough()

export const VlessOutboundSettingsSchema = z
  .object({ vnext: z.array(VlessVnextSchema).optional() })
  .passthrough()

export const ProxyServerUserSchema = z
  .object({ user: z.string().optional(), pass: z.string().optional(), level: z.number().optional() })
  .passthrough()

export const ProxyServerSchema = z
  .object({
    address: z.string().optional(),
    port: z.number().optional(),
    users: z.array(ProxyServerUserSchema).optional(),
  })
  .passthrough()

export const SocksOutboundSettingsSchema = z
  .object({ servers: z.array(ProxyServerSchema).optional() })
  .passthrough()

export const HttpOutboundSettingsSchema = z
  .object({ servers: z.array(ProxyServerSchema).optional() })
  .passthrough()

export const MuxSchema = z
  .object({
    enabled: z.boolean().optional(),
    concurrency: z.number().optional(),
    xudpConcurrency: z.number().optional(),
    xudpProxyUDP443: z.string().optional(),
  })
  .passthrough()

const OUTBOUND_SETTINGS_BY_PROTOCOL: Record<string, z.ZodTypeAny> = {
  freedom: FreedomOutboundSettingsSchema,
  blackhole: BlackholeOutboundSettingsSchema,
  wireguard: WireguardOutboundSettingsSchema,
  vless: VlessOutboundSettingsSchema,
  socks: SocksOutboundSettingsSchema,
  http: HttpOutboundSettingsSchema,
}

export const OutboundSchema = z
  .object({
    tag: z.string({ error: 'У outbound должен быть tag' }),
    protocol: z.string({ error: 'У outbound должен быть protocol' }),
    settings: obj().optional(),
    streamSettings: StreamSettingsSchema.optional(),
    proxySettings: obj().optional(),
    sendThrough: z.string().optional(),
    mux: MuxSchema.optional(),
  })
  .passthrough()
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
