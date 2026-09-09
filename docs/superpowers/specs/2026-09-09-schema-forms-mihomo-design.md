# Полное визуальное редактирование клиентских шаблонов. Часть 2: Mihomo целиком — дизайн

**Дата:** 2026-09-09
**Статус:** выполнен планом `docs/superpowers/plans/2026-09-09-schema-forms-mihomo-plan.md`
**Предшественники:** `2026-09-09-schema-forms-singbox-full-ui-design.md` (общий слой и sing-box,
часть 1), `2026-09-05-mihomo-templates-design.md` (модель и первый интерфейс Mihomo)
**Продолжение:** часть 3 (Xray-шаблон) — отдельная спека на тех же контрактах.

## Цель

Та же, что у части 1: шаблон подписки собирается и правится целиком через интерфейс, текстовая
вкладка остаётся для просмотра, аварийных случаев и ключей, которых редактор не знает. Мера
успеха — сквозной сценарий «собрать рабочий шаблон Mihomo с нуля, ни разу не открыв YAML».

Эта часть переносит общий слой (схема, `SchemaForm`, `DocWriter`, панель «Документ», меню
«+ Добавить», движок рецептов) на редактор Mihomo и доводит его до полноты. Общий слой при этом
расширяется только аддитивно; тесты Xray и sing-box — контрольная группа.

## Откуда взялась задача

Инвентаризация 2026-09-09 показала у Mihomo ту же картину «от графа», что и у sing-box, но с
другим дефицитом: словарь почти полон для живых шаблонов, а не хватает **писателей и структуры**.
Провайдер, набор правил и подсписок не создаются и не удаляются; секцию верхнего уровня не
завести; вложенное отображение (`sniffer.sniff`, `dns.nameserver-policy`, `remnawave`, `override`,
`health-check`) заперто; flow-коллекция запирает поле и кабель; порядок есть только у правил;
«+ Группа» кладёт `proxies: []` и тем самым сама себя запирает; «+ Правило» на шаблоне без `rules`
молча ничего не делает, а с `rules` ставит правило ПОСЛЕ финального `MATCH`.

Причина — в архитектурной предпосылке первой спеки Mihomo: «текст владеет файлом, модель обратно
не печатается», обоснованной тем, что панель ищет место подстановки по комментарию
`# LEAVE THIS LINE!`. Предпосылка проверена по исходнику панели и оказалась неверной (см. ниже).
Правки сплайсами остаются верным приёмом для скаляров, но для структуры они не сходятся: у
каждой новой операции свой поиск места в тексте, и 1224 строки `edits.ts` покрывают меньше
половины нужного.

## Проверенные факты, на которые опирается дизайн

- **Панель не ищет маркер.** `remnawave/backend` (`main`, f8ad8ad3, 2026-08-31):
`subscription-template.service.ts` разбирает YAML-шаблон через `load()` библиотеки `js-yaml` со
схемой слияния в обычный объект; `mihomo.generator.service.ts` импортирует только `dump()`, строки
`LEAVE THIS LINE` в нём нет. `renderConfig` дописывает сгенерированные серверы В КОНЕЦ корневого
`proxies`, их имена — В КОНЕЦ `proxy-groups[].proxies` у каждой группы без
`remnawave.include-proxies: false`, а у `proxy-providers.<имя>` с `remnawave.include-proxies: true`
подменяет `payload` полными объектами серверов. Ключ `remnawave` вырезается везде. Комментарии и
якоря панель теряет сама, на своей стороне. Маркер — подсказка человеку, и только.
- **Круг через `Document` библиотеки `yaml` почти без потерь.** Спайк
`parseDocument(text, { merge: true }).toString({ lineWidth: 0 })` на четырёх фикстурах
(`roscomvpn`, `bundle`, `simple`, `default`) сохраняет все якоря (7/7), алиасы (24/24), слияния
`<<:` (19/19), маркеры и комментарии; размер ×0.99–1.03. Дрейф — выравнивание хвостовых
комментариев и пробелы во flow-списках. Значит, модельный писатель для структурных операций
возможен, и «раздувание втрое» из первой спеки было следствием печати из `js-yaml`-подобного
объекта, а не из `Document`.
- **Семантика ключей панели** (`docs/guides/templates/mihomo.md` панели и код генератора совпадают):
у группы читаются `include-proxies: false`, `select-random-proxy: true`,
`shuffle-proxies-order: true` в этом порядке приоритета; у провайдера — только
`include-proxies === true`; в корне — `includeHiddenHosts`. Панель дописывает, а не переписывает:
список `proxies` группы остаётся авторским, хосты идут следом.
- **Ядро** — `MetaCubeX/mihomo`, ветка `Meta`, релизы v1.19.x; справочник ключей собран по
`wiki.metacubex.one/config/*` и каноническому `docs/config.yaml` ядра. Устаревшее: тип группы
`relay` (заменён `dialer-proxy`), `sniffer.sniffing` и `sniffer.port-whitelist` (заменены
`sniffer.sniff`), `tun.inet4-route-*`/`inet6-route-*` (заменены `route-address`/
`route-exclude-address`), `dns.fallback-filter.geosite` (заменён `nameserver-policy`), корневой
`enable-process` (заменён `find-process-mode`), `interface-name`/`routing-mark` у группы
(заменены теми же ключами у сервера).

## Решения владельца (2026-09-09)

