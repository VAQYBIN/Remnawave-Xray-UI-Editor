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
//   4. поверх изменённого черновика спрашиваем подтверждение ОТДЕЛЬНЫМ окном.
//      Раньше вопрос подменял собой нижний ряд кнопок: «Импортировать в
//      редактор» на месте согласия превращалась в «Затереть и импортировать»,
//      и второй клик в ту же точку экрана означал уже не то же самое. Окно
//      поверх окна заставляет перевести взгляд и целиться заново.

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
  // Кнопка — вся карточка, а не имя внутри неё: целиться в строку текста в
  // узкой колонке пользователю незачем, а тип и автор — такая же часть записи.
  // Внутрь идут только span'ы (Chip — тоже span), кнопка в кнопку не вложена
  return (
    <li>
      <Button className="import-card" aria-pressed={selected} onClick={onPick}>
        <span className="mono">{entry.name}</span>
        <Chip dir="none">{entry.type}</Chip>
        <span className="muted">{entry.author}</span>
        {!isKnownType(entry.type) && (
          <span className="field-warning">тип не поддерживается редактором</span>
        )}
      </Button>
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
    <>
      <Dialog open={open} title="Импорт шаблона из каталога" onClose={close} wide>
        <div className="import-body">
          <div className="import-col import-col-list">
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

          <div className="import-col">
            {picked === undefined ? (
              <p className="muted">Выберите шаблон слева — содержимое покажется здесь.</p>
            ) : content.isPending ? (
              <p className="muted">Скачиваю шаблон…</p>
            ) : content.isError ? (
              <p className="field-error">{(content.error as Error).message}</p>
            ) : (
              <pre className="mono diff-frame import-preview">{text}</pre>
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
      </Dialog>

      {/* Импорт затирает документ целиком, а не дописывает к нему. Отказ здесь
          возвращает к выбору шаблона, а не в редактор: диалог каталога остаётся
          открытым под этим окном.

          Монтируется по условию, а не живёт с `open={confirming}`, как прочие
          диалоги приложения: закрытый `<dialog>` держит содержимое в DOM, и
          предупреждение «импорт затрёт правки» читалось бы вспомогательными
          технологиями (и тестами) всё время, пока открыт каталог. */}
      {confirming && (
        <Dialog open title="Импорт затрёт документ" onClose={() => setConfirming(false)}>
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
        </Dialog>
      )}
    </>
  )
}
