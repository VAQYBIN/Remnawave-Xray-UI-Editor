# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Визуальный редактор Xray-конфигов панели Remnawave 2.8+/3.x: топология трафика как граф (React Flow), формы вместо ручного JSON, сохранение в панель по API. Редактор работает с двумя сущностями панели: конфиг-профилями нод и шаблонами подписок (тип `XRAY_JSON`) — общая оболочка `Workbench`/`useConfigDraft`, но своя логика сохранения и оптимистической блокировки у каждой (см. «Особенности домена»). Язык UI, сообщений об ошибках и документации — русский; коммиты — английский conventional style (`fix(frontend): ...`). Ветки: `main` и рабочая `dev`.

## Команды

npm workspaces: `backend` + `frontend`. Из корня:

```bash
npm run dev            # dev-сервер бэкенда (tsx watch, нужен .env — см. .env.example)
npm run dev:frontend   # Vite на :5173, проксирует /api на :3000
npm test               # тесты обоих workspace
npm run build          # tsup (backend) + tsc --noEmit && vite build (frontend)

npm test -w backend                       # vitest бэкенда
npm test -w frontend                      # vitest фронтенда
npm run typecheck -w backend              # tsc --noEmit (аналогично -w frontend)
npx vitest run test/auth.test.ts          # один тест-файл (из каталога workspace)
npm run e2e -w frontend                   # Playwright e2e (перед первым запуском:
                                          #   cd frontend && npx playwright install chromium)
```

Три тестовых контура фронтенда не пересекаются:
- **vitest** берёт только `test/**/*.test.{ts,tsx}` (jsdom);
- **Playwright** (`e2e/*.spec.ts`) поднимает собственный dev-сервер на `127.0.0.1:4173` и мокает API через `e2e/mocks.ts` — бэкенд не нужен;
- `tsc --noEmit` не проверяет каталог `e2e` (не входит в `include` tsconfig).

Четвёртый контур — **скриншоты** для README: `npm run screenshots -w frontend`
(`screenshots/*.spec.ts`, свой `playwright.screenshots.config.ts` и порт 4175). Ничего не
проверяет, пишет PNG в `docs/screenshots/` на витринном конфиге `screenshots/showcase.ts`;
в `npm test` и `npm run e2e` не входит. Анимации там **не глушатся**: `RemeasureOnEnter`
пересчитывает якоря рёбер по `animationend`, и без него рёбра уедут на 8px ниже гнёзд.

## Архитектура

### Backend (`backend/src`) — Fastify, ESM, Node 24

Тонкий защищённый прокси к API панели Remnawave. Токен панели живёт только на сервере; браузер ходит на `/api/*` с сессионной cookie.

