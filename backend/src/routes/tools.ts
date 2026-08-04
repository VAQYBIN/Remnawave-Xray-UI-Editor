import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { derivePublicKey, generateRealityKeypair } from '../tools/reality.js'
import { probeRealityTarget, type RealityProbe } from '../tools/realityProbe.js'
import { registerWarpAccount, type WarpRegister } from '../tools/warp.js'

const deriveSchema = z.object({ privateKey: z.string().min(1) })
const xrayTestSchema = z.object({ config: z.unknown(), profileUuid: z.string().optional() })
const realitySchema = z.object({
  target: z.string().min(1),
  serverNames: z.array(z.string()).default([]),
})

export interface ToolsRoutesOptions {
  probeReality?: RealityProbe
  registerWarp?: WarpRegister
}

export const toolsRoutes: FastifyPluginAsync<ToolsRoutesOptions> = async (app, opts) => {
  const probe = opts.probeReality ?? probeRealityTarget
  const warp = opts.registerWarp ?? (() => registerWarpAccount())

  app.post('/api/tools/reality-keypair', async () => generateRealityKeypair())

  app.post('/api/tools/reality-public-key', async (req) => {
    const { privateKey } = deriveSchema.parse(req.body)
    return { publicKey: derivePublicKey(privateKey) }
  })

  app.post('/api/tools/xray-test', async (req, reply) => {
    // z.unknown() не отличает «не передали» от «передали undefined» — проверяем сами
    const { config, profileUuid } = xrayTestSchema.parse(req.body ?? {})
    if (config === undefined) {
      return reply.status(400).send({ message: 'Нужно передать поле config' })
    }
    let computed: unknown
    if (profileUuid !== undefined) {
      // Панель недоступна или профиль ещё не сохранён — проверка обязана
      // работать так же, как работала до computed-config
      try {
        computed = await app.remnawave.getComputedConfig(profileUuid)
      } catch (err) {
        req.log.warn({ err }, 'computed-config недоступен, проверяем на фиктивных клиентах')
      }
    }
    return app.xray.test(config, computed)
  })

  app.post('/api/tools/reality-target', async (req) => {
    const input = realitySchema.parse(req.body)
    return probe(input)
  })

  // Неофициальный API Cloudflare: отказ не должен выглядеть как поломка редактора —
  // у пользователя остаётся ручной ввод ключей из wgcf
  app.post('/api/tools/warp-account', async (_req, reply) => {
    try {
      return await warp()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return reply.status(502).send({
        message: `Cloudflare не выдал аккаунт WARP: ${reason}. Введите ключи вручную (wgcf)`,
      })
    }
  })
}