1. Порядок ядер: sing-box, Mihomo, Xray-шаблон (часть 1 выполнена).
2. Запрет `doc.toString()` для Mihomo снят для структурных операций; скалярные правки остаются
сплайсами ради формата.
3. Глубина: вся модель ядра, серверы (`proxies[]`, `payload` inline-провайдера) и входы
(`listeners[]`) описаны полностью по типам.
4. Рецепты Mihomo входят в объём.
5. Материализация якоря — только по явному действию пользователя.
6. Маркер декоративен, узлы подстановки рисуются по правилу панели.
7. Неизвестные схеме ключи всегда видны в форме на чтение (наследуется из части 1).

## Расхождения со спекой

Спека — авторитет, и расхождения с ней здесь названы, а не молчаливы. Каждое найдено сверкой
спеки с уже написанным кодом при исполнении плана
`2026-09-09-schema-forms-mihomo-plan.md`.

**1. `renameAt` получил отказ `locked` и при ЛЮБОМ отказе возвращает исходный документ (задача
7).** Спека («Переименование») называет только отказ на занятом либо пустом имени. Первая версия
кода писала новое имя и вело ссылки, не проверяя `mihomoLockAt` ни на пути определения, ни на
путях ссылок — переименование через алиас или слияние прошло бы наполовину и отрапортовало
успех. `renameAt` теперь проверяет замок на определении и на каждом `referencesTo`-пути ДО
записи; при любом замке — `{ md: исходный, refusal: 'locked' }`, при непустом `refused` от
`applyMihomoOps` — `{ md: исходный, refusal: 'unprintable' }`. Принцип «отказ вместо порчи» из
той же спеки перевешивает конкретный код плана.

**2. `fieldAt` возвращает описание родителя только для элемента списка либо имени записи
отображения, а не при любом промахе (задача 5).** Бриф плана предлагал запасной ход «не нашли —
берём родителя» без условий; на практике незнакомый ключ ВНУТРИ известного объекта (например,
опечатка в поле группы) получал бы описание самой группы, а не «вне схемы». Спека прямо называет
незнакомый ключ полем «вне схемы», доступным только на чтение, а не полем родителя — запасной ход
сузили до двух случаев, где он и нужен: последний сегмент пути — число (элемент списка) либо
родительское поле — `map` с `fields` (имя записи отображения, `proxy-providers.<имя>`).

**3. Разрыв кабеля «группа → сервер» считает индекс по СЫРОМУ списку `proxies`, а не по
строково-отфильтрованной проекции (задача 9).** Первая версия искала позицию `indexOf(name)` в
списке, из которого уже отброшены нестроковые элементы (алиасы, слияния) — при их наличии индекс
сдвигался, и `disconnectMihomo` разрывал не тот элемент. Исправлено: индекс ищется по СЫРЫМ
(дealias-нутым) элементам последовательности сравнением скалярного значения с именем; не нашли —
`'not-found'`, а не тихое искажение. Тот же принцип «отказ вместо порчи».

**4. Рецепт «локальные сети напрямую» берёт панельный список из 18 подсетей, а не список из 16
IPv4-диапазонов из брифа плана (задача 18).** Комментарий брифа ссылался на
`entities/mihomo/starters.ts`, где такого списка нет, и не включал `224.0.0.0/3` и четыре
диапазона IPv6 из панельного шаблона по умолчанию (`test/fixtures/mihomo/default.yaml:63-80`).
Цель спеки — воспроизвести то, что панель выпустила бы сама; более короткий список совпал бы с
панелью не полностью и мог бы выпустить локальный IPv6-адрес наружу.

**5. Заголовок диалога отказа — нейтральное «Правка не применена», а не «Так соединить нельзя»
(задача 14).** Первая версия задачи 14 подвела под старый кабельный заголовок и отказы меню «+
Добавить»/«+ Правило», хотя они не про кабель вовсе. Спека требует, чтобы отказ называл свою
причину — заголовок про кабель на некабельном отказе вводит в заблуждение; тело диалога и так
называет причину (`draft.refusal`/`refusalText`).

**6. Операция без эффекта в режиме модели — `refused` без перепечатки документа, а не тихий
успех (задача 6).** Спека описывает режим модели как безусловную перепечатку `Document`, не
оговаривая операции, которые ничего не меняют: `move` с индексом за пределами списка, `remove` по
отсутствующему листовому ключу (`deleteIn` тихо возвращает `false`), `insert` по пути с чужим
НЕ-списком (заменил бы значение пустым списком). Первая версия писателя всё равно печатала
документ целиком в этих случаях — риск сдвинуть форматирование без содержательной правки — и
`refused` оставался пуст. `applyModelOp` теперь возвращает `ModelOpOutcome = { ok: true } | { ok:
false; reason: string }`, и `applyMihomoOps` не печатает документ, если исход отрицательный.

**7. `materializeAt` разворачивает узел через `toJS(md.doc / doc, { maxAliasCount: -1 })`, а не
`.toJSON()` без контекста (задача 6).** Первая версия звала `.toJSON()` на узле напрямую;
`Alias.toJSON()` без `ToJSOptions`-контекста печатает служебный объект `{ source: <имя якоря> }`
вместо разрешённого значения, а `YAMLMap.toJSON()` без контекста падает на собственном вложенном
`<<:`. Материализация обязана развернуть значение так же глубоко, как читает документ ядро,
поэтому нужен контекст (`md.doc` для ветки `merged`, свежий `doc` для ветки `alias`).

**8. `MihomoNameField` коммитит новое имя ПО КАЖДОМУ нажатию клавиши, а не по потере фокуса или
Enter (задача 11).** Формулировка брифа реализации для контролирующего ревью называла «по
blur/Enter» — это было ошибкой самого ревью, а не спеки: код брифа плана уже писал операцию на
каждый символ, как и любое строковое поле `SchemaForm` (без локального зеркала значения — см.
пункт 5 расхождений части 1). Оставлено поведение брифа: цена ошибки — один снимок истории на
букву при переименовании, а не потерянная правка.

