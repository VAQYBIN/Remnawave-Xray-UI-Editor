# Полное визуальное редактирование клиентских шаблонов. Часть 1: общий слой схемы и форм, sing-box целиком — дизайн

**Дата:** 2026-09-09
**Статус:** выполнен планом `2026-09-09-schema-forms-singbox-plan.md`
**Предшественники:** `2026-09-07-singbox-templates-design.md` (модель и первый интерфейс sing-box),
`2026-09-05-mihomo-templates-design.md`, `2026-09-03-subscription-templates-design.md`
**Продолжения:** часть 2 (Mihomo) и часть 3 (Xray-шаблон) — отдельные спеки на тех же контрактах,
пишутся после выполнения этой.

## Цель

Клиентский шаблон подписки собирается и правится целиком через интерфейс: кнопки, формы, граф.
Текстовая вкладка остаётся для просмотра, аварийных случаев и ключей, которых редактор не знает.
Мера успеха — сквозной сценарий «собрать рабочий шаблон с нуля, ни разу не открыв JSON».

Эта часть строит общий слой (схема, рендерер форм, писатель операций, панель «Документ»,
создание и порядок, движок рецептов) и доводит до полноты редактор sing-box — первый потребитель
общего слоя. Порядок ядер утверждён владельцем: sing-box, затем Mihomo, затем Xray-шаблон.

## Откуда взялась задача

Инвентаризация трёх клиентских редакторов 2026-09-09 показала одну и ту же картину: редакторы
построены «от графа». У всего, что является узлом маршрута, есть карточка и форма; у настроек
документа, параметров серверов, создания сущностей и порядка списков — нет. Для sing-box это
означало: секции `route`, `dns`, `log`, `experimental` без единой формы при том, что стартер
панели заводит их всегда; словарь выхода из пяти ключей без единого протокольного и без `tls`,
`transport`, `multiplex`; создание с холста только правила, набора правил и DNS-сервера; порядок
только у правил, хотя первый элемент `outbounds` — маршрут по умолчанию.

Причина не в отдельных недоделках, а в том, что формы писались руками по узлам графа, а словарь
питал только подсказки. Ручные формы отстают от ядра неизбежно: sing-box уходит вперёд быстрее,
чем успевает форма.

## Проверенные факты, на которые опирается дизайн

- Генератор панели (`remnawave/backend`, `singbox.generator.service.ts`) нацелен на sing-box
1.13.x; дописывает сгенерированные выходы в **конец** `outbounds`; переписывает `outbounds` у
`selector`/`urltest`, если нет `remnawave.includeProxies: false`; вырезает ключ `remnawave` из
любого выхода; `dns`, `route`, `inbounds` не трогает. Это уже записано в `CLAUDE.md` и здесь не
меняется.
- Стабильный sing-box на 2026-09 — 1.14.0. Удалено из ядра: `geoip`/`geosite` в правилах (1.12),
outbound-типы `block` и `dns`, `wireguard`-outbound, `override_address`/`override_port` у
`direct` (1.13), legacy-формат DNS-серверов `address` и корневой блок `fakeip` (1.14). Панель
такие документы всё ещё хранит и отдаёт, поэтому редактор их **открывает без потерь и
предупреждает**, а не отказывает.
- Живые шаблоны каталога кладут почти всё авторское содержимое в `route.rules`
(`sniff`, `hijack-dns`, `clash_mode`, `rule_set`), `dns.servers` и `dns.rules`, а серверы и
списки групп оставляют панели. Значит, полнота форм правил и DNS важнее полноты форм
протоколов, но по решению владельца схема покрывает ядро **целиком**.

## Решения владельца (2026-09-09)

1. Порядок ядер: sing-box, Mihomo, Xray-шаблон.
2. Запрет `doc.toString()` для Mihomo снят для структурных операций (действует со второй части).
3. Глубина: вся модель ядра, а не только то, что встречается в каталоге.
4. Рецепты для клиентских шаблонов входят в объём, по ядру внутри его спеки.
5. Панель «Документ» — псевдоузел в инспекторе, а не диалог.
6. Неизвестные схеме ключи всегда видны в форме на чтение.

## Расхождения со спекой

Спека — авторитет, и расхождения с ней здесь названы, а не молчаливы. Каждое найдено сверкой
спеки с уже написанным кодом при исполнении плана `2026-09-09-schema-forms-singbox-plan.md`.

