import type { ButtonHTMLAttributes, Ref } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
  // React 19 больше не заводит ref сам по себе для функциональных компонентов —
  // без явного поля в Props вызывающий (MenuButton, ставящий ref на триггер) не типизируется
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant, className, ref, ...rest }: Props) {
  const cls = ['btn', variant ? `btn-${variant}` : '', className ?? ''].filter(Boolean).join(' ')
  return <button type="button" ref={ref} {...rest} className={cls} />
}