- `server.ts` — `buildServer(config, deps)`: сборка приложения. Через `deps` инжектятся `RemnawavePort` и `BackupService` — так тесты подменяют панель стабом (`test/stub-remnawave.ts`).
- `remnawave/client.ts` — `RemnawaveClient` (реализация `RemnawavePort`), все ошибки панели заворачиваются в `RemnawaveError` и превращаются глобальным error handler'ом в JSON-ответы с исходным статусом.
- `routes/profiles.ts` — ключевой флоу сохранения: `PATCH /api/profiles/:uuid` требует `expectedUpdatedAt`; при расхождении — `409` с актуальным профилем (оптимистическая блокировка). Перед каждым обновлением текущая версия пишется в бэкап (`backups/service.ts`, каталог `DATA_DIR/backups/<uuid>/`).
- `routes/templates.ts` — пять роутов (список, чтение, создание, удаление, `PATCH`) для шаблонов
  подписки. У шаблона нет `updatedAt`, поэтому `PATCH` сравнивает не версию, а **хэш содержимого**
  (`expectedHash` в теле): расхождение — тот же `409`, что у профилей. Хэш считает и сравнивает
  только бэкенд (`templates/hash.ts`, `canonicalize`): рекурсивная сортировка ключей объектов
  через `Object.create(null)` (иначе `__proto__` из чужого JSON молча выпал бы из хэша), а порядок
  элементов массивов сохраняется — в списке правил маршрутизации он значим. Создание у панели
  двухшаговое (`POST` заводит пустой шаблон, содержимое льётся отдельным `PATCH`); ручка склеивает
  оба вызова и подставляет каркас `templates/starter.ts` (локальные inbound'ы, одна группа
  подстановки, минимум outbound'ов — пустой шаблон панель тоже создаёт, но подписка из него не
  отдаст клиенту ни одного сервера). Редактор умеет только `templateType: XRAY_JSON` — на
  остальных (`MIHOMO`, `CLASH`, `STASH`, `SINGBOX`, `XRAY_BASE64`, содержимое в
  `encodedTemplateYaml`) `PATCH` отвечает `400`. Бэкапы шаблонов лежат в отдельном пространстве
  `DATA_DIR/backups/templates/<uuid>/` (роуты чтения — в `routes/backups.ts`), а не рядом с
  бэкапами профилей: uuid профиля и шаблона могут совпасть, общий путь вернул бы чужие версии.
  `routes/nameSchema.ts` — общая для имени профиля и шаблона регулярка (`/^[A-Za-z0-9_\s-]+$/`,
  латиница/цифры/пробел/`-`/`_`), зеркалит проверку панели: расширять нельзя, панель всё равно
  откажет, только позже и по-английски. `backend/test/contract.test-types.ts` — тест на уровне
  типов (падает на `tsc --noEmit`, ничего не выполняет) против `@remnawave/backend-contract`
  (только devDependency, только `import type`) — ловит расхождение наших интерфейсов с контрактом
  панели, не блокируя проход неизвестных полей в рантайме.
- `auth/*` — вход по паролю, подписанная httpOnly-cookie, guard закрывает все `/api/*` кроме
  auth/health. В `.env` `APP_PASSWORD` может быть и открытым текстом, и bcrypt-хэшем, но
  `loadConfig` хэширует открытый на старте — в `AppConfig.appPassword` всегда лежит хэш, и
  `verifyPassword` знает единственный формат. Rate-limit двухуровневый: 5 попыток в минуту на
  логине и глобальные 600 запросов в минуту на остальное.
- `xray/*` — проверка конфига ядром: `panelClients.ts` берёт по одному настоящему клиенту из
  `computed-config` профиля, `dummyClient.ts` подставляет фиктивного там, где пары не нашлось
  (профили панели хранятся с `clients: []`), `service.ts` запускает `xray run -test` с
  `XRAY_LOCATION_ASSET` на geo-базы из `DATA_DIR`, `parseOutput.ts` переводит цепочки ошибок ядра
  в русские подсказки. Нет бинаря (`XRAY_BIN`) — `available: false`, а не ошибка.
- `tools/realityProbe.ts` — TLS-проба Reality-цели (TLS 1.3, ALPN h2, X25519, покрытие
  `serverNames` сертификатом, проверка цепочки, подозрение на CDN). Исходящие соединения обоих
  инструментов проходят через `net/guard.ts` (`assertPublicHost`/`fetchExternal`) — приватные,
  loopback, link-local и CGNAT-адреса отклоняются, у geo есть опт-ин `GEO_ALLOW_PRIVATE_URLS`.
- `tools/warp.ts` — регистрация бесплатного аккаунта Cloudflare WARP (то же, что делает `wgcf`):
  POST `/reg` + PATCH `warp_enabled`, ответ приводится к настройкам wireguard-outbound. Оба
  запроса идут через `fetchExternal` с параметром `init` (метод/заголовки/тело) — обходить guard
  нельзя. API неофициальный, поэтому ручка отвечает 502 с русским текстом, а не 500: в форме
  рецепта остаётся ручной ввод ключей. Ключ здесь в обычном base64 с padding, у Reality —
  base64url без padding; общая генерация сырых байт — `generateX25519Raw` в `tools/reality.ts`.