**1. `FieldKind` получил `'map'`, `Condition` — `notIn` (аддитивно, задача 1).** Спека описывает
`FieldKind` без `'map'` и `Condition` только с `in` (см. блок кода выше). `'map'` понадобился для
отображений строка → строка (заголовки транспорта, `hosts`): без него такой ключ был бы объектом
без полей и рисовался бы только на чтение. `notIn` понадобился там, где проще назвать
исключения, чем перечислить всех: dial-поля выхода нужны всем типам, кроме групп, и список «всех
остальных» устаревал бы на первом же новом типе ядра. Оба поля — расширение перечисленного в
спеке набора, ни один из существующих вариантов не убран и не переопределён.

**2. Условные поля не поднимаются из «Ещё поля» одним выполнением `when` (задача 5).** Спека
говорит только «заполненные сверху, незаполненные — под крышкой» и не оговаривает, что делать с
полем, чьё условие видимости выполнилось, но само поле пусто. В реальном словаре sing-box
условным оказывается почти каждое поле (dial-поля исключают только группы через `notIn`,
`tls`/`transport`/`multiplex` зависят от `type`) — подними рендерер наверх любое поле, чьё `when`
сработало, крышка опустела бы, а верх формы захламили бы десятки полей, ставших ДОСТУПНЫМИ, но не
заполненных. Наверх поднимает только значение, которое вписал пользователь (`SchemaForm.tsx`,
функция `isFilled`).

**3. Список строк со ссылкой (`item.ref`) рисуется мультиселектом по тегам документа.** У спеки
тип элемента списка (`item`) полей `ref` не имеет вовсе — только `kind`/`fields`/`label`, и
списки строк с ref не были описаны совсем. Полям вроде `outbounds` селектора нужен выбор из
нескольких тегов, а не одного, поэтому `SchemaForm.tsx` даёт им `MultiSelectField` с тем же
сквозным пропуском чужого значения, что у одиночного `ref`: тег, который подставит панель, или
опечатка автора не пропадают молча из списка при открытии формы.

**4. `NumberField` ресинхронизирует буфер при внешней смене `value` (задача 3).** Спека этого
поведения не требует явно. Без ресинхронизации переключение узла или отмена/возврат оставляли бы
в поле число прежнего владельца позиции, пока пользователь не начнёт печатать сам — форма
показывала бы значение, которого уже нет в документе.

**5. Формы sing-box не держат зеркало значения в локальном состоянии (например, форма правила).**
Спека не запрещает и не требует этого явно, но `SchemaForm` и построенные на нём формы читают
значение из документа на каждый рендер и эмитят операции по абсолютному пути, а не берут его в
`useState` для последующей синхронизации — второй источник истины расходился бы с документом при
внешней правке (отмена, восстановление версии, импорт).

**6. Типы выходов, устаревшие по схеме, исключены из предупреждения «панель не добавит в списки
групп» (задача 20).** Вместо отдельного списка удалённых типов предупреждение пропускает типы, у
которых уже есть `deprecated` в схеме (`DEPRECATED_OUTBOUND_TYPES`, посчитан из
`OUTBOUND_TYPE_VALUES`, а не переписан руками): про такой тип уже сказало предупреждение
`deprecated` со своей причиной и заменой, и вторая, более общая претензия на том же пути
документа была бы шумом.

**7. Неиспользуемые помощники мутаций графа удалены, а не оставлены рядом с новыми.** Первый
интерфейс sing-box (план 2) читал и писал запись выхода/эндпоинта через `outboundByTag`/
`withOutboundAt`/`removeAt`. Операции писателя (`DocOp`+`applyOps`) взяли на себя запись, а чтение
свелось к одному `outboundSlot(doc, tag)` (`entities/graph/singbox/mutations.ts`) — три прежних
помощника без единого потребителя удалены целиком, а не оставлены неиспользуемыми в файле.

**8. Карточка ГРУППЫ тоже получает бейдж «по умолчанию».** Спека говорит «граф не меняется» и
описывает бейдж только следом за порядком `outbounds`; первый интерфейс sing-box (план 2) ставил
флаг `isDefault` только на карточку выхода, по образцу Xray. Но первый элемент `outbounds` может
быть и группой (`selector`/`urltest`), а не только сервером, — и без флага на карточке группы
дефолтный маршрут в этом случае был бы не виден нигде на холсте, что и стало поводом чинить это
здесь же, а не переносить в часть 2/3.

