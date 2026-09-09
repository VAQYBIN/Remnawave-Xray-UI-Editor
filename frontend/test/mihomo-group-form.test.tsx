import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoGroupForm } from '../src/features/inspector/MihomoGroupForm'
import { mihomoRefs } from '../src/entities/mihomo/schema'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { makeWriter } from './schemaHelpers'
import { optionLabels, selectOption } from './helpers'

const md = parseMihomo('proxies:\n  - name: s\n    type: direct\nproxy-groups:\n  - name: G\n    type: select\n    proxies: [s]\n    remnawave:\n      include-proxies: false\n')
const value = (md.json as { 'proxy-groups': Record<string, unknown>[] })['proxy-groups'][0]!

describe('MihomoGroupForm', () => {
  it('имя, тип, участники по целям документа, ключи панели видны', async () => {
    const { ops, writer } = makeWriter()
    const onRename = vi.fn(() => null)
    render(<MihomoGroupForm value={value} path={['proxy-groups', 0]} writer={writer} refs={mihomoRefs(md)} name="G" onRename={onRename} />)
    expect(screen.getByLabelText('Имя')).toHaveValue('G')
    expect(await optionLabels('Тип')).toEqual(['(не задано)', 'select', 'url-test', 'fallback', 'load-balance'])
    expect(screen.getByRole('button', { name: 's', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DIRECT', pressed: false })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'include-proxies' })).toBeInTheDocument()
    await selectOption('Тип', 'url-test')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['proxy-groups', 0, 'type'], value: 'url-test' })
    await userEvent.type(screen.getByLabelText('Имя'), '2')
    expect(onRename).toHaveBeenLastCalledWith('G2')
  })

  it('устаревший тип relay не предлагается, но текущий проходит сквозь с подсказкой', async () => {
    const { writer } = makeWriter()
    render(<MihomoGroupForm value={{ ...value, type: 'relay' }} path={['proxy-groups', 0]} writer={writer} refs={mihomoRefs(md)} name="G" onRename={() => null} />)
    expect(await optionLabels('Тип')).toEqual(['(не задано)', 'relay', 'select', 'url-test', 'fallback', 'load-balance'])
    expect(screen.getByText(/dialer-proxy/)).toBeInTheDocument()
  })

  it('отказ переименования показывается у поля, набранное не теряется', async () => {
    const { writer } = makeWriter()
    render(<MihomoGroupForm value={value} path={['proxy-groups', 0]} writer={writer} refs={mihomoRefs(md)} name="G" onRename={(to) => (to === 's' ? 'Имя занято.' : null)} />)
    await userEvent.clear(screen.getByLabelText('Имя'))
    await userEvent.type(screen.getByLabelText('Имя'), 's')
    expect(screen.getByText('Имя занято.')).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('s')
  })
})
