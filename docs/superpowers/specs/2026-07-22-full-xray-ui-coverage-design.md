# Полное UI-покрытие настроек Xray (прагматичный Remnawave-набор)

Дата: 2026-07-22. Статус: дизайн утверждён, декомпозиция на 4 плана реализации.

## Проблема

MVP редактора закрывает только базовый минимум: правила маршрутизации редактируются
исключительно через JSON, протоколы и транспорты настраиваются частично, у outbound вообще
нет формы streamSettings. Цель — довести UI до состояния, когда типовые конфиги нод
Remnawave собираются целиком через формы, а JSON остаётся только для экзотики.

## Текущее покрытие (аудит на дату дизайна)

Формами покрыто: inbound vless/trojan/shadowsocks (базовые поля), outbound
freedom/blackhole/wireguard (частично), транспорты ws/grpc/httpupgrade (только
`path`/`serviceName`), TLS (только SNI), Reality (почти полностью).

Только JSON:

- правила маршрутизации целиком (форм нет, `rule:`-узлы в инспекторе получают только JSON);
- `routing.domainStrategy`/`domainMatcher` недоступны даже как узлы;
- outbound: socks/http/vless settings, `streamSettings` (StreamForm не подключён к
  OutboundForm), `mux`, `sendThrough`;
- транспорты: xhttp целиком, `sockopt`, вторичные поля ws/grpc/httpupgrade
  (`host`, `headers`, `multiMode`);
- TLS: `alpn`, `certificates`, `fingerprint`, `minVersion`; Reality: `xver`, `spiderX`;
- inbound: `fallbacks`, `sniffing.destOverride`/`routeOnly`, `allocate`;
- верхнеуровневые секции: `dns` (узел есть, формы нет), `log`, `policy` и прочие.

## Принятые решения

1. **Полнота**: прагматичный Remnawave-набор, не «весь Xray». Экзотика остаётся в JSON.
2. **Маршрутизация**: полная форма правила + общие настройки (`domainStrategy`,
   `domainMatcher`). Balancers — в JSON (в сценариях Remnawave редкость).
3. **Верхнеуровневые секции**: формы для `dns` и `log`. Остальные — JSON.
4. **UX**: формы + подсказки на русском (префиксы geosite:/geoip:, валидация, пояснения
   полей). Без библиотеки готовых пресетов-сценариев (кроме уже существующего WARP-шаблона).
5. **Протоколы inbound**: vless/trojan/shadowsocks доводим до полноты + добавляем
   **Hysteria 2** (`protocol: "hysteria"`, штатно поддержан Remnawave 2.8.0). vmess — в JSON.
6. **Архитектура форм**: гибрид — полные zod-схемы + расширенный набор переиспользуемых
   примитивов, формы собираются вручную из компактных примитивов (в стиле текущего кода,
   без движка-генератора форм).

## Рамки

**Входит:** inbound vless/trojan/shadowsocks/hysteria2; outbound
freedom/blackhole/wireguard/vless/socks/http; транспорты raw(tcp)/ws/grpc/httpupgrade/xhttp
(+hysteria-транспорт для HY2); TLS и Reality целиком; полный UI правил маршрутизации +
общие настройки routing; формы DNS и log; матрица совместимости и валидация целостности.

**Не входит (остаётся в JSON):** balancers, vmess/dokodemo-door/mkcp,
policy/stats/api/reverse/fakedns/observatory, `attrs` в правилах, `noises` у freedom,
`allocate` у inbound, продвинутые поля Reality (`minClientVer`, `maxTimeDiff`,
`mldsa65Seed`, `limitFallback*`).

## Дизайн

### 1. Слой типов (`entities/xray`)

Расширяем zod-схемы до полных по официальной документации Xray (сверено с
xtls.github.io через Context7 на дату дизайна):

- **`TlsSettingsSchema`**: `alpn: string[]`, `fingerprint`, `minVersion`/`maxVersion`,
  `rejectUnknownSni`, `certificates[]` (варианты: `certificateFile`+`keyFile` или inline
  `certificate[]`+`key[]`). `allowInsecure` сознательно не добавляем — выпилен из свежих
  ядер Xray.
- **`RealitySettingsSchema`**: + `xver`, `spiderX`, `show`. Остальное — passthrough.
- **Транспорты**: `wsSettings` (+`host`, `headers`, `heartbeatPeriod`), `grpcSettings`
  (+`authority`, `multiMode`), `httpupgradeSettings` (+`host`, `headers`),
  `xhttpSettings` (`host`, `path`, `mode: auto|packet-up|stream-up|stream-one` + `extra`
  passthrough), `hysteriaSettings` (`version: 2`, `masquerade`, `up`/`down`,
  `udpIdleTimeout`) + `finalmask.quicParams` (`congestion`, `brutalUp`/`brutalDown`),
  `sockopt` — типизированный поднабор (`dialerProxy`, `tcpFastOpen`,
  `acceptProxyProtocol`, `mark`, `domainStrategy`, `interface`) + passthrough.