**9. Рецепты `ads` и `dns` не двигают правила `sniff`/`hijack-dns`, а работают вокруг них
(задача 22).** Правило блокировки рекламы встаёт не первым, а СРАЗУ ЗА ведущей серией
`sniff`/`resolve`/`route-options`/`hijack-dns` (`afterLeadingService`): в sing-box `sniff` —
такое же правило маршрута, а не свойство inbound'а, как у Xray, и правило по домену впереди него
слепо — домен ещё не известен. Рецепт `dns` уже существующие `sniff`/`hijack-dns` НЕ
переставляет вовсе: если оба есть, но не первыми двумя, план отвечает `status: 'exists'` на
оба и добавляет заметку с просьбой проверить порядок руками — переставить чужие правила значило
бы молча сломать то, что расставил не рецепт.

## Общий слой

Общий слой живёт в `frontend/src/shared/schema/` (типы, операции, разбор схемы) и
`frontend/src/features/inspector/schema/` (рендерер). Слоистость сохраняется: `shared` не знает
о ядрах, `entities/<ядро>` экспортирует свою схему, `features` рисует.

### Схема

Одна форма описания на три ядра. Дерево, а не плоские секции: вложенный объект описан на месте,
условные ключи привязаны к значению соседа.

```ts
// shared/schema/types.ts
export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'list' | 'object'

export interface Deprecation {
  /** Версия ядра, с которой ключ или значение считается устаревшим либо удалённым */
  since: string
  /** Чем заменить — по-русски, одной фразой; попадает и в подсказку формы, и в диагностику */
  replacement: string
}

export interface EnumValue {
  value: string
  doc?: string
  deprecated?: Deprecation
}

export interface Condition {
  /** Ключ соседа в том же объекте */
  key: string
  /** Поле показывается, когда значение соседа входит в список */
  in: string[]
}

export type RefKind = 'outbound' | 'inbound' | 'dns-server' | 'rule-set'

export interface FieldSchema {
  key: string
  /** Русское описание: подпись формы, tooltip подсказки, текст hover */
  doc: string
  kind: FieldKind
  /** kind: enum — известные значения. Подсказка, а не ограничение: чужое значение проходит сквозь */
  enum?: EnumValue[]
  /** kind: object — вложенные поля */
  fields?: FieldSchema[]
  /** kind: list — элемент: скаляр или объект с полями */
  item?: { kind: 'string' | 'number' | 'object'; fields?: FieldSchema[]; label?: (value: unknown) => string }
  /** Показывать, только когда сосед принял одно из значений (протокол, тип, security…) */
  when?: Condition
  deprecated?: Deprecation
  /** Версия ядра, с которой ключ существует — только для подсказки, не для запрета */
  since?: string
  /** Значение — тег другой записи документа: форма даёт выбор из существующих тегов */
  ref?: RefKind
  /** kind: number — целое (по умолчанию да) и нижняя граница; отрицательные разрешены при min < 0 */
  integer?: boolean
  min?: number
  /** Ключ панели, а не ядра: в отданном клиенту документе его не будет */
  panelKey?: boolean
  /** Значение по умолчанию при заведении объекта или элемента списка */
  starter?: () => unknown
}
```

Разбор схемы — чистые функции в `shared/schema/resolve.ts`:

- `schemaAt(root: FieldSchema[], path: PathParts, value: unknown): FieldSchema[] | undefined` —
поля объекта по пути в документе с учётом `when` (значения соседей берутся из `value`).
Заменяет `docPath.descendSingbox`/`sectionAtPath`: путь в документе — единственный адрес,
отдельной карты «путь → секция» больше нет.
- `visibleFields(fields, value)` — поля, чьё условие `when` выполнено или отсутствует.
- `unknownKeys(fields, value)` — ключи документа, которых нет среди полей: они показываются
на чтение и никогда не скрываются (решение 6).
- `deprecatedAt(fields, value)` — устаревшие ключи и значения перечислений в объекте: питает
и подсказку формы, и валидацию. Один источник для обоих: раньше текст замены жил дважды.

Списки строк (`domain_suffix`, `alpn`, `address`) описываются как `kind: 'list'` с элементом
`string`; вида `strings` больше нет — два способа сказать одно и то же разошлись бы. Значение,
которое ядро принимает и строкой, и списком (`domain`, `inbound`, `port`), читается в обоих
видах, а пишется всегда списком — так уже делает форма правила.

### Операции писателя

