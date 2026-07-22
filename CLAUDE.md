# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Визуальный редактор Xray-конфигов (конфиг-профилей) панели Remnawave v2.8.0: топология трафика как граф (React Flow), формы вместо ручного JSON, сохранение в панель по API. Язык UI, сообщений об ошибках и документации — русский; коммиты — английский conventional style (`fix(frontend): ...`). Ветки: `main` и рабочая `dev`.

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

## Архитектура

### Backend (`backend/src`) — Fastify, ESM, Node 24

Тонкий защищённый прокси к API панели Remnawave. Токен панели живёт только на сервере; браузер ходит на `/api/*` с сессионной cookie.

- `server.ts` — `buildServer(config, deps)`: сборка приложения. Через `deps` инжектятся `RemnawavePort` и `BackupService` — так тесты подменяют панель стабом (`test/stub-remnawave.ts`).
- `remnawave/client.ts` — `RemnawaveClient` (реализация `RemnawavePort`), все ошибки панели заворачиваются в `RemnawaveError` и превращаются глобальным error handler'ом в JSON-ответы с исходным статусом.
- `routes/profiles.ts` — ключевой флоу сохранения: `PATCH /api/profiles/:uuid` требует `expectedUpdatedAt`; при расхождении — `409` с актуальным профилем (оптимистическая блокировка). Перед каждым обновлением текущая версия пишется в бэкап (`backups/service.ts`, каталог `DATA_DIR/backups/<uuid>/`).
- `auth/*` — вход по паролю (`APP_PASSWORD` — plaintext или bcrypt-хэш), подписанная httpOnly-cookie, rate-limit на логин, guard закрывает все `/api/*` кроме auth/health.
- `config.ts` — env валидируется zod'ом при старте; отдельная проверка ловит bcrypt-хэш, испорченный интерполяцией `$` в Docker Compose (см. README).
- Статика фронтенда отдаётся из `STATIC_DIR` с SPA-fallback на `index.html`; неизвестные `/api/*` — JSON 404.

### Frontend (`frontend/src`) — React 19, Vite, слоистая структура

`shared` → `entities` → `features` (вариация feature-sliced):

- `entities/xray` — типы и чистая логика Xray-конфига: схемы inbound/outbound/stream/routing, генерация (`generate.ts`). Всё реэкспортируется через `entities/xray/index.ts`.
- `entities/graph` — `buildGraph.ts` строит из конфига колоночный граф (squad → inbound → rule → outbound); `mutations.ts` — обратные правки конфига из графа. Дубликаты тегов пропускаются (иначе ломаются id узлов React Flow).
- `features/editor` — `EditorPage` (вкладки: топология / JSON узла), `draftStore.ts` — zustand-persist черновики в localStorage по uuid профиля, хранят `baseUpdatedAt` для проверки конфликта при сохранении; `BackupsDialog`, `SaveDialog`, `IssueList`.
- `features/topology` + `features/inspector` — граф и формы редактирования выбранного узла (InboundForm/OutboundForm/StreamForm; генератор ключей Reality дергает `/api/tools`).
- `shared/api` — fetch-клиент; `AuthError` перехватывается в `App.tsx` на уровне QueryCache/MutationCache и редиректит на `/login`.
- `shared/ui` — свой мини-UI-kit (Button, Dialog, Select…), сторонних компонентных библиотек нет.

### Особенности домена

- Trojan-inbound'ы не имеют редактора клиентов — панель сама инжектит пользователей в конфиг.
- Для VLESS `flow` задаётся на уровне settings; при смене протокола settings очищаются.
- Squad-узлы графа приходят не из конфига, а из контекста панели (`GraphContext`), и фильтруются по реально существующим тегам inbound'ов черновика.

## Документация

- `docs/superpowers/specs/` — дизайн-документ проекта, `docs/superpowers/plans/` — планы реализации (все 4 выполнены).
- README: нюансы деплоя (Docker, uid 1000, права на `./data`), безопасность, bcrypt-гейтча с `$` в `.env`.
