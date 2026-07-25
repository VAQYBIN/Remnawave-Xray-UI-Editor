import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DiffView } from '../src/features/editor/DiffView'

describe('DiffView', () => {
  it('монтируется и рисует обе стороны сравнения', () => {
    const { container } = render(<DiffView original='{"a":1}' modified='{"a":2}' />)
    expect(container.querySelectorAll('.cm-editor').length).toBe(2)
  })
})
