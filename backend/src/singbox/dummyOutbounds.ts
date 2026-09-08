// Ядро отвергнет корректный шаблон: группы ссылаются на серверы, которых в
// документе нет — их подставит панель. Перед проверкой кладём фиктивные,
// как xray/dummyClient.ts кладёт фиктивного пользователя.
//
// Повторяем ровно то, что делает генератор панели
// (remnawave/backend, singbox.generator.service.ts): серверы дописываются в
// КОНЕЦ, список группы перезаписывается целиком, `includeProxies: false`
// оставляет список как есть, ключ `remnawave` вырезается. Расхождение с
// генератором сделало бы вердикт ядра ответом про другой документ.

/** Типы выходов, которые панель считает прокси при заполнении групп */
const PROXY_TYPES = new Set(['vless', 'trojan', 'shadowsocks', 'hysteria2'])

/**
 * Фиксированные значения: вердикт проверки не должен зависеть от случайности.
 * Тип назван явно: без него литерал сузился бы до собственных полей, и элементы
 * документа рядом с ним потеряли бы индексную сигнатуру.
 */
const DUMMY: Record<string, unknown>[] = [
  {
    type: 'shadowsocks',
    tag: 'singbox-dummy-1',
    server: '127.0.0.1',
    server_port: 1080,
    method: 'aes-128-gcm',
    password: 'dummy',
  },
  {
    type: 'shadowsocks',
    tag: 'singbox-dummy-2',
    server: '127.0.0.1',
    server_port: 1081,
    method: 'aes-128-gcm',
    password: 'dummy',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function withDummyOutbounds(doc: unknown): unknown {
  if (!isRecord(doc)) return doc
  // Копия целиком: вход — документ пользователя, и правка на месте отравила бы
  // объект, который вызывающий ещё держит
  const out = structuredClone(doc) as Record<string, unknown>
  delete out.remnawave

  const template = Array.isArray(out.outbounds) ? out.outbounds.filter(isRecord) : []
  const all = [...template, ...DUMMY.map((d) => ({ ...d }))]

  const proxyTags = all
    .filter((o) => typeof o.type === 'string' && PROXY_TYPES.has(o.type))
    .map((o) => String(o.tag))
  const urltestTags = all.filter((o) => o.type === 'urltest').map((o) => String(o.tag))

  out.outbounds = all.map((outbound) => {
    const copy = { ...outbound }
    const panelKey = isRecord(copy.remnawave) ? copy.remnawave : undefined
    delete copy.remnawave
    if (panelKey?.includeProxies === false) return copy
    if (copy.type === 'urltest') return { ...copy, outbounds: proxyTags }
    if (copy.type === 'selector') return { ...copy, outbounds: [...proxyTags, ...urltestTags] }
    return copy
  })

  return out
}