- `geo/*` — разбор `geosite.dat`/`geoip.dat` (свой декодер protobuf), настраиваемые источники в
  `DATA_DIR/settings.json`, ответы на вопрос «входит ли домен/IP в категорию». Коды категорий в
  `.dat` лежат в ВЕРХНЕМ регистре — поиск по исходной строке из конфига всегда промахнётся.
  Просмотр баз: `categories(kind)` считает размеры категорий через `countEntries` (проход по
  байтам без разбора — полный разбор всей базы стоил бы сотни мегабайт), `categoryPage` режет
  содержимое по `offset`/`limit` и фильтрует по `q`, пересчитывая `total`. Кэш разобранных
  категорий ограничен восемью на вид (`MAX_PARSED`): вьюер листает категории подряд, а `US` в
  geoip — 336 502 подсети. UI — `features/diagnostics/GeoBrowser.tsx` во вкладке диалога
  «Geo-базы»; кнопка «В правило» идёт через `appendGeoKey` в `entities/graph/mutations.ts`.
- `config.ts` — env валидируется zod'ом при старте; отдельная проверка ловит bcrypt-хэш, испорченный интерполяцией `$` в Docker Compose (см. README).
- Статика фронтенда отдаётся из `STATIC_DIR` с SPA-fallback на `index.html`; неизвестные `/api/*` — JSON 404.

### Frontend (`frontend/src`) — React 19, Vite, слоистая структура

`shared` → `entities` → `features` (вариация feature-sliced):

- `entities/xray` — типы и чистая логика Xray-конфига: схемы inbound/outbound/stream/routing, генерация (`generate.ts`). Всё реэкспортируется через `entities/xray/index.ts`.
  Транспорт узла читается **только** через `streamNetwork` (`compat.ts`): Xray v26.7.28
  переименовал `streamSettings.network` в `method` и при обоих ключах слушает `method`, поэтому
  форма при смене транспорта пишет `network` и удаляет `method`.
- `entities/graph` — `buildGraph.ts` строит из конфига колоночный граф (squad → inbound → rule → outbound); `mutations.ts` — обратные правки конфига из графа. Дубликаты тегов пропускаются (иначе ломаются id узлов React Flow).
- **Балансеры.** `routing.balancers` — своя колонка графа между правилами и outbound'ами
  (`COLUMN_X.balancer`, outbound уехал на 1290), узел `bal:<tag>`. `selector` матчит теги
  outbound'ов **по префиксу**; единственная реализация — `entities/xray/balancers.ts`
  (`matchPrefixes`/`balancerCandidates`), её зовут граф, форма, валидации, трассировка и рецепт.
  Разрыв ребра «балансер → выход», заданного префиксом, `disconnectEdge` не выполняет (возвращает
  тот же конфиг) — `TopologyView` спрашивает подтверждение и вызывает `expandSelector`. У ребра
  запасного выхода свой префикс id (`e:bal:<tag>->fb:<out>`): тег может быть и кандидатом, и
  fallback'ом, а одинаковые id ломают React Flow. `observatory`/`burstObservatory` — глобальные
  секции (по одной на конфиг), живут в узле `obs` под колонкой балансеров; `leastPing` требует
  первую, `leastLoad` — вторую, заводит их кнопка в форме балансера через
  `ensureObservatorySection`. При заданных сразу `outboundTag` и `balancerTag` ядро берёт
  `outboundTag`, поэтому мутации графа снимают парный тег.
