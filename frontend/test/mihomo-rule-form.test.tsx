import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MihomoRuleForm } from '../src/features/inspector/MihomoRuleForm'
import type { DocRefs } from '../src/features/inspector/schema/DocPanel'
import type { SchemaPath } from '../src/shared/schema'
import { makeWriter } from './schemaHelpers'
import { selectOption, optionLabels } from './helpers'

const REFS: DocRefs = { 'proxy-target': ['A', 'DIRECT'], 'sub-rule': ['block'] }

function renderRule(raw: string, path: SchemaPath = ['rules', 0], refs: DocRefs = REFS) {
  const { ops, writer } = makeWriter()
  render(<MihomoRuleForm raw={raw} path={path} writer={writer} refs={refs} />)
  return { ops, writer }
}

describe('форма правила Mihomo', () => {
  it('раскладывает строку на поля', () => {
    renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    expect(screen.getByLabelText('Значение')).toHaveValue('a.com')
    expect(screen.getByLabelText('Цель')).toHaveValue('A')
    expect(screen.getByLabelText('no-resolve')).toBeChecked()
  })

  it('MATCH не показывает поле значения', () => {
    renderRule('MATCH,A')
    expect(screen.queryByLabelText('Значение')).not.toBeInTheDocument()
  })

  it('у SUB-RULE цель выбирается из подсписков, а не из групп', async () => {
    renderRule('SUB-RULE,(NETWORK,udp),block', ['rules', 1])
    expect(await optionLabels('Цель')).toEqual(['block'])
  })

  it('смена типа переписывает строку целиком', async () => {
    const { ops } = renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await selectOption('Тип', 'DOMAIN-KEYWORD')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['rules', 0], value: 'DOMAIN-KEYWORD,a.com,A,no-resolve' })
  })

  // Имя хоста, подставленного панелью, редактор не знает и знать не может,
  // поэтому цель по умолчанию — свободный ввод; список известных имён прячется
  // за снятой галочкой, а не наоборот.
  it('снятая галочка «своё имя» даёт список известных целей', async () => {
    renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await userEvent.click(screen.getByLabelText('своё имя'))
    expect(await optionLabels('Цель')).toContain('A')
    expect(await optionLabels('Цель')).toContain('DIRECT')
  })

  it('свободный ввод цели переписывает строку', async () => {
    const { ops } = renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await userEvent.type(screen.getByLabelText('Цель'), 'B')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['rules', 0], value: 'DOMAIN-SUFFIX,a.com,AB,no-resolve' })
  })

  // У SUB-RULE свободного ввода нет: имя подсписка обязано существовать в
  // документе, панель их не подставляет.
  it('у SUB-RULE свободного ввода цели нет', () => {
    renderRule('SUB-RULE,(NETWORK,udp),block', ['rules', 1])
    expect(screen.queryByLabelText('своё имя')).not.toBeInTheDocument()
  })

  it('снятие модификатора убирает его из строки', async () => {
    const { ops } = renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await userEvent.click(screen.getByLabelText('no-resolve'))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['rules', 0], value: 'DOMAIN-SUFFIX,a.com,A' })
  })

  // Запятая разделяет поля правила, и выразить её внутри поля нечем: строка
  // «DOMAIN-SUFFIX,a.com,b,A,no-resolve» перечиталась бы со значением «a.com» и
  // целью «b». Отказ вместо порчи — правка не уходит писателю вовсе.
  it('запятая в значении не пишется и объясняется', async () => {
    const { ops } = renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await userEvent.type(screen.getByLabelText('Значение'), ',b')
    expect(ops).toHaveLength(0)
    expect(screen.getByText(/не собирается/)).toBeInTheDocument()
  })

  it('запятая в цели не пишется', async () => {
    const { ops } = renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await userEvent.type(screen.getByLabelText('Цель'), ',B')
    expect(ops).toHaveLength(0)
  })

  // Проверка обратимости, а не запрет запятой: у логических типов запятая
  // ВНУТРИ скобок законна, и правка такого правила обязана проходить.
  it('запятая внутри скобок у SUB-RULE не мешает правке', async () => {
    const { ops } = renderRule('SUB-RULE,(NETWORK,udp),block', ['rules', 1])
    await userEvent.type(screen.getByLabelText('Значение'), 'x')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['rules', 1], value: 'SUB-RULE,(NETWORK,udp)x,block' })
  })

  // Имя, которого в документе нет (например, подставленный панелью хост), обязано
  // остаться в списке: иначе выбор молча заменил бы его первым вариантом.
  it('незнакомая цель остаётся в списке известных', async () => {
    renderRule('MATCH,ru-1', ['rules', 0], { 'proxy-target': ['A'] })
    await userEvent.click(screen.getByLabelText('своё имя'))
    expect(await optionLabels('Цель')).toContain('ru-1')
  })

  // Любая правка может сорваться на необратимости, не только ввод в поле:
  // у правила «MATCH,b)c,d» лишняя скобка увела уровень вложенности в минус, и
  // добавленный модификатор при перечитывании прилипнет к цели.
  // «Рядом с ним» — не фигура речи, а то, ради чего заведён `RuleField`:
  // объяснение обязано стоять В БЛОКЕ своего поля.
  it('отказ на переключателе модификатора объясняется рядом с ним', async () => {
    const { ops } = renderRule('MATCH,b)c,d')
    await userEvent.click(screen.getByLabelText('src'))
    expect(ops).toHaveLength(0)
    const block = screen.getByLabelText('src').closest('.field')
    expect(block).not.toBeNull()
    expect(within(block as HTMLElement).getByText(/не собирается обратно/)).toBeInTheDocument()
    // И только там: на форме объяснение ровно одно, а не по копии в каждом блоке
    expect(screen.getAllByText(/не собирается обратно/)).toHaveLength(1)
  })

  // Текст отказа обязан обещать ровно то, что проверка делает: перевод строки
  // внутри поля `parseRule` переживает обратимо, и ловлей его хвастаться нельзя.
  it('текст отказа не обещает того, чего проверка не делает', async () => {
    const { ops } = renderRule('DOMAIN-SUFFIX,a.com,A,no-resolve')
    await userEvent.type(screen.getByLabelText('Значение'), ',b')
    expect(ops).toHaveLength(0)
    expect(screen.getByText(/не собирается обратно/).textContent).not.toMatch(/перевод строки/)
  })

  // Переход MATCH → тип со значением: без пустого значения строка собралась бы
  // из двух полей («DOMAIN,A»), разбор вернул бы null, и правка молча не
  // применилась бы.
  it('переход с MATCH заводит пустое значение', async () => {
    const { ops } = renderRule('MATCH,A')
    await selectOption('Тип', 'DOMAIN')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['rules', 0], value: 'DOMAIN,,A' })
  })

  // Форма не имеет права записать то, чего сама не разбирает: собранная из
  // полей строка затёрла бы непонятую и потеряла бы её содержимое.
  it('неразбираемую строку правит вкладка YAML', () => {
    renderRule('совсем не правило')
    expect(screen.getByText(/правьте её на вкладке YAML/)).toBeInTheDocument()
  })

  // Путь строки правила может вести и в подсписок (`['sub-rules', 'имя', i]`) —
  // форма ничего не знает про то, где живёт список, и передаёт путь писателю
  // как есть.
  it('путь подсписка уходит в операцию как есть', async () => {
    const { ops } = renderRule('DOMAIN,a.com,DIRECT', ['sub-rules', 's', 1], { 'proxy-target': ['DIRECT'] })
    await userEvent.type(screen.getByLabelText('Цель'), 'X')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['sub-rules', 's', 1], value: 'DOMAIN,a.com,DIRECTX' })
  })
})
