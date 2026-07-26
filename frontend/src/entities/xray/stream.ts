import { z } from 'zod'

const obj = () => z.looseObject({})

export const RealitySettingsSchema = z.looseObject({
  show: z.boolean().optional(),
  dest: z.union([z.string(), z.number()]).optional(),
  target: z.union([z.string(), z.number()]).optional(),
  xver: z.number().optional(),
  serverNames: z.array(z.string()).optional(),
  privateKey: z.string().optional(),
  publicKey: z.string().optional(),
  shortIds: z.array(z.string()).optional(),
  fingerprint: z.string().optional(),
  spiderX: z.string().optional(),
  serverName: z.string().optional(),
  shortId: z.string().optional(),
  password: z.string().optional(),
})

export const CertificateSchema = z.looseObject({
  certificateFile: z.string().optional(),
  keyFile: z.string().optional(),
  certificate: z.array(z.string()).optional(),
  key: z.array(z.string()).optional(),
  usage: z.string().optional(),
})

export const TlsSettingsSchema = z.looseObject({
  serverName: z.string().optional(),
  rejectUnknownSni: z.boolean().optional(),
  alpn: z.array(z.string()).optional(),
  certificates: z.array(CertificateSchema).optional(),
  minVersion: z.string().optional(),
  maxVersion: z.string().optional(),
  fingerprint: z.string().optional(),
})

export const TcpSettingsSchema = z.looseObject({
  acceptProxyProtocol: z.boolean().optional(),
  header: obj().optional(),
})

export const WsSettingsSchema = z.looseObject({
  path: z.string().optional(),
  host: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  heartbeatPeriod: z.number().optional(),
  acceptProxyProtocol: z.boolean().optional(),
})

export const GrpcSettingsSchema = z.looseObject({
  serviceName: z.string().optional(),
  authority: z.string().optional(),
  multiMode: z.boolean().optional(),
})

export const HttpupgradeSettingsSchema = z.looseObject({
  path: z.string().optional(),
  host: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  acceptProxyProtocol: z.boolean().optional(),
})

export const XhttpSettingsSchema = z.looseObject({
  path: z.string().optional(),
  host: z.string().optional(),
  mode: z.string().optional(),
  extra: obj().optional(),
})

export const HysteriaSettingsSchema = z.looseObject({
  version: z.number().optional(),
  auth: z.string().optional(),
  up: z.string().optional(),
  down: z.string().optional(),
  udpIdleTimeout: z.number().optional(),
  masquerade: obj().optional(),
})

export const QuicParamsSchema = z.looseObject({
  congestion: z.string().optional(),
  brutalUp: z.number().optional(),
  brutalDown: z.number().optional(),
})

export const FinalmaskSchema = z.looseObject({
  quicParams: QuicParamsSchema.optional(),
})

export const SockoptSchema = z.looseObject({
  mark: z.number().optional(),
  tcpFastOpen: z.union([z.boolean(), z.number()]).optional(),
  tproxy: z.string().optional(),
  domainStrategy: z.string().optional(),
  dialerProxy: z.string().optional(),
  acceptProxyProtocol: z.boolean().optional(),
  interface: z.string().optional(),
  tcpMptcp: z.boolean().optional(),
})

export const StreamSettingsSchema = z.looseObject({
  network: z.string().optional(),
  security: z.string().optional(),
  realitySettings: RealitySettingsSchema.optional(),
  tlsSettings: TlsSettingsSchema.optional(),
  tcpSettings: TcpSettingsSchema.optional(),
  rawSettings: TcpSettingsSchema.optional(),
  wsSettings: WsSettingsSchema.optional(),
  grpcSettings: GrpcSettingsSchema.optional(),
  httpupgradeSettings: HttpupgradeSettingsSchema.optional(),
  xhttpSettings: XhttpSettingsSchema.optional(),
  hysteriaSettings: HysteriaSettingsSchema.optional(),
  finalmask: FinalmaskSchema.optional(),
  sockopt: SockoptSchema.optional(),
})

export const SniffingSchema = z.looseObject({
  enabled: z.boolean().optional(),
  destOverride: z.array(z.string()).optional(),
  routeOnly: z.boolean().optional(),
  metadataOnly: z.boolean().optional(),
})