- **Шаблоны подписки.** `entities/xray/inject.ts` разбирает директиву `remnawave.injectHosts`:
  панель на её основе строит outbound'ы, которых в документе физически нет, и вставляет их **в
  начало массива** `outbounds` — правила и балансеры ссылаются на них по тегу. Тег
  предсказуем (`predictedTags`/`tagScheme`) только при `tagPrefix` (`proxy`, `proxy-2`, …); при
  `useHostRemarkAsTag`/`useHostTagAsTag` тег знает только панель — `predictedTags` тогда
  возвращает пусто, а `hasPanelNamedTags` подавляет по всему документу проверки «неизвестный
  outbound-тег» и «у балансера нет кандидатов» (иначе корректный шаблон дал бы ложную тревогу).
  Отсюда же дефолтный маршрут трассировки: если ни одно правило не совпало, трафик уходит не в
  `outbounds[0]`, а в первый подставленный сервер первой группы — `entities/xray/trace.ts` называет
  именно её, потому что порядок вставки МЕЖДУ группами панель не документирует (осознанное
  предположение, не факт). Граф рисует группу узлом `inj:<index>` в колонке outbound'ов
  (`COLUMN_X.outbound`) перед статическими выходами. `entities/graph/edgeIds.ts` — единственная
  схема id рёбер (`edgeId`, `fallbackEdgeId`, `outboundTargets`): ребро к инжектируемому тегу ведёт
  в `inj:<index>`, а не в `out:<tag>` — статического узла для такого тега нет. Разрыв ребра
  «балансер → выход», если тег ловится префиксом группы подстановки, неразрешим тем же способом,
  что и обычный префикс-разрыв: `blockingInjectPrefix`/`blockingGroupPrefix`
  (`entities/xray/balancers.ts`, `entities/graph/mutations.ts`) объясняют это в подтверждении, а
  `expandSelector` такие префиксы **не разворачивает** — сохранит группу и вернётся к разрыву,
  развернёт и сломает предсказание тегов; при тегах от панели разворот запрещён целиком. Гнездо
  узла группы при схеме, отличной от `tagPrefix`, закрыто (`isConnectable`): предсказанного тега
  нет, мутация вернула бы тот же конфиг и кабель тянулся бы вхолостую. Завести группу с холста
  можно кнопкой «+ Подстановка» — она появляется только у `TemplateEditorPage` (проп
  `allowInject` через `Workbench`), в редакторе профиля секции `remnawave` нет. UI — `features/templates/*` (`TemplatesPage`,
  `TemplateEditorPage`, `CreateTemplateDialog`) и `features/inspector/InjectGroupForm.tsx` (способ
  именования — ровно один из трёх ключей, форма делает состояние «два сразу» невыразимым, как и
  сама `withTagScheme`). Список шаблонов показывает все типы панели, но открыть на редактирование
  можно только `XRAY_JSON` — остальные (`MIHOMO`, `CLASH`, `STASH`, `SINGBOX`, `XRAY_BASE64`)
  ведут в панель. Переключатель разделов — `features/nav/SectionSwitch.tsx`.
- `features/editor` — общая оболочка обоих редакторов: `useConfigDraft.ts` (документ — черновик,
  история, валидация, выбор узла, вкладки, поиск, трассировка; профильного и шаблонного в хуке нет
  ничего) + `Workbench.tsx` (топбар, канвас с инспектором, статус-бар, общие диалоги). Страница
  (`EditorPage.tsx` для профиля, `features/templates/TemplateEditorPage.tsx` для шаблона)
  добавляет только своё: заголовок, кнопки топбара, сохранение. У шаблона нет `updatedAt` и
  проверки ядром/рецептов в топбаре (они про конфиг ноды, а не про клиентскую подписку), контекст
  графа пуст (`NO_CONTEXT` — сквадов у шаблона нет), а сохранение шлёт `expectedHash` вместо
  `expectedUpdatedAt`. `draftStore.ts` — zustand-persist черновики в localStorage по ключу
  документа (uuid профиля или шаблона), хранят `baseVersion` для проверки конфликта при сохранении
  — `updatedAt` профиля либо хэш содержимого шаблона (переименовано из `baseUpdatedAt`; есть
  `migrate`-миграция persist-схемы: старые записи без `baseVersion` не роняют всё хранилище, но и
  не притворяются валидной базой — `??` тут дал бы неверный fallback, поэтому в `useConfigDraft`
  сравнение через `||`); `VersionsDialog`, `SaveDialog`, `IssueList`.
- Все записи черновика в обоих редакторах идут через одну функцию `writeDraft(text, {history})`
  (живёт в `useConfigDraft`, зовётся из `Workbench` — из `JsonView` и из восстановления
  версии; страницы её не трогают, они только собирают черновик хуком);
  `historyStore.ts` — стеки `past`/`future` в памяти (без persist: 50 снимков конфига вытеснили бы
  черновики из localStorage). Набор текста в JSON в историю не пишется — это забота CodeMirror,
  вместо этого при уходе с вкладки записывается один снимок «как было до входа». После undo/redo,
  импорта и восстановления бэкапа обязателен `setSelectedNode(null)`.
