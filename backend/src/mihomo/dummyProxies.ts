// Ядро отвергнет корректный шаблон: proxies пуст, а группы ссылаются на имена,
// которых ещё нет — их подставит панель. Перед проверкой кладём фиктивные
// серверы, как xray/dummyClient.ts кладёт фиктивного пользователя.
//
// ЕДИНСТВЕННОЕ место во всём проекте, где YAML печатается из модели: результат
// уходит во временный файл для ядра и тут же удаляется, пользовательский
// документ он не заменяет.

import { parse, stringify } from 'yaml'

const MARKER = 'LEAVE THIS LINE!'

/** Фиксированные значения: вердикт проверки не должен зависеть от случайности */
const DUMMY = [
  { name: 'mihomo-dummy-1', type: 'socks5', server: '127.0.0.1', port: 1080 },
  { name: 'mihomo-dummy-2', type: 'socks5', server: '127.0.0.1', port: 1081 },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function withDummyProxies(yamlText: string): string {
  const marked = yamlText.includes(MARKER)
  const config = parse(yamlText) as unknown
  if (!isRecord(config)) return yamlText

  delete config.remnawave
  config.proxies = [...DUMMY]
  const names = DUMMY.map((p) => p.name)

  const groups = config['proxy-groups']
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (!isRecord(group)) continue
      const remnawave = isRecord(group.remnawave) ? group.remnawave : undefined
      delete group.remnawave
      if (remnawave?.['include-proxies'] === false) continue
      const proxies = Array.isArray(group.proxies) ? group.proxies : []
      // Пустая группа ядру не нравится, поэтому имена добавляем и тем, у кого
      // маркер стоял, и тем, кто остался бы вовсе без кандидатов
      if (marked || proxies.length === 0) group.proxies = [...proxies, ...names]
    }
  }

  const providers = config['proxy-providers']
  if (isRecord(providers)) {
    for (const provider of Object.values(providers)) {
      if (!isRecord(provider)) continue
      delete provider.remnawave
      if (provider.type !== 'inline') continue
      const payload = Array.isArray(provider.payload) ? provider.payload : []
      if (payload.length === 0) provider.payload = [...DUMMY]
    }
  }

  return stringify(config)
}
