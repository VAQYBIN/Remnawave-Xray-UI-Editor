import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DocPanel } from '../src/features/inspector/schema/DocPanel'
import { fieldAt, fieldsAt, obj, str, valueAt, type DocSection, type FieldSchema } from '../src/shared/schema'
import { SchemaForm } from '../src/features/inspector/schema/SchemaForm'
import { makeWriter } from './schemaHelpers'

const SCHEMA: FieldSchema[] = [
  obj('providers', 'Провайдеры.', []),
  obj('general', 'Общие.', [str('mode', 'Режим.')]),
]
const SECTIONS: DocSection[] = [
  { title: 'Общие', path: ['general'], kind: 'object' },
  { title: 'Провайдеры', path: ['providers'], kind: 'map' },
]
const ENTRY = [str('url', 'Ссылка.')]

function renderPanel(doc: Record<string, unknown>) {
  const { ops, writer } = makeWriter()
  render(
    <DocPanel
      sections={SECTIONS}
      doc={doc}
      writer={writer}
      refs={{}}
      fieldsAt={(path, d) => fieldsAt(SCHEMA, path, d)}
      fieldAt={(path, d) => fieldAt(SCHEMA, path, d)}
      valueOf={(d, path) => valueAt(d, path)}
      maps={{
        providers: {
          addLabel: '+ Провайдер',
          removeLabel: (name) => `Удалить провайдера ${name}`,
          baseName: 'provider',
          starter: () => ({ url: '' }),
          Form: (p) => <SchemaForm fields={ENTRY} value={p.value} path={p.path} writer={p.writer} />,
        },
      }}
    />,
  )
  return ops
}

describe('DocPanel: раздел по имени', () => {
  it('перечисляет записи, заводит новую под уникальным именем и удаляет по имени', async () => {
    const ops = renderPanel({ providers: { provider: { url: 'u' } } })
    await userEvent.click(screen.getByRole('button', { name: 'Провайдеры' }))
    const region = screen.getByRole('region', { name: 'Провайдеры' })
    expect(within(region).getByText('provider')).toBeInTheDocument()
    expect(within(region).getByLabelText('url')).toHaveValue('u')
    await userEvent.click(within(region).getByRole('button', { name: '+ Провайдер' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['providers', 'provider-2'], value: { url: '' } })
    await userEvent.click(within(region).getByRole('button', { name: 'Удалить провайдера provider' }))
    expect(ops.at(-1)).toEqual({ op: 'remove', path: ['providers', 'provider'] })
  })

  it('раздел-объект без записи заводится стартером или пустым объектом', async () => {
    const ops = renderPanel({})
    await userEvent.click(screen.getByRole('button', { name: 'Общие' }))
    await userEvent.click(screen.getByRole('button', { name: 'Завести раздел' }))
    expect(ops.at(-1)).toEqual({ op: 'set', path: ['general'], value: {} })
  })
})
