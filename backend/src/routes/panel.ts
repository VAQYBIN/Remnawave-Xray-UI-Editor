import type { FastifyPluginAsync } from 'fastify'

export const panelRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/nodes', async () => ({ nodes: await app.remnawave.getNodes() }))
  app.get('/api/squads', async () => ({ squads: await app.remnawave.getSquads() }))
}
