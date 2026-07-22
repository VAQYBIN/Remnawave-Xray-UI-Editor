<div align="center">

# 🛰️ Remnawave Xray UI Editor

**Визуальный редактор Xray-конфигов для панели [Remnawave](https://remna.st) — топология трафика графом, формы вместо ручного JSON, сохранение прямо в панель по API.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Node](https://img.shields.io/badge/Node-24_LTS-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Remnawave](https://img.shields.io/badge/Remnawave-2.8.0-6E56CF)
![tests](https://img.shields.io/badge/tests-349_passing-brightgreen)

</div>

---

Xray-конфиг — это большой вложенный JSON: inbound'ы, outbound'ы, транспорты, TLS/Reality,
правила маршрутизации, DNS. Редактировать его руками легко ошибиться. Этот редактор
показывает конфиг **графом трафика** (squad → inbound → правило → outbound), даёт **формы**
на каждый узел и **проверяет целостность** до сохранения в панель.

## ✨ Возможности

- **Топология графом.** Конфиг рисуется колоночным графом (React Flow): видно, какой inbound
  куда маршрутизируется, какие правила и outbound'ы задействованы. Узлы перетаскиваются,
  рёбра создаются и удаляются мышью.
- **Формы вместо JSON — полное покрытие:**
  - **Inbound:** VLESS (fallbacks, decryption, flow), Trojan (fallbacks), Shadowsocks
    (method/network), **Hysteria 2**; полный sniffing (destOverride / routeOnly / metadataOnly).
  - **Outbound:** freedom (redirect, fragment с анти-DPI пресетом `tlshello`), blackhole,
    wireguard/WARP (несколько peers, reserved), vless-цепочки (vnext), socks/http,
    mux + sendThrough.
  - **Транспорты:** TCP(raw), WebSocket, gRPC, HTTPUpgrade, XHTTP, Hysteria — со всеми полями.
  - **TLS целиком:** ALPN, fingerprint, сертификаты (файловые пути / inline-PEM), версии,
    rejectUnknownSni.
  - **Reality целиком** с разведением серверных/клиентских полей и **генератором ключей**
    (приватный/публичный ключ, short-ID) прямо в форме.
- **Маршрутизация формой.** Полный редактор правила: домены/IP/порты/сеть/протокол со
  шпаргалкой префиксов (`geosite:` / `geoip:` / `domain:` / `regexp:`), перестановка правил,
  глобальный диалог «Настройки конфига» (`domainStrategy`, `domainMatcher`, `log`).
- **DNS формой.** Серверы (строкой или расширенным объектом с `domains`/`expectIPs`), `hosts`,
  `queryStrategy`, `tag`.
- **Умная валидация.** Проверяет несовместимые комбинации транспорт × security (Reality только
  поверх raw/xhttp/grpc), flow × транспорт, Hysteria без сертификата, висячие ссылки на
  несуществующие теги, домены без префикса, битые порты — и подсвечивает до сохранения.
- **Матрица совместимости в формах.** Несовместимые опции просто не предлагаются в select'ах;
  уже существующие в конфиге — подсвечиваются предупреждением, но никогда не переписываются молча.
- **Оптимистическая блокировка + бэкапы.** Перед каждым сохранением текущая версия уходит в
  бэкап; при расхождении версий — понятный конфликт-диалог, а не молчаливая перезапись.
- **Пресеты профилей.** Типовые связки inbound/outbound (минимальный VLESS, VLESS Reality
  Vision с автогенерацией ключей) — без ручного набора JSON.
- **Экзотика — не заблокирована.** Всё, что не покрыто формой, редактируется на вкладке
  «JSON узла»; неизвестные поля не теряются при round-trip.

## 🏗️ Архитектура

```
Браузер ──cookie──►  Backend (Fastify, тонкий прокси)  ──API-токен──►  Панель Remnawave
   React 19 SPA          токен панели живёт только тут          профили Xray-конфигов
```

| Слой | Технологии | Роль |
|------|-----------|------|
| **Frontend** | React 19 · Vite · React Flow · Zustand · CodeMirror · Zod | SPA: граф, формы, валидация, черновики в localStorage |
| **Backend** | Fastify 5 · Node 24 · ESM · Zod | Защищённый прокси к API панели, сессии, бэкапы, оптимистическая блокировка |

- Токен Remnawave **никогда не попадает в браузер** — живёт только на сервере в `.env`.
- Модель Xray-конфига — Zod-схемы с `passthrough` (неизвестные поля переживают редактирование).
- Слоистая структура фронтенда: `shared` → `entities` → `features`.

## 🚀 Быстрый старт (VPS)

```bash
git clone https://github.com/VAQYBIN/Remnawave-Xray-UI-Editor.git
cd Remnawave-Xray-UI-Editor
cp .env.example .env
# заполнить .env: адрес панели, API-токен, пароль входа, секрет сессии
docker compose up -d --build
```

> [!IMPORTANT]
> Контейнер работает от непривилегированного пользователя (uid 1000). Перед первым запуском
> выдайте права на каталог бэкапов:
> ```bash
> mkdir -p data && sudo chown -R 1000:1000 data
> ```

Редактор доступен на `http://<host>:3000`. Проверка здоровья: `curl http://<host>:3000/health`.
Бэкапы конфигов складываются в `./data/backups/<uuid-профиля>/` перед каждым сохранением.

## 🧑‍💻 Разработка

```bash
npm install
npm run dev            # dev-сервер бэкенда (нужен .env)
npm run dev:frontend   # Vite на http://localhost:5173, проксирует /api на :3000
```

Для локальной разработки запустите бэкенд и фронтенд в двух терминалах.

## 🧪 Тестирование

```bash
npm test                                    # тесты обоих workspace
npm test -w backend                         # backend (vitest): 55 тестов
npm test -w frontend                        # frontend (vitest, jsdom): 284 теста
(cd frontend && npx playwright install chromium)   # один раз перед первым e2e
npm run e2e -w frontend                     # Playwright: топология, инспектор, формы (10 сценариев)
```

Три контура тестов не пересекаются:

- **vitest** берёт только `test/**/*.test.{ts,tsx}` (jsdom);
- **Playwright** (`e2e/*.spec.ts`) поднимает свой dev-сервер на `127.0.0.1:4173` и мокает API
  (`e2e/mocks.ts`) — бэкенд не нужен;
- `tsc --noEmit` не проверяет каталог `e2e` (он вне `include` tsconfig).

## 🔐 Безопасность

> [!WARNING]
> **bcrypt-хэш в `.env`:** Docker Compose интерполирует `$` и молча портит хэш. Берите значение
> в одинарные кавычки (`APP_PASSWORD='$2b$12$…'`) или удваивайте каждый `$` (`$$`). Повреждённый
> хэш приложение отклоняет на старте с этой же подсказкой.

- Токен Remnawave живёт только на сервере (`.env`), в браузер не передаётся.
- Вход по паролю; сессия — подписанная httpOnly-cookie; rate-limit на логин.
- Сессионная cookie без флага `secure` (TLS терминируется на reverse-proxy) — **не публикуйте
  порт приложения в интернет напрямую**, только через HTTPS-прокси (Caddy / nginx) или firewall.

## 📦 Стек

`React 19` · `Vite` · `@xyflow/react` (React Flow) · `Zustand` · `CodeMirror` · `Zod` ·
`Fastify 5` · `Node 24 LTS` · `TypeScript` · `Vitest` · `Playwright` · `Docker`

## 📄 Лицензия

[MIT](./LICENSE) © VAQYBIN

---

<div align="center">
<sub>Язык UI, сообщений об ошибках и документации — русский. Коммиты — английский conventional style.</sub>
</div>
