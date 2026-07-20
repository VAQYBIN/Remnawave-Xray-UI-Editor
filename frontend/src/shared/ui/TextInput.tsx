import { forwardRef, type InputHTMLAttributes } from 'react'

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={['input', className ?? ''].filter(Boolean).join(' ')} />
  },
)
