/**
 * Узкий НЕРАЗРЫВНЫЙ пробел (U+202F), а не обычный. Обычный браузер вправе
 * порвать переносом ровно между разрядами, и «15 511» распалось бы на «15» и
 * «511» на разных строках — как раз в узкой колонке метрик, где это вероятнее
 * всего. Тест этого не ловил: он сравнивался с тем же обычным пробелом, то есть
 * код сверялся сам с собой.
 */
const GROUP_SEPARATOR = '\u202F'

/**
 * Разряды числа через пробел. Своя реализация, а не `toLocaleString`, потому что
 * набор разделителей у Intl зависит от среды: в jsdom и в браузере они разные,
 * и тест либо ловил бы не то, либо сравнивался бы сам с собой.
 */
export function groupDigits(value: number): string {
  const text = String(Math.trunc(Math.abs(value)))
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && (text.length - i) % 3 === 0) out += GROUP_SEPARATOR
    out += text[i]
  }
  return value < 0 ? `-${out}` : out
}

/** Размер файла набора: они бывают и в килобайтах, и в мегабайтах */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