**9. `MihomoDocPanel` держит таблицы разделов (`lists`/`maps`) в `useMemo` с пустыми
зависимостями и читает актуальные `draft`/`md` из рефов, а не из параметров функции (задача
13).** Первая версия строила эти таблицы прямо в теле компонента на каждый рендер; `DocPanel`
рисует `spec.Form` как ТИП компонента, а не как проп-функцию — другая функция на каждый рендер
читается React как другой компонент и размонтирует/перемонтирует поддерево карточки, снося фокус
и текстовый буфер при вводе. `DocPanel` при этом остаётся нетронутым (контрольная группа
sing-box) — фикс держится в обёртке `MihomoDocPanel`, тем же приёмом, что уже применён в
`useMihomoDraft` (`coreRef`/`mdRef`).

**10. Узел `hosts:root` рисуется безусловно у любого документа-отображения — без всякой проверки
маркера, даже неявной.** Формулировка решения владельца (6) уже требовала этого в тексте спеки;
находка исполнения (задача 8) в том, что старое условие `hasRootMarker(md)` было заменено не на
пропуск проверки, а на `isMap(md.doc.contents)` — то есть узел зависит только от формы документа
(отображение или нет), а не от присутствия какого-либо маркера-подсказки. Мутационная приёмка
(замена условия на `if (false)`) подтвердила: без этой проверки красный тест «`hosts:root`
рисуется всегда у…» ловит именно регресс к маркеру, а не что-то другое.

**11. `merge: true` резолвит текст ключа `<<` в `Symbol('<<')` (тег `tag:yaml.org,2002:merge`), а
не оставляет строку `'<<'` — `merge.ts` потребовал `mergePairOf` (задача 6).** «Проверенные
факты» спеки описывают спайк `parseDocument(text, { merge: true })` как «почти без потерь» для
структуры документа, но не документируют, что сам ПОИСК пары `<<` в `map.items` меняется:
прежняя реализация `ownPair(map, '<<')` в `merge.ts` искала строковый ключ и с `merge: true`
перестала находить слияния вовсе. `mergePairOf(map)` ищет пару и по строке, и по
`typeof value === 'symbol' && …` — правка точечная, `merge: true` откатить нельзя, это и есть
предмет задачи (снимок `MihomoDoc.json`).

## Общий слой: аддитивные расширения

Все изменения `shared/schema` и `features/inspector/schema` — расширения, ни один существующий
вариант не убран и не переопределён. Тесты Xray и sing-box не меняются.

- **`Lock.action`** — необязательное действие у замка: `{ label: string; run: () => void }`.
`SchemaForm` рисует под запертым полем кнопку с этой подписью. Нужно материализации якоря
(ниже); у sing-box замков с действием нет.
- **`DocSection.kind: 'map'`** — раздел панели «Документ», где записи адресуются именем, а не
индексом (`proxy-providers`, `rule-providers`, `sub-rules`, `hosts`). Кнопка добавления заводит
запись под уникальным именем-заготовкой (`provider`, `provider-2`, …) — имя правится в форме
записи, как у групп; отдельного диалога с вопросом «как назвать» нет.
- **`FieldSchema.values` у `kind: 'map'`** — `'string' | 'strings'` (по умолчанию `'string'`).
`strings` означает: значение записи читается и строкой, и списком, а пишется всегда списком — то
же правило «скаляр как список из одного элемента», что у `domain`/`inbound` в части 1. Нужно
`dns.nameserver-policy` (`rule-set:geosite-private: [system]`) и `hosts` (`[1.1.1.1, 2.2.2.2]`).
- **`ListItemSchema.kind: 'port'`** — элемент «число либо строка-диапазон» (`[80, 8080-8880]` у
`sniffer.sniff.HTTP.ports`, `port` у `listeners`): строка целиком из цифр пишется числом, как у
`PortField` Xray; остальное — строкой.
- **`RefKind`** получает `'proxy-target' | 'provider' | 'sub-rule'`: цель маршрута (группы,
статические серверы, встроенные цели), провайдер (`use`), подсписок (`SUB-RULE`). Имеющийся
`'rule-set'` переиспользуется для `rule-providers`.
- **`DocPanel`** — `SingboxDocPanel` обобщается в `features/inspector/schema/DocPanel.tsx`:
разделы, писатель, ссылки, `fieldsAt`/`fieldAt` ядра и таблицы форм для списков и отображений
приходят пропсами; `SingboxDocPanel` и `MihomoDocPanel` — тонкие обёртки. Тесты `SingboxDocPanel`
не правятся: они и есть проверка, что извлечение ничего не поменяло.

## Схема Mihomo

`entities/mihomo/schema/*` по ветвям, как у sing-box: `root.ts`, `dns.ts`, `tun.ts`, `sniffer.ts`,
`proxies.ts`, `groups.ts`, `providers.ts`, `rules.ts`, `listeners.ts`, `misc.ts`, `shared.ts`;
корень `schema/index.ts` экспортирует `MIHOMO_SCHEMA`, `mihomoFieldsAt`, `mihomoFieldAt`,
`mihomoRefs`, `MIHOMO_DOC_SECTIONS`. Прежний плоский `docSchema.ts` (`MIHOMO_SECTIONS`,
`fieldsOf`, `sectionForKey`) удаляется вместе с `MihomoFieldsForm`: спуск по пути от корня делает
`fieldsAt`, его же читают формы, подсказки и валидация устаревшего.

