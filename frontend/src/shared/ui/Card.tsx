import type { HTMLAttributes } from 'react'

export function Card({ className, onClick, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      onClick={onClick}
      data-clickable={onClick ? 'true' : undefined}
      className={['card', className ?? ''].filter(Boolean).join(' ')}
    />
  )
}
