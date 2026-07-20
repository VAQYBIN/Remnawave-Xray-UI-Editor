import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig()
const app = await buildServer(config)
await app.listen({ port: config.port, host: '0.0.0.0' })