Ключи ядра в Mihomo — kebab-case, ключи панели у групп и провайдеров — тоже kebab-case
(`include-proxies`), в корне — camelCase (`includeHiddenHosts`). Схема повторяет их дословно.

| Ветвь | Что описано |
| --- | --- |
| Корень | порты (`port`, `socks-port`, `redir-port`, `tproxy-port`, `mixed-port`), `allow-lan`, `bind-address`, `lan-allowed-ips[]`, `lan-disallowed-ips[]`, `authentication[]`, `skip-auth-prefixes[]`, `mode`, `log-level`, `ipv6`, `unified-delay`, `tcp-concurrent`, `interface-name`, `routing-mark`, `find-process-mode`, `global-client-fingerprint`, `keep-alive-idle`, `keep-alive-interval`, `disable-keep-alive`, `geodata-mode`, `geodata-loader`, `geo-auto-update`, `geo-update-interval`, `geox-url{}`, `geosite-matcher`, `global-ua`, `etag-support`, `external-controller`, `external-controller-tls`, `external-controller-unix`, `external-controller-pipe`, `external-controller-cors{}`, `secret`, `external-ui`, `external-ui-name`, `external-ui-url`, `external-doh-server`, `tls{}` (`certificate`, `private-key`, `client-auth-type`, `client-auth-cert`, `ech-key`, `custom-certifactes[]` — опечатка ядра, ключ такой), `profile{}`, `experimental{}`, `ntp{}`, `hosts`, `dns`, `tun`, `sniffer`, `listeners[]`, `tunnels[]`, `proxies[]`, `proxy-groups[]`, `proxy-providers`, `rule-providers`, `rules[]`, `sub-rules`, `remnawave{includeHiddenHosts}` (panelKey); deprecated `enable-process` |
| `dns` | `enable`, `cache-algorithm`, `prefer-h3`, `listen`, `ipv6`, `ipv6-timeout`, `use-hosts`, `use-system-hosts`, `respect-rules`, `default-nameserver[]`, `enhanced-mode`, `fake-ip-range`, `fake-ip-range6`, `fake-ip-filter[]`, `fake-ip-filter-mode`, `fake-ip-ttl`, `nameserver[]`, `fallback[]`, `fallback-filter{}` (`geoip`, `geoip-code`, `ipcidr[]`, `domain[]`; deprecated `geosite[]`), `fallback-lazy-query`, `proxy-server-nameserver[]`, `proxy-server-nameserver-policy` (map, `strings`), `direct-nameserver[]`, `direct-nameserver-follow-policy`, `nameserver-policy` (map, `strings`) |
| `hosts` | map, `strings` |
| `tun` | `enable`, `stack`, `device`, `dns-hijack[]`, `auto-route`, `auto-redirect`, `auto-detect-interface`, `strict-route`, `route-address[]`, `route-exclude-address[]`, `route-address-set[]`, `route-exclude-address-set[]`, `include-interface[]`, `exclude-interface[]`, `include-uid[]`, `include-uid-range[]`, `exclude-uid[]`, `exclude-uid-range[]`, `include-mac-address[]`, `exclude-mac-address[]`, `include-android-user[]`, `include-package[]`, `exclude-package[]`, `mtu`, `gso`, `gso-max-size`, `udp-timeout`, `iproute2-table-index`, `iproute2-rule-index`, `endpoint-independent-nat`, `disable-icmp-forwarding`, `file-descriptor`; deprecated `inet4-route-address[]`, `inet6-route-address[]`, `inet4-route-exclude-address[]`, `inet6-route-exclude-address[]` |
| `sniffer` | `enable`, `force-dns-mapping`, `parse-pure-ip`, `override-destination`, `sniff{}` с `HTTP{ports[], override-destination}`, `TLS{ports[]}`, `QUIC{ports[]}`, `force-domain[]`, `skip-domain[]`, `skip-src-address[]`, `skip-dst-address[]`; deprecated `sniffing[]`, `port-whitelist[]` |
| `profile`, `ntp`, `experimental` | `store-selected`, `store-fake-ip`, `tracing`; `enable`, `write-to-system`, `server`, `port`, `interval`, `dialer-proxy` (ref proxy-target); `quic-go-disable-gso`, `quic-go-disable-ecn`, `dialer-ip4p-convert` |
| `proxies[]` | общие `name`, `type`, `server`, `port`, `udp`, `ip-version`, `interface-name`, `routing-mark`, `tfo`, `mptcp`, `dialer-proxy` (ref proxy-target), `smux{}`; TLS-поля (`tls`, `sni`/`servername`, `skip-cert-verify`, `fingerprint`, `client-fingerprint`, `alpn[]`, `ech-opts{}`, `reality-opts{}`) — по типам через `when type`; по типу: `direct`, `dns`, `http`, `socks5`, `ss` (+`plugin`, `plugin-opts{}`), `ssr`, `vmess`, `vless`, `trojan`, `hysteria`, `hysteria2`, `tuic`, `wireguard` (`private-key`, `public-key`, `pre-shared-key`, `ip`, `ipv6`, `reserved[]`, `mtu`, `peers[]`, `amnezia-wg-option{}`), `ssh`, `mieru`, `anytls`, `snell`, `sudoku`, `shadowquic`, `trusttunnel`; транспорт `network` ∈ `tcp`, `ws`, `http`, `h2`, `grpc` с `ws-opts{}`, `http-opts{}`, `h2-opts{}`, `grpc-opts{}` по `when network` |
| `proxy-groups[]` | `name`, `type` (deprecated `relay`), `proxies[]` (ref proxy-target), `use[]` (ref provider), `url`, `interval`, `lazy`, `timeout`, `max-failed-times`, `tolerance`, `strategy`, `filter`, `exclude-filter`, `exclude-type`, `include-all`, `include-all-proxies`, `include-all-providers`, `disable-udp`, `hidden`, `icon`, `expected-status`, `default-selected`, `empty-fallback`, `remnawave{include-proxies, select-random-proxy, shuffle-proxies-order}` (panelKey); deprecated `interface-name`, `routing-mark` |
| `proxy-providers` | map записей: `type`, `url`, `path`, `interval`, `proxy` (ref proxy-target), `size-limit`, `age-secret-key`, `header` (map, `strings`), `health-check{enable, url, interval, lazy, timeout, expected-status}`, `filter`, `exclude-filter`, `exclude-type`, `dialer-proxy`, `payload[]` (элемент — схема `proxies[]`), `override{additional-prefix, additional-suffix, proxy-name[], skip-cert-verify, name-cert-verify, udp, udp-over-tcp, tfo, mptcp, down, up, dialer-proxy, interface-name, routing-mark, ip-version, override-expr[]}`, `remnawave{include-proxies}` (panelKey) |
| `rule-providers` | map записей: `type`, `behavior`, `format`, `url`, `path`, `path-in-bundle`, `interval`, `proxy` (ref proxy-target), `size-limit`, `header` (map, `strings`), `payload[]` |
| `rules[]`, `sub-rules` | список строк; подсписок — map «имя → список строк». Грамматику строки схема не описывает: её разбирает `rules.ts`, форма правила своя |
| `listeners[]` | общие `name`, `type`, `listen`, `port` (port), `proxy` (ref proxy-target), `rule` (ref sub-rule), `routing-mark`; по типу: `http`, `socks`, `mixed`, `redir`, `tproxy`, `tun` (те же поля, что у корневого `tun`), `shadowsocks`, `vmess`, `vless`, `trojan`, `anytls`, `mieru`, `sudoku`, `tuic`, `shadowquic`, `hysteria2`, `trusttunnel`, `tunnel`, `snell` |
| `tunnels[]` | `network[]`, `address`, `target`, `proxy` (ref proxy-target) |

