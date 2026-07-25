import { useMemo, useState } from 'react'
import { useGeoCategories, useGeoCategory, type GeoKind } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { Button, Select, TextInput } from '../../shared/ui'

const PAGE_SIZE = 200
/** 1520 категорий в DOM делают диалог вязким — показываем начало списка */
const MAX_ROWS = 300

interface Props {
  /** Не передан — кнопки «В правило» нет (диалог открыт вне редактора) */
  onUseKey?: (key: string) => void
  onOpenSources: () => void
}

export function GeoBrowser({ onUseKey, onOpenSources }: Props) {
  const [kind, setKind] = useState<GeoKind>('geosite')
  const [catQuery, setCatQuery] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [itemQuery, setItemQuery] = useState('')
  const [offset, setOffset] = useState(0)

  const categories = useGeoCategories(kind)
  // Поиск внутри категории идёт на бэкенд: без задержки запрос уходил бы на каждый символ
  const debouncedItemQuery = useDebounced(itemQuery, 600)
  const page = useGeoCategory(kind, code, { q: debouncedItemQuery, offset })

  const filtered = useMemo(() => {
    const q = catQuery.trim().toUpperCase()
    const all = categories.data ?? []
    return q === '' ? all : all.filter((c) => c.code.includes(q))
  }, [categories.data, catQuery])

  function switchKind(next: GeoKind) {
    setKind(next)
    setCode(null)
    setItemQuery('')
    setOffset(0)
  }

  function selectCode(next: string) {
    setCode(next)
    setItemQuery('')
    setOffset(0)
  }

  if (categories.isError) {
    return (
      <div className="geo-empty">
        <p className="field-warning">{(categories.error as Error).message}</p>
        <Button onClick={onOpenSources}>К источникам</Button>
      </div>
    )
  }

  const total = page.data?.total ?? 0
  const shown = page.data ? Math.min(total - page.data.offset, PAGE_SIZE) : 0
  const key = code === null ? null : `${kind}:${code.toLowerCase()}`

  return (
    <div className="geo-browser">
      <div className="geo-browser-head">
        <Select
          aria-label="База"
          value={kind}
          options={[
            { value: 'geosite', label: 'geosite — домены' },
            { value: 'geoip', label: 'geoip — подсети' },
          ]}
          onChange={(v) => switchKind(v as GeoKind)}
        />
        <TextInput
          aria-label="Поиск категории"
          placeholder="google"
          value={catQuery}
          onChange={(e) => setCatQuery(e.target.value)}
        />
      </div>

      <div className="geo-browser-body">
        <div className="geo-cat-list">
          {categories.isPending && <p className="muted">Загрузка…</p>}
          {filtered.slice(0, MAX_ROWS).map((c) => (
            <button
              key={c.code}
              type="button"
              className={c.code === code ? 'geo-cat geo-cat-active' : 'geo-cat'}
              aria-pressed={c.code === code}
              onClick={() => selectCode(c.code)}
            >
              <span className="geo-cat-code">{c.code}</span>
              <span className="geo-cat-count">{c.count}</span>
            </button>
          ))}
          {filtered.length > MAX_ROWS && (
            <p className="muted">Показаны первые {MAX_ROWS} — уточните поиск.</p>
          )}
          {!categories.isPending && filtered.length === 0 && (
            <p className="muted">Ничего не найдено.</p>
          )}
        </div>

        <div className="geo-items">
          {code === null && <p className="muted">Выберите категорию слева.</p>}
          {code !== null && (
            <>
              <TextInput
                aria-label="Поиск внутри категории"
                placeholder={kind === 'geosite' ? 'example.com' : '10.'}
                value={itemQuery}
                onChange={(e) => {
                  setItemQuery(e.target.value)
                  setOffset(0)
                }}
              />
              {page.isError && <p className="field-error">{(page.error as Error).message}</p>}
              {page.data?.reverseMatch === true && (
                <p className="field-warning">
                  У категории включён reverseMatch: правило срабатывает на адресах ВНЕ списка.
                </p>
              )}
              <ul className="geo-item-list" aria-label="Содержимое категории">
                {(page.data?.domains ?? []).map((d) => (
                  <li key={`${d.type}:${d.value}`}>
                    <span className="geo-item-type">{d.type}</span>
                    <span className="mono">{d.value}</span>
                    {d.attributes.map((a) => (
                      <span key={a} className="geo-item-attr">{`@${a}`}</span>
                    ))}
                  </li>
                ))}
                {(page.data?.cidrs ?? []).map((c) => (
                  <li key={c}>
                    <span className="mono">{c}</span>
                  </li>
                ))}
              </ul>
              <div className="geo-pager">
                <span className="muted">
                  {total === 0
                    ? 'Ничего не найдено'
                    : `показаны ${page.data!.offset + 1}–${page.data!.offset + shown} из ${total}`}
                </span>
                <span className="spacer" />
                <Button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ← Назад
                </Button>
                <Button
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Вперёд →
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {key !== null && (
        <div className="row">
          <span className="mono">{key}</span>
          <span className="spacer" />
          <Button onClick={() => void navigator.clipboard?.writeText(key)}>Скопировать</Button>
          {onUseKey && (
            <Button variant="primary" onClick={() => onUseKey(key)}>
              В правило
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