- `shared/lib/useHotkeys.ts` — хоткеи с guard'ом `isEditableTarget` (проверяет и атрибут
  `contenteditable` по цепочке предков — так покрывается `.cm-content`, а в jsdom свойства
  `isContentEditable` вообще нет); `Escape` не отменяет действие браузера и молчит при открытом
  `<dialog>`. Компонент, потребивший клавишу, обязан гасить всплытие — так `Select` не даёт
  глобальному `Escape` закрыть инспектор вместе со своим списком.
- `DiffView.tsx` — общий `MergeView` для `SaveDialog` и `VersionsDialog` (бывший `BackupsDialog`:
  вкладки «Бэкапы панели» / «Файл», сравнение бэкапа с черновиком в том же диалоге, без вложенного
  `<dialog>`). Разбор и именование файлов — `configFile.ts` (разворачивает `{profile:{config}}`).
- `features/topology` + `features/inspector` — граф и формы редактирования выбранного узла (InboundForm/OutboundForm/StreamForm; генератор ключей Reality дергает `/api/tools`).
- Диагностики несут путь массивом (`ValidationIssue.parts`), а строковый `path` — производный
  (`formatPath`). На `parts` завязаны три резолвера: `features/editor/jsonLocate.ts` (путь →
  диапазон в документе, спуск по дереву CodeMirror — обратная задача к `intellisense/context.ts`;
  используется `ensureSyntaxTree`, иначе хвост большого конфига не разобран),
  `entities/graph/locate.ts` (путь → id узла и счётчики проблем), `entities/graph/search.ts`
  (поиск узлов). Клик по проблеме зависит от вкладки: на топологии ведёт к узлу, в JSON —
  прокручивает к месту; вкладку не переключаем, потому что у `log`/`policy` узла нет.
- `features/diagnostics` — трассировщик (`TraceBar` в доке + `TracePanel` оверлеем), `GeoDataDialog`
  и `CheckReportDialog` (проверка ядром и Reality-целями). Логика трассировки живёт в
  `entities/xray/trace.ts`, бэкенд отвечает только на вопрос «входит ли домен/IP в geo-категорию».
  Цель трассировки в state `useConfigDraft` без персиста: это инструмент, а не документ; ввод
  проходит через `useDebounced` (600 мс), иначе каждый символ дергал бы бэкенд.
- `entities/xray/recipes` — библиотека рецептов чистыми функциями `plan(config, params) →
  { config, changes, notes }`: вход не мутируется, идемпотентность держится на трёх примитивах
  (`ensureOutbound`/`ensureRule`/`ensureSniffing`) из `apply.ts`. Правила вставляются в начало
  `routing.rules` (в Xray выигрывает первое совпавшее), маршрутные — сразу за ведущей серией
  блокирующих. Реестр в `recipes/index.ts`: `planFor`/`validateFor` разводят рецепты switch'ем по
  `RecipeId`, параметры всех рецептов лежат одной картой `AllParams` — так `RecipesDialog` не
  теряет введённое при переключении списка. UI — `features/recipes` (диалог + формы параметров),
  вход через кнопку «+ Рецепт» в доке топологии, применение идёт через `changeConfig`, то есть
  одним снимком истории. Ключи WARP: ручной ввод либо `POST /api/tools/warp-account`.
- `shared/api` — fetch-клиент; `AuthError` перехватывается в `App.tsx` на уровне QueryCache/MutationCache и редиректит на `/login`.
- `shared/ui` — свой мини-UI-kit (Button, Dialog, Select…), сторонних компонентных библиотек нет.

### Дизайн-система

`shared/ui/tokens.css` — единственный стилевой файл, метафора «патчбей»: ingress индиго
(`--flux`), egress янтарь (`--ember`), правило без своего hue (сталь). Прежние имена
(`--bg`, `--in`, `--out`…) сохранены алиасами. Шрифты: Golos Text + JetBrains Mono.