Точные списки ключей по типам серверов и входов — предмет плана: он сверяет каждую ветвь со
страницами `wiki.metacubex.one/config/proxies/*` и `config/inbound/listeners/*` на момент
написания, а не по памяти. Правило покрытия то же, что в части 1: ветвь покрыта, когда в схеме
есть каждый ключ страницы документации, включая устаревшие. Тип, у которого страница есть, но
ключи неоднозначны, план описывает общими полями и отмечает это в брифе — молчаливое «примерно
так» хуже честного пробела с неизвестными ключами на чтение.

## Писатель

### Два режима одной функции

`applyMihomoOps(md: MihomoDoc, ops: DocOp[]): { md: MihomoDoc; refused: { op: DocOp; reason: string }[] }`
— чистая функция в `entities/mihomo/write.ts`. Операции применяются по одной, после каждой
документ перечитывается (`parseMihomo`): следующая операция считает диапазоны по уже
изменённому тексту, и пачка операций в одном вызове безопасна — прежний запрет «одна правка за
раз» снимается.

Режим каждой операции выбирается по документу, а не по вызывающему:

- **Сплайс** — `set` со скалярным значением или `remove` по пути, чей последний сегмент —
СОБСТВЕННЫЙ ключ блочного отображения с однострочным скалярным значением, не алиас и не
пришедший через `<<:`. Байты вне правки не меняются. Это и есть нынешние `setFieldAt`/
`removeFieldAt` в их «счастливом» случае; их ветки поиска места для НОВОГО ключа удаляются.
- **Модель** — всё остальное: новый ключ (в том числе с созданием промежуточных отображений —
так панель «Документ» заводит секцию), значение-отображение или список, `insert`, `move`,
`remove` элемента списка, любая flow-коллекция, многострочный скаляр. Применяется к `Document`
библиотеки `yaml` (`setIn`/`addIn`/`deleteIn`, `items.splice` у последовательностей) и
печатается `toString({ lineWidth: 0 })`. Перепечатка целиком; косметический дрейф (выравнивание
хвостовых комментариев, пробелы в flow-списках) принят решением 2 и случается один раз — после
первой структурной операции документ стабилен.

Перевод строки документа (`newlineOf`) сохраняется: `toString` печатает `\n`, и у CRLF-файла
результат приводится обратно. Это чинит и нынешний дефект `setFieldAt`, вставлявший `\n` в
CRLF-файл.

Пустая последовательность печатается как `[]` — это flow, и это нормально: flow больше ничего
не запирает, следующая вставка в неё идёт режимом модели и печатается как есть.

### Отказ вместо порчи

Операция, чей путь проходит через алиас (`*имя`) или через ключ, пришедший слиянием (`<<:`),
не применяется и попадает в `refused` с причиной; остальные операции пачки применяются. Форма до
этого не доводит — она спрашивает `lockAt` и рисует такое поле на чтение; `refused` — защита для
рецептов и графа, которые пишут без формы. Черновик отказ показывает тем же диалогом, что отказ
кабеля (`refusalText`).

Материализовать якорь молча, как это делает панель, писатель не имеет права: это правка чужого
объявления. Отсюда:

### Замки и материализация

`lockAt(path)` отвечает замком ровно в двух случаях, оба читаются из документа:

- `alias` — на пути стоит `*имя` («Значение приходит через ссылку на якорь…»);
- `merged` — ключ есть только через `<<:` («Значение приходит через слияние…»).

