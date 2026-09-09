import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MihomoProviderForm } from '../src/features/inspector/MihomoProviderForm'
import { MihomoRuleProviderForm } from '../src/features/inspector/MihomoRuleProviderForm'
import { makeWriter } from './schemaHelpers'
import { optionLabels } from './helpers'

describe('MihomoProviderForm', () => {
  it('inline показывает payload карточками с формой сервера и кнопкой «+ Добавить»', async () => {
    const { ops, writer } = makeWriter()
    render(<MihomoProviderForm value={{ type: 'inline', payload: [] }} path={['proxy-providers', 'p']} writer={writer} refs={{}} name="p" onRename={() => null} />)
    const group = screen.getByRole('group', { name: 'payload' })
    await userEvent.click(within(group).getByRole('button', { name: '+ Добавить' }))
    expect(ops.at(-1)).toEqual({ op: 'insert', path: ['proxy-providers', 'p', 'payload'], index: 0, value: { name: '', type: 'ss', server: '', port: 443 } })
  })

  it('у http виден url, payload не виден', () => {
    const { writer } = makeWriter()
    render(<MihomoProviderForm value={{ type: 'http', url: 'https://example.com/list' }} path={['proxy-providers', 'p']} writer={writer} refs={{}} name="p" onRename={() => null} />)
    expect(screen.getByLabelText('url')).toHaveValue('https://example.com/list')
    expect(screen.queryByRole('group', { name: 'payload' })).toBeNull()
  })
})

describe('MihomoRuleProviderForm', () => {
  it('format и behavior — селекты, url виден у http', async () => {
    const { writer } = makeWriter()
    render(<MihomoRuleProviderForm value={{ type: 'http', behavior: 'domain', format: 'yaml', url: 'https://example.com/rules' }} path={['rule-providers', 'r']} writer={writer} refs={{}} name="r" onRename={() => null} />)
    expect(screen.getByLabelText('url')).toHaveValue('https://example.com/rules')
    expect(await optionLabels('behavior')).toContain('domain')
    expect(await optionLabels('format')).toContain('yaml')
  })
})
