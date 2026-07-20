import { forwardRef, type SelectHTMLAttributes } from 'react'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return (
      <select
        ref={ref}
        {...rest}
        className={['input', 'select', className ?? ''].filter(Boolean).join(' ')}
      />
    )
  },
)
