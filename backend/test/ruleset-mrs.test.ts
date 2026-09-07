// backend/test/ruleset-mrs.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseMrs } from '../src/ruleset/mrs.js'
import { RuleSetError } from '../src/ruleset/errors.js'

const DIR = join(import.meta.dirname, 'fixtures', 'ruleset')
const fixture = (name: string): Uint8Array => readFileSync(join(DIR, name))
const MAX = 32 * 1024 * 1024

/** Собрать .mrs с произвольным заголовком — для проверки отказов */
function madeUp(magic: string, version: number, behavior: number, count: bigint): Uint8Array {
  const head = Buffer.alloc(21)
  head.write(magic, 0, 'latin1')
  head[3] = version
  head[4] = behavior
  head.writeBigInt64BE(count, 5)
  head.writeBigInt64BE(0n, 13)
  return zstdCompressSync(head)
}

describe('заголовок .mrs', () => {
  it('читает настоящий набор доменов', () => {
    const file = parseMrs(fixture('faceit.mrs'), MAX)
    expect(file.behavior).toBe('domain')
    expect(file.count).toBe(2)
    // Точная длина, а не «больше нуля»: без неё чтение extraLen со смещения 14
    // вместо 13 сдвигало тело на байт и НЕ роняло ни одного теста
    expect(file.body.length).toBe(69)
  })

  it('читает настоящий набор подсетей', () => {
    const file = parseMrs(fixture('geoip-private.mrs'), MAX)
    expect(file.behavior).toBe('ipcidr')
    expect(file.count).toBe(17)
    expect(file.body.length).toBe(553)
  })

  it('версия формата, кроме первой, — отказ с указанием версии', () => {
    expect(() => parseMrs(madeUp('MRS', 2, 0, 1n), MAX)).toThrow(RuleSetError)
    // Номер версии обязан быть в тексте: без него на новом формате ядра
    // пользователь не поймёт, что именно пришло
    expect(() => parseMrs(madeUp('MRS', 2, 0, 1n), MAX)).toThrow(/версия формата MRS 2/i)
  })

  it('чужая подпись — отказ, и не про версию', () => {
    expect(() => parseMrs(madeUp('SRS', 1, 0, 1n), MAX)).toThrow(/подпись|не набор/i)
  })

  it('незнакомый вид набора — отказ с номером байта', () => {
    expect(() => parseMrs(madeUp('MRS', 1, 7, 1n), MAX)).toThrow(/7/)
  })

  it('не-zstd мусор — RuleSetError, а не исключение распаковщика', () => {
    expect(() => parseMrs(new Uint8Array([1, 2, 3, 4]), MAX)).toThrow(RuleSetError)
    expect(() => parseMrs(new Uint8Array([1, 2, 3, 4]), MAX)).toThrow(/не распаковывается/)
  })

  it('чужой тип аргумента — наша ошибка, а не испорченный набор', () => {
    // Иначе промах вызывающего читается как «ваш файл битый», и пользователь
    // идёт чинить чужой .mrs вместо нас
    expect(() => parseMrs(null as unknown as Uint8Array, MAX)).toThrow(TypeError)
    expect(() => parseMrs(null as unknown as Uint8Array, MAX)).not.toThrow(RuleSetError)
  })

  it('причина отказа распаковщика не теряется', () => {
    try {
      parseMrs(new Uint8Array([1, 2, 3, 4]), MAX)
      expect.unreachable('должно было бросить')
    } catch (err) {
      expect((err as Error).name).toBe('RuleSetError')
      expect((err as Error).cause).toBeDefined()
    }
  })

  it('отрицательное число записей — отказ', () => {
    expect(() => parseMrs(madeUp('MRS', 1, 0, -1n), MAX)).toThrow(/число записей/)
  })

  it('число записей за пределом точности — отказ', () => {
    // 2^63-1 после Number() уже не то число, что записано; крутить по нему цикл
    // чтения означало бы повесить бэкенд на одном скачанном файле
    expect(() => parseMrs(madeUp('MRS', 1, 0, 2n ** 63n - 1n), MAX)).toThrow(/число записей/)
  })

  it('обрезанный заголовок — отказ, а не чтение за границей буфера', () => {
    expect(() => parseMrs(zstdCompressSync(Buffer.from('MRS\x01\x00')), MAX)).toThrow(RuleSetError)
  })

  it('zstd-бомба отбивается потолком распаковки', () => {
    // Бомба с ЗАКОННЫМ заголовком: 64 МБ нулей сжимаются примерно в две тысячи
    // байт, и потолок на проводе такое пропустит — остановить это может только
    // предел на выходе распаковщика.
    //
    // Заголовок здесь не для красоты. С мусором вместо него тест проходил бы и
    // без всякого лимита: нули не совпали бы с подписью, и отказ пришёл бы по
    // другой причине, но того же класса. С законным заголовком снятый лимит
    // означает, что разбор УСПЕШЕН, и тест падает на «не бросил ничего».
    const head = Buffer.alloc(21)
    head.write('MRS', 0, 'latin1')
    head[3] = 1
    head[4] = 0 // domain
    head.writeBigInt64BE(0n, 5)
    head.writeBigInt64BE(0n, 13)
    const bomb = zstdCompressSync(Buffer.concat([head, Buffer.alloc(64 * 1024 * 1024)]))
    expect(bomb.length).toBeLessThan(10_000)
    // Проверяем и текст: он обязан говорить про размер, а не про испорченный файл
    expect(() => parseMrs(bomb, 1024 * 1024)).toThrow(/больше 1048576 байт/)
  })
})
