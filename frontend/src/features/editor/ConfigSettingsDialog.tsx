import type { XrayConfig } from '../../entities/xray'
import { Button, Dialog } from '../../shared/ui'
import { CheckboxField, SelectField, TextField, type Option } from '../inspector/fields'

type Obj = Record<string, unknown>

// Пояснения зашиты в лейблы опций — отдельные hint'ы не нужны
const DOMAIN_STRATEGIES: Option[] = [
  { value: '', label: 'не задана (AsIs)' },
  { value: 'AsIs', label: 'AsIs — матчить только по домену, без резолва' },
  { value: 'IPIfNonMatch', label: 'IPIfNonMatch — резолвить в IP, если домен не совпал ни с одним правилом' },
  { value: 'IPOnDemand', label: 'IPOnDemand — резолвить сразу при первом ip-условии в правилах' },
]

const DOMAIN_MATCHERS: Option[] = [
  { value: '', label: 'не задан (hybrid)' },
  { value: 'hybrid', label: 'hybrid — быстрый (по умолчанию)' },
  { value: 'mph', label: 'mph — синоним hybrid' },
  { value: 'linear', label: 'linear — линейный перебор (для отладки)' },
]

const LOG_LEVELS: Option[] = [
  { value: '', label: 'не задан (warning)' },
  { value: 'debug', label: 'debug — максимально подробно' },
  { value: 'info', label: 'info' },
  { value: 'warning', label: 'warning (по умолчанию)' },
  { value: 'error', label: 'error' },
  { value: 'none', label: 'none — ничего не логировать' },
]

interface Props {
  open: boolean
  config: XrayConfig
  onChange: (next: XrayConfig) => void
  onClose: () => void
}

// Глобальные настройки конфига (routing, log) — не узел графа, поэтому диалог.
// Правки применяются в черновик сразу (как в формах инспектора): диалог модален,
// параллельных правок конфига при открытом диалоге не бывает.
export function ConfigSettingsDialog({ open, config, onChange, onClose }: Props) {
  const routing = (config.routing as Obj | undefined) ?? {}
  const log = (config.log as Obj | undefined) ?? {}

  // Ставшая пустой секция удаляется целиком — не оставляем в JSON висящие "{}"
  function patchSection(key: 'routing' | 'log', mut: (s: Obj) => void) {
    const next = structuredClone(config)
    const section = ((next as Obj)[key] as Obj | undefined) ?? {}
    mut(section)
    if (Object.keys(section).length === 0) delete (next as Obj)[key]
    else (next as Obj)[key] = section
    onChange(next)
  }

  return (
    <Dialog open={open} title="Настройки конфига" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Глобальные настройки применяются к черновику сразу.
      </p>
      <h3>Маршрутизация</h3>
      <SelectField
        label="Стратегия доменов (domainStrategy)"
        hint="Как резолвить домены при сопоставлении с ip-правилами"
        value={(routing.domainStrategy as string) ?? ''}
        options={DOMAIN_STRATEGIES}
        onChange={(v) =>
          patchSection('routing', (r) => { if (v === '') delete r.domainStrategy; else r.domainStrategy = v })
        }
      />
      <SelectField
        label="Матчер доменов (domainMatcher)"
        hint="Алгоритм сопоставления доменных правил"
        value={(routing.domainMatcher as string) ?? ''}
        options={DOMAIN_MATCHERS}
        onChange={(v) =>
          patchSection('routing', (r) => { if (v === '') delete r.domainMatcher; else r.domainMatcher = v })
        }
      />
      <h3 style={{ marginTop: 16 }}>Лог</h3>
      <SelectField
        label="Уровень лога (loglevel)"
        value={(log.loglevel as string) ?? ''}
        options={LOG_LEVELS}
        onChange={(v) => patchSection('log', (l) => { if (v === '') delete l.loglevel; else l.loglevel = v })}
      />
      <TextField
        label="Файл access-лога"
        mono
        hint="Путь к файлу; none — отключить; пусто — stdout"
        placeholder="/var/log/xray/access.log"
        value={log.access as string | undefined}
        onChange={(v) => patchSection('log', (l) => { if (v === undefined) delete l.access; else l.access = v })}
      />
      <TextField
        label="Файл error-лога"
        mono
        hint="Путь к файлу; none — отключить; пусто — stderr"
        placeholder="/var/log/xray/error.log"
        value={log.error as string | undefined}
        onChange={(v) => patchSection('log', (l) => { if (v === undefined) delete l.error; else l.error = v })}
      />
      <CheckboxField
        label="Логировать DNS-запросы (dnsLog)"
        value={log.dnsLog as boolean | undefined}
        onChange={(v) => patchSection('log', (l) => { if (v === undefined) delete l.dnsLog; else l.dnsLog = v })}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть настройки">
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}
