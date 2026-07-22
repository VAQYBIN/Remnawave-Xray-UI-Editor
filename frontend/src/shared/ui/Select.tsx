import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption {
  value: string
  label: string
  /** Опция допустима, но конфликтует с текущим набором — подсвечивается, но остаётся выбираемой */
  warn?: boolean
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

interface PopPosition {
  /** Раскрытие вниз — якорь сверху; вверх — снизу, иначе короткий список
   *  повис бы в отрыве от кнопки на всю разрешённую высоту */
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

const POP_GAP = 4
const POP_MARGIN = 8
const POP_MAX = 320

// Раскрываем вниз, если снизу помещается больше, чем сверху; иначе — вверх.
export function computePosition(rect: DOMRect, viewportHeight: number): PopPosition {
  const below = viewportHeight - rect.bottom - POP_GAP - POP_MARGIN
  const above = rect.top - POP_GAP - POP_MARGIN
  const dropDown = below >= Math.min(POP_MAX, above) || below >= above
  const maxHeight = Math.max(120, Math.min(POP_MAX, dropDown ? below : above))
  return {
    top: dropDown ? rect.bottom + POP_GAP : undefined,
    bottom: dropDown ? undefined : viewportHeight - rect.top + POP_GAP,
    left: rect.left,
    width: rect.width,
    maxHeight,
  }
}

// Поиск по первым буквам: сначала за текущей позицией, затем с начала списка
export function typeaheadIndex(options: SelectOption[], query: string, from: number): number {
  const q = query.toLowerCase()
  const order = [...options.slice(from + 1), ...options.slice(0, from + 1)]
  const hit = order.find((o) => o.label.toLowerCase().startsWith(q))
  return hit ? options.indexOf(hit) : -1
}

export function Select({
  value,
  options,
  onChange,
  id,
  disabled,
  placeholder = 'Не выбрано',
  className,
  'aria-label': ariaLabel,
}: Props) {
  const autoId = useId()
  const listId = `${autoId}-list`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PopPosition | null>(null)
  const [active, setActive] = useState(0)
  const typed = useRef({ query: '', at: 0 })

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value])
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex]

  // Модальный <dialog> живёт в top layer: портал в body оказался бы под ним при любом
  // z-index. Поэтому список едет в тот же диалог, если триггер внутри него.
  const [container, setContainer] = useState<HTMLElement | null>(null)

  const openList = useCallback(() => {
    const trigger = triggerRef.current
    const rect = trigger?.getBoundingClientRect()
    if (rect) setPos(computePosition(rect, window.innerHeight))
    setContainer(trigger?.closest('dialog') ?? document.body)
    setActive(selectedIndex === -1 ? 0 : selectedIndex)
    setOpen(true)
  }, [selectedIndex])

  const closeList = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option) return
      onChange(option.value)
      closeList()
    },
    [options, onChange, closeList],
  )

  // Клик вне закрывает список. Прокрутка и ресайз не закрывают, а пересчитывают
  // позицию: закрытие ломало бы выбор, когда браузер сам подкручивает опцию
  // в видимую область (клавиатура, скринридер, автотесты).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPos(computePosition(rect, window.innerHeight))
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  // Активная опция всегда в поле зрения при навигации с клавиатуры
  // (scrollIntoView отсутствует в jsdom — вызываем опционально)
  useLayoutEffect(() => {
    if (!open) return
    const el = popRef.current?.querySelector(`[data-index="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeList()
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(active)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % options.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + options.length) % options.length)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActive(options.length - 1)
      return
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0
      const query = now - typed.current.at < 700 ? typed.current.query + e.key : e.key
      typed.current = { query, at: now }
      const hit = typeaheadIndex(options, query, query.length > 1 ? active - 1 : active)
      if (hit !== -1) setActive(hit)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        // Значение кнопки-триггера не читается как value — выносим в атрибут,
        // чтобы состояние было видно и в DOM, и в тестах
        data-value={value}
        disabled={disabled}
        className={['select-trigger', className ?? ''].filter(Boolean).join(' ')}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="select-value" data-placeholder={selected === undefined ? 'true' : undefined}>
          {selected?.label ?? placeholder}
        </span>
        <svg className="select-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        container &&
        createPortal(
          <div
            ref={popRef}
            id={listId}
            role="listbox"
            className="select-pop"
            style={
              pos
                ? {
                    top: pos.top,
                    bottom: pos.bottom,
                    left: pos.left,
                    minWidth: pos.width,
                    maxHeight: pos.maxHeight,
                  }
                : undefined
            }
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                data-value={option.value}
                data-index={index}
                data-active={index === active ? 'true' : undefined}
                data-warn={option.warn ? 'true' : undefined}
                aria-selected={option.value === value}
                className="select-option"
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(index)}
              >
                <span className="select-option-mark" aria-hidden="true">
                  {option.value === value ? '✓' : ''}
                </span>
                <span className="select-option-label">{option.label}</span>
              </div>
            ))}
          </div>,
          container,
        )}
    </>
  )
}
