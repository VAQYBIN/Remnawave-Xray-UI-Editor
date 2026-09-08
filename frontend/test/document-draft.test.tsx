import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  escapeTarget,
  resolveDraftText,
  useDocumentDraft,
  type DocumentAdapter,
} from '../src/features/editor/useDocumentDraft'
import { useDraftStore } from '../src/features/editor/draftStore'
import { useHistoryStore } from '../src/features/editor/historyStore'

interface ToyModel {
  lines: string[]
}

// Документ — строки текста. Ядро не знает ни JSON, ни YAML, и это тест фиксирует.
const toyAdapter: DocumentAdapter<ToyModel> = {
  parse: (text) => ({
    model: text.includes('!') ? undefined : { lines: text.split('\n') },
    issues: text.includes('!')
      ? [{ parts: [], path: '', message: 'восклицательный знак', level: 'error' as const }]
      : [{ parts: ['lines', 0], path: 'lines.0', message: 'первая строка', level: 'warning' as const }],
  }),
  issueCounts: () => ({ 'line:0': { errors: 0, warnings: 1 } }),
  nodeIdForPath: (parts) => (parts[0] === 'lines' ? `line:${parts[1]}` : null),
  search: (model, _ctx, query) =>
    model.lines
      .map((line, i) => ({
        nodeId: `line:${i}`,
        kind: 'rule' as const,
        title: line,
        matchedOn: 'строка',
      }))
      .filter((h) => query !== '' && h.title.includes(query)),
}

function draft() {
  return renderHook(() =>
    useDocumentDraft({
      docKind: 'template',
      docKey: 'toy-1',
      panelText: 'a\nb',
      baseVersion: 'v1',
      ctx: {},
      adapter: toyAdapter,
    }),
  )
}

describe('ядро черновика', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} })
    useHistoryStore.setState({ stacks: {} })
  })

  it('без черновика показывает текст панели и не считается изменённым', () => {
    const { result } = draft()
    expect(result.current.text).toBe('a\nb')
    expect(result.current.dirty).toBe(false)
    expect(result.current.storageKey).toBe('template:toy-1')
  })

  it('разбор идёт через адаптер: модель, диагностики и счётчики берутся у него', () => {
    const { result } = draft()
    expect(result.current.model).toEqual({ lines: ['a', 'b'] })
    expect(result.current.warningCount).toBe(1)
    expect(result.current.errorCount).toBe(0)
    expect(result.current.nodeIssues).toEqual({ 'line:0': { errors: 0, warnings: 1 } })
  })

  it('неразобранный документ гасит модель, но не диагностики', () => {
    const { result } = draft()
    act(() => result.current.writeDraft('a!', { history: true }))
    expect(result.current.model).toBeUndefined()
    expect(result.current.hasErrors).toBe(true)
    expect(result.current.nodeIssues).toEqual({})
  })

  it('запись черновика попадает в историю и отменяется', () => {
    const { result } = draft()
    act(() => result.current.writeDraft('c\nd', { history: true }))
    expect(result.current.text).toBe('c\nd')
    expect(result.current.dirty).toBe(true)
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(result.current.text).toBe('a\nb')
  })

  it('на текстовой вкладке история недоступна, а уход с неё пишет один снимок', () => {
    const { result } = draft()
    act(() => result.current.openTextTab())
    act(() => result.current.writeDraft('x', { history: false }))
    expect(result.current.undoAvailable).toBe(false)
    act(() => result.current.openGraphTab())
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(result.current.text).toBe('a\nb')
  })

  it('переход к проблеме зависит от вкладки', () => {
    const { result } = draft()
    const issue = { parts: ['lines', 0], path: 'lines.0', message: 'x', level: 'warning' as const }
    act(() => result.current.selectIssue(issue))
    expect(result.current.selectedNode).toBe('line:0')
    act(() => result.current.openTextTab())
    act(() => result.current.selectIssue(issue))
    expect(result.current.reveal?.parts).toEqual(['lines', 0])
  })

  it('в тексте ведёт и туда, где путь пуст, но место известно', () => {
    // Такова синтаксическая ошибка разбора: «что за ключ» она сказать не может,
    // «где» — может. Прежде список требовал непустой путь, и клик по ней
    // молчал: единственная проблема документа была и единственной, по которой
    // некуда пойти
    const { result } = draft()
    const issue = {
      parts: [],
      path: '',
      message: 'Синтаксис YAML: сломано',
      level: 'error' as const,
      at: { from: 12, to: 20 },
    }
    act(() => result.current.openTextTab())
    expect(result.current.canSelectIssue(issue)).toBe(true)
    act(() => result.current.selectIssue(issue))
    expect(result.current.reveal?.at).toEqual({ from: 12, to: 20 })
  })

  it('пустой путь без места по-прежнему никуда не ведёт', () => {
    // Отказ обязан оставаться отказом: диагностика, у которой нет ни пути, ни
    // места, кликом бы просто ничего не делала — и это читалось бы как поломка
    const { result } = draft()
    const issue = { parts: [], path: '', message: 'ниоткуда', level: 'error' as const }
    act(() => result.current.openTextTab())
    expect(result.current.canSelectIssue(issue)).toBe(false)
  })

  // Одним действием, потому что порознь не собирается: `selectIssue` читает
  // `tab` из замыкания, и сразу после `openTextTab()` там ещё вкладка графа —
  // прокрутка ушла бы в ветку выбора узла.
  it('revealAt переводит в текст и прокручивает одним действием', () => {
    const { result } = draft()
    act(() => result.current.revealAt(['lines', 1]))
    expect(result.current.tab).toBe('text')
    expect(result.current.reveal?.parts).toEqual(['lines', 1])
    expect(result.current.selectedNode).toBeNull()
    const first = result.current.reveal?.nonce
    // Повторный вызов из того же места обязан сработать снова — за это отвечает nonce
    act(() => result.current.revealAt(['lines', 1]))
    expect(result.current.reveal?.nonce).not.toBe(first)
  })

  it('поиск идёт через адаптер', () => {
    const { result } = draft()
    act(() => result.current.setSearchQuery('b'))
    expect(result.current.searchHits.map((h) => h.nodeId)).toEqual(['line:1'])
  })

  it('escapeTarget закрывает слои сверху вниз', () => {
    expect(escapeTarget({ selectedNode: 'x', traceTarget: null, searchQuery: 'q' })).toBe('inspector')
    expect(
      escapeTarget({
        selectedNode: null,
        traceTarget: { address: 'a', port: 443, network: 'tcp' },
        searchQuery: 'q',
      }),
    ).toBe('trace')
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: 'q' })).toBe('search')
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: ' ' })).toBe(null)
  })

  it('resolveDraftText: черновик приоритетнее текста панели', () => {
    expect(resolveDraftText({ text: 'd', baseVersion: 'v', savedAt: 's' }, 'panel')).toBe('d')
    expect(resolveDraftText(undefined, 'panel')).toBe('panel')
  })
})
