import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const validEnv = {
  REMNAWAVE_URL: 'https://panel.example.com/',
  REMNAWAVE_TOKEN: 'secret-token',
  APP_PASSWORD: 'super-secret-1',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
}

describe('loadConfig', () => {
  it('парсит валидное окружение и подставляет дефолты', () => {
    const config = loadConfig(validEnv)
    expect(config.remnawaveUrl).toBe('https://panel.example.com') // без хвостового слэша
    expect(config.remnawaveToken).toBe('secret-token')
    expect(config.port).toBe(3000)
    expect(config.dataDir).toBe('./data')
    expect(config.staticDir).toBe('./public')
    expect(config.sessionTtlSeconds).toBe(604800)
  })

  it('уважает переопределения PORT и DATA_DIR', () => {
    const config = loadConfig({ ...validEnv, PORT: '8080', DATA_DIR: '/data' })
    expect(config.port).toBe(8080)
    expect(config.dataDir).toBe('/data')
  })

  it('падает с русским сообщением при отсутствии REMNAWAVE_TOKEN', () => {
    const { REMNAWAVE_TOKEN: _omit, ...rest } = validEnv
    expect(() => loadConfig(rest)).toThrow(/Некорректная конфигурация окружения/)
  })

  it('падает с подсказкой при повреждённом bcrypt-хэше (интерполяция $ в docker compose)', () => {
    // хэш $2b$12$C6UzMDM... после интерполяции compose теряет "$C6UzMDM" -> 52 символа
    const mangled = '$2b$12.H6dfI/f/IKcEeO7ZBpDvhpVghUlmxvIgGmXcSl7dcqrqq'
    expect(() => loadConfig({ ...validEnv, APP_PASSWORD: mangled })).toThrow(/одинарные кавычки|\$\$/)
  })

  it('принимает целый bcrypt-хэш длиной 60', () => {
    const intact = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpDvhpVghUlmxvIgGmXcSl7dcqrqq'
    expect(loadConfig({ ...validEnv, APP_PASSWORD: intact }).appPassword).toBe(intact)
  })

  it('падает при коротком SESSION_SECRET', () => {
    expect(() => loadConfig({ ...validEnv, SESSION_SECRET: 'short' })).toThrow(
      /Некорректная конфигурация окружения/,
    )
  })
})
