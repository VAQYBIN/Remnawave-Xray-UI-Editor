/** Узкий неразрывный пробел: `15 511` читается, `15511` — нет */
const GROUP_SEPARATOR = ' '

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
