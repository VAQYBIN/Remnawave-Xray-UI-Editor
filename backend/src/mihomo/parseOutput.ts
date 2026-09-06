/**
 * Формат вывода `mihomo -t` версии не фиксирован, поэтому вердикт берём по коду
 * возврата, а из текста достаём только содержательные строки. Выдумывать разбор
 * по конкретным фразам ядра нельзя: обновление ядра сделало бы проверку слепой.
 */
export function parseMihomoOutput(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.replace(/^time="[^"]*"\s*/, ''))
}
