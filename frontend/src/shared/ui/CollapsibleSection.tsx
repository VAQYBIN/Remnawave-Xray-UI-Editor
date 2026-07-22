import { useState, type ReactNode } from 'react'

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="collapsible">
      <button type="button" className="collapsible-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {/* Маркер один, поворачивается CSS'ом — состояние читается по aria-expanded */}
        <span className="collapsible-marker" aria-hidden="true">
          ▸
        </span>
        {title}
      </button>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </div>
  )
}
