import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { derivePublicKey, generateRealityKeypair } from '../tools/reality.js'
import { probeRealityTarget, type RealityProbe } from '../tools/realityProbe.js'

const deriveSchema = z.object({ privateKey: z.string().min(1) })
const xrayTestSchema = z.object({ config: z.unknown() })
const realitySchema = z.object({
  target: z.string().min(1),
  serverNames: z.array(z.string()).default([]),
})

export interface ToolsRoutesOptions {
  probeReality?: RealityProbe
}

export const toolsRoutes: FastifyPluginAsync<ToolsRoutesOptions> = async (app, opts) => {
  const probe = opts.probeReality ?? probeRealityTarget

  app.post('/api/tools/reality-keypair', async () => generateRealityKeypair())

  app.post('/api/tools/reality-public-key', async (req) => {
    const { privateKey } = deriveSchema.parse(req.body)
    return { publicKey: derivePublicKey(privateKey) }
  })

  app.post('/api/tools/xray-test', async (req, reply) => {
    // z.unknown() не отличает «не передали» от «передали undefined» — проверяем сами
    const { config } = xrayTestSchema.parse(req.body ?? {})
    if (config === undefined) {
      return reply.status(400).send({ message: 'Нужно передать поле config' })
    }
    return app.xray.test(config)
  })

  app.post('/api/tools/reality-target', async (req) => {
    const input = realitySchema.parse(req.body)
    return probe(input)
  })
}
