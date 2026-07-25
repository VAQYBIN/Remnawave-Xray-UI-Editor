// Ядро сообщает об ошибке цепочкой «слой > слой > конкретная причина» в одну строку.
// Показываем цепочку как есть (по ней ищут в issues), а рядом — русскую подсказку
// для случаев, которые в этом редакторе встречаются регулярно.

export interface XrayTestError {
  message: string
  line?: number
  hint?: string
  /** 'geo' — UI предлагает открыть диалог Geo-баз вместо сырого текста */
  code?: 'geo'
}

const HINTS: { pattern: RegExp; hint: string; code?: 'geo' }[] = [
  {
    pattern: /(geosite|geoip)\.dat|geodata:/i,
    hint: 'Ядро не нашло geo-базы. Загрузите их в диалоге «Geo-базы»: правила с geosite:/geoip: без файлов списков не собираются.',
    code: 'geo',
  },
  {
    pattern: /empty clients|no valid users?|user is not specified/i,
    hint: 'Inbound без пользователей. Панель подставляет их сама, редактор — тоже (на время проверки), так что ошибка означает несовпадение протокола и settings.',
  },
  {
    pattern: /unable to find (outbound|balancer)|tag (does not exist|not found)/i,
    hint: 'Правило или балансер ссылается на тег outbound, которого нет в конфиге.',
  },
  {
    pattern: /reality|empty "?serverNames"?/i,
    hint: 'Reality собран неполно: нужны serverNames, приватный ключ и shortIds.',
  },
  {
    // «unknown config id: vmesss» — так ядро 26.6.27 сообщает о неизвестном протоколе
    pattern: /unknown (protocol|network|security|config id)|unsupported/i,
    hint: 'Ядро не знает такой протокол или транспорт — проверьте написание значения.',
  },
  {
    pattern: /cannot unmarshal|invalid character|failed to parse json/i,
    hint: 'Значение не того типа, чем ждёт ядро (строка вместо числа или наоборот).',
  },
  {
    pattern: /no such file or directory/i,
    hint: 'Конфиг ссылается на файл, которого нет на диске рядом с ядром (сертификат, ключ, лог).',
  },
]

/**
 * Предупреждения ядра приходят и при успешной проверке (например, «Trojan
 * устарел, переходите на VLESS») — терять их незачем, это ровно тот совет,
 * ради которого проверку и запускают. Строки [Info] отбрасываем: там путь
 * к временному файлу и ничего полезного.
 */
export function parseXrayWarnings(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => /\[Warning\]\s*(.+)$/.exec(line.trim())?.[1]?.trim())
    .filter((line): line is string => line !== undefined && line !== '')
}

export function versionOf(output: string): string | undefined {
  return /^Xray\s+(\S+)/m.exec(output)?.[1]
}

function scrub(line: string, configPath: string): string {
  const base = configPath.split(/[\\/]/).pop() ?? configPath
  return line
    .replace(/^Failed to start:\s*/i, '')
    .replace(/^main:\s*/i, '')
    .split(configPath)
    .join('конфиг')
    .split(base)
    .join('конфиг')
    .replace(/\[конфиг\]\s*>\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseXrayOutput(output: string, configPath: string): XrayTestError[] {
  if (/Configuration OK/i.test(output)) return []

  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  let raw = lines.filter((l) => /^(failed to|panic:)/i.test(l))
  // Ядро молчит понятным нам образом — не выдумываем причину, показываем весь вывод
  if (raw.length === 0) raw = lines.length > 0 ? [lines.join(' ')] : ['Ядро не вернуло вывода']

  return raw.map((line) => {
    const message = scrub(line, configPath)
    const hit = HINTS.find((h) => h.pattern.test(message))
    const lineNo = /(?:at )?line (\d+)/i.exec(message)?.[1]
    return {
      message,
      ...(lineNo === undefined ? {} : { line: Number(lineNo) }),
      ...(hit === undefined ? {} : { hint: hit.hint }),
      ...(hit?.code === undefined ? {} : { code: hit.code }),
    }
  })
}
