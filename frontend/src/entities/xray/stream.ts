import { z } from 'zod'

const obj = () => z.object({}).passthrough()

export const RealitySettingsSchema = z
  .object({
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
  })
  .passthrough()

export const TlsSettingsSchema = z
  .object({
    serverName: z.string().optional(),
    alpn: z.array(z.string()).optional(),
    certificates: z.array(obj()).optional(),
    minVersion: z.string().optional(),
    fingerprint: z.string().optional(),
  })
  .passthrough()

export const StreamSettingsSchema = z
  .object({
    network: z.string().optional(),
    security: z.string().optional(),
    realitySettings: RealitySettingsSchema.optional(),
    tlsSettings: TlsSettingsSchema.optional(),
    tcpSettings: obj().optional(),
    wsSettings: z
      .object({ path: z.string().optional(), host: z.string().optional(), headers: obj().optional() })
      .passthrough()
      .optional(),
    grpcSettings: z
      .object({ serviceName: z.string().optional(), multiMode: z.boolean().optional() })
      .passthrough()
      .optional(),
    httpupgradeSettings: z
      .object({ path: z.string().optional(), host: z.string().optional() })
      .passthrough()
      .optional(),
    xhttpSettings: obj().optional(),
    sockopt: obj().optional(),
  })
  .passthrough()

export const SniffingSchema = z
  .object({
    enabled: z.boolean().optional(),
    destOverride: z.array(z.string()).optional(),
    routeOnly: z.boolean().optional(),
  })
  .passthrough()
