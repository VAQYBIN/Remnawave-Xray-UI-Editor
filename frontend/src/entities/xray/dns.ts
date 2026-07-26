import { z } from 'zod'

export const DnsServerObjectSchema = z.looseObject({
  address: z.string().optional(),
  port: z.number().optional(),
  domains: z.array(z.string()).optional(),
  expectIPs: z.array(z.string()).optional(),
  skipFallback: z.boolean().optional(),
  queryStrategy: z.string().optional(),
})

export const DnsServerSchema = z.union([z.string(), DnsServerObjectSchema])

export const DnsSchema = z.looseObject({
  servers: z.array(DnsServerSchema).optional(),
  hosts: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  clientIp: z.string().optional(),
  queryStrategy: z.string().optional(),
  tag: z.string().optional(),
})
