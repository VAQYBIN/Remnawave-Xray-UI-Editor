import { zstdDecompressSync } from 'node:zlib'
import { RuleSetError } from './errors.js'

export type RuleBehavior = 'domain' | 'ipcidr' | 'classical'

/** Байт вида набора: constant/provider/interface.go, RuleBehavior.Byte() */
const BEHAVIOR_BY_BYTE: Record<number, RuleBehavior> = {
  0: 'domain',
  1: 'ipcidr',
  2: 'classical',
}

/** Заголовок: подпись, вид, счётчик, зарезервированное поле — 21 байт */
const HEADER_BYTES = 21

export interface MrsFile {
  behavior: RuleBehavior
  /**
   * Число записей ИСХОДНОГО списка, как его записало ядро. В боре доменов
   * ключей вдвое больше: на каждый домен ядро кладёт и его самого, и форму
   * `+.<домен>`. Пользователю показываем это число, а не число ключей.
   */
  count: number
  body: Buffer
}

/**
 * Разбор `.mrs`: весь файл — один zstd-поток, внутри заголовок и тело.
 * Прочитано в `rules/provider/mrs_reader.go`; документации на формат нет.
 */
export function parseMrs(raw: Uint8Array, maxPlainBytes: number): MrsFile {
  // Осознанно НЕ RuleSetError: это промах вызывающего, и выдать его за
  // испорченный набор — отправить пользователя чинить чужой файл вместо нас
  if (!(raw instanceof Uint8Array)) throw new TypeError('parseMrs ждёт Uint8Array')

  let buf: Buffer
  try {
    buf = zstdDecompressSync(raw, { maxOutputLength: maxPlainBytes })
  } catch (err) {
    // Отдельный текст на превышение потолка: «файл не распаковывается» увело бы
    // в сторону испорченного файла, а дело в размере
    const code = (err as { code?: string }).code
    throw new RuleSetError(
      code === 'ERR_BUFFER_TOO_LARGE'
        ? `Распакованный набор больше ${maxPlainBytes} байт`
        : 'Набор не распаковывается: это не zstd или файл испорчен',
      { cause: err },
    )
  }

  if (buf.length < HEADER_BYTES) throw new RuleSetError('Файл короче заголовка MRS')
  if (buf.subarray(0, 3).toString('latin1') !== 'MRS') {
    throw new RuleSetError('Это не набор правил MRS: подпись не совпала')
  }
  // Версия живёт четвёртым байтом подписи, поэтому о ней отдельный текст:
  // «подпись не совпала» на новом формате ядра сбило бы с толку
  if (buf[3] !== 1) {
    throw new RuleSetError(`Версия формата MRS ${buf[3]} — редактор знает только первую`)
  }

  const behavior = BEHAVIOR_BY_BYTE[buf[4]!]
  if (behavior === undefined) {
    throw new RuleSetError(`Незнакомый вид набора: байт ${buf[4]}`)
  }

  const count = Number(buf.readBigInt64BE(5))
  // Ядро это поле не проверяет, но у ядра оно и не уходит ни в интерфейс, ни в
  // счётчик цикла. «Набор из 4.6·10^18 правил» — не то, что стоит показывать
  if (count < 0 || !Number.isSafeInteger(count)) {
    throw new RuleSetError(`Испорченный заголовок MRS: число записей ${count}`)
  }
  const extraLen = Number(buf.readBigInt64BE(13))
  if (extraLen < 0 || HEADER_BYTES + extraLen > buf.length) {
    throw new RuleSetError('Испорченный заголовок MRS: неверная длина запаса')
  }

  return { behavior, count, body: buf.subarray(HEADER_BYTES + extraLen) }
}