- **Select — кастомный listbox, не нативный `<select>`.** API: `value` + `options: SelectOption[]`
  + `onChange(value)`. Список рендерится порталом; если триггер внутри модального `<dialog>`,
  порталом служит сам диалог (top layer не пробивается z-index'ом). В тестах вместо
  `userEvent.selectOptions` — `selectOption()`/`optionLabels()`/`selectedValue()` из
  `test/helpers.ts`, в e2e — `pickOption()` из `e2e/helpers.ts`.
- **`Field` с `controlId`** связывает лейбл с контролом через `htmlFor` вместо обёртки. Нужно
  всему, чей текст значения лежит в содержимом (Select): внутри `<label>` он приклеился бы
  к accessible-имени.
- **Раскладка редактора** — `.workbench`: топбар / сцена / статус-бар. Инспектор
  (`.wb-inspector`) выезжает оверлеем поверх канваса, поэтому вьюпорт графа сдвигается ровно
  на его ширину (`inspectorWidth()` в TopologyView ↔ `--inspector-w` в tokens.css) — иначе
  правая колонка узлов уходит под панель и становится некликабельной.
- **Коммутация** описана в `isValidConnection`/`applyConnection` (TopologyView): inbound →
  правило либо outbound; правило — в outbound, балансер либо группу подстановки (`inj:`);
  балансер — в outbound либо группу подстановки. Из группы кабель не выходит: её выходы создаёт
  панель. Гнёзда сквадов закрыты — привязку задаёт панель.

### Особенности домена

- Trojan-inbound'ы не имеют редактора клиентов — панель сама инжектит пользователей в конфиг.
- Для VLESS `flow` задаётся на уровне settings; при смене протокола settings очищаются.
- Squad-узлы графа приходят не из конфига, а из контекста панели (`GraphContext`), и фильтруются по реально существующим тегам inbound'ов черновика.
- У шаблонов подписки нет `createdAt`/`updatedAt` — база черновика и оптимистической блокировки
  это хэш содержимого (`templates/hash.ts`), и считает его только бэкенд; фронтенд просто носит
  строку туда-обратно (`baseVersion`/`expectedHash`), не пересчитывая.
- Панель вставляет инжектируемые группой подстановки outbound'ы **в начало массива** `outbounds` —
  отсюда дефолтный маршрут трассировки в шаблоне (см. `entities/xray/trace.ts`), а не
  `outbounds[0]` документа. При нескольких группах трассировка называет победителем **первую**:
  порядок вставки между группами панель не документирует, это осознанное предположение, а не факт
  из API.
- При `useHostRemarkAsTag`/`useHostTagAsTag` теги инжектируемых outbound'ов знает только панель:
  `predictedTags` возвращает пусто, а проверки «неизвестный outbound-тег» и «у балансера нет
  кандидатов» подавляются по всему документу (`hasPanelNamedTags`) — иначе корректный шаблон дал
  бы ложную тревогу на каждой такой ссылке.
- `expandSelector` не разворачивает префиксы селектора балансера, которые ловят инжектируемые
  теги (иначе развернуть — значит сломать предсказание группы), а при **любой** группе с тегами от
  панели отказывается разворачивать селектор целиком (`expandBlockedByPanelTags`): какие теги
  подставит панель, редактор не знает по определению, поэтому ловить их может любой префикс, и
  замена его точными статическими тегами молча выбросила бы выходы, которых в документе нет.
  `blockingInjectPrefix` (разрыв «балансер → статический выход», пойманный тем же префиксом, что
  и группа) и `blockingGroupPrefix` (разрыв «балансер → группа» префиксом, который заодно ловит
  чужого кандидата) объясняют, когда такой разрыв неразрешим — на них и на
  `expandBlockedByPanelTags` строится диалог подтверждения в `TopologyView`.

## Документация

- `docs/superpowers/specs/` — дизайн-документ проекта, `docs/superpowers/plans/` — планы реализации (все 4 выполнены). Шаблоны подписки — отдельная спека
  `2026-09-03-subscription-templates-design.md` и два плана: `2026-09-03-subscription-templates-plan1-core.md`
  (бэкенд: роуты, хэш, бэкапы, `nameSchema`) и `2026-09-04-subscription-templates-plan2-ui.md`
  (фронтенд: `inject.ts`, узел `inj:<index>`, общая оболочка `Workbench`/`useConfigDraft`,
  `features/templates`).
- README: нюансы деплоя (Docker, uid 1000, права на `./data`), безопасность, bcrypt-гейтча с `$` в `.env`.
