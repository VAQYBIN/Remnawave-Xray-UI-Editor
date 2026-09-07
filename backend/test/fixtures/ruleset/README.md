# Двоичные фикстуры наборов правил Mihomo (`.mrs`)

Настоящие файлы из экосистемы, а не собранные нами. Они здесь именно для того,
чтобы наш декодер сверялся с тем, что пишет ядро: всё остальное в
`backend/src/ruleset/` мы пишем сами, и проверять себя собой смысла нет.

Файлы двоичные, глазами не читаются, поэтому их содержимое выписано ниже. Оно
получено черновым декодером и перепроверено на здравый смысл: набор `private`
расшифровался ровно в RFC 1918, CGNAT, loopback, link-local, TEST-NET, ULA и
multicast — совпадение случайным быть не может.

Взяты самые маленькие наборы, какие нашлись: все четыре вместе — 459 байт.

| Файл | Источник | Байт | sha256 |
|---|---|---|---|
| `faceit.mrs` | `hydraponique/roscomvpn-geosite` → `release/mihomo/faceit.mrs` | 78 | `af106f9f6c0238672ac14fa72e5681e31575c260868731ff0f3e6ffd80b7411d` |
| `eft.mrs` | там же, `escapefromtarkov.mrs` | 110 | `899ea36051c3f05a6c4abeb4b98fefd5194f9abd59e7f110ce711af8b0eeac53` |
| `twitch-ads.mrs` | там же, `twitch-ads.mrs` | 122 | `1c774a43019c56371c9c6edd3a847c081d105169d4f5bbd95098581c6cfb427b` |
| `geoip-private.mrs` | `hydraponique/roscomvpn-geoip` → `release/mihomo/private.mrs` | 149 | `3a94bcf0323baf09378b666820d81614bc04fd10d7bbbb85c03b7536711bc671` |

## Содержимое

**`faceit.mrs`** — `behavior: domain`, `count: 2`, ключей в боре 4:

```
faceit.com        +.faceit.com
faceit-cdn.net    +.faceit-cdn.net
```

**`eft.mrs`** — `behavior: domain`, `count: 4`, ключей 8:

```
eft-store.com        +.eft-store.com
eft-project.com      +.eft-project.com
tarkov.com           +.tarkov.com
escapefromtarkov.com +.escapefromtarkov.com
```

**`twitch-ads.mrs`** — `behavior: domain`, `count: 5`, ключей 10:

```
static-cdn.jtvnw.net  usher.ttvnw.net  playlist.ttvnw.net
gql.twitch.tv         ads.twitch.tv
```

(каждый — плюс форма `+.<домен>`)

**`geoip-private.mrs`** — `behavior: ipcidr`, `count: 17`, диапазонов 17:

```
10.0.0.0—10.255.255.255          100.64.0.0—100.127.255.255
127.0.0.0—127.255.255.255        169.254.0.0—169.254.255.255
172.16.0.0—172.31.255.255        192.0.0.0—192.0.0.255
192.0.2.0—192.0.2.255            192.88.99.0—192.88.99.255
192.168.0.0—192.168.255.255      198.18.0.0—198.19.255.255
198.51.100.0—198.51.100.255      203.0.113.0—203.0.113.255
224.0.0.0—255.255.255.255        ::1—::1
fc00::—fdff:ffff:…               fe80::—febf:ffff:…
ff00::—ffff:ffff:…
```

## Ключевое наблюдение: `count` и число ключей — разные числа

В заголовке `.mrs` лежит `count` — сколько записей было в ИСХОДНОМ списке. В
боре ключей вдвое больше: на каждый домен ядро кладёт и сам домен, и его форму
`+.<домен>`, которая ловит поддомены. Пользователю показываем `count` из
заголовка: число ключей бора ему ни о чём не говорит и выглядело бы вдвое
завышенным.

## Проверенная семантика поиска

На `faceit.mrs`, чтобы дальше было от чего отталкиваться:

| Запрос | Ответ |
|---|---|
| `faceit.com` | да |
| `www.faceit.com`, `a.b.faceit.com` | да — работает `+.` |
| `FACEIT.COM`, `WWW.Faceit.Com` | да — регистр не важен |
| `notfaceit.com`, `myfaceit.com` | нет — граница метки соблюдается |
| `faceit.com.evil.com` | нет |
| `com`, `.faceit.com`, пустая строка | нет |
