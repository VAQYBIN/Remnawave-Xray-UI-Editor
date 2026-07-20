# Xray UI Editor для Remnawave

Визуальный редактор Xray-конфигов (конфиг-профилей) панели
[Remnawave](https://remna.st) v2.8.0: топология трафика как граф,
формы вместо ручного JSON, сохранение напрямую в панель по API.

- Формы для inbound/outbound всех основных протоколов (VLESS + Reality/flow,
  Trojan, Shadowsocks; freedom/blackhole/wireguard-WARP outbound), остальное —
  через вкладку «JSON узла».
- Генератор ключей Reality (приватный/публичный ключ, short-ID) прямо в форме
  stream-настроек.
- Пресеты при создании профиля — типовые связки inbound/outbound без ручного
  набора JSON.
- Панель бэкапов конфигов профиля с восстановлением любой сохранённой версии.

## Быстрый старт (VPS)

```bash
git clone <repo> && cd xray-ui-editor
cp .env.example .env
# заполнить .env: адрес панели, API-токен, пароль, секрет сессии
docker compose up -d --build
```

> Контейнер работает от непривилегированного пользователя (uid 1000).
> Перед первым запуском выдайте права на каталог бэкапов:
> `mkdir -p data && sudo chown -R 1000:1000 data`

Редактор доступен на `http://<host>:3000`. Проверка: `curl http://<host>:3000/health`.

Бэкапы конфигов складываются в `./data/backups/<uuid-профиля>/` перед каждым
сохранением в панель.

## Разработка

```bash
npm install
npm test          # тесты бэкенда
npm run dev       # dev-сервер (нужен .env или переменные окружения)
npm run dev:frontend   # dev-сервер фронтенда (http://localhost:5173, проксирует /api на :3000)
```

Для локальной разработки запустите бэкенд (`npm run dev`, нужен `.env`) и фронтенд
(`npm run dev:frontend`) в двух терминалах.

## Тестирование

```bash
npm test -w backend      # юнит/интеграционные тесты бэкенда
npm test -w frontend     # юнит-тесты фронтенда (vitest)
(cd frontend && npx playwright install chromium)   # один раз перед первым e2e-прогоном
npm run e2e -w frontend  # Playwright: топология, инспектор, формы протоколов
```

e2e-сценарии (`frontend/e2e/*.spec.ts`) поднимают собственный dev-сервер на
`http://127.0.0.1:4173` (см. `frontend/playwright.config.ts`) и подменяют API
моками (`frontend/e2e/mocks.ts`) — бэкенд для них не нужен. Vitest эти файлы
не подхватывает (`include: 'test/**/*.test.{ts,tsx}'` в `vitest.config.ts`),
а `tsc --noEmit` не проверяет каталог `e2e` (он не входит в `include`
`tsconfig.json`).

## Безопасность

> **bcrypt-хэш в `.env`:** Docker Compose интерполирует `$` и молча портит хэш.
> Берите значение в одинарные кавычки (`APP_PASSWORD='$2b$12$…'`) или удваивайте
> каждый `$` (`$$`). Повреждённый хэш приложение теперь отклоняет на старте
> с этой же подсказкой.

- Токен Remnawave живёт только на сервере (`.env`), в браузер не передаётся.
- Вход по паролю, сессия — подписанная httpOnly-cookie, rate-limit на логин.
- Рекомендуется закрыть порт reverse-proxy с TLS (Caddy/nginx) или firewall.
- Сессионная cookie не имеет флага `secure` (TLS терминируется на reverse-proxy) —
  не публикуйте порт приложения в интернет напрямую, только через HTTPS-прокси.
