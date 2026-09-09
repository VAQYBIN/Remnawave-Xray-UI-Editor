import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { singboxRefs } from '../src/entities/singbox/schema'
import { SingboxDocPanel } from '../src/features/topology/SingboxDocPanel'
import { makeWriter } from './schemaHelpers'
import { selectOptionIn } from './helpers'

const DOC = parseSingbox(`{
  "log": {"level": "warn"},
  "dns": {"servers": [{"type":"local","tag":"dns-local"}], "rules": [{"domain_suffix":["a"],"server":"dns-local"}], "final": "dns-local"},
  "outbounds": [{"type":"direct","tag":"direct"}],
  "route": {"rules": [], "rule_set": [{"type":"remote","tag":"ads","format":"binary","url":"u"}], "final": "direct"}
}`).doc!

describe('панель «Документ»', () => {
  it('перечисляет разделы; отсутствующий раздел заводится стартером', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    for (const title of ['Общие', 'DNS', 'DNS-серверы', 'DNS-правила', 'Маршрут', 'Наборы правил', 'Экспериментальное', 'NTP', 'Сертификаты']) {
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Экспериментальное' }))
    await userEvent.click(screen.getByRole('button', { name: 'Завести раздел' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['experimental'], value: { cache_file: { enabled: true } } })
  })

  it('раздел-объект правится формой по схеме без ключей, вынесенных в другие разделы', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Маршрут' }))
    const route = screen.getByRole('region', { name: 'Маршрут' })
    expect(within(route).queryByText('rules')).toBeNull()
    expect(within(route).queryByText('rule_set')).toBeNull()
    await selectOptionIn(route, 'final', 'direct')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['route', 'final'], value: 'direct' })
  })

  it('раздел-список: добавить, переставить, удалить, форма элемента', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    await userEvent.click(screen.getByRole('button', { name: 'DNS-серверы' }))
    const list = screen.getByRole('region', { name: 'DNS-серверы' })
    expect(within(list).getByLabelText('Тег')).toHaveValue('dns-local')
    await userEvent.click(within(list).getByRole('button', { name: '+ Сервер' }))
    expect(ops.at(-1)).toEqual({ op: 'insert', path: ['dns', 'servers'], index: 1, value: { type: 'udp', tag: 'dns', server: '1.1.1.1' } })
    await userEvent.click(within(list).getByRole('button', { name: 'Удалить сервер #1' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['dns', 'servers', 0] })
  })

  it('DNS-правило редактируется своей формой с сервером из документа', async () => {
    const { writer } = makeWriter()
    render(<SingboxDocPanel doc={DOC} writer={writer} refs={singboxRefs(DOC)} />)
    await userEvent.click(screen.getByRole('button', { name: 'DNS-правила' }))
    const list = screen.getByRole('region', { name: 'DNS-правила' })
    expect(within(list).getByLabelText('Действие')).toBeInTheDocument()
    expect(within(list).getByLabelText('Сервер')).toBeInTheDocument()
  })
})
