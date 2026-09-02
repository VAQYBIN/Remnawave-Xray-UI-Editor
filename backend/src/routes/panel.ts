import type { FastifyPluginAsync } from 'fastify'
import type { AppConfig } from '../config.js'
import { describeToken } from '../remnawave/token.js'

export const panelRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (app, opts) => {
  app.get('/api/nodes', async () => ({ nodes: await app.remnawave.getNodes() }))
  app.get('/api/squads', async () => ({ squads: await app.remnawave.getSquads() }))

  // Только срок: сам токен и его claims (uuid оператора) наружу не уходят.
  app.get('/api/panel/token', async () => describeToken(opts.config.remnawaveToken))
}
