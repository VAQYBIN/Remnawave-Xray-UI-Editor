import { z } from 'zod'
import { BalancerSchema } from './balancers'

export const RoutingRuleSchema = z
  .object({
    type: z.string().optional(),
    inboundTag: z.array(z.string()).optional(),
    outboundTag: z.string().optional(),
    balancerTag: z.string().optional(),
    domain: z.array(z.string()).optional(),
    ip: z.array(z.string()).optional(),
    port: z.union([z.string(), z.number()]).optional(),
    sourcePort: z.union([z.string(), z.number()]).optional(),
    network: z.string().optional(),
    protocol: z.array(z.string()).optional(),
    user: z.array(z.string()).optional(),
    source: z.array(z.string()).optional(),
  })
  .passthrough()

export const RoutingSchema = z
  .object({
    domainStrategy: z.string().optional(),
    domainMatcher: z.string().optional(),
    rules: z.array(RoutingRuleSchema).optional(),
    balancers: z.array(BalancerSchema).optional(),
  })
  .passthrough()
