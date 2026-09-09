import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SingboxDnsRuleForm } from '../src/features/inspector/SingboxDnsRuleForm'
import { selectOption, selectedValue } from './helpers'
import { makeWriter } from './schemaHelpers'

const REFS = { outbound: ['direct'], inbound: [], 'dns-server': ['dns-remote', 'dns-local'], 'rule-set': ['ads'] }

describe('форма DNS-правила', () => {
  it('без action считается route и показывает сервер из документа', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDnsRuleForm value={{ domain_suffix: ['a.com'], server: 'dns-remote' }} path={['dns', 'rules', 0]} writer={writer} refs={REFS} />)
    expect(selectedValue('Действие')).toBe('route')
    await selectOption('Сервер', 'dns-local')
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['dns', 'rules', 0, 'server'], value: 'dns-local' })
  })

  it('reject снимает сервер и показывает method', async () => {
    const { ops, writer } = makeWriter()
    render(<SingboxDnsRuleForm value={{ server: 'dns-remote' }} path={['dns', 'rules', 0]} writer={writer} refs={REFS} />)
    await selectOption('Действие', 'reject')
    expect(ops).toEqual([
      { op: 'set', path: ['dns', 'rules', 0, 'action'], value: 'reject' },
      { op: 'remove', path: ['dns', 'rules', 0, 'server'] },
    ])
  })

  it('матчеры DNS приходят из схемы: query_type есть, hijack-dns нет', () => {
    const { writer } = makeWriter()
    render(<SingboxDnsRuleForm value={{ query_type: ['A'] }} path={['dns', 'rules', 0]} writer={writer} refs={REFS} />)
    expect(screen.getByLabelText('query_type')).toBeInTheDocument()
    expect(screen.queryByText('hijack-dns')).toBeNull()
  })
})
