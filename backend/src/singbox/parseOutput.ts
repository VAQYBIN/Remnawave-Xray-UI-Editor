/**
 * Формат вывода `sing-box check` от версии к версии не фиксирован, поэтому
 * вердикт берём по коду возврата, а из текста достаём только содержательные
 * строки. Разбор по конкретным фразам ядра сделал бы проверку слепой после
 * первого же обновления.
 */
export function parseSingboxOutput(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}
