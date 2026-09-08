// Содержимое одного набора постранично. Сестра `GeoBrowser`: тот же приём —
// страницу режет сервер, поиск идёт туда же, в DOM попадает только страница.
import { useState } from 'react'
import { useRuleSetPage, type RuleSetQuery } from '../../shared/api'
import { useDebounced } from '../../shared/lib/useDebounced'
import { groupDigits } from '../../shared/lib/format'
import { Button, TextInput } from '../../shared/ui'

const PAGE_SIZE = 200

export function RuleSetBrowser({
  descriptor,
  onBack,
}: {
  descriptor: RuleSetQuery | null
  onBack: () => void
}) {
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  // Поиск считает сервер: у набора подсетей крупной страны 300 тысяч записей,
  // и гонять их на клиент ради подстроки бессмысленно
  const debounced = useDebounced(query, 600)
  const page = useRuleSetPage(descriptor, { offset, limit: PAGE_SIZE, q: debounced })

  if (descriptor === null) {
    return (
      <div className="rs-browser">
        <p className="muted">Выберите набор на вкладке «Состояние».</p>
      </div>
    )
  }

  const total = page.data?.total ?? 0
  const shown = page.data ? Math.min(total - page.data.offset, PAGE_SIZE) : 0

  return (
    <div className="rs-browser">
      <div className="rs-browser-head">
        <Button variant="ghost" onClick={onBack}>
          ← К списку
        </Button>
        <span className="mono">{descriptor.name}</span>
        <TextInput
          aria-label="Поиск по набору"
          placeholder={descriptor.behavior === 'ipcidr' ? '10.' : 'example.com'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Страница считается от начала: на третьей странице прошлого поиска
            // новый выдал бы пустоту при непустом результате
            setOffset(0)
          }}
        />
      </div>

      {page.isError && <p className="field-error">{(page.error as Error).message}</p>}

      <ul className="rs-items" aria-label="Содержимое набора">
        {(page.data?.items ?? []).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className="rs-pager">
        {/* На отказе счётчик молчит: сказать «Ничего не найдено» значило бы
            выдать несостоявшуюся загрузку за пустой набор — причина стоит
            строкой выше, и второго, противоречащего ей текста тут быть не
            должно (находка ревью) */}
        {!page.isError && (
          <span className="muted">
            {total === 0
              ? page.isPending
                ? 'Загружаю…'
                : 'Ничего не найдено'
              : `показаны ${page.data!.offset + 1}–${page.data!.offset + shown} из ${groupDigits(total)}`}
          </span>
        )}
        {page.data !== undefined && descriptor.behavior === 'domain' && (
          // Строк вдвое больше записей: на каждый домен ядро кладёт и его
          // самого, и форму «+.». Промолчать значило бы оставить пользователя с
          // подозрением, что декодер считает вдвое
          <span className="muted">{`в заголовке набора: ${groupDigits(page.data.count)}`}</span>
        )}
        <span className="spacer" />
        <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ← Назад
        </Button>
        <Button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Вперёд →
        </Button>
      </div>
    </div>
  )
}
