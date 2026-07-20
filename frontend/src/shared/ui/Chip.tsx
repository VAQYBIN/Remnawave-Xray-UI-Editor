import type { ReactNode } from 'react'

export function Chip({ dir, children }: { dir: 'in' | 'out' | 'none'; children: ReactNode }) {
  const cls = ['chip', dir === 'in' ? 'chip-in' : '', dir === 'out' ? 'chip-out' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls}>
      {dir !== 'none' && <span className="chip-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
