// Импорт готового шаблона из каталога remnawave/templates. Диалог общий для
// обоих редакторов шаблонов: каталог отдаёт все типы, и Xray-редактору он нужен
// ровно так же, как Mihomo.
//
// Четыре решения, которые здесь закреплены:
//   1. по умолчанию видны шаблоны типа ОТКРЫТОГО документа, но фильтр
//      переключается на «все»: смотреть чужой шаблон полезно, импортировать — нет;
//   2. незнакомый тип (каталог опережает контракт панели — SINGBOX_LEGACY) не
//      ломает список, а показывается с пометкой;
//   3. импорт — правка ЧЕРНОВИКА: содержимое уходит наружу через onImport, и
//      сохранять ли его в панель, решает пользователь. Прямая запись в панель
//      была бы необратимой операцией по одному клику в диалоге;
//   4. поверх изменённого черновика спрашиваем подтверждение — документ
//      затирается целиком, а `dirty` означает, что затирать есть что.

import { useState } from 'react'
import {
  TEMPLATE_TYPES,
  useCatalog,
  useCatalogTemplate,
  type CatalogEntry,
  type TemplateType,
} from '../../shared/api'
import { Button, Chip, Dialog, EmptyState } from '../../shared/ui'
import { SelectField } from '../inspector/fields'

/** Ширина колонки со списком записей: правая колонка — предпросмотр */
const LAYOUT = {
  display: 'grid',
  gridTemplateColumns: '260px 1fr',
  gap: 12,
  alignItems: 'start',
} as const

const PREVIEW = { margin: 0, padding: 8, maxHeight: 320 } as const

/** Тип из каталога — строка: узнать его можно только сверкой со списком панели */
function isKnownType(type: string): boolean {
  return (TEMPLATE_TYPES as readonly string[]).includes(type)
}

function EntryRow({
  entry,
  selected,
  onPick,
}: {
  entry: CatalogEntry
  selected: boolean
  onPick: () => void
}) {
  return (
    <li className="check-item">
      <Button variant="ghost" aria-pressed={selected} onClick={onPick}>
        <span className="mono">{entry.name}</span>
      </Button>
      <Chip dir="none">{entry.type}</Chip>
      <span className="muted">{entry.author}</span>
      {!isKnownType(entry.type) && (
        <span className="field-warning">тип не поддерживается редактором</span>
      )}
    </li>
  )
}

export function ImportTemplateDialog({
  open,
  docType,
  dirty,
  onImport,
  onClose,
}: {
  open: boolean
  /** Тип открытого документа: и умолчание фильтра, и условие импорта */
  docType: TemplateType
  /** Есть ли в черновике что затирать */
  dirty: boolean
  /** Содержимое уходит в черновик редактора, а не в панель */
  onImport: (content: string) => void
  onClose: () => void
}) {
  // Диалог смонтирован вместе со страницей — без гейта каждый открытый редактор
  // ходил бы на GitHub через наш бэкенд
  const catalog = useCatalog(open)
  const [filter, setFilter] = useState<string>(docType)
  const [pickedUrl, setPickedUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const content = useCatalogTemplate(pickedUrl)

  const entries = catalog.data ?? []
  const shown = filter === 'all' ? entries : entries.filter((e) => e.type === filter)
  // Поиск по всем записям, а не по видимым, безопасен ровно потому, что смена
  // фильтра снимает выбор (см. onChange ниже): выбранной записи, которой нет в
  // списке, не бывает. Убрать тот сброс — и здесь появится предпросмотр
  // невидимой записи
  const picked = entries.find((e) => e.url === pickedUrl)

  // Закрытие забывает выбор: иначе следующее открытие встречает предпросмотром
  // чужого шаблона и наполовину пройденным подтверждением
  function close() {
    setPickedUrl(null)
    setConfirming(false)
    onClose()
  }

  function doImport(text: string) {
    onImport(text)
    close()
  }

  const importable = picked !== undefined && picked.type === docType
  const text = content.data

  return (
    <Dialog open={open} title="Импорт шаблона из каталога" onClose={close} wide>
      <div style={LAYOUT}>
        <div>
          {catalog.isPending && open ? (
            <p className="muted">Читаю каталог…</p>
          ) : catalog.isError ? (
            <p className="field-error">{(catalog.error as Error).message}</p>
          ) : shown.length === 0 ? (
            <EmptyState
              title="Ничего не нашлось"
              // Пустой список приходит двумя разными путями, и совет у них не
              // общий: под фильтром типа переключение на «все» действительно
              // помогает, а на «всех типах» переключать уже некуда — пуст сам
              // ответ каталога. Один текст на оба случая советовал бы уйти туда,
              // где пользователь и так стоит
              hint={
                filter === 'all'
                  ? 'Каталог не вернул ни одной записи — попробуйте позже.'
                  : `В каталоге нет шаблонов типа ${filter} — переключите фильтр на «все типы».`
              }
            />
          ) : (
            <ul className="check-list">
              {shown.map((entry) => (
                <EntryRow
                  key={entry.url}
                  entry={entry}
                  selected={entry.url === pickedUrl}
                  onPick={() => {
                    setPickedUrl(entry.url)
                    setConfirming(false)
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        <div>
          {picked === undefined ? (
            <p className="muted">Выберите шаблон слева — содержимое покажется здесь.</p>
          ) : content.isPending ? (
            <p className="muted">Скачиваю шаблон…</p>
          ) : content.isError ? (
            <p className="field-error">{(content.error as Error).message}</p>
          ) : (
            <pre className="mono diff-frame" style={PREVIEW}>
              {text}
            </pre>
          )}
        </div>
      </div>

      {picked !== undefined && !importable && (
        <p className="field-warning">
          {isKnownType(picked.type)
            ? `Открыт документ ${docType}: импортировать в него можно только шаблон типа ${docType}, а этот — ${picked.type}.`
            : `Тип ${picked.type} редактор не открывает — такой шаблон можно только посмотреть.`}
        </p>
      )}

      {confirming ? (
        <>
          {/* Импорт затирает документ целиком, а не дописывает к нему */}
          <p className="field-warning">
            Импорт затрёт ваши правки этого документа целиком. Записи в панель не будет — вернуть
            прежний текст можно через Ctrl+Z.
          </p>
          <div className="row">
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Не затирать
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (text !== undefined) doImport(text)
              }}
            >
              Затереть и импортировать
            </Button>
          </div>
        </>
      ) : (
        <div className="row">
          <SelectField
            label="Тип"
            value={filter}
            options={[
              { value: docType, label: `Только ${docType}` },
              { value: 'all', label: 'Все типы' },
            ]}
            onChange={(value) => {
              // Смена фильтра снимает выбор: иначе в предпросмотре осталась бы
              // запись, которой в списке уже нет, — состояние, которое нечем
              // объяснить смотрящему
              setFilter(value)
              setPickedUrl(null)
              setConfirming(false)
            }}
          />
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!importable || text === undefined}
            onClick={() => {
              if (text === undefined) return
              if (dirty) setConfirming(true)
              else doImport(text)
            }}
          >
            Импортировать в редактор
          </Button>
        </div>
      )}
    </Dialog>
  )
}
