import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App'

describe('App', () => {
  it('рендерится', () => {
    render(<App />)
    expect(screen.getByText('Xray UI Editor')).toBeInTheDocument()
  })
})