- **Inbound**: полный `sniffing` (`destOverride: (http|tls|quic|fakedns)[]`, `routeOnly`,
  `metadataOnly`), `fallbacks[]` (`dest`, `path`, `alpn`, `xver`, `name`) для
  vless/trojan, `HysteriaInboundSettingsSchema` (`version`, `clients[]`).
- **Outbound**: типизированные settings — vless (`vnext[]`: `address`, `port`,
  `users[]` c `id`/`flow`/`encryption`), socks/http (`servers[]` + `users[]`), freedom
  (+`redirect`, `fragment`), wireguard полный (`peers[]` c `publicKey`/`endpoint`/
  `allowedIPs`/`preSharedKey`/`keepAlive`, `reserved`, `mtu`, `domainStrategy`),
  blackhole (`response.type`); `mux` (`enabled`, `concurrency`, `xudpConcurrency`,
  `xudpProxyUDP443`), `sendThrough`.
- **Routing**: rule + `source`, `user`; `RoutingSchema` + `domainMatcher`.
- **DNS**: `servers[]` (строка-адрес или объект `address`/`port`/`domains[]`/
  `expectIPs[]`/`skipFallback`/`queryStrategy`), `hosts`, `clientIp`, `queryStrategy`,
  `tag`.
- **Log**: `loglevel`, `access`, `error`, `dnsLog`.

Всё по-прежнему `passthrough()` — неизвестные поля не теряются при round-trip.

### 2. Примитивы форм (`features/inspector/fields.tsx` + `shared/ui`)

Новые примитивы (свой UI-kit, сторонние библиотеки не добавляем):

- `CheckboxField` — чекбокс с label и подсказкой;
- `MultiSelectField` — выбор нескольких значений чипами (`destOverride`, `alpn`,
  `protocol` правила);
- `KeyValueField` — редактор пар ключ-значение (`headers`, `dns.hosts`);
- `ListEditor` — повторяемые карточки с добавить/удалить (fallbacks, peers,
  certificates, dns-серверы, vnext);
- `CollapsibleSection` — сворачиваемый блок «Продвинутые», по умолчанию закрыт.

Паттерн всех форм: частые поля сверху, редкие — под «Продвинутые». Каждое поле — с
короткой русской подсказкой.

### 3. Маршрутизация

- **`RuleForm`** — новая форма в инспекторе для `rule:`-узлов (сейчас kind `other`):
  - `outboundTag` — select из существующих outbound; `inboundTag` — multi-select из
    существующих inbound;
  - `domain`/`ip` — списки (StringListField) со шпаргалкой префиксов
    (`domain:`/`full:`/`regexp:`/`geosite:`, `geoip:`) и предупреждением «строка без
    префикса матчится как keyword-подстрока»;
  - `port`/`sourcePort` — с валидацией формата (`443`, `1000-2000`, списки);
  - `network` (tcp/udp/tcp,udp), `protocol` — multi-select (http/tls/quic/bittorrent,
    работает только при включённом sniffing — подсказать), `user`, `source`.
- **Порядок правил**: кнопки вверх/вниз в форме, номер правила в узле графа. UI явно
  сообщает: правила проверяются сверху вниз, побеждает первое совпавшее.
- **Диалог «Настройки конфига»** — новая кнопка в тулбаре редактора: `routing.
  domainStrategy` (AsIs/IPIfNonMatch/IPOnDemand с пояснениями), `domainMatcher`
  (hybrid/mph/linear), секция log (`loglevel`, `access`, `error`, `dnsLog`).
  Не узел графа — глобальные настройки логичнее в диалоге.

### 4. Транспорты и безопасность (StreamForm)

- StreamForm получает `mode: 'inbound' | 'outbound'` и **подключается к OutboundForm**
  (для всех протоколов, кроме wireguard — он streamSettings не поддерживает, и
  blackhole — бессмысленно). В outbound-режиме — клиентские поля (TLS `fingerprint`,
  `serverName`; Reality `serverName`, `publicKey`(`password`), `shortId`, `spiderX`,
  `fingerprint`); в inbound-режиме — серверные (`certificates`, `privateKey`,
  `serverNames`, `shortIds`, `dest`, `xver`).
- Транспорты: tcp (raw, `acceptProxyProtocol` в продвинутых), ws (`path`, `host`,
  `headers`, `heartbeatPeriod`), grpc (`serviceName`, `authority`, `multiMode`),
  httpupgrade (`path`, `host`, `headers`), xhttp (`path`, `host`, `mode`; `extra`
  оставляем в JSON с пометкой «спека нестабильна»), hysteria (`up`/`down`,
  `masquerade`, `congestion`/`brutalUp`/`brutalDown` из `finalmask`).
