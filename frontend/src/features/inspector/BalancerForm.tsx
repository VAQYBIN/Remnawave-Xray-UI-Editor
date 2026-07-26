import { BALANCER_STRATEGIES, matchPrefixes } from '../../entities/xray'
import { Button } from '../../shared/ui'
import { SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

const STRATEGIES: Option[] = [
  { value: 'random', label: 'random — случайный выход' },
  { value: 'roundRobin', label: 'roundRobin — по кругу' },
  { value: 'leastPing', label: 'leastPing — самый быстрый (нужна observatory)' },
  { value: 'leastLoad', label: 'leastLoad — наименее загруженный (нужна burstObservatory)' },
]

export interface ObservatoryState {
  /** Есть ли секция, которую требует стратегия */
  present: boolean
  /** Кандидаты, которых не покрывает subjectSelector */
  missing: string[]
}

interface Props {
  value: Obj // объект балансера целиком (getNodeJson(config, 'bal:<tag>'))
  onChange: (next: Obj) => void
  outboundTags: string[]
  observatory?: ObservatoryState
  onSetupObservatory?: (kind: 'observatory' | 'burst', subjects: string[]) => void
}

export function BalancerForm({
  value,
  onChange,
  outboundTags,
  observatory,
  onSetupObservatory,
}: Props) {
  const selector = value.selector as string[] | undefined
  const candidates = matchPrefixes(outboundTags, selector)
  const strategy = (value.strategy as { type?: string } | undefined)?.type ?? 'random'
  const needsObservatory = strategy === 'leastPing' || strategy === 'leastLoad'
  const kind = strategy === 'leastLoad' ? 'burst' : 'observatory'
  const sectionName = kind === 'burst' ? 'burstObservatory' : 'observatory'

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  const fallbackOptions: Option[] = [
    { value: '', label: 'без запасного выхода' },
    ...outboundTags.map((t) => ({ value: t, label: t })),
  ]

  return (
    <>
      <TextField
        label="Тег балансера"
        mono
        hint="На него ссылается balancerTag правила"
        value={value.tag as string | undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      {/* Mount-only буфер StringListField: значение читается при монтировании */}
      <StringListField
        label="Селектор (selector)"
        hint="ПРЕФИКСЫ тегов outbound’ов: «proxy-» захватит proxy-de и proxy-nl"
        placeholder={'proxy-\nvless-'}
        value={selector}
        onChange={(v) => patch((n) => { n.selector = v ?? [] })}
      />
      {candidates.length > 0 ? (
        <p className="field-hint">Кандидаты: {candidates.join(', ')}</p>
      ) : (
        <p className="field-error">
          Селектор не совпал ни с одним outbound — балансеру не из чего выбирать
        </p>
      )}
      <SelectField
        label="Стратегия"
        value={(BALANCER_STRATEGIES as readonly string[]).includes(strategy) ? strategy : 'random'}
        options={STRATEGIES}
        onChange={(v) =>
          patch((n) => {
            const prev = (n.strategy as Obj | undefined) ?? {}
            n.strategy = { ...prev, type: v }
          })
        }
      />
      <SelectField
        label="Запасной выход (fallbackTag)"
        hint="Куда уйдёт трафик, когда все кандидаты недоступны"
        value={(value.fallbackTag as string | undefined) ?? ''}
        options={fallbackOptions}
        onChange={(v) => patch((n) => { if (v === '') delete n.fallbackTag; else n.fallbackTag = v })}
      />

      {/* Секция обсерватории общая на конфиг — правим её в своём узле, отсюда только переход */}
      {needsObservatory && (
        <div className="field">
          <span className="field-label">Проверка живости</span>
          {observatory?.present !== true ? (
            <>
              <span className="field-warning">
                Стратегия {strategy} измеряет выходы, а секции {sectionName} в конфиге нет
              </span>
              {onSetupObservatory && (
                <Button onClick={() => onSetupObservatory(kind, candidates)}>
                  Настроить проверку живости
                </Button>
              )}
            </>
          ) : observatory.missing.length > 0 ? (
            <>
              <span className="field-warning">
                Обсерватория не покрывает {observatory.missing.join(', ')} — ядро не будет их мерить
              </span>
              {onSetupObservatory && (
                <Button onClick={() => onSetupObservatory(kind, candidates)}>Добавить в проверку</Button>
              )}
            </>
          ) : (
            <span className="field-hint">Настроена, все кандидаты под наблюдением</span>
          )}
        </div>
      )}
    </>
  )
}