Тексты — нынешние `LOCK_NOTE.alias`/`merged`. Замки `map`, `flow` и `nowhere` исчезают: первое
рисует `SchemaForm` по схеме, второе и третье пишет режим модели.

У обоих замков есть действие `Lock.action` «Развернуть значение здесь»: `materializeAt(md, path)`
копирует значение собственным ключом (для `merged` — кладёт собственную пару с копией слитого
значения; для `alias` — заменяет алиас копией узла-цели), после чего поле правится обычно.
Действие явное (решение 5): оно меняет документ пользователя — остальные потребители якоря
перестают быть связаны с этим местом, и пользователь обязан это выбрать сам, а не получить при
первом же нажатии клавиши.

### Хук

`useMihomoDraft` реализует `DocWriter` поверх `applyMihomoOps` и `core.writeDraft` — один вызов
`apply` даёт один снимок истории. Прежние методы `setField`/`removeField`/`setListAt`/
`renameGroupTo`/`addGroupNamed`/`addRuleText`/`replaceRule`/`moveSelected`/`removeSelected`
сводятся к операциям писателя и общему `renameAt`; хук экспортирует `writer`, `materialize`,
`rename` и графовые `connect`/`disconnect`. `edits.ts` сокращается до сплайс-примитивов
(`applyEdits`, `scalar`, `detectIndentStep`, `newlineOf`, `originAt`/`readFieldAt` и режим
сплайса); `addGroup`, `addRule`, `removeGroup`, `removeRule`, `moveMihomoRule`, `renameGroup`,
`setListAt`, `replaceRuleText`, `setRuleTarget` удаляются вместе с тестами — их работу делают
операции.

### Переименование

Имя группы, статического сервера, провайдера, набора правил и подсписка адресует запись во
всём документе. `renameAt(md, kind, from, to)` — структурная операция, которая пишет новое имя и
ведёт за собой ссылки: `proxies`/`use` групп, `proxy`/`dialer-proxy` провайдеров, `RULE-SET`/
`SUB-RULE` и цели в `rules` и `sub-rules` (включая условия внутри `AND`/`OR`/`NOT` — их разбирает
`parseRule`), ключи `rule-set:<имя>` в `nameserver-policy` и записи `rule-set:<имя>` в
`fake-ip-filter`, `proxy` у наборов и провайдеров. Перечень ссылок ОДИН — `referencesTo(md, kind,
name)` в `entities/mihomo/refs.ts`, его же читает валидация для проверки «ссылка в пустоту»:
второй список разошёлся бы с первым на первом же новом месте ссылки. Занятое имя и пустое имя —
отказ с причиной, как сегодня у `renameGroup`.

## Подстановка хостов

Маркер `# LEAVE THIS LINE!` декоративен (решение 6). `marker.ts`, `hasRootMarker`,
`MihomoGroup.hasMarker`, `INJECT_MARKER` и предупреждение «маркер стоит, но include-proxies: false
его отменяет» удаляются. Предикаты `inject.ts` переписываются по правилу панели:

- `panelInjectsHosts(group)` — `remnawave.include-proxies !== false`: панель дописывает имена в
конец `proxies` каждой такой группы;
- `groupTakesHosts(group)` (узел подстановки на холсте) — `panelInjectsHosts(group)` либо
`include-all`/`include-all-proxies`: во втором случае хосты собирает ядро из корневого `proxies`,
куда панель их положила;
- `groupGetsHosts(group)` (предупреждение «останется пустой») — `groupTakesHosts` либо непустой
`use`, либо `include-all-providers`.

Узел `hosts:root` рисуется всегда, когда документ — отображение: панель дописывает серверы в
корневой `proxies` безусловно, есть там ключ или нет. Карточка подстановки называет основание
(«панель допишет хосты в конец списка группы» либо «группа соберёт хосты сама через
include-all»); ключи выборки `select-random-proxy`/`shuffle-proxies-order` показываются как
сегодня.

Список `proxies` группы **правится** (в отличие от sing-box, где панель переписывает список
целиком): панель дописывает, авторские имена остаются впереди. Форма показывает подсказку «панель
допишет подставленные хосты в конец», а не замок.

Стартер бэкенда (`starterMihomo.ts`) оставляет комментарий как есть — это подсказка человеку,
совпадающая со стартером панели. `backend/src/mihomo/dummyProxies.ts` перестаёт смотреть на
маркер: фиктивные имена дописываются в каждую группу без `include-proxies: false`, как это
делает панель; константа `MARKER` удаляется на обеих сторонах.

## Граф

Полосы те же: правила → группы → выходы. Узлы: `rule:<index>`, `subrule:<имя>`, `group:<имя>`,
`provider:<имя>`, `proxy:<имя>` — **новый** узел статической записи `proxies[]` в колонке
выходов, `builtin:<цель>`, `hosts:root`, `hosts:<группа>` (по правилу выше). `resolveTarget`
получает вид `'proxy'`; ребро от правила и группы на статический сервер рисуется как на группу.
Дедупликация id одна на все виды, как сегодня.

Коммутация: источник `rule:`/`group:`, цель `group:`/`provider:`/`proxy:`/`builtin:`. Кабель из
`hosts:*` не выходит. `connectMihomo`/`disconnectMihomo` возвращают операции писателя вместо
`TextEdit[]`; отказы остаются поимённо (`SubRuleRefusal`, `panel-hosts-edge`, `alias-list`,
`merged-list`, `proxies-not-a-list`, кольцо групп); `flow-list` и `no-proxies-key` уходят —
писатель пишет и туда. Разрыв нескольких рёбер разом теперь возможен (пачка операций), диалог
«за раз разрывается одна связь» удаляется.

