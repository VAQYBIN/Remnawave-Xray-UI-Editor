import { useEffect, useRef, useState } from 'react'

/**
 * Отложенное значение: обновляется, когда ввод затих на `delay`.
 *
 * Нужно трассировке: каждый символ адреса иначе пересчитывал бы граф и дергал
 * бэкенд за geo-ответами. Сброс в null проходит мгновенно — закрытие инструмента
 * не должно ждать таймера, иначе панель разбора висит после «Закрыть».
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (value === null || value === undefined) {
      clearTimeout(timer.current)
      setSettled(value)
      return
    }
    timer.current = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer.current)
  }, [value, delay])

  return settled
}
