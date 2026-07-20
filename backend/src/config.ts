import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  REMNAWAVE_URL: z.string().url(),
  REMNAWAVE_TOKEN: z.string().min(1),
  APP_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
  DATA_DIR: z.string().default('./data'),
  STATIC_DIR: z.string().default('./public'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
})

export interface AppConfig {
  port: number
  remnawaveUrl: string
  remnawaveToken: string
  appPassword: string
  sessionSecret: string
  dataDir: string
  staticDir: string
  sessionTtlSeconds: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Некорректная конфигурация окружения: ${issues}`)
  }
  const e = parsed.data
  // bcrypt-хэш всегда ровно 60 символов; docker compose интерполирует `$слово`
  // в .env и молча вырезает куски хэша — ловим это на старте с понятной подсказкой.
  if (e.APP_PASSWORD.startsWith('$2') && e.APP_PASSWORD.length !== 60) {
    throw new Error(
      `Некорректная конфигурация окружения: APP_PASSWORD похож на повреждённый bcrypt-хэш ` +
        `(${e.APP_PASSWORD.length} символов вместо 60). Docker Compose интерполирует "$" в .env — ` +
        `возьмите хэш в одинарные кавычки либо замените каждый "$" на "$$".`,
    )
  }
  return {
    port: e.PORT,
    remnawaveUrl: e.REMNAWAVE_URL.replace(/\/+$/, ''),
    remnawaveToken: e.REMNAWAVE_TOKEN,
    appPassword: e.APP_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    dataDir: e.DATA_DIR,
    staticDir: e.STATIC_DIR,
    sessionTtlSeconds: e.SESSION_TTL_SECONDS,
  }
}
