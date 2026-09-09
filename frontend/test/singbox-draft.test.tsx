import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import { useSingboxDraft } from '../src/features/editor/useSingboxDraft'
import { singboxAdapter } from '../src/features/editor/singboxAdapter'
import { parseSingbox } from '../src/entities/singbox/parse'

const PANEL = {
  outbounds: [
    { type: 'selector', tag: 'выбор', outbounds: null },
    { type: 'direct', tag: 'direct' },
  ],
  route: { rules: [{ domain: 'a.com', outbound: 'direct' }] },
}

beforeEach(() => {
  localStorage.clear()
})

describe('адаптер документа sing-box', () => {
  it('на разбираемом тексте даёт модель и диагностики', () => {
    const res = singboxAdapter.parse(JSON.stringify(PANEL))
    expect(res.model).toBeDefined()
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('на битом JSON модели нет, а объяснение есть', () => {
    // Одна опечатка не должна лишать пользователя объяснения
    const res = singboxAdapter.parse('{ "outbounds": [')
    expect(res.model).toBeUndefined()
    expect(res.issues.length).toBeGreaterThan(0)
  })

  it('к разбору приклеены диагностики целостности', () => {
    // Разбор схемы кольцо ссылок между группами не видит: его находит
    // validateSingbox, и без склейки оболочка молчала бы о неподнимаемом конфиге
    const res = singboxAdapter.parse(
      JSON.stringify({
        outbounds: [
          { type: 'selector', tag: 'a', outbounds: ['b'] },
          { type: 'selector', tag: 'b', outbounds: ['a'] },
        ],
      }),
    )
    expect(res.model).toBeDefined()
    expect(res.issues.some((i) => i.level === 'error' && i.message.includes('Кольцо'))).toBe(true)
  })

  it('счётчики и переход по пути идут через один и тот же резолвер', () => {
    const model = parseSingbox(JSON.stringify(PANEL)).doc!
    expect(singboxAdapter.nodeIdForPath(['outbounds', 1], model)).toBe('out:direct')
    expect(singboxAdapter.issueCounts([], model)).toEqual({})
  })
})

describe('черновик sing-box', () => {
  it('текст черновика — отформатированный документ панели', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u1', panelJson: PANEL, baseVersion: 'h1' }),
    )
    expect(result.current.text).toBe(JSON.stringify(PANEL, null, 2))
    expect(result.current.dirty).toBe(false)
    expect(result.current.doc).toBeDefined()
  })

  it('changeDoc пишет новую модель текстом и заводит запись в историю', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u2', panelJson: PANEL, baseVersion: 'h1' }),
    )
    act(() => {
      result.current.changeDoc({ ...result.current.doc!, route: { rules: [], final: 'direct' } })
    })
    expect(result.current.dirty).toBe(true)
    expect(JSON.parse(result.current.text).route.final).toBe('direct')
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(JSON.parse(result.current.text).route.final).toBeUndefined()
  })

  it('json отдаёт разобранный ТЕКСТ, а не модель схемы', () => {
    // В панель уходит то, что человек видит на вкладке JSON. Печатать обратно
    // модель значило бы отправить не тот документ, который он правил руками
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u3', panelJson: PANEL, baseVersion: 'h1' }),
    )
    act(() => result.current.writeDraft('{"outbounds":[],"unknown_key":7}', { history: false }))
    expect(result.current.json).toEqual({ outbounds: [], unknown_key: 7 })
    // Незнакомый ключ доезжает и до модели: схема сквозная. Текст от модели
    // отличает документ, схему НЕ прошедший, — модели нет, а в панель уходит
    // по-прежнему то, что человек набрал
    act(() => result.current.writeDraft('{"outbounds": 5}', { history: false }))
    expect(result.current.doc).toBeUndefined()
    expect(result.current.json).toEqual({ outbounds: 5 })
  })

  it('на неразбираемом тексте json пуст, а не наполовину собран', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u4', panelJson: PANEL, baseVersion: 'h1' }),
    )
    act(() => result.current.writeDraft('{ бред', { history: false }))
    expect(result.current.json).toBeUndefined()
    expect(result.current.hasErrors).toBe(true)
  })

  it('цель трассировки без адреса разбора не даёт', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u5', panelJson: PANEL, baseVersion: 'h1' }),
    )
    expect(result.current.trace).toBeUndefined()
    act(() => result.current.setTraceTarget({ address: 'a.com', port: 443, network: 'tcp' }))
    expect(result.current.trace?.winner?.target).toBe('direct')
  })
})

describe('черновик как писатель', () => {
  function mount() {
    return renderHook(() =>
      useSingboxDraft({ docKey: 'writer-test', panelJson: PANEL, baseVersion: 'h1' }),
    )
  }

  it('applyOps меняет текст черновика записью в историю', () => {
    const { result } = mount()
    act(() => result.current.applyOps([{ op: 'set', path: ['route', 'final'], value: 'direct' }]))
    expect(JSON.parse(result.current.text).route.final).toBe('direct')
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(JSON.parse(result.current.text).route.final).toBeUndefined()
  })

  it('lockAt закрывает список группы, которую заполняет панель, и молчит про закреплённую', () => {
    const { result } = mount()
    expect(result.current.lockAt(['outbounds', 0, 'outbounds'])?.reason).toMatch(/панел/i)
    act(() => result.current.applyOps([{ op: 'set', path: ['outbounds', 0, 'remnawave'], value: { includeProxies: false } }]))
    expect(result.current.lockAt(['outbounds', 0, 'outbounds'])).toBeNull()
    expect(result.current.lockAt(['outbounds', 1, 'tag'])).toBeNull()
  })

  it('writer — тот же объект между рендерами при неизменном документе', () => {
    const { result, rerender } = mount()
    const first = result.current.writer
    rerender()
    expect(result.current.writer).toBe(first)
  })
})
