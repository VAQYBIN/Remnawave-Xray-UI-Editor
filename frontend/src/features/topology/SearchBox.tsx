import { useEffect, useRef } from 'react'
import type { SearchHit } from '../../entities/graph/search'
import { TextInput } from '../../shared/ui'

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  inbound: 'inbound',
  outbound: 'outbound',
  rule: 'правило',
  squad: 'сквад',
  dns: 'dns',
  balancer: 'балансер',
}

export function SearchBox({
  query,
  hits,
  onQuery,
  onPick,
  focusSignal,
}: {
  query: string
  hits: SearchHit[]
  onQuery: (value: string) => void
  onPick: (nodeId: string) => void
  /** Сигнал от Ctrl+F: значение растёт, эффект перезапускается и ставит фокус */
  focusSignal?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus()
  }, [focusSignal])

  return (
    <div className="search-box">
      <label className="sr-only" htmlFor="graph-search">
        Поиск по конфигу
      </label>
      <TextInput
        ref={inputRef}
        id="graph-search"
        value={query}
        placeholder="Поиск: тег, порт, домен…"
        onChange={(e) => onQuery(e.target.value)}
      />
      {query.trim() !== '' && (
        <div className="search-results">
          {hits.length === 0 ? (
            <p className="muted search-empty">Ничего не найдено</p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={hit.nodeId}>
                  <button type="button" className="search-hit" onClick={() => onPick(hit.nodeId)}>
                    <span className="search-hit-kind">{KIND_LABEL[hit.kind]}</span>
                    <span className="search-hit-title">{hit.title}</span>
                    <span className="search-hit-why">{hit.matchedOn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
