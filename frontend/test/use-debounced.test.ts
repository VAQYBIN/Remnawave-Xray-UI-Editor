import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { useDebounced } from '../src/shared/lib/useDebounced'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebounced', () => {
  it('первое значение отдаётся сразу — иначе пустой старт мигал бы', () => {
    const { result } = renderHook(() => useDebounced('a', 600))
    expect(result.current).toBe('a')
  })

  it('изменение доходит только после паузы', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 600), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'b' })
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(599))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('b')
  })

  it('таймер перезапускается на каждом изменении — печать не проскакивает частями', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 600), {
      initialProps: { v: 'g' },
    })
    for (const v of ['go', 'goo', 'goog', 'googl', 'google']) {
      act(() => vi.advanceTimersByTime(300))
      rerender({ v })
    }
    // Прошло 1.5 с, но паузы в 600 мс не было ни разу
    expect(result.current).toBe('g')
    act(() => vi.advanceTimersByTime(600))
    expect(result.current).toBe('google')
  })

  it('сброс в null проходит мгновенно — закрытие инструмента не должно ждать', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced<string | null>(v, 600), {
      initialProps: { v: 'a' as string | null },
    })
    rerender({ v: null })
    expect(result.current).toBeNull()
  })
})
