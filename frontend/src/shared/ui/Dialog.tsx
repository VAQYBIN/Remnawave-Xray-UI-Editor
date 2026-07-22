import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Широкий вариант — для diff-сравнений и другого объёмного контента */
  wide?: boolean
}

export function Dialog({ open, title, onClose, children, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog-wide' : 'dialog'}
      onClose={onClose}
      aria-label={title}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </Button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  )
}
