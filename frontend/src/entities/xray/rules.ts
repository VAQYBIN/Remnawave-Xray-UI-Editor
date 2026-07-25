// Чистая логика правил маршрутизации. Живёт в entities (не в RuleForm),
// чтобы analyzeIntegrity мог переиспользовать её без слоевого нарушения:
// entities не импортирует из features.

// Известные префиксы доменных матчеров Xray; строка без префикса матчится как keyword-подстрока
export const DOMAIN_PREFIXES = ['domain:', 'full:', 'regexp:', 'geosite:', 'keyword:', 'ext:']

export function keywordEntries(items: string[] | undefined): string[] {
  return (items ?? []).filter((s) => !DOMAIN_PREFIXES.some((p) => s.startsWith(p)))
}

// Формат port/sourcePort правила: «443», «1000-2000» или их список через запятую
export function portSpecError(value: string | number | undefined): string | null {
  if (value === undefined) return null
  for (const part of String(value).split(',').map((s) => s.trim())) {
    if (part === '') return 'Пустой элемент в списке портов'
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part)
    if (!m) return `Некорректный формат «${part}» — ожидается 443, 1000-2000 или их список через запятую`
    const lo = Number(m[1])
    const hi = m[2] === undefined ? lo : Number(m[2])
    if (lo < 1 || hi > 65535) return `Порт вне диапазона 1–65535: «${part}»`
    if (lo > hi) return `Начало диапазона больше конца: «${part}»`
  }
  return null
}

/** Совпадает ли порт со спецификацией правила. Формат тот же, что проверяет portSpecError. */
export function portMatches(spec: string | number | undefined, port: number): boolean {
  if (spec === undefined) return true
  for (const part of String(spec).split(',').map((s) => s.trim())) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part)
    if (!m) continue
    const lo = Number(m[1])
    const hi = m[2] === undefined ? lo : Number(m[2])
    if (port >= lo && port <= hi) return true
  }
  return false
}
