import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}

export function Button({ variant, className, ...rest }: Props) {
  const cls = ['btn', variant ? `btn-${variant}` : '', className ?? ''].filter(Boolean).join(' ')
  return <button type="button" {...rest} className={cls} />
}
