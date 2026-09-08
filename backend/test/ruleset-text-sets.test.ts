import { describe, expect, it } from 'vitest'
import { domainSetFromLines, ipCidrSetFromLines } from '../src/ruleset/textSets.js'

describe('текстовый набор подсетей', () => {
  it('обычная запись работает', () => {
    const set = ipCidrSetFromLines(['10.0.0.0/8', '192.168.0.0/16'])
    expect(set.has('10.1.2.3')).toBe(true)
    expect(set.has('192.168.1.1')).toBe(true)
    expect(set.has('8.8.8.8')).toBe(false)
  })

  it('адрес без длины префикса — это ровно один адрес', () => {
    const set = ipCidrSetFromLines(['10.0.0.1'])
    expect(set.has('10.0.0.1')).toBe(true)
    expect(set.has('10.0.0.2')).toBe(false)
  })

  it('лишняя косая не превращает набор во «всё подряд»', () => {
    // Самый дорогой из возможных промахов: `Number('')` равен нулю, и запись
    // `10.0.0.0/` укладывалась в набор как `0.0.0.0/0`. Одна опечатка в чужом
    // наборе делала бы правило RULE-SET совпавшим для ЛЮБОГО адреса, и
    // трассировка уверенно называла бы неверный маршрут
    const set = ipCidrSetFromLines(['10.0.0.0/'])
    expect(set.has('8.8.8.8')).toBe(false)
    expect(set.has('10.0.0.1')).toBe(false)
  })

  it('нечисловая длина префикса отбрасывает строку', () => {
    // `Number` принял бы и то, и другое — поэтому длину читаем сами
    expect(ipCidrSetFromLines(['10.0.0.0/0x8']).has('10.0.0.1')).toBe(false)
    expect(ipCidrSetFromLines(['10.0.0.0/ 8 ']).has('10.0.0.1')).toBe(false)
    expect(ipCidrSetFromLines(['10.0.0.0/-8']).has('10.0.0.1')).toBe(false)
  })

  it('длина префикса больше размера адреса отбрасывает строку', () => {
    expect(ipCidrSetFromLines(['10.0.0.0/33']).has('10.0.0.1')).toBe(false)
    expect(ipCidrSetFromLines(['::/129']).has('::1')).toBe(false)
  })

  it('явный нулевой префикс — законная запись и работает как «всё»', () => {
    // Отличать её от опечатки обязательно: `0.0.0.0/0` пишут намеренно
    expect(ipCidrSetFromLines(['0.0.0.0/0']).has('8.8.8.8')).toBe(true)
  })

  it('мусорная строка пропускается, а соседняя работает', () => {
    const set = ipCidrSetFromLines(['не адрес', '10.0.0.0/8'])
    expect(set.has('10.1.1.1')).toBe(true)
    expect(set.has('8.8.8.8')).toBe(false)
  })

  it('IPv6 ищется в своём семействе', () => {
    const set = ipCidrSetFromLines(['fc00::/7'])
    expect(set.has('fc00::1')).toBe(true)
    expect(set.has('10.0.0.1')).toBe(false)
  })
})

describe('текстовый набор доменов', () => {
  it('«+.» ловит и сам домен, и поддомены', () => {
    const set = domainSetFromLines(['+.example.com'])
    expect(set.has('example.com')).toBe(true)
    expect(set.has('a.b.example.com')).toBe(true)
    expect(set.has('notexample.com')).toBe(false)
  })

  it('«*.» ловит ровно одну метку', () => {
    const set = domainSetFromLines(['*.example.com'])
    expect(set.has('a.example.com')).toBe(true)
    expect(set.has('a.b.example.com')).toBe(false)
    expect(set.has('example.com')).toBe(false)
  })

  it('ведущая точка ловит только поддомены', () => {
    const set = domainSetFromLines(['.example.com'])
    expect(set.has('a.example.com')).toBe(true)
    expect(set.has('example.com')).toBe(false)
  })

  it('без подстановки — точное совпадение без учёта регистра', () => {
    const set = domainSetFromLines(['Example.COM'])
    expect(set.has('example.com')).toBe(true)
    expect(set.has('a.example.com')).toBe(false)
  })
})

describe('текстовый набор доменов: подстановка на любой метке', () => {
  it('«*» в середине совпадает, как в ядре', () => {
    // Прежняя редакция знала только ведущую «*.», и запись ниже не совпадала ни
    // с чем: ядро отвечало «да», редактор — уверенное «нет»
    const set = domainSetFromLines(['www.*.example.com'])
    expect(set.has('www.a.example.com')).toBe(true)
    expect(set.has('www.b.example.com')).toBe(true)
    expect(set.has('www.a.b.example.com')).toBe(false)
    expect(set.has('www.example.com')).toBe(false)
  })

  it('«*» — ровно одна метка, а не любой остаток', () => {
    const set = domainSetFromLines(['*.example.com'])
    expect(set.has('a.example.com')).toBe(true)
    expect(set.has('a.b.example.com')).toBe(false)
  })

  it('«+.» после подстановки по-прежнему любой глубины', () => {
    const set = domainSetFromLines(['+.*.example.com'])
    expect(set.has('x.a.example.com')).toBe(true)
    expect(set.has('y.z.a.example.com')).toBe(true)
    expect(set.has('a.example.com')).toBe(true)
    expect(set.has('example.com')).toBe(false)
  })
})
