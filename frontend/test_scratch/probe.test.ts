import { describe, expect, it } from 'vitest'
describe('проба окружения', () => {
  it('есть ли Range.getClientRects в jsdom', () => {
    console.log('getClientRects:', typeof Range.prototype.getClientRects)
    console.log('getBoundingClientRect:', typeof Range.prototype.getBoundingClientRect)
    console.log('jsdom версия:', require('jsdom/package.json').version)
    expect(true).toBe(true)
  })
})
