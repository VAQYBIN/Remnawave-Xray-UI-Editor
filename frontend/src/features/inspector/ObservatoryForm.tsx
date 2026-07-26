import { CheckboxField, NumberField, StringListField, TextField } from './fields'

type Obj = Record<string, unknown>

interface Props {
  /** { observatory?, burstObservatory? } — то, что отдаёт getNodeJson(config, 'obs') */
  value: Obj
  onChange: (next: Obj) => void
  outboundTags: string[]
}

export function ObservatoryForm({ value, onChange }: Props) {
  const obs = value.observatory as Obj | undefined
  const burst = value.burstObservatory as Obj | undefined
  const ping = (burst?.pingConfig as Obj | undefined) ?? {}

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }
  const setObs = (mut: (s: Obj) => void) =>
    patch((n) => {
      const s = { ...((n.observatory as Obj) ?? {}) }
      mut(s)
      n.observatory = s
    })
  const setPing = (mut: (p: Obj) => void) =>
    patch((n) => {
      const s = { ...((n.burstObservatory as Obj) ?? {}) }
      const p = { ...((s.pingConfig as Obj) ?? {}) }
      mut(p)
      s.pingConfig = p
      n.burstObservatory = s
    })

  return (
    <>
      <CheckboxField
        label="Фоновые пробы (observatory)"
        hint="Нужна стратегии leastPing: периодический запрос probeUrl через каждый выход"
        value={obs !== undefined}
        onChange={(v) =>
          patch((n) => {
            if (v) n.observatory = { subjectSelector: [] }
            else delete n.observatory
          })
        }
      />
      {obs !== undefined && (
        <>
          <StringListField
            label="Наблюдаемые выходы (subjectSelector)"
            hint="ПРЕФИКСЫ тегов outbound’ов — как selector балансера"
            placeholder="proxy-"
            value={obs.subjectSelector as string[] | undefined}
            onChange={(v) => setObs((s) => { s.subjectSelector = v ?? [] })}
          />
          <TextField
            label="URL пробы (probeUrl)"
            mono
            placeholder="https://www.google.com/generate_204"
            value={obs.probeUrl as string | undefined}
            onChange={(v) => setObs((s) => { if (v === undefined) delete s.probeUrl; else s.probeUrl = v })}
          />
          <TextField
            label="Интервал (probeInterval)"
            mono
            placeholder="10s"
            hint="Число с единицей: 10s, 1m"
            value={obs.probeInterval as string | undefined}
            onChange={(v) =>
              setObs((s) => { if (v === undefined) delete s.probeInterval; else s.probeInterval = v })
            }
          />
          <CheckboxField
            label="Мерить параллельно (enableConcurrency)"
            value={obs.enableConcurrency as boolean | undefined}
            onChange={(v) =>
              setObs((s) => { if (v === undefined) delete s.enableConcurrency; else s.enableConcurrency = v })
            }
          />
        </>
      )}

      <CheckboxField
        label="Замеры под нагрузкой (burstObservatory)"
        hint="Нужна стратегии leastLoad: серия проб с усреднением"
        value={burst !== undefined}
        onChange={(v) =>
          patch((n) => {
            if (v) n.burstObservatory = { subjectSelector: [] }
            else delete n.burstObservatory
          })
        }
      />
      {burst !== undefined && (
        <>
          <StringListField
            label="Наблюдаемые выходы (subjectSelector), burst"
            hint="ПРЕФИКСЫ тегов outbound’ов"
            placeholder="proxy-"
            value={burst.subjectSelector as string[] | undefined}
            onChange={(v) =>
              patch((n) => {
                const s = { ...((n.burstObservatory as Obj) ?? {}) }
                s.subjectSelector = v ?? []
                n.burstObservatory = s
              })
            }
          />
          <TextField
            label="Адрес проверки (destination)"
            mono
            placeholder="https://connectivitycheck.gstatic.com/generate_204"
            hint="Должен отвечать HTTP 204"
            value={ping.destination as string | undefined}
            onChange={(v) => setPing((p) => { if (v === undefined) delete p.destination; else p.destination = v })}
          />
          <TextField
            label="Интервал (interval)"
            mono
            placeholder="1m"
            hint="Минимум 10s"
            value={ping.interval as string | undefined}
            onChange={(v) => setPing((p) => { if (v === undefined) delete p.interval; else p.interval = v })}
          />
          <NumberField
            label="Хранить замеров (sampling)"
            placeholder="10"
            value={ping.sampling as number | undefined}
            onChange={(v) => setPing((p) => { if (v === undefined) delete p.sampling; else p.sampling = v })}
          />
          <TextField
            label="Таймаут (timeout)"
            mono
            placeholder="5s"
            value={ping.timeout as string | undefined}
            onChange={(v) => setPing((p) => { if (v === undefined) delete p.timeout; else p.timeout = v })}
          />
        </>
      )}
    </>
  )
}
