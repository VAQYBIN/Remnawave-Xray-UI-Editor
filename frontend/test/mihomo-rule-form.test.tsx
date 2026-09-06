import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoRuleForm } from '../src/features/inspector/MihomoRuleForm'
import { parseMihomo } from '../src/entities/mihomo'
import type { MihomoDraft } from '../src/features/editor/useMihomoDraft'
import { selectOption, optionLabels } from './helpers'

const DOC = [
  'proxy-groups:',
  '  - name: A',
  'sub-rules:',
  '  block:',
  '    - MATCH,REJECT',
  'rules:',
  '  - DOMAIN-SUFFIX,a.com,A,no-resolve',
  '  - SUB-RULE,(NETWORK,udp),block',
  '',
].join('\n')

function renderRule(index: number) {
  const md = parseMihomo(DOC)
  const draft = { setField: vi.fn(), addRuleText: vi.fn(), replaceRule: vi.fn() } as unknown as MihomoDraft
  render(<MihomoRuleForm md={md} index={index} draft={draft} />)
  return draft
}

describe('форма правила Mihomo', () => {
  it('раскладывает строку на поля', () => {
    renderRule(0)
    expect(screen.getByLabelText('Значение')).toHaveValue('a.com')
    expect(screen.getByLabelText('Цель')).toHaveValue('A')
    expect(screen.getByLabelText('no-resolve')).toBeChecked()
  })

  it('MATCH не показывает поле значения', () => {
    const md = parseMihomo('rules:\n  - MATCH,A\n')
    render(<MihomoRuleForm md={md} index={0} draft={{ replaceRule: vi.fn() } as unknown as MihomoDraft} />)
    expect(screen.queryByLabelText('Значение')).not.toBeInTheDocument()
  })

  it('у SUB-RULE цель выбирается из подсписков, а не из групп', async () => {
    renderRule(1)
    expect(await optionLabels('Цель')).toEqual(['block'])
  })

  it('смена типа переписывает строку целиком', async () => {
    const draft = renderRule(0)
    await selectOption('Тип', 'DOMAIN-KEYWORD')
    expect(draft.replaceRule).toHaveBeenCalledWith(0, 'DOMAIN-KEYWORD,a.com,A,no-resolve')
  })

  // Имя хоста, подставленного панелью, редактор не знает и знать не может,
  // поэтому цель по умолчанию — свободный ввод; список известных имён прячется
  // за снятой галочкой, а не наоборот.
  it('снятая галочка «своё имя» даёт список известных целей', async () => {
    renderRule(0)
    await userEvent.click(screen.getByLabelText('своё имя'))
    expect(await optionLabels('Цель')).toContain('A')
    expect(await optionLabels('Цель')).toContain('DIRECT')
  })

  it('свободный ввод цели переписывает строку', async () => {
    const draft = renderRule(0)
    await userEvent.type(screen.getByLabelText('Цель'), 'B')
    expect(draft.replaceRule).toHaveBeenCalledWith(0, 'DOMAIN-SUFFIX,a.com,AB,no-resolve')
  })

  // У SUB-RULE свободного ввода нет: имя подсписка обязано существовать в
  // документе, панель их не подставляет.
  it('у SUB-RULE свободного ввода цели нет', () => {
    renderRule(1)
    expect(screen.queryByLabelText('своё имя')).not.toBeInTheDocument()
  })

  it('снятие модификатора убирает его из строки', async () => {
    const draft = renderRule(0)
    await userEvent.click(screen.getByLabelText('no-resolve'))
    expect(draft.replaceRule).toHaveBeenCalledWith(0, 'DOMAIN-SUFFIX,a.com,A')
  })

  // Запятая разделяет поля правила, и выразить её внутри поля нечем: строка
  // «DOMAIN-SUFFIX,a.com,b,A,no-resolve» перечиталась бы со значением «a.com» и
  // целью «b». Пишем на каждое нажатие, поэтому искажение осталось бы в
  // документе, а не в поле — отказ вместо порчи.
  it('запятая в значении не пишется и объясняется', async () => {
    const draft = renderRule(0)
    await userEvent.type(screen.getByLabelText('Значение'), ',b')
    expect(draft.replaceRule).not.toHaveBeenCalled()
    expect(screen.getByText(/не собирается/)).toBeInTheDocument()
  })

  it('запятая в цели не пишется', async () => {
    const draft = renderRule(0)
    await userEvent.type(screen.getByLabelText('Цель'), ',B')
    expect(draft.replaceRule).not.toHaveBeenCalled()
  })

  // Проверка обратимости, а не запрет запятой: у логических типов запятая
  // ВНУТРИ скобок законна, и правка такого правила обязана проходить.
  it('запятая внутри скобок у SUB-RULE не мешает правке', async () => {
    const draft = renderRule(1)
    await userEvent.type(screen.getByLabelText('Значение'), 'x')
    expect(draft.replaceRule).toHaveBeenCalledWith(1, 'SUB-RULE,(NETWORK,udp)x,block')
  })

  // Имя, которого в документе нет (например, подставленный панелью хост), обязано
  // остаться в списке: иначе выбор молча заменил бы его первым вариантом.
  it('незнакомая цель остаётся в списке известных', async () => {
    const md = parseMihomo('proxy-groups:\n  - name: A\nrules:\n  - MATCH,ru-1\n')
    render(<MihomoRuleForm md={md} index={0} draft={{ replaceRule: vi.fn() } as unknown as MihomoDraft} />)
    await userEvent.click(screen.getByLabelText('своё имя'))
    expect(await optionLabels('Цель')).toContain('ru-1')
  })

  // Переход MATCH → тип со значением: без пустого значения строка собралась бы
  // из двух полей («DOMAIN,A»), разбор вернул бы null, и правка молча не
  // применилась бы.
  it('переход с MATCH заводит пустое значение', async () => {
    const md = parseMihomo('rules:\n  - MATCH,A\n')
    const draft = { replaceRule: vi.fn() } as unknown as MihomoDraft
    render(<MihomoRuleForm md={md} index={0} draft={draft} />)
    await selectOption('Тип', 'DOMAIN')
    expect(draft.replaceRule).toHaveBeenCalledWith(0, 'DOMAIN,,A')
  })
})
