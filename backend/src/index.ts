import { loadConfig } from './config.js'
import { buildServer } from './server.js'

try {
  const config = loadConfig()
  const app = await buildServer(config)
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