## Инспектор и формы

Ручными остаются главные поля узла, остальное даёт `SchemaForm` по схеме ветви:

| Узел | Главные поля | Из схемы |
| --- | --- | --- |
| группа | `name` (переименование), `type`, `proxies` (мультиселект по `proxy-target` с пропуском чужих имён — имена хостов панели редактор не знает), `use` (мультиселект по провайдерам) | всё остальное, `remnawave.*` всегда видны |
| статический сервер | `name`, `type`, `server`, `port` | по типу, транспорт по `network`, TLS |
| провайдер | `name` (переименование ключа), `type`, `url`/`path` по типу | `health-check`, `override`, `payload[]` карточками с формой сервера, `remnawave.include-proxies` |
| правило | нынешняя `MihomoRuleForm` (тип, значение, цель, модификаторы) — грамматика строки | — |
| подсписок | имя (переименование), список правил карточками с той же формой правила, «+ Правило», порядок, удаление | — |
| набор правил (панель «Документ») | `name`, `type`, `behavior`, `format`, `url`/`path` по типу | остальное, `payload[]` |
| вход (панель «Документ») | `name`, `type`, `listen`, `port` | по типу |

`MihomoRuleForm` пишет `{ op: 'set', path: [...listPath, index], value: raw }` вместо
`draft.replaceRule`: одна форма обслуживает `rules` и любой `sub-rules.<имя>`. Проверка
обратимости строки (`roundTrips`) остаётся.

Порядок («порядок: N из M», «Выше»/«Ниже») и удаление показаны у любого узла, стоящего в списке:
правила, группы, статические серверы, правила подсписка. У записей отображений (провайдер,
подсписок) — удаление. Смена имени переносит выбор за узлом, как сегодня у группы.

Карточка `SubRuleCard` «только чтение, откройте в YAML» и `MihomoSectionsDialog` удаляются.

## Панель «Документ»

Псевдоузел `doc:settings`, кнопка дока «Документ», `MihomoDocPanel` поверх общего `DocPanel`.
Разделы (`MIHOMO_DOC_SECTIONS`):

| Раздел | Путь | Вид |
| --- | --- | --- |
| Общие | `[]` | object, `skip` — все контейнеры, у которых свой раздел или холст; `hosts` и `tls` остаются здесь полями (`map` и `object`) |
| DNS | `dns` | object |
| TUN | `tun` | object |
| Снифер | `sniffer` | object |
| Профиль | `profile` | object |
| NTP | `ntp` | object |
| Экспериментальное | `experimental` | object |
| Входы | `listeners` | list, форма входа |
| Туннели | `tunnels` | list |
| Наборы правил | `rule-providers` | map, форма набора |
| Провайдеры | `proxy-providers` | map, форма провайдера (у провайдера есть и узел: панель — второй вход к той же форме, как список наборов у sing-box) |
| Подсписки | `sub-rules` | map, форма подсписка |

Раздел, которого нет, заводится кнопкой «Завести раздел» стартером схемы (`dns` — стартер
панели: `enable`, `enhanced-mode: fake-ip`, `fake-ip-range`, `nameserver`, `default-nameserver`;
остальные — `{}`/`[]`). `mihomoNodeIdForPath` ведёт пути этих разделов на `doc:settings`; у
`rule-providers` появляется переход из диагностики, которого до сих пор не было.

Диалог «Наборы правил» (состояние загрузки и содержимое) остаётся: он про содержимое наборов, а
не про их запись в документе.

## Создание с холста

Меню «+ Добавить» (`MenuButton`): «Группа» (`{ name, type: 'select' }` — без `proxies`: панель
допишет хосты и так, а пустой список печатался бы flow-скобками), «Сервер» (`{ name, type:
'direct', udp: true }` — единственный вид статического сервера, документированный панелью),
«Провайдер» (`{ type: 'http', url: '', interval: 86400 }`), «Набор правил» (`{ type: 'http',
behavior: 'domain', format: 'mrs', url: '', interval: 86400 }`), «Подсписок» (`[]`), «Вход»
(`{ name, type: 'mixed', listen: '127.0.0.1', port: 7890 }`). Имена уникальны через `uniqueName`
в пространстве, где имя адресует узел: группы, серверы и встроенные цели — одно пространство
(`proxy-target`), провайдеры, наборы, подсписки, входы — свои. После вставки выбор переходит на
новый узел; у записей без узла (набор, вход) открывается панель «Документ».

«+ Правило» остаётся кнопкой: вставляет `DOMAIN-SUFFIX,example.com,DIRECT` ПЕРЕД выбранным
правилом, иначе перед финальным `MATCH`, иначе `MATCH,DIRECT` в конец; секцию `rules` при её
отсутствии заводит (нынешний молчаливый no-op — дефект).

## Валидация, трассировка, подсказки

- Устаревшие ключи и значения — предупреждение с заменой через `walkSchema(MIHOMO_SCHEMA, …)` +
`deprecatedAt`; нынешний текст про `enable-process` переезжает в схему.
- Ссылки: `use` → провайдеры, `RULE-SET` → наборы, `SUB-RULE` → подсписки, `proxy`/`dialer-proxy`
→ цели, `rule-set:` в `nameserver-policy` и `fake-ip-filter` → наборы. Все — предупреждения:
имена хостов панели редактор знать не может, и это правило первой спеки не меняется. Перечень
мест ссылок — `referencesTo`.
- Сохранение блокирует только синтаксис YAML — как сегодня.
- Трассировка: статический сервер — разрешимая цель (`'proxy'`), остальное без изменений.
- Подсказки и hover (`mihomoIntellisense/*`) берут поля по `mihomoFieldsAt(path, md)`; описания
контейнеров (`dns`, `tun`, `proxies`, `remnawave`, …) переезжают из `context.ts` в `doc` полей
схемы — одно описание вместо двух. Молчание там, где схема ничего не описывает, сохраняется.

