# Миграция на Remnawave v3.x и Xray-core v26.7.28 — дизайн

Редактор догоняет мажорную версию панели: чинит единственную сломавшуюся ручку, забирает у
панели вычисленный конфиг для честной проверки ядром и учит схему, формы и диагностики тем
запретам, которые ядро и панель ввели за три релиза.

## Задача

Вышла Remnawave v3.0.0 (актуальна 3.2.1) — мажор с длинным списком breaking changes. Первый
вопрос: сколько из них про нас.

Ответ, полученный машинным сравнением `docs/Remnawave API/api-1.json` (2.8.1) с OpenAPI 3.2.1
по восьми методам `RemnawavePort` — **почти ничего**. Весь редизайн v3 — переход пользователей
с UUID на числовой `id`, `ip-control` → `connections`, настройки подписки в заголовки,
`JWT_AUTH_SECRET` → `APP_SECRET` — лежит в разделах, к которым редактор не обращается. Схемы
`config-profiles`, `internal-squads` и `nodes` совпадают байт в байт, ни одна используемая
ручка не удалена и не переименована. Диф даёт три строки:

| Изменение | Что значит для нас |
|---|---|
| `DELETE /api/config-profiles/{uuid}`: `200 {response:{isDeleted}}` → **`204 No Content`** | `client.ts:137` типизирует тело, которого больше нет |
| `GET /api/nodes`: у ноды появилось `id: number` | ничего: фронтенд `/api/nodes` не вызывает, `getNodes` отдаёт `unknown[]` |
| `POST /api/config-profiles` → `201` | не изменение: в 2.8.1 тоже был `201` |

Настоящая работа обнаружилась не в REST, а на этаже ниже. Remnawave Node v3.0.0 приносит
**Xray-core v26.7.28**, тогда как `Dockerfile` приколочен к **v26.6.27**, а README обещает
пользователю «та же версия, что использует Remnawave». Между этими двумя релизами ядро:

1. **Сменило умолчание REALITY `minClientVer` на `26.3.27`** — Mihomo, Sing-Box и старые Xray
   перестают подключаться молча, без единой строчки в логе клиента. Лечится
   `"minClientVer": "0.0.0"`, но полей `minClientVer`/`maxClientVer` нет ни в
   `RealitySettingsSchema`, ни в `docSchema`, ни в `StreamForm` — подсказать редактору нечем.
