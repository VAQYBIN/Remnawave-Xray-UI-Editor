import { describe, expect, it } from 'vitest'
import {
  escapeTarget,
  formatConfig,
  moveSelectedRule,
  nextSelection,
  renamedNodeId,
  resolveEditorText,
  toGraphContext,
  traceOf,
} from '../src/features/editor/EditorPage'
import type { XrayConfig } from '../src/entities/xray'

describe('editor logic', () => {
  it('formatConfig — JSON с отступом 2', () => {
    expect(formatConfig({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('resolveEditorText: черновик приоритетнее конфига панели', () => {
    expect(resolveEditorText({ text: 'draft', baseUpdatedAt: 't', savedAt: 's' }, { a: 1 })).toBe('draft')
    expect(resolveEditorText(undefined, { a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('toGraphContext', () => {
  it('собирает inboundSquads по тегам', () => {
    const ctx = toGraphContext(
      [{ uuid: 's1', name: 'Default' }],
      [{ uuid: 'i1', tag: 'vless-in', type: 'vless', network: null, security: null, port: 443, activeSquads: ['s1'] }],
    )
    expect(ctx.squads).toEqual([{ uuid: 's1', name: 'Default' }])
    expect(ctx.inboundSquads).toEqual({ 'vless-in': ['s1'] })
  })

  it('без данных возвращает пустой контекст', () => {
    expect(toGraphContext(undefined, undefined)).toEqual({ squads: [], inboundSquads: {} })
  })
})

describe('nextSelection', () => {
  const prev = {
    inbounds: [{ tag: 'a', protocol: 'vless' }],
    routing: { rules: [{ type: 'field' }, { type: 'field', outboundTag: 'x' }] },
  }
  it('сохраняет выбор, если узел жив и правила не сдвигались', () => {
    expect(nextSelection('in:a', prev, prev)).toBe('in:a')
    expect(nextSelection('rule:1', prev, prev)).toBe('rule:1')
  })
  it('сбрасывает выбор исчезнувшего узла', () => {
    const next = { ...prev, inbounds: [] }
    expect(nextSelection('in:a', prev, next)).toBeNull()
  })
  it('сбрасывает выбор rule-узла при изменении числа правил (позиционные id)', () => {
    const next = { ...prev, routing: { rules: [{ type: 'field', outboundTag: 'x' }] } }
    expect(nextSelection('rule:1', prev, next)).toBeNull()
  })
  it('null остаётся null', () => {
    expect(nextSelection(null, prev, prev)).toBeNull()
  })
})

describe('moveSelectedRule', () => {
  const cfg = {
    routing: { rules: [{ type: 'field' }, { type: 'field', outboundTag: 'x' }] },
  }

  it('переставляет правило и переносит выбор на новую позицию', () => {
    const moved = moveSelectedRule(cfg, 'rule:0', 1)!
    expect(moved.selected).toBe('rule:1')
    expect(moved.config.routing!.rules![1]).toEqual({ type: 'field' })
    expect(moved.config.routing!.rules![0]).toEqual({ type: 'field', outboundTag: 'x' })
  })

  it('null на границе, для не-rule узлов и без выбора', () => {
    expect(moveSelectedRule(cfg, 'rule:0', -1)).toBeNull()
    expect(moveSelectedRule(cfg, 'rule:1', 1)).toBeNull()
    expect(moveSelectedRule(cfg, 'in:a', 1)).toBeNull()
    expect(moveSelectedRule(cfg, null, 1)).toBeNull()
  })
})

describe('traceOf', () => {
  const config = {
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: {
      rules: [
        { domain: ['geosite:google'], outboundTag: 'direct' },
        { domain: ['domain:openai.com'], outboundTag: 'direct' },
      ],
    },
  } as unknown as XrayConfig

  it('без цели трассировки нет', () => {
    expect(traceOf(config, null, undefined)).toBeUndefined()
  })

  it('без валидного конфига трассировки нет', () => {
    expect(
      traceOf(undefined, { address: 'openai.com', port: 443, network: 'tcp' }, undefined),
    ).toBeUndefined()
  })

  it('без geo-ответов geo-правила неизвестны', () => {
    const res = traceOf(config, { address: 'api.openai.com', port: 443, network: 'tcp' }, undefined)
    expect(res?.verdicts[0].state).toBe('unknown')
    expect(res?.winner?.ruleIndex).toBe(1)
  })

  it('с geo-ответами geo-правило получает точный вердикт', () => {
    const res = traceOf(
      config,
      { address: 'www.google.com', port: 443, network: 'tcp' },
      { loaded: true, answers: { 'geosite:google': true }, missing: [] },
    )
    expect(res?.verdicts[0].state).toBe('yes')
    expect(res?.winner?.ruleIndex).toBe(0)
  })
})

// TraceTarget требует address, port и network — минимальная цель для проверок
const TARGET = { address: 'example.com', port: 443, network: 'tcp' } as const

describe('escapeTarget', () => {
  it('открытый инспектор закрывается первым', () => {
    expect(escapeTarget({ selectedNode: 'in:a', traceTarget: TARGET, searchQuery: 'q' })).toBe(
      'inspector',
    )
  })

  it('без инспектора — панель трассы', () => {
    expect(escapeTarget({ selectedNode: null, traceTarget: TARGET, searchQuery: 'q' })).toBe('trace')
  })

  it('без инспектора и трассы — результаты поиска', () => {
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: 'q' })).toBe('search')
  })

  it('пробелы в поиске за запрос не считаются', () => {
    expect(escapeTarget({ selectedNode: null, traceTarget: null, searchQuery: '  ' })).toBeNull()
  })
})

describe('renamedNodeId', () => {
  it('смена тега даёт новый id узла', () => {
    expect(renamedNodeId('out:direct', { tag: 'wg' })).toBe('out:wg')
    expect(renamedNodeId('in:vless-in', { tag: 'vless-new' })).toBe('in:vless-new')
    // Тег балансера — тоже id узла: выбор обязан ехать за ним
    expect(renamedNodeId('bal:balancer', { tag: 'bal-eu' })).toBe('bal:bal-eu')
  })

  it('тот же тег, пустой тег и нестроковый тег — выбор не переносим', () => {
    expect(renamedNodeId('out:direct', { tag: 'direct' })).toBeNull()
    expect(renamedNodeId('out:direct', { tag: '' })).toBeNull()
    expect(renamedNodeId('out:direct', { tag: 42 })).toBeNull()
    expect(renamedNodeId('out:direct', null)).toBeNull()
  })

  it('у правил и dns тег не адресует узел', () => {
    expect(renamedNodeId('rule:0', { tag: 'wg' })).toBeNull()
    expect(renamedNodeId('dns', { tag: 'wg' })).toBeNull()
  })
})
