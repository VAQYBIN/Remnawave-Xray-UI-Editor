import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MihomoSectionsDialog } from '../src/features/editor/MihomoSectionsDialog'
import { parseMihomo } from '../src/entities/mihomo'
import type { MihomoDraft } from '../src/features/editor/useMihomoDraft'
import { selectOption } from './helpers'

const DOC = [
  'mode: rule',
  'mixed-port: 7890',
  'dns:',
  '  enable: true',
  'rule-providers:',
  '  ads:',
  '    type: http',
  '    behavior: domain',
  '',
].join('\n')

function open(doc = DOC) {
  const md = parseMihomo(doc)
  const draft = { setField: vi.fn(), removeField: vi.fn(), setListAt: vi.fn() } as unknown as MihomoDraft
  render(<MihomoSectionsDialog open md={md} draft={draft} onClose={vi.fn()} />)
  return draft
}

describe('диалог секций Mihomo', () => {
  it('корневые настройки открыты сразу и пишутся правкой', async () => {
    const draft = open()
    // Путь корня пуст: секция — само отображение документа
    await selectOption('mode', 'global')
    expect(draft.setField).toHaveBeenCalledWith([], 'mode', 'global')
  })

  // Снятая галочка у СВОЕГО ключа снимает сам ключ (правило «пустое значение
  // снимает ключ»), а адрес правки — путь секции, а не корень документа
  it('секция документа правится своим словарём и по своему пути', async () => {
    const draft = open()
    await userEvent.click(screen.getByRole('button', { name: 'DNS' }))
    await userEvent.click(screen.getByLabelText('enable'))
    expect(draft.removeField).toHaveBeenCalledWith(['dns'], 'enable')
  })

  // Стена запертых полей объяснила бы отсутствие секции двадцать раз подряд и ни
  // разу не сказала бы главного: завести саму секцию форма не умеет.
  it('отсутствующая секция объясняется одной строкой, а не стеной полей', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'TUN' }))
    expect(screen.getByText(/Заведите её на вкладке YAML/)).toBeInTheDocument()
    expect(screen.queryByLabelText('stack')).not.toBeInTheDocument()
  })

  it('наборы правил перечислены по одному и правятся своим словарём', async () => {
    const draft = open()
    await userEvent.click(screen.getByRole('button', { name: 'ads' }))
    await selectOption('behavior', 'classical')
    expect(draft.setField).toHaveBeenCalledWith(['rule-providers', 'ads'], 'behavior', 'classical')
  })

  it('без наборов правил заголовка нет', () => {
    open('mode: rule\n')
    expect(screen.queryByText('Наборы правил')).not.toBeInTheDocument()
  })
})