- **Матрица совместимости зашита в формы**: `security: reality` — только
  raw/xhttp/grpc; `flow: xtls-rprx-vision` — только raw; `network: hysteria` — только
  `security: tls` с сертификатами. Несовместимые комбинации не предлагаются в
  select'ах; уже существующие в конфиге — подсвечиваются предупреждением (не молча
  переписываются).
- `sockopt` — секция «Продвинутые»; `dialerProxy` — select из тегов outbound (сценарий
  цепочки нода→WARP).

### 5. Протоколы

- **Inbound**:
  - vless: `fallbacks` (ListEditor), `decryption` — текстовое поле в «Продвинутых»
    (VLESS Encryption, формат `mlkem768x25519plus...`); клиентов по-прежнему инжектит
    панель (форму клиентов не делаем);
  - trojan: `fallbacks`; клиенты — панель;
  - shadowsocks: + `network` (tcp/udp/tcp,udp);
  - **hysteria2**: новый шаблон settings (`version: 2` фиксирован), подсказка «нужен
    настоящий TLS-сертификат, Reality не используется»; клиентов инжектит панель;
  - sniffing: `destOverride` multi-select, `routeOnly`, `metadataOnly`.
- **Outbound**:
  - vless: `vnext` (адрес, порт, uuid, flow, encryption) — сценарий цепочек между
    нодами;
  - socks/http: `servers` (адрес, порт, users);
  - freedom: + `redirect`, `fragment` (с пресетом `packets: "tlshello"` — анти-DPI);
  - blackhole: `response.type` (none/http);
  - wireguard: несколько peers (ListEditor), `reserved` (WARP), `preSharedKey`,
    `keepAlive`, `domainStrategy`;
  - `mux`, `sendThrough` — в «Продвинутых».

### 6. DNS

`DnsForm` для существующего dns-узла графа (kind `other` → свой kind): `servers` —
ListEditor с двумя режимами карточки (простая строка-адрес / расширенный сервер с
`address`, `port`, `domains`, `expectIPs`), `queryStrategy`, `hosts` (KeyValueField),
`tag`, `clientIp` в «Продвинутых».

### 7. Валидация и целостность

`analyzeIntegrity` расширяется проверками:

- security×network-матрица (reality только raw/xhttp/grpc);
- `flow` при network ≠ raw — ошибка;
- `protocol: hysteria` без `security: tls` + certificates — ошибка;
- `sockopt.dialerProxy` / `balancerTag` на несуществующий тег — ошибка;
- домен в правиле без префикса — предупреждение (keyword-матчинг);
- порт вне диапазона / битый формат диапазона — ошибка.

Вывод — в существующий `IssueList` и gutter JSON-редактора.

### 8. Тестирование

- **Vitest**: новые схемы (парс валидных/невалидных примеров из документации), мутации,
  каждое правило `analyzeIntegrity`, round-trip форм (изменение поля → корректный патч
  конфига, неизвестные поля не теряются).
- **Playwright e2e**: редактирование правила маршрутизации формой (вкл. порядок),
  переключение транспорта/security с проверкой матрицы, создание hysteria2-inbound,
  outbound vless со streamSettings + Reality (клиентские поля), диалог «Настройки
  конфига», DNS-форма.

## Декомпозиция на планы реализации

Последовательные планы, каждый — отдельный цикл «план → реализация → ревью»:

1. **Фундамент** — полные zod-схемы (`entities/xray`) + новые примитивы форм
   (`CheckboxField`, `MultiSelectField`, `KeyValueField`, `ListEditor`,
   `CollapsibleSection`).
2. **Маршрутизация** — `RuleForm`, порядок правил, диалог «Настройки конфига»
   (routing + log).
3. **Транспорты и безопасность** — полный StreamForm с режимами inbound/outbound,
   все транспорты, TLS, Reality, sockopt, подключение к OutboundForm.
4. **Протоколы + DNS + валидация** — полнота inbound/outbound-форм, hysteria2,
   `DnsForm`, расширенный `analyzeIntegrity`, e2e-сценарии.

## Справочные источники

- Официальная документация Xray (xtls.github.io / xtls/xray-docs-next) — списки полей
  TLS/Reality/sockopt/routing/dns сверены на 2026-07-22.
- Скилл `remnawave-xray` (справочник стека, снимок 2026-07-01): матрица
  security×network, статус Hysteria 2 в Xray-core (inbound с v26.3.27) и в Remnawave
  2.8.0, поля WireGuard/WARP, префиксы доменных матчеров.
