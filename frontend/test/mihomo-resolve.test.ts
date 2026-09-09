import { describe, expect, it } from 'vitest'
import { parseMihomo } from '../src/entities/mihomo/parse'
import { resolveTarget } from '../src/entities/mihomo/resolve'

describe('resolveTarget', () => {
  it('статический сервер — вид proxy; группа с тем же именем побеждает', () => {
    const md = parseMihomo('proxies:\n  - name: s\n    type: direct\n  - name: G\n    type: direct\nproxy-groups:\n  - name: G\n    type: select\n')
    expect(resolveTarget(md, 's')).toBe('proxy')
    expect(resolveTarget(md, 'G')).toBe('group')
    expect(resolveTarget(md, 'DIRECT')).toBe('builtin')
    expect(resolveTarget(md, 'x')).toBe('unknown')
  })

  it('сервер с тем же именем, что провайдер, разрешается в proxy — порядок builtin→group→proxy→provider', () => {
    const md = parseMihomo(
      'proxies:\n  - name: p\n    type: direct\nproxy-providers:\n  p:\n    type: inline\n',
    )
    expect(resolveTarget(md, 'p')).toBe('proxy')
  })
})