## Рецепты Mihomo

`entities/mihomo/recipes/*`, реестр `MIHOMO_RECIPES`, модель — `MihomoDoc`: план строит операции
и применяет их `applyMihomoOps`; `changes` считаются по тому, применилась операция или запись уже
была (`ensureAt` по имени либо по содержимому строки правила, как у sing-box). Отказ писателя
(якорь на пути) становится заметкой плана, а не молчанием.

| Рецепт | Что делает |
| --- | --- |
| Разделить трафик по наборам правил | Каталог `RULE_SET_CATALOG` (`entities/mihomo/recipes/catalog.ts`): статический список `.mrs` из `MetaCubeX/meta-rules-dat` (ветка `meta`, `geo/geosite/*.mrs` и `geo/geoip/*.mrs`), те же имена, что у каталога sing-box, каждая ссылка проверена 200 при написании плана; заводит `rule-providers` (`http`, `mrs`, `behavior` по виду), правила `RULE-SET,<имя>,<цель>` перед финальным `MATCH` (`no-resolve` у `ipcidr`) |
| Блокировка рекламы | Набор `category-ads-all` → `RULE-SET,category-ads-all,REJECT` первым правилом: в Mihomo снифинг — не правило, впереди ставить нечего |
| DNS с fake-ip | `dns.enable`, `enhanced-mode: fake-ip`, `fake-ip-range`, `nameserver`, `default-nameserver`, `fake-ip-filter` (записи `ensure`), `profile.store-fake-ip`; заданные значения не перезаписываются — `exists` |
| Локальный вход | `mixed-port` (по умолчанию 7890), при желании `allow-lan` |
| Локальные сети напрямую | Inline-набор `geoip-private` (`behavior: ipcidr`, подсети как в стартере панели) и `RULE-SET,geoip-private,DIRECT,no-resolve` первым правилом |
| WARP | `POST /api/tools/warp-account` либо ручные ключи → запись `proxies[]` типа `wireguard` (`server: engage.cloudflareclient.com`, `port: 2408`, `ip`, `ipv6`, `private-key`, `public-key`, `reserved`, `udp: true`, `mtu: 1280`); при желании группа `select` с этим сервером |

Идемпотентность — забота рецепта (`ensureAt`), диалог `RecipesDialog<MihomoDoc>` с `print: (md)
=> md.text`; применение — один снимок истории.

## Тестирование

- Общий слой: `Lock.action` рисуется и вызывается; `DocSection` вида `map` заводит запись под
уникальным именем; элемент `port`; `map` со `strings`; `DocPanel` — тесты `SingboxDocPanel`
проходят без правок.
- Писатель: сплайс не меняет байты вне правки (нынешний инвариант); режим модели на всех четырёх
фикстурах сохраняет число якорей, алиасов, слияний и комментариев (спайк становится тестом);
CRLF; пачка операций; отказ на алиасе с причиной; материализация обоих замков; создание
промежуточных отображений; вставка, перестановка и удаление в списках; flow-коллекции.
- Схема: полнота по таблице охвата, непустая замена у каждого `deprecated`, существующий вид у
каждого `ref`.
- Подстановка: узлы `hosts:*` по правилу панели без маркера; бэкенд `dummyProxies` — группа без
маркера получает фиктивные имена.
- Граф: узел `proxy:<имя>`, рёбра на него, коммутация, разрыв нескольких рёбер.
- Формы и панель: каждый узел, подсписок с правкой правил, «+ Добавить» шести видов с
уникальностью имён, «+ Правило» перед выбранным/перед `MATCH`/с заведением секции,
переименование с переносом ссылок, порядок у групп и серверов.
- Валидация, подсказки, рецепты (план на пустом документе и на стартере панели,
идемпотентность).
- Контрольная группа: тесты Xray-профиля, Xray-шаблона и sing-box не меняются. Тесты Mihomo —
предмет изменения: те, что утверждали поведение маркера, сплайсов для структуры и запертых
flow-полей, переписываются под новые контракты, а не удаляются молча.
- Приёмка мутационная, как принято.
- E2E «с нуля»: шаблон с пустым `encodedTemplateYaml` из мока панели; кнопками заводятся группа,
сервер, провайдер, набор правил, подсписок, вход и правило; в панели «Документ» заводится `dns`;
применяется рецепт; шаблон сохраняется; вкладка YAML не открывается; тело запроса содержит
собранный документ. Нынешний сценарий «правка группы не трогает маркер» остаётся как проверка
сплайса.

## Вне охвата

- `CLASH` и `STASH`.
- Конструктор логических условий `AND`/`OR`/`NOT` — значение остаётся строкой.
- Редактор выражений `override-expr`.
- Автоматическая материализация якорей и слияний.
- Xray-шаблон — часть 3.

## Открытые допущения

- Ключи по типам серверов и входов сверяются с документацией ядра при написании плана; версии в
`deprecated` — со страниц документации либо из канонического `config.yaml` ядра.
- `Document` библиотеки `yaml` печатает алиасы и слияния без потерь при `merge: true` (спайк);
план проверяет это же на `setIn` через алиасный путь, а не только на холостом круге.
- Порядок ключей у новой записи — порядок стартера; ядро к порядку ключей отображения безразлично.