2. **Переименовало `streamSettings.network` в `method`** (PR #6426). Старое имя оставлено
   алиасом, но в `StreamConfig.Build()` действует правило `if c.Method != nil { c.Network =
   c.Method }` — **`method` перебивает `network`**.
3. **Запретило VLESS и Trojan без шифрования на публичный адрес** (PR #6303,
   `validateOutboundTransportSecurity` в `infra/conf/xray.go`) и выпилило шифры `none`/`plain`
   у Shadowsocks, `none`/`zero` у VMess.
4. Добавило корневой `env`, finalmask `XMC`, `cipherSuites` для unsafe-fingerprint; потребовало
   `serverName` при `pinnedPeerCertSha256`.

Плюс сама панель v3 валидирует конфиг строже: отклоняет пустые `outbounds` и проверяет длину
ключа Shadowsocks 2022 — то есть сохранение падает уже на её стороне, а мы показываем только
верхнеуровневый `message`, теряя `errors[]` из `RemnawaveValidationErrorDto`.

## Совместимость

Поддерживаем **и 2.8.x, и 3.x**. Разница ровно в одном ответе (`DELETE`), терпимость к обоим
вариантам стоит дешевле версионной ветки; `computed-config` существует в обеих версиях. Никакой
проверки версии панели на старте не вводим — её нечем осмысленно использовать.

## Клиент панели

`backend/src/remnawave/client.ts`, `types.ts`.

**`deleteProfile` перестаёт типизировать тело.** Сейчас метод объявляет
`request<{ response: { isDeleted: boolean } }>` и результат выбрасывает. С `204` тело пустое,
`request` вернёт `undefined` — падения нет, но тип лжёт. Меняем на `request<void>`; терпимость
к обоим ответам получается сама собой, потому что тело не читается ни в одном из них.

**Новый метод `getComputedConfig(uuid: string): Promise<unknown>`** —
`GET /api/config-profiles/{uuid}/computed-config`, отдаёт `response.config`. Добавляется в
`RemnawavePort`, `RemnawaveClient` и `test/stub-remnawave.ts`.

**`RemnawaveError` начинает разбирать `errors[]`.** У панели два формата ошибки `400`:

```
RemnawaveBadRequestErrorDto  { timestamp, path, message, errorCode }
RemnawaveValidationErrorDto  { message, statusCode, errors: [{ validation, code, message, path }] }
```

Сейчас `client.ts:93` берёт только `message`, и для валидационной ошибки пользователь видит
общую фразу без единого указания на поле. В v3 это стало заметно: панель валидирует конфиг, и
именно её вердикт нужен целиком. Добавляется чистая функция `describePanelError(json): string`
рядом с `describeCause`: если в теле есть непустой `errors[]` — собирает
`«<path.join('.')> — <message>»` через `; `, иначе возвращает `message`. Результат идёт в
`RemnawaveError.message`, сырое тело остаётся в `details`, как сейчас.

## Проверка ядром на настоящих клиентах панели

`backend/src/xray/*`, `backend/src/routes/tools.ts`, `frontend/src/shared/api/hooks.ts`,
`features/diagnostics/CheckReportDialog.tsx`.

Профили Remnawave хранятся с `clients: []` — пользователей инжектит панель при раздаче конфига
на ноды. `dummyClient.ts` подставляет фиктивного, чтобы `xray run -test` не ругался на то, что
в проде валидно. Слабое место известно и честно описано в README: **редактор не знает, совпадает
ли его фикция с тем, что реально подставляет панель**. `computed-config` отвечает ровно на этот
вопрос — это тот же профиль, но уже с пользователями.

Прямо проверять `computed-config` нельзя: он отражает **сохранённую** версию, а проверяем мы
черновик. Поэтому берём из него не конфиг, а клиентов.

**Контракт.** `POST /api/tools/xray-test` принимает необязательный `profileUuid`. Хук
`useXrayTest` меняет сигнатуру на `{ config, profileUuid }` и получает uuid из `EditorPage`.

**Алгоритм** — новый `backend/src/xray/panelClients.ts`, чистая функция:

```ts
withPanelClients(draft: unknown, computed: unknown): { config: unknown; injected: Injected[] }
```

1. Из `computed.inbounds` строится карта `tag → settings.clients[0]`. Берём **ровно одного**
   клиента на inbound: профиль боевой панели содержит тысячи пользователей, и целиком он
   раздул бы временный файл на пустом месте.
2. Обходим `draft.inbounds` теми же правилами отбора, что и `withDummyClients` (пропускаем
   inbound'ы с непустым `clients` и одиночный shadowsocks с паролем в `settings`).
3. Нашлась пара по тегу — подставляем клиента панели, `source: 'panel'`. Не нашлась — отдаём
   inbound в `withDummyClients`, `source: 'dummy'`.

`XrayService.test(config, computed?)` вызывает `withPanelClients`, когда `computed` передан, и
`withDummyClients` иначе. Роут `tools.ts` тянет `computed-config` только при наличии
`profileUuid` и **глушит любую ошибку панели**: проверка ядром обязана работать при недоступной
панели ровно как сегодня.

**Отчёт.** `XrayTestResult.injected` меняет тип со `string[]` на
`{ tag: string; source: 'panel' | 'dummy' }[]` (и там же в `frontend/src/shared/api/types.ts`).
`CheckReportDialog` разделяет два списка: «клиенты взяты из панели: …» и «подставлены
фиктивные: …» — второй сохраняет нынешнюю оговорку про инжект панелью.

## Ядро и версии

`Dockerfile` — три ARG двигаются вместе, суммы взяты из `.dgst` релиза v26.7.28:

```
XRAY_VERSION=v26.7.28
XRAY_SHA256_AMD64=8195d909f1109b8f3d99eefe401a3c451d7bf4af71f24d3815420f77e5dd2a40
XRAY_SHA256_ARM64=f5698bb218ada3b4022db26fafc39601c5f53b46b19eb76c9616325985807501
```

Документация: бейдж `Remnawave-2.8.0` в README → `3.2.1`, раздел про версию ядра (`README.md:276`),
формулировка `CLAUDE.md` «панели Remnawave v2.8.0» → «панели Remnawave 2.8+/3.x». Локальная копия
спеки `docs/Remnawave API/api-1.json` заменяется на OpenAPI 3.2.1 — каталог в `.gitignore:16`,
так что в репозиторий это не попадает и коммита не требует.

## `method` как синоним `network`

**Чтение.** В `compat.ts` появляется единственная точка чтения транспорта:

```ts
export function streamNetwork(stream: StreamSubset | undefined): string | undefined
// stream?.method ?? stream?.network
```

`normalizeNetwork(string)` остаётся как есть — она про `raw`/`tcp`, другая задача. Через
`streamNetwork` переводятся все нынешние чтения `streamSettings.network`:
`entities/graph/buildGraph.ts:70`, `entities/graph/search.ts:51`, пять мест `entities/xray/config.ts`
(строки 234, 236, 242, 250, 267) и `features/inspector/StreamForm.tsx:121`. `stream.ts` получает
`method: z.string().optional()`.

Не трогаем два одноимённых, но других ключа: `routing.rules[].network` (условие правила) и
`inbounds[].settings.network` (dokodemo-door).

**Запись.** Формы, генерация и рецепты продолжают писать `network` — конфиги остаются
переносимыми на старые ядра и в клиенты, которые про `method` не знают. Но при смене транспорта
`StreamForm` **удаляет `method`**, если тот был в узле: иначе ядро продолжит слушать его, и
правка окажется беззвучной. Это единственная развязка между «пишем `network`» и приоритетом
`method` в `StreamConfig.Build()`.

`docSchema` получает `method` с пометкой «новое имя `network` (Xray ≥26.7.28); при обоих ключах
ядро берёт `method`».

## Новые диагностики

`entities/xray/config.ts`, `analyzeIntegrity`.

**1. Пустые outbounds — `error`.** `outbounds` отсутствует или пуст → «Панель Remnawave 3.x
отклоняет профиль без outbounds». Путь `['outbounds']`. Это единственная проверка здесь,
которая про панель, а не про ядро.

**2. Reality без явного `minClientVer` — `warning`.** Для каждого inbound'а с
`streamSettings.security === 'reality'`, у которого в `realitySettings` нет `minClientVer`:
«Ядро 26.7.11+ по умолчанию требует клиента 26.3.27 и новее — Mihomo, Sing-Box и старые Xray
не подключатся. Поставьте `minClientVer: "0.0.0"`, если они нужны». Путь
`['inbounds', i, 'streamSettings', 'realitySettings']`. Уровень намеренно `warning`: конфиг
валиден, вопрос в том, кого пускаем.

**3. VLESS/Trojan без шифрования на публичный адрес — `error`.** Ядро проверяет **плоскую**
форму outbound'а (`settings.address`), потому что `validateOutboundTransportSecurity` читает
`vlessCfg.Address`, а у `vnext[]`/`servers[]` он `nil`. Наши генераторы и рецепты пишут
классическую форму и под запрет не попадают — проверка нужна для конфигов, набранных руками.
Условие: `protocol` = `vless` или `trojan`, задан `settings.address`, `streamSettings.security`
пуст или `none`, у VLESS вдобавок `settings.encryption` пуст или `none`, адрес не приватный.

Приватность адреса — новый модуль `entities/xray/address.ts` с единственной функцией
`isPrivateAddress(address: string): boolean`: RFC1918, loopback, link-local, CGNAT, ULA для IP;
`localhost` и суффиксы `.local`, `.lan`, `.internal`, `.home`, `.home.arpa` для доменов. Отдельный
файл, а не `compat.ts`: тот про матрицу «security × network», адреса к ней отношения не имеют.
Ядро сверяется с geosite-категорией `private`, повторить её точно нельзя — берём практическое
подмножество и считаем всё остальное публичным, как и ядро.

**4. Ключ Shadowsocks 2022 неверной длины — `error`.** Для inbound'ов с
`settings.method` из семейства `2022-blake3-*`: `settings.password` должен быть base64 ровно
на 16 или 32 байта (по методу). Панель v3 валидирует это до сохранения; таблица длин уже есть
в `backend/src/xray/dummyClient.ts` (`SS2022_KEY_BYTES`) — на фронтенде заводится своя, дублировать
через сеть нечего.

## Reality в форме и мелочи схемы

`RealitySettingsSchema` (`entities/xray/stream.ts`) получает `minClientVer` и `maxClientVer`,
`docSchema` — их описания. В `StreamForm` при `security: reality` появляется поле «Минимальная
версия клиента» с подсказкой про умолчание `26.3.27` и кнопкой «0.0.0 — пустить Mihomo и
Sing-Box», выставляющей значение одним нажатием.

Догоняем ядро по остальному, что появилось между релизами:

- `XrayConfigSchema` — корневой `env` (PR #6400);
- `docSchema` — finalmask `XMC` (Minecraft, PR #6210), `cipherSuites` у TLS-клиента с unsafe
  fingerprint (PR #6450), `pinnedPeerCertSha256` с пометкой «требует `serverName`» (PR #6472);
- `VlessOutboundSettingsSchema` и Trojan-настройки — плоская форма
  (`address`, `port`, `id`, `flow`, `encryption`, `seed` / `password`) рядом с
  `vnext[]`/`servers[]`: без неё диагностика №3 не на что опереться, а IntelliSense молчит.

`backend/src/xray/parseOutput.ts` получает три записи в `HINTS`:

- `vless without TLS or other encryption is prohibited` → «Ядро 26.7.28+ запрещает VLESS без
  TLS/Reality и без `encryption` на публичный адрес. Включите транспортное шифрование или
  задайте `encryption`»;
- `trojan without TLS is prohibited` → то же про Trojan (для него выхода через `encryption` нет);
- предупреждения парсера REALITY (PR #6508) → отсылка к `minClientVer`.

## Тесты

**Бэкенд.** `deleteProfile` на обоих ответах панели (`204` без тела и `200` с телом).
`describePanelError` на трёх формах тела: `errors[]`, только `message`, мусор. `withPanelClients`:
подстановка по тегу, fallback на dummy для тега без пары, срез до одного клиента, недоступный
`computed-config` (роут отвечает как сегодня). Роут `xray-test` с `profileUuid` и без него.

**Фронтенд.** `streamNetwork` на трёх формах записи (`network`, `method`, оба сразу — выигрывает
`method`). Каждая новая диагностика отдельным тестом, включая отрицательные случаи: приватный
адрес не поднимает ошибку, Reality с явным `minClientVer` молчит. Удаление `method` при смене
транспорта в `StreamForm`. `CheckReportDialog` на двух списках инжекта.

**e2e.** `frontend/e2e/mocks.ts:69` и `check-report.spec.ts:15` обновляются под новую форму
`injected`.

## Что сознательно не делаем

- Не вводим проверку версии панели и не показываем её в UI: ни одна ветка кода от неё не зависит.
- Не переходим на `computed-config` как источник конфига для редактирования — редактируем
  черновик, панель инжектит пользователей сама, это разделение остаётся.
- Не поддерживаем `method` на запись: пока панель и клиентские приложения не начнут его писать,
  переносимость важнее моды.
- Не трогаем разделы v3, которых у нас нет (пользователи, подписки, HWID, connections).