Форма не отдаёт наружу целое значение. Она эмитит операции по пути — так один рендерер служит
и модельным ядрам, и Mihomo, где путь превращается в сплайс или в правку модели `yaml`.

```ts
// shared/schema/ops.ts
export type DocOp =
  | { op: 'set'; path: PathParts; value: unknown }
  | { op: 'remove'; path: PathParts }
  | { op: 'insert'; path: PathParts; index: number; value: unknown }
  | { op: 'move'; path: PathParts; from: number; to: number }

export interface Lock {
  /** Причина, по которой значение по этому пути правится только в тексте — по-русски */
  reason: string
}

export interface DocWriter {
  apply(ops: DocOp[]): void
  /** null — правится; иначе форма показывает замок с причиной */
  lockAt(path: PathParts): Lock | null
}

/** Применение к JSON-модели: копия, спуск по пути, промежуточные объекты создаются */
export function applyOps<T>(model: T, ops: DocOp[]): T
```

`set` по несуществующему пути создаёт промежуточные объекты — именно так панель «Документ»
заводит отсутствующую секцию. `remove` удаляет ключ или элемент списка. `insert` зажимает
индекс в `[0, length]`. `move` переставляет элемент. У sing-box `DocWriter` реализует
`useSingboxDraft` поверх `applyOps` и существующего `changeDoc`; `lockAt` отвечает замком
ровно в одном случае — список участников группы, которую заполняет панель
(`panel-fills`), сегодня это ветвление живёт внутри формы.

### Рендерер `SchemaForm`

`features/inspector/schema/SchemaForm.tsx`: получает поля, значение, путь, писатель и список
ключей, которые уже нарисовал вызывающий (`skip`). Правила отрисовки:

- Заполненные поля сверху, незаполненные — под `CollapsibleSection` «Ещё поля (N)». Это
поведение `SingboxExtraFields`, которое рендерер заменяет.
- `string` — `TextField`; `number` — `NumberField`, расширенный `integer`/`min` (сегодня он
принимает только `^\d+$`); `enum` — `SelectField` с пунктом «(не задано)», текущее значение
вне списка проходит сквозь как собственный пункт, устаревшее значение получает подсказку из
`deprecated.replacement`; `ref` — `SelectField` по тегам документа с тем же сквозным пропуском.
- `boolean` — **трёхпозиционный** контрол «не задано / да / нет» в стиле `.segmented`
(тот же, что у переключателя «Форма / JSON узла»). Явное `false` обязано быть выразимо:
`set_system_proxy: false` и `auto_route: false` — реальные значения, а `CheckboxField` снимает
ключ. `CheckboxField` остаётся у форм Xray-профиля нетронутым.
- `list` строк — `StringListField`; список чисел — тот же контрол с разбором чисел; список
объектов — `ListEditor`, расширенный кнопками «выше»/«ниже», каждый элемент — вложенный
`SchemaForm` под сворачиваемым заголовком из `item.label` (тег, имя или номер). Кнопка
добавления берёт `starter` элемента.
- `object` — сворачиваемый блок с вложенным `SchemaForm`. Условные поля (`when`) появляются и
исчезают вместе со значением соседа; исчезнувшее поле из документа **не удаляется** — это
чужие данные, редактор их не выбрасывает.
- Ключ вне схемы — `TextInput readOnly` со значением в JSON и подписью «Ключ неизвестен
словарю: правится на вкладке JSON». Ключи панели (`panelKey`) рендерятся, только если их
явно попросил вызывающий (у групп это кнопка «Закрепить список»).
- Замок (`writer.lockAt(path)`) — поле на чтение с причиной, как `LOCK_NOTE` у Mihomo.

Каждая правка — один `DocOp`; пустая строка и «(не задано)» — `remove`.

### Панель «Документ»

Псевдоузел `doc:settings` (решение 5), кнопка дока «Документ». Панель — список разделов, у
каждого ядра свой явный перечень:

```ts
interface DocSection {
  title: string
  path: PathParts
  /** object — форма по схеме; list — редактор списка с формой на элемент */
  kind: 'object' | 'list'
}
```

Раздел, которого в документе нет, показывает одну кнопку «Завести раздел»: она пишет
`starter` схемы по этому пути (или `{}`/`[]`, если стартера нет). Существующие псевдоузлы
`doc:rule-sets` и `doc:dns-servers` становятся разделами этой панели; их кнопки дока уходят.
`GraphCanvas` и общий слой по-прежнему ничего о псевдоузлах не знают — разводку по id делает
инспектор ядра.

