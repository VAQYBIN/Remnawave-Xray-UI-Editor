# Xray UI Editor для Remnawave

Визуальный редактор Xray-конфигов (конфиг-профилей) панели
[Remnawave](https://remna.st) v2.8.0: топология трафика как граф,
формы вместо ручного JSON, сохранение напрямую в панель по API.

## Быстрый старт (VPS)

```bash
git clone <repo> && cd xray-ui-editor
cp .env.example .env
# заполнить .env: адрес панели, API-токен, пароль, секрет сессии
docker compose up -d --build
```

Редактор доступен на `http://<host>:3000`. Проверка: `curl http://<host>:3000/health`.

Бэкапы конфигов складываются в `./data/backups/<uuid-профиля>/` перед каждым
сохранением в панель.

## Разработка

```bash
npm install
npm test          # тесты бэкенда
npm run dev       # dev-сервер (нужен .env или переменные окружения)
```

## Безопасность

- Токен Remnawave живёт только на сервере (`.env`), в браузер не передаётся.
- Вход по паролю, сессия — подписанная httpOnly-cookie, rate-limit на логин.
- Рекомендуется закрыть порт reverse-proxy с TLS (Caddy/nginx) или firewall.
