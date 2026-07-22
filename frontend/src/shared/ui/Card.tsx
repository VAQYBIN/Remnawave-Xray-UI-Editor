import type { HTMLAttributes } from 'react'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={['card', className ?? ''].filter(Boolean).join(' ')} />
}