### Создание и порядок

- Док получает одну кнопку-меню «+ Добавить» с пунктами по ядру (новый компонент
`shared/ui/MenuButton` на том же портальном списке, что `Select`): восемь отдельных кнопок в
доке не помещаются. «+ Правило» остаётся отдельной кнопкой — это самое частое действие.
- Каждый пункт заводит запись через `insert` со `starter` элемента и уникальным тегом
(`uniqueTag(doc, base)` по образцу Xray) и выбирает новый узел.
- Инспектор показывает «порядок: N из M» и стрелки у **любого** узла, стоящего в списке, а не
только у правила: `outbounds` и `endpoints` (у sing-box первый выход — маршрут по умолчанию, и
бейдж следует за порядком), `inbounds`, элементы списков панели «Документ». Мутации
`moveRule`/`removeAt` обобщаются до `moveAt(doc, listPath, index, dir)` и `removeAt` по пути.
- Удаление есть у всего, что стоит в списке.

### Рецепты

Движок рецептов Xray (`entities/xray/recipes`) обобщается, не меняя Xray:

```ts
// shared/recipes/types.ts
export interface Recipe<TModel, TParams> {
  id: string
  title: string
  summary: string
  defaults: TParams
  validate(params: TParams): string | null
  plan(model: TModel, params: TParams): { model: TModel; changes: string[]; notes: string[] }
}
```

`RecipesDialog` параметризуется реестром и моделью; формы параметров остаются рецепт-специфичными
компонентами. Для Xray-профиля ничего не меняется: его реестр и диалог становятся первым
экземпляром обобщения, тесты профиля — контрольная группа. Применение рецепта — один снимок
истории, как сейчас.

## Sing-box целиком

### Схема ядра

`entities/singbox/schema.ts` заменяет `docSchema.ts` и `docPath.ts`: одно дерево от корня.
Покрытие — sing-box 1.13 с пометками 1.14 (`since`), устаревшее помечено `deprecated`:


| Ветвь                | Что описано                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Корень               | `log`, `dns`, `ntp`, `certificate`, `endpoints`, `inbounds`, `outbounds`, `route`, `experimental`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `log`                | `disabled`, `level`, `output`, `timestamp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `dns`                | `servers[]`, `rules[]`, `final` (ref dns-server), `strategy`, `independent_cache`, `cache_capacity`, `reverse_mapping`, `client_subnet`; legacy `fakeip{}` — deprecated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `dns.servers[]`      | общие `type`, `tag`, `detour` (ref outbound), `domain_resolver`; по типу (`when type`): `local`, `hosts`, `udp`, `tcp`, `tls`, `https` (`path`, `headers`), `quic`, `h3`, `dhcp` (`interface`), `fakeip` (`inet4_range`, `inet6_range`), `predefined`, `resolved`, `tailscale`; legacy-ключи `address`, `address_resolver`, `address_strategy`, `strategy` — deprecated с заменой «типизированный сервер»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `dns.rules[]`        | все матчеры (те же, что у маршрута, плюс `query_type`, `outbound`), `server` (ref dns-server), `action` ∈ `route`, `route-options`, `reject`, `predefined`; опции по действию (`when action`); логическое правило `type: logical`, `mode`, `rules[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `inbounds[]`         | `tag`, `type`; `tun` целиком (`interface_name`, `address`, `mtu`, `auto_route`, `iproute2_*`, `auto_redirect*`, `strict_route`, `route_address(_set)`, `route_exclude_address(_set)`, `endpoint_independent_nat`, `udp_timeout`, `stack`, `include/exclude_interface`, `include/exclude_uid(_range)`, `include/exclude_android_user`, `include/exclude_package`, `platform.http_proxy{}`); listen-поля (`listen`, `listen_port`, `tcp_fast_open`, `tcp_multi_path`, `udp_fragment`, `udp_timeout`, `detour`); `mixed`/`socks`/`http` (`users[]`, `set_system_proxy`); `direct`, `shadowsocks`, `redirect`, `tproxy`; deprecated `sniff`, `sniff_override_destination`, `sniff_timeout`, `domain_strategy`, `inet4_address`, `inet6_address`                                                                                                                                                                                                             |
| `outbounds[]`        | `tag`, `type`; dial-поля (`detour`, `bind_interface`, `inet4/6_bind_address`, `routing_mark`, `reuse_addr`, `netns`, `connect_timeout`, `tcp_fast_open`, `tcp_multi_path`, `udp_fragment`, `domain_resolver{}`, `network_strategy`, `network_type`, `fallback_network_type`, `fallback_delay`; deprecated `domain_strategy`); по типу: `direct`, `socks`, `http`, `shadowsocks`, `vmess`, `trojan`, `vless`, `hysteria`, `hysteria2`, `tuic`, `shadowtls`, `ssh`, `tor`, `anytls`, `selector`, `urltest`; `tls{}` (`enabled`, `disable_sni`, `server_name`, `insecure`, `alpn`, `min/max_version`, `cipher_suites`, `certificate(_path)`, `fragment*`, `record_fragment`, `ech{}`, `utls{}`, `reality{}`); `transport{}` по `type` ∈ `http`, `ws`, `quic`, `grpc`, `httpupgrade`; `multiplex{}` (`enabled`, `protocol`, `max_connections`, `min_streams`, `max_streams`, `padding`, `brutal{}`); deprecated типы `block`, `dns`, `wireguard` с заменами |
| `endpoints[]`        | `wireguard` (`system`, `name`, `mtu`, `address[]`, `private_key`, `listen_port`, `peers[]` с `address`, `port`, `public_key`, `pre_shared_key`, `allowed_ips[]`, `persistent_keepalive_interval`, `reserved[]`; `workers`), `tailscale` (`state_directory`, `auth_key`, `control_url`, `ephemeral`, `hostname`, `accept_routes`, `exit_node`, `exit_node_allow_lan_access`, `advertise_routes[]`, `advertise_exit_node`, `udp_timeout`) плюс dial-поля                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `route`              | `rules[]`, `rule_set[]`, `final` (ref outbound), `auto_detect_interface`, `override_android_vpn`, `default_interface`, `default_mark`, `default_domain_resolver` (ref dns-server или объект), `default_network_strategy`, `default_network_type`, `default_fallback_network_type`, `default_fallback_delay`, `find_process`; deprecated `geoip`, `geosite`, `default_domain_strategy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `route.rules[]`      | все матчеры: `inbound` (ref inbound), `ip_version`, `network`, `auth_user`, `protocol`, `client`, `domain*`, `source_ip_cidr`, `source_ip_is_private`, `ip_cidr`, `ip_is_private`, `source_port(_range)`, `port(_range)`, `process_name`, `process_path(_regex)`, `package_name`, `user(_id)`, `clash_mode`, `network_type`, `network_is_expensive`, `network_is_constrained`, `wifi_ssid`, `wifi_bssid`, `rule_set` (ref rule-set), `rule_set_ip_cidr_match_source`, `rule_set_ip_cidr_accept_empty`, `invert`; `action` ∈ `route`, `route-options`, `reject`, `hijack-dns`, `sniff`, `resolve`; опции по действию (`outbound` ref, `override_address`, `override_port`, `udp_disable_domain_unmapping`, `udp_connect`, `udp_timeout`, `tls_fragment*`, `tls_record_fragment`, `method`, `no_drop`, `sniffer[]`, `timeout`, `server` ref dns-server, `strategy`, `disable_cache`, `rewrite_ttl`, `client_subnet`); логическое правило                  |
| `route.rule_set[]`   | `tag`, `type` ∈ `inline`, `local`, `remote`; `format`, `path`, `url`, `download_detour` (ref outbound), `update_interval`; для `inline` — `rules[]` по схеме headless-правила                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `experimental`       | `cache_file{}` (`enabled`, `path`, `cache_id`, `store_fakeip`, `store_rdrc`, `rdrc_timeout`), `clash_api{}` (`external_controller`, `external_ui`, `external_ui_download_url`, `external_ui_download_detour` ref outbound, `secret`, `default_mode`, `access_control_allow_origin[]`, `access_control_allow_private_network`), `v2ray_api{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ntp`, `certificate` | `enabled`, `server`, `server_port`, `interval` плюс dial-поля; `store`, `certificate[]`, `certificate_path[]`, `certificate_directory_path[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |


Точные списки ключей и значений перечислений — предмет плана: он сверяет каждую ветвь с
`sing-box.sagernet.org/configuration/` на момент написания. Спека фиксирует **охват** и правило:
ветвь считается покрытой, когда в схеме есть каждый ключ страницы документации соответствующего
раздела, включая помеченные устаревшими. Места, где документация неоднозначна (действие
`predefined` у DNS-правил, `up`/`up_mbps` у hysteria, значение `security` у vmess по умолчанию),
план проверяет по странице, а не по памяти.

### Формы

Ручными остаются только главные поля узла; всё остальное даёт `SchemaForm` по схеме ветви:


| Узел         | Главные поля                                                                   | Из схемы                                                                                 |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| вход         | `tag`, `type`, `listen`, `listen_port`                                         | всё по типу, listen-поля                                                                 |
| выход-сервер | `tag`, `type`, `server`, `server_port`                                         | протокол (`when type`), `tls`, `transport`, `multiplex`, dial-поля                       |
| группа       | `tag`, `type`, участники (с замком `panel-fills` и кнопкой «Закрепить список») | `default`, `url`, `interval`, `tolerance`, `idle_timeout`, `interrupt_exist_connections` |
| эндпоинт     | `tag`, `type` ∈ `wireguard`, `tailscale`                                       | всё по типу, включая `peers[]` списком объектов                                          |
| правило      | `action`, цель по действию, четырнадцать нынешних контролов                    | остальные матчеры и опции действия                                                       |
| набор правил | `tag`, `type`, `format`, `url`, `download_detour`                              | `path`, `update_interval`, `rules[]` для `inline`                                        |
| DNS-сервер   | `tag`, `type`, `server`, `detour`                                              | всё по типу; legacy-ключи видны с пометкой устаревшего                                   |
| DNS-правило  | `action`, `server`                                                             | матчеры и опции действия                                                                 |


Форма выхода узнаёт эндпоинт по списку (`outboundSlotOf`), как сделано исправлением
2026-09-09, и берёт для него ветвь `endpoints`. Селект `type` у выхода предлагает только живые
типы; удалённые проходят сквозь с подсказкой замены — этот приём становится общим свойством
`enum` в `SchemaForm`.

### Панель «Документ» sing-box

Разделы: «Общие» (`log`), «DNS» (`dns` как объект, затем списки `dns.servers` и `dns.rules`),
«Маршрут» (`route` как объект: `final` селектом по тегам выходов, остальное по схеме; затем
список `route.rule_set`), «Экспериментальное» (`experimental`), «NTP» (`ntp`), «Сертификаты»
(`certificate`). Стартеры: `dns` — два сервера, как в стартере панели; `route` — `{}`;
`experimental` — `cache_file.enabled: true` (без него удалённые наборы правил не кэшируются).

### Создание с холста

Пункты меню «+ Добавить»: «Вход» (`mixed` на `127.0.0.1:2080`), «Выход» (`direct`), «Сервер»
(`vless` с пустыми `server` и `uuid`, `server_port: 443`), «Группа» (`selector` с пустым
списком, который заполняет панель), «Эндпоинт» (`wireguard` с пустыми `address`, `private_key`,
`peers`). Тег уникален в объединении `outbounds` и `endpoints` (у них общий узел `out:<tag>`).
«+ Правило» остаётся кнопкой. DNS-сервер, DNS-правило и набор правил заводятся из своих
разделов панели «Документ».

### Валидация

- Устаревшие ключи и значения из `deprecatedAt` — предупреждение с текстом замены. Нынешняя
проверка `REMOVED_OUTBOUND_TYPES` растворяется в этом общем механизме: текст живёт в схеме.
- Ссылки `ref` без цели — предупреждение либо ошибка по тем же правилам, что сегодня у тегов
выходов (ошибка, если панели некуда подставлять серверы). Добавляются проверки ссылок на
DNS-серверы (`dns.final`, `dns.rules[].server`, `route.default_domain_resolver`, `resolve.server`)
и на наборы правил из DNS-правил.
- Неизвестные ключи диагностик не порождают: схема сквозная, ядро развивается быстрее словаря.

### Подсказки и переход по пути

`singboxIntellisense/context.ts` берёт поля по `schemaAt(schema, path, doc)`: подсказки внутри
`dns.rules` перестают молчать, значения перечислений показываются с пометкой устаревшего,
hover берёт `doc` из схемы. `singboxNodeIdForPath` для путей панели «Документ» (`dns.*`,
`route.rule_set`, `log`, `experimental`) ведёт на `doc:settings` — клик по диагностике
открывает нужный раздел.

### Граф

Не меняется: входы, правила, группы, выходы, встроенные действия, узел подстановки. DNS в граф
не идёт. Новые записи получают узлы по прежней схеме id; бейдж «по умолчанию» следует за
порядком `outbounds` после перестановки.

### Рецепты sing-box

Реестр `entities/singbox/recipes/`:


| Рецепт                             | Что делает                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Разделить трафик по наборам правил | Выбор наборов из каталога источников (`legiz-ru/sb-rule-sets`, `MetaCubeX/meta-rules-dat` — статический список `entities/singbox/ruleSetCatalog.ts` с тегом, ссылкой, форматом и видом домен/IP) и цели для каждого; заводит `route.rule_set` remote, правила перед финальным, включает `experimental.cache_file` |
| Блокировка рекламы                 | Набор `category-ads-all` (или `oisd`) → правило `action: reject`; вариант с DNS-правилом `predefined`                                                                                                                                                                                                             |
| DNS с fake-ip                      | Типизированные серверы (remote через `detour`, `local`, `fakeip`), `dns.rules` для подстановки, `route.rules` с `sniff` и `hijack-dns` первыми, `experimental.cache_file.store_fakeip`                                                                                                                            |
| Локальный вход                     | `mixed`/`socks` на выбранном порту, при желании `set_system_proxy`                                                                                                                                                                                                                                                |
| Обход локальных сетей              | `ip_is_private` и `source_ip_is_private` → `direct`                                                                                                                                                                                                                                                               |
| WARP-эндпоинт                      | `POST /api/tools/warp-account` → `endpoints[]` wireguard с пирами Cloudflare; при желании — группа-цепочка через него                                                                                                                                                                                             |


Идемпотентность: примитивы «завести, если нет» по тегу и по содержимому правила, как у Xray
(`ensureOutbound`/`ensureRule`). Ссылки каталога — только те, что записаны в статическом
списке; бэкенд их не скачивает, они уходят в документ пользователя.

### Хук и адаптер

`useSingboxDraft` реализует `DocWriter` (`applyOps` над моделью, `lockAt` для `panel-fills`) и
экспортирует его инспектору; `changeDoc` остаётся для мутаций графа и рецептов. `singboxAdapter`
не меняется: разбор, счётчики, поиск и переход по пути — те же, `nodeIdForPath` дополняется
псевдоузлом панели.

## Тестирование

- Общий слой: `shared/schema` — юнит-тесты `schemaAt`/`visibleFields`/`unknownKeys`/
`deprecatedAt`/`applyOps` (создание промежуточных объектов, зажим индекса, перестановка);
`SchemaForm` — компонентные тесты на каждый вид поля, сквозной пропуск чужого значения,
подсказку устаревшего, тристейт с явным `false`, неизвестный ключ на чтение, список объектов
с перестановкой, условные поля и сохранность исчезнувшего поля, замок с причиной.
- Sing-box: тест полноты схемы — каждая ветвь таблицы охвата присутствует, у каждой
`deprecated` есть непустая замена, у каждого `ref` — существующий вид; формы по узлам; панель
«Документ» с заведением раздела; создание всех пяти видов записей с холста и уникальность
тегов; порядок у выходов с бейджем «по умолчанию»; валидация устаревших и ссылок; подсказки в
`dns.rules`; рецепты — план на пустом документе и на стартере панели, идемпотентность.
- Контрольная группа: тесты Xray-профиля и Mihomo не меняются; `CheckboxField` и формы Xray не
трогаются.
- Приёмка: мутационная проверка каждого значимого изменения, как принято в репозитории.
- E2E: сценарий «с нуля» — шаблон с содержимым `{}` из мока панели, кнопками заводятся вход,
группа, сервер, DNS-сервер, DNS-правило, набор правил и правило, в панели «Документ» задаётся
`route.final`, применяется рецепт, шаблон сохраняется; вкладка JSON не открывается ни разу,
тело запроса на сохранение содержит собранный документ.

## Вне охвата

- Mihomo и Xray-шаблон — части 2 и 3 своими спеками: писатель Mihomo на модели `yaml`,
исправление предпосылки про маркер, клиентский режим Xray, неявный выход `proxy`, режим
шаблона в проверке целостности, перевод `NODES` на общую схему.
- Трассировка DNS-раздела sing-box.
- `CLASH` и `STASH`.
- Загрузка содержимого наборов правил ради трассировки sing-box.

## Открытые допущения

- Список типов и ключей сверяется с документацией ядра при написании плана; версии в
`since`/`deprecated` берутся со страниц документации, а не из памяти.
- Меню «+ Добавить» — новый компонент UI-кита; если портальный список `Select` не переиспользуется
без переделки, допустима отдельная реализация на тех же токенах.

