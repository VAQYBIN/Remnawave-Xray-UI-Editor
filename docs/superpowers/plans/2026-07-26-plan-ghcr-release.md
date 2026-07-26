# План: публикация образа в ghcr.io и релизный конвейер

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** мультиарх-образ проекта публикуется в GitHub Container Registry автоматически, версии и релизы выпускаются из conventional-коммитов, а установка сводится к скачиванию двух файлов и `docker compose up -d`.

**Architecture:** одно событие — push в `main`. Джоб `release-please` решает, есть ли релиз, и в положительном случае создаёт тег и GitHub Release; два джоба собирают образ на нативных раннерах своей архитектуры и пушат **по дайджесту без тегов**; джоб `merge` склеивает дайджесты в один манифест и только там навешивает теги. Публикация живёт в отдельном `release.yml`, потому что `ci.yml` запускают PR из форков и он обязан оставаться read-only.

**Tech Stack:** GitHub Actions, Docker Buildx (multi-platform, push-by-digest), GHCR, Release Please v5, Docker Compose.

## Global Constraints

- Спецификация: `docs/superpowers/specs/2026-07-26-ghcr-release-design.md`. Расхождение с ней — повод остановиться и спросить, а не додумать.
- Имя образа пишется литералом в нижнем регистре: `ghcr.io/vaqybin/remnawave-xray-ui-editor`. GHCR не принимает верхний регистр, а `github.repository` даёт `VAQYBIN/Remnawave-Xray-UI-Editor`.
- **Все сторонние экшены пинуются по SHA коммита** с комментарием-версией рядом — так уже сделано в `ci.yml`, отступать нельзя.
- `ci.yml` сохраняет `permissions: contents: read` на верхнем уровне. Права `packages: write` не появляются в нём ни при каких условиях.
- Язык: комментарии в конфигах, README и сообщения пользователю — русский; сообщения коммитов — английский conventional style.
- Версия ядра Xray остаётся `v26.6.27` — она должна совпадать с той, что использует Remnawave.
- Точные значения sha256 ядра (взяты из `.dgst`-файлов релиза v26.6.27 и проверены):
  - `Xray-linux-64.zip` → `b3e5902d06d6282fe53cfa2fc426058b9aeaa429b2c812e20887cd47f26d08bf`
  - `Xray-linux-arm64-v8a.zip` → `13a251379bea366c2cf10363ad71e75734193d401f26f518bf0c25e5c8f8c931`
- Точные SHA-пины экшенов, которых ещё нет в репозитории:

  | Экшен | Версия | SHA |
  | --- | --- | --- |
  | `docker/login-action` | v4.5.1 | `abd2ef45e78c5afb21d64d4ca52ee8550d9572c7` |
  | `docker/setup-buildx-action` | v4.2.0 | `bb05f3f5519dd87d3ba754cc423b652a5edd6d2c` |
  | `docker/build-push-action` | v7.3.0 | `53b7df96c91f9c12dcc8a07bcb9ccacbed38856a` |
  | `docker/metadata-action` | v6.2.0 | `dc802804100637a589fabce1cb79ff13a1411302` |
  | `actions/download-artifact` | v8.0.1 | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
  | `actions/attest-build-provenance` | v4.1.1 | `0f67c3f4856b2e3261c31976d6725780e5e4c373` |
  | `googleapis/release-please-action` | v5.0.0 | `45996ed1f6d02564a971a2fa1b5860e934307cf7` |

  Уже используются в `ci.yml` и переиспользуются как есть: `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` v7.0.0 `820762786026740c76f36085b0efc47a31fe5020`, `actions/upload-artifact` v7.0.1 `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.

## Раскладка файлов

| Файл | Ответственность |
| --- | --- |
| `Dockerfile` (изменяется) | выбор архива Xray по `TARGETARCH`; владелец `/data` в образе |
| `docker-compose.yml` (переписывается) | запуск готового образа пользователем; именованный том |
| `docker-compose.build.yml` (создаётся) | сборка из исходников для разработки; bind-mount `./data` |
| `.github/workflows/ci.yml` (изменяется) | + джоб `docker`: сборка образа на PR без пуша |
| `.github/workflows/release.yml` (создаётся) | версии, релизы, сборка и публикация в GHCR |
| `release-please-config.json` (создаётся) | стратегия версионирования |
| `.release-please-manifest.json` (создаётся) | текущая версия — источник истины |
| `package.json` (изменяется) | поле `version`, которое ведёт Release Please |
| `package-lock.json` (изменяется) | синхронизация версии корневого пакета |
| `README.md` (изменяется) | установка, обновление, бэкапы, сборка из исходников, порядок релиза |

Задачи 1–2 проверяются локально настоящим Docker'ом. Задачи 3–5 — конфигурация CI: их полная проверка возможна только после мержа в `main`, поэтому каждая содержит статическую проверку до мержа и явную проверку после (задача 7).

---

### Task 1: Dockerfile — вторая архитектура и владелец `/data`

**Files:**
- Modify: `Dockerfile:1-13` (стадия `xray`), `Dockerfile:31-45` (финальная стадия)

**Interfaces:**
- Consumes: ничего
- Produces: образ, собираемый под `linux/amd64` и `linux/arm64`; каталог `/data` внутри образа принадлежит `node:node` (uid 1000)

- [ ] **Step 1: Убедиться, что сейчас arm64 не собирается**

Текущая стадия `xray` жёстко качает `Xray-linux-64.zip`. Проверка того, что проблема реальна, а не выдумана:

```bash
docker buildx build --platform linux/arm64 --target xray --load -t xray-stage-test .
docker run --rm xray-stage-test /usr/local/bin/xray version
```

Ожидается провал: бинарь amd64 под arm64-платформой не запустится (`exec format error`) либо, если Docker подставит эмуляцию наоборот, версия выведется, но `file` покажет x86-64. Зафиксировать фактический вывод — он понадобится для сравнения на шаге 4.

- [ ] **Step 2: Переписать стадию `xray`**

Заменить строки 1–13 `Dockerfile` целиком на:

```dockerfile
# Ядро для проверки конфига (`xray run -test`). Версия совпадает с той, что
# использует Remnawave: проверять конфиг чужим ядром бессмысленно. sha256 взят
# из соответствующего .dgst того же релиза; при смене версии двигать все ARG.
FROM alpine:3.24 AS xray
# Подставляет buildx: amd64 или arm64. Архив и его контрольная сумма
# выбираются парой — рассинхрон здесь тише всего ломает сборку.
ARG TARGETARCH
ARG XRAY_VERSION=v26.6.27
ARG XRAY_SHA256_AMD64=b3e5902d06d6282fe53cfa2fc426058b9aeaa429b2c812e20887cd47f26d08bf
ARG XRAY_SHA256_ARM64=13a251379bea366c2cf10363ad71e75734193d401f26f518bf0c25e5c8f8c931
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) asset=Xray-linux-64.zip;        sha="$XRAY_SHA256_AMD64" ;; \
      arm64) asset=Xray-linux-arm64-v8a.zip; sha="$XRAY_SHA256_ARM64" ;; \
      *) echo "неподдерживаемая архитектура: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache curl unzip; \
    curl -fsSL -o /tmp/xray.zip \
      "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${asset}"; \
    echo "${sha}  /tmp/xray.zip" | sha256sum -c -; \
    unzip -j /tmp/xray.zip xray -d /usr/local/bin; \
    chmod +x /usr/local/bin/xray; \
    rm /tmp/xray.zip
```

- [ ] **Step 3: Добавить владельца `/data` в финальную стадию**

В финальной стадии, между `COPY --from=frontend-build …` и `WORKDIR /app/backend`, вставить:

```dockerfile
# Каталог данных создаётся здесь с правильным владельцем: Docker копирует
# права из образа в свежий именованный том, поэтому chown руками не нужен.
RUN mkdir -p /data && chown node:node /data
```

Порядок важен: строка должна стоять **до** `USER node`, иначе `chown` выполнится без прав.

- [ ] **Step 4: Проверить обе архитектуры**

```bash
docker buildx build --platform linux/arm64 --target xray --load -t xray-stage-arm64 .
docker run --rm xray-stage-arm64 sh -c 'apk add --no-cache file >/dev/null && file /usr/local/bin/xray'

docker buildx build --platform linux/amd64 --target xray --load -t xray-stage-amd64 .
docker run --rm xray-stage-amd64 sh -c 'apk add --no-cache file >/dev/null && file /usr/local/bin/xray'
```

Ожидается: первый вывод содержит `ARM aarch64`, второй — `x86-64`. Обе сборки должны пройти проверку `sha256sum -c` — её провал означает, что архив или сумма подставлены неверно, и это **стоп**: сумма не подгоняется под скачанное, а перепроверяется по `.dgst` релиза.

Проверяется только стадия `xray` (несколько секунд). Полная arm64-сборка локально идёт под эмуляцией и заняла бы десятки минут без пользы: в CI она пойдёт на нативном раннере.

- [ ] **Step 5: Проверить владельца `/data` на полном образе**

```bash
docker buildx build --platform linux/amd64 --load -t xray-ui-editor:local .
docker run --rm xray-ui-editor:local sh -c 'ls -ld /data && id'
```

Ожидается `drwxr-xr-x 2 node node … /data` и `uid=1000(node)`.

- [ ] **Step 6: Коммит**

```bash
git add Dockerfile
git commit -m "feat(docker): build for arm64 and own /data in the image"
```

---

### Task 2: compose-файлы

**Files:**
- Modify: `docker-compose.yml` (переписывается целиком)
- Create: `docker-compose.build.yml`

**Interfaces:**
- Consumes: образ из задачи 1 (локально `xray-ui-editor:local`, в проде `ghcr.io/vaqybin/remnawave-xray-ui-editor:latest`)
- Produces: сервис `app`, именованный том `xray-editor-data`, смонтированный в `/data`

- [ ] **Step 1: Воспроизвести проблему, которую убираем**

Показать, что без подготовки каталога bind-mount падает — это и есть исходный `EACCES`:

```bash
mkdir -p /tmp/eacces-check && chmod 755 /tmp/eacces-check
docker run --rm -v /tmp/eacces-check:/data -e DATA_DIR=/data xray-ui-editor:local \
  node -e "require('fs').mkdirSync('/data/backups',{recursive:true})"
```

Ожидается `EACCES: permission denied` (каталог принадлежит root, процесс — uid 1000). На Docker Desktop под Windows bind-mount проходит через прослойку и прав не проверяет — тогда шаг зафиксировать как «на этой платформе не воспроизводится» и идти дальше: проверка на именованном томе (шаг 4) от платформы не зависит.

- [ ] **Step 2: Переписать `docker-compose.yml`**

```yaml
# Готовый образ из GitHub Container Registry — исходники и сборка на машине
# не нужны. Сборка из исходников: docker-compose.build.yml
services:
  app:
    image: ghcr.io/vaqybin/remnawave-xray-ui-editor:latest
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    env_file: .env
    # Приоритет выше, чем у env_file: пути внутри контейнера не должны
    # зависеть от того, что пользователь напишет в .env
    environment:
      PORT: 3000
      DATA_DIR: /data
      STATIC_DIR: /app/frontend/dist
    volumes:
      # Бэкапы конфигов и geo-базы. Именованный том, а не ./data: права на
      # него выставляет сам образ, и chown руками не нужен.
      - xray-editor-data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  xray-editor-data:
```

- [ ] **Step 3: Создать `docker-compose.build.yml`**

```yaml
# Сборка из исходников — для разработки и проверки образа перед релизом.
# Пользователям нужен docker-compose.yml с готовым образом.
services:
  app:
    build: .
    image: xray-ui-editor:local
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    env_file: .env
    environment:
      PORT: 3000
      DATA_DIR: /data
      STATIC_DIR: /app/frontend/dist
    volumes:
      # Здесь bind-mount намеренно: разработчику удобнее видеть бэкапы обычным
      # ls. На Linux каталог нужно подготовить один раз:
      #   mkdir -p data && sudo chown -R 1000:1000 data
      - ./data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

- [ ] **Step 4: Проверить схему обоих файлов и реальный запуск на пустом томе**

```bash
docker compose -f docker-compose.yml config >/dev/null && echo "compose ok"
docker compose -f docker-compose.build.yml config >/dev/null && echo "build compose ok"
```

Обе команды должны напечатать своё «ok». Затем — запуск с локально собранным образом на свежем томе, ради проверки, что `EACCES` исчез:

```bash
docker volume create eacces-probe
docker run --rm -v eacces-probe:/data -e DATA_DIR=/data xray-ui-editor:local \
  node -e "require('fs').mkdirSync('/data/backups',{recursive:true}); console.log('запись в том прошла')"
docker volume rm eacces-probe
```

Ожидается `запись в том прошла` без ошибок прав.

- [ ] **Step 5: Коммит**

```bash
git add docker-compose.yml docker-compose.build.yml
git commit -m "feat(docker): compose on the published image, source build split out"
```

---

### Task 3: сборка образа на PR в `ci.yml`

**Files:**
- Modify: `.github/workflows/ci.yml` (добавляется джоб после `secrets`)

**Interfaces:**
- Consumes: `Dockerfile` из задачи 1
- Produces: обязательная проверка с именем **`docker (build only)`** — это имя понадобится в задаче 7 для ruleset'а

- [ ] **Step 1: Добавить джоб**

В конец `.github/workflows/ci.yml`, на том же уровне отступа, что `build`, `e2e` и `secrets`:

```yaml
  docker:
    name: docker (build only)
    # Только на PR: на push в main ту же сборку делает release.yml.
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0

      # Одна архитектура и без пуша: задача джоба — поймать поломку Dockerfile
      # на PR, а не собрать релиз. Экспорт кэша разрешён только своим веткам:
      # у PR из форка нет прав на запись в кэш Actions, и попытка записи
      # заканчивалась бы ошибкой на каждом внешнем PR.
      - uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
        with:
          context: .
          platforms: linux/amd64
          push: false
          cache-from: type=gha,scope=amd64
          cache-to: ${{ github.event.pull_request.head.repo.full_name == github.repository && 'type=gha,mode=max,scope=amd64' || '' }}
```

- [ ] **Step 2: Проверить, что YAML разбирается**

```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('.github/workflows/ci.yml','utf8');
// Срез от 'jobs:' обязателен: под 'on:' лежат такие же ключи без значения
// ('  push:', '  pull_request:'), и без среза они попадут в список джобов.
const block=t.slice(t.indexOf('\njobs:'));
const jobs=[...block.matchAll(/^  ([a-z][a-z0-9_-]*):$/gm)].map(m=>m[1]);
console.log('джобы:', jobs.join(', '));
if(!jobs.includes('docker')) { console.error('джоб docker не найден'); process.exit(1); }
"
```

Ожидается `джобы: build, e2e, secrets, docker`.

- [ ] **Step 3: Коммит**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build the production image on pull requests"
```

---

### Task 4: версия проекта и конфиг Release Please

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `release-please-config.json`, `.release-please-manifest.json`

**Interfaces:**
- Consumes: ничего
- Produces: манифест с текущей версией — источник истины для задачи 5; после первого релиза `release-please` обновляет `version` в `package.json` и `package-lock.json` и ведёт `CHANGELOG.md`

- [ ] **Step 1: Убедиться, что версии нигде нет**

```bash
node -p "'package.json version: ' + require('./package.json').version"
```

Ожидается `undefined` — это и есть исходное состояние, которое задача чинит.

- [ ] **Step 2: Добавить `version` в корневой `package.json`**

Вторым ключом, сразу после `"name"`:

```json
{
  "name": "xray-ui-editor",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["backend", "frontend"],
```

`0.0.0`, а не `1.0.0`: реальную версию проставит Release Please, смержив релизный PR. Ставить её руками здесь — значит завести второй источник истины, который разъедется с манифестом.

`backend/package.json` и `frontend/package.json` не трогаются: наружу они не публикуются и версионировать их нечем.

- [ ] **Step 3: Синхронизировать lock-файл**

```bash
npm install --package-lock-only
node -e "
const l=require('./package-lock.json');
if(l.version!=='0.0.0'||l.packages[''].version!=='0.0.0'){
  console.error('lock не синхронизирован:', l.version, l.packages[''].version); process.exit(1);
}
console.log('lock синхронизирован');
"
```

Ожидается `lock синхронизирован`. Это нужно сделать сейчас: обновлятор Release Please правит оба места, и если поле в lock отсутствует, релизный PR получится неполным.

- [ ] **Step 4: Создать `release-please-config.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "changelog-path": "CHANGELOG.md",
      "release-as": "1.0.0"
    }
  }
}
```

`"release-as": "1.0.0"` — **одноразовая строка**. Без неё бот пойдёт от `0.0.0` и предложит `0.1.0`, а проект уже функционально завершён и работает в проде. Строка удаляется отдельным коммитом сразу после первого релиза (задача 7, шаг 7); если её забыть, каждый следующий релиз будет снова выпускаться как 1.0.0 и падать на существующем теге.

- [ ] **Step 5: Создать `.release-please-manifest.json`**

```json
{
  ".": "0.0.0"
}
```

- [ ] **Step 6: Проверить, что оба JSON валидны и согласованы с `package.json`**

```bash
node -e "
const cfg=require('./release-please-config.json');
const man=require('./.release-please-manifest.json');
const pkg=require('./package.json');
const ok = cfg.packages['.'] && cfg.packages['.']['release-type']==='node'
        && man['.']===pkg.version;
console.log('config/manifest/package:', cfg.packages['.']['release-as'], man['.'], pkg.version);
if(!ok){ console.error('манифест и package.json разошлись'); process.exit(1); }
console.log('согласованы');
"
```

Ожидается `config/manifest/package: 1.0.0 0.0.0 0.0.0` и `согласованы`.

- [ ] **Step 7: Убедиться, что новые файлы не ломают существующие проверки**

```bash
npm run typecheck --workspace backend && npm run typecheck --workspace frontend
```

Ожидается: обе команды без ошибок. Проверка формальная — правился корневой `package.json`, а он влияет на разрешение workspace'ов.

- [ ] **Step 8: Коммит**

```bash
git add package.json package-lock.json release-please-config.json .release-please-manifest.json
git commit -m "chore: set up release-please versioning"
```

---

### Task 5: workflow публикации

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `Dockerfile` (задача 1), `release-please-config.json` и `.release-please-manifest.json` (задача 4), секрет `RELEASE_PLEASE_TOKEN` (заводится в задаче 7)
- Produces: образ `ghcr.io/vaqybin/remnawave-xray-ui-editor` с тегами `:edge`, `:sha-<короткий>` на каждый push в `main` и `:X.Y.Z`, `:X.Y`, `:X`, `:latest` на релиз

- [ ] **Step 1: Создать файл**

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

# В отличие от ci.yml этот workflow никогда не запускается на PR из форка —
# только на push в main. Поэтому здесь допустимы права на запись в реестр и
# доступ к секретам.
permissions:
  contents: read

# Релизы не отменяют друг друга: отменённый прогон оставил бы в реестре
# дайджесты без манифеста.
concurrency:
  group: release
  cancel-in-progress: false

env:
  # Литералом и в нижнем регистре: GHCR не принимает верхний, а
  # github.repository даёт VAQYBIN/Remnawave-Xray-UI-Editor.
  IMAGE: ghcr.io/vaqybin/remnawave-xray-ui-editor

jobs:
  release-please:
    name: version & release notes
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    outputs:
      released: ${{ steps.rp.outputs.release_created }}
      version: ${{ steps.rp.outputs.version }}
      major: ${{ steps.rp.outputs.major }}
      minor: ${{ steps.rp.outputs.minor }}
    steps:
      # PAT, а не GITHUB_TOKEN: события, порождённые GITHUB_TOKEN, не
      # запускают workflow'ы, поэтому на релизном PR не появилось бы ни одной
      # проверки — и required checks не дали бы его смержить.
      - id: rp
        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  build:
    name: build ${{ matrix.arch }}
    # Намеренно без needs: сборка :edge не зависит от того, состоялся ли
    # релиз, и ждать release-please незачем. Теги навешивает merge, который
    # ждёт обоих.
    runs-on: ${{ matrix.runner }}
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - arch: amd64
            platform: linux/amd64
            runner: ubuntu-latest
          - arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0

      - uses: docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7 # v4.5.1
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # Здесь нужны только метки — теги вычисляет и вешает джоб merge. Среди
      # меток приезжает org.opencontainers.image.source: она связывает пакет с
      # репозиторием и даёт на странице пакета ссылку на исходники.
      - id: meta
        uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
        with:
          images: ${{ env.IMAGE }}

      # push-by-digest: образ уезжает в реестр без единого тега. Так не
      # возникает промежуточного состояния, где :latest указывает на одну
      # платформу из двух.
      - id: build
        uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
        with:
          context: .
          platforms: ${{ matrix.platform }}
          labels: ${{ steps.meta.outputs.labels }}
          outputs: type=image,name=${{ env.IMAGE }},push-by-digest=true,name-canonical=true,push=true
          cache-from: type=gha,scope=${{ matrix.arch }}
          cache-to: type=gha,mode=max,scope=${{ matrix.arch }}
          sbom: true
          provenance: mode=max

      # Имя файла — сам дайджест; содержимое не нужно, merge читает имена.
      - name: Export digest
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: |
          mkdir -p /tmp/digests
          touch "/tmp/digests/${DIGEST#sha256:}"

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: digests-${{ matrix.arch }}
          path: /tmp/digests/*
          if-no-files-found: error
          retention-days: 1

  merge:
    name: manifest & tags
    needs: [release-please, build]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          path: /tmp/digests
          pattern: digests-*
          merge-multiple: true

      - uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0

      - uses: docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7 # v4.5.1
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # edge и sha- — всегда; версионные теги и latest — только если
      # release-please действительно выпустил релиз в этом же прогоне.
      - id: meta
        uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
        with:
          images: ${{ env.IMAGE }}
          tags: |
            type=raw,value=edge
            type=sha,prefix=sha-,format=short
            type=raw,value=${{ needs.release-please.outputs.version }},enable=${{ needs.release-please.outputs.released == 'true' }}
            type=raw,value=${{ needs.release-please.outputs.major }}.${{ needs.release-please.outputs.minor }},enable=${{ needs.release-please.outputs.released == 'true' }}
            type=raw,value=${{ needs.release-please.outputs.major }},enable=${{ needs.release-please.outputs.released == 'true' }}
            type=raw,value=latest,enable=${{ needs.release-please.outputs.released == 'true' }}

      - name: Create manifest list
        working-directory: /tmp/digests
        run: |
          docker buildx imagetools create \
            $(jq -cr '.tags | map("-t " + .) | join(" ")' <<< "$DOCKER_METADATA_OUTPUT_JSON") \
            $(printf "${IMAGE}@sha256:%s " *)
        env:
          IMAGE: ${{ env.IMAGE }}

      - id: digest
        name: Read index digest
        run: |
          digest=$(docker buildx imagetools inspect "${IMAGE}:edge" --format '{{json .Manifest}}' | jq -r .digest)
          echo "value=$digest" >> "$GITHUB_OUTPUT"
          echo "манифест-индекс: $digest"
        env:
          IMAGE: ${{ env.IMAGE }}

      # Аттестация вешается на дайджест манифеста-индекса, а не отдельных
      # платформ: иначе `gh attestation verify` по тегу её не найдёт.
      - uses: actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373 # v4.1.1
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.digest.outputs.value }}
          push-to-registry: true

      - name: Show published tags
        run: docker buildx imagetools inspect "${IMAGE}:edge"
        env:
          IMAGE: ${{ env.IMAGE }}
```

- [ ] **Step 2: Проверить структуру файла статически**

```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('.github/workflows/release.yml','utf8');
const need=['release-please:','build:','merge:','push-by-digest=true','ubuntu-24.04-arm','RELEASE_PLEASE_TOKEN'];
const miss=need.filter(s=>!t.includes(s));
if(miss.length){ console.error('в release.yml не хватает:', miss.join(', ')); process.exit(1); }
const unpinned=[...t.matchAll(/uses: ([^\s]+)/g)].map(m=>m[1]).filter(u=>!/@[0-9a-f]{40}\$/.test(u));
if(unpinned.length){ console.error('экшены без SHA-пина:', unpinned.join(', ')); process.exit(1); }
console.log('release.yml на месте, все экшены запинованы');
"
```

Ожидается `release.yml на месте, все экшены запинованы`.

- [ ] **Step 3: Коммит**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish multi-arch image to ghcr and cut releases"
```

---

### Task 6: документация

**Files:**
- Modify: `README.md` — блок бейджей (строки 11–16), «🚀 Быстрый старт (VPS)» (99–117), «🧑‍💻 Разработка» (214–222)

**Interfaces:**
- Consumes: имена файлов и команды из задач 2 и 5
- Produces: инструкция, по которой установка проходит без `git clone` и без `chown`

- [ ] **Step 1: Убедиться, какие места устареют**

```bash
grep -n "git clone\|chown\|--build\|IMPORTANT" README.md
```

Зафиксировать номера строк: все они должны исчезнуть или измениться к концу задачи.

- [ ] **Step 2: Добавить бейдж версии**

В блок бейджей, первой строкой перед бейджем лицензии:

```markdown
[![Release](https://img.shields.io/github/v/release/VAQYBIN/Remnawave-Xray-UI-Editor?label=release&color=6E56CF)](https://github.com/VAQYBIN/Remnawave-Xray-UI-Editor/releases)
```

Бейдж динамический — при выпуске версий его править не нужно.

- [ ] **Step 3: Переписать «Быстрый старт»**

Заменить весь раздел (от заголовка `## 🚀 Быстрый старт (VPS)` до строки перед `## 🔎 Диагностика конфига`) на:

````markdown
## 🚀 Быстрый старт (VPS)

Нужны только Docker и два файла — исходники и сборка на сервере не требуются.

```bash
curl -fsSLO https://raw.githubusercontent.com/VAQYBIN/Remnawave-Xray-UI-Editor/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/VAQYBIN/Remnawave-Xray-UI-Editor/main/.env.example
nano .env   # адрес панели, API-токен, пароль входа, секрет сессии
docker compose up -d
```

Редактор доступен на `http://<host>:3000`. Проверка здоровья: `curl http://<host>:3000/health`.

Образ мультиархитектурный: `linux/amd64` и `linux/arm64` — ARM-серверы (Oracle Ampere,
Hetzner CAX) работают без оговорок.

**Обновление:**

```bash
docker compose pull && docker compose up -d
```

**Версии образа.** `:latest` — последний релиз, его и ставит `docker-compose.yml`.
Закрепиться можно на `:1.2.3`, `:1.2` или `:1`. Тег `:edge` — сборка последнего коммита в
`main`: свежая, но невыпущенная.

**Бэкапы.** Перед каждым сохранением текущая версия профиля уходит в бэкап; лежат они в
именованном томе `xray-editor-data`. Смотреть и восстанавливать их удобнее из диалога
«Версии» в самом редакторе, но при желании можно достать файлами:

```bash
docker compose cp app:/data/backups ./backups
```

**Подлинность образа.** Каждая сборка подписана GitHub-аттестацией — можно убедиться, что
образ собран этим репозиторием, а не подменён в реестре:

```bash
gh attestation verify oci://ghcr.io/vaqybin/remnawave-xray-ui-editor:latest \
  --repo VAQYBIN/Remnawave-Xray-UI-Editor
```
````

Раздела `> [!IMPORTANT]` про uid 1000 и `chown` в новом тексте нет: с именованным томом права выставляет сам образ, и устаревшее предупреждение хуже отсутствующего.

- [ ] **Step 4: Дополнить «Разработку»**

В конец раздела `## 🧑‍💻 Разработка`, после абзаца про два терминала:

````markdown
**Сборка образа из исходников** (проверить прод-сборку локально):

```bash
docker compose -f docker-compose.build.yml up -d --build
```

Здесь `./data` монтируется каталогом, чтобы бэкапы были видны обычным `ls`. На Linux каталог
нужно подготовить один раз: `mkdir -p data && sudo chown -R 1000:1000 data`.

**Выпуск релиза.** Версии ведёт Release Please по conventional-коммитам: после каждого мержа в
`main` бот обновляет PR «chore: release X.Y.Z» с `CHANGELOG.md` и версией в `package.json`.
Мерж этого PR создаёт тег, GitHub Release с описанием и публикует образ с тегами `:X.Y.Z`,
`:X.Y`, `:X` и `:latest`. Отдельно ставить теги руками не нужно.
````

- [ ] **Step 5: Проверить, что устаревшего не осталось**

```bash
grep -n "git clone\|chown -R 1000\|up -d --build" README.md
```

Ожидается ровно два совпадения, оба в разделе «Разработка»: `chown -R 1000` и
`up -d --build` в абзаце про `docker-compose.build.yml`. Упоминаний `git clone` в инструкции
по установке остаться не должно.

- [ ] **Step 6: Проверить ссылки на файлы, которые скачивает пользователь**

```bash
test -f docker-compose.yml && test -f .env.example && echo "оба файла на месте"
```

Ожидается `оба файла на месте`. Ссылки в README ведут на `main`, поэтому файлы обязаны лежать в корне репозитория под этими именами — переименование сломает установку у всех.

- [ ] **Step 7: Коммит**

```bash
git add README.md
git commit -m "docs(readme): install from the published image"
```

---

### Task 7: выкатка и проверка на живом репозитории

**Files:**
- Modify: `release-please-config.json` (удаление `release-as` после первого релиза)

**Interfaces:**
- Consumes: всё, сделанное задачами 1–6
- Produces: опубликованный образ, первый GitHub Release 1.0.0, работающая установка по README

- [ ] **Step 1: Завести секрет `RELEASE_PLEASE_TOKEN`**

Это делает владелец репозитория, до мержа PR — иначе первый же прогон `release.yml` упадёт на пустом токене.

GitHub → Settings (личные) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token:
- Repository access: **Only select repositories** → `Remnawave-Xray-UI-Editor`;
- Permissions → Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**;
- срок — на усмотрение, но с напоминанием: по истечении релизы молча перестанут выпускаться.

Затем репозиторий → Settings → Secrets and variables → Actions → New repository secret, имя **`RELEASE_PLEASE_TOKEN`**.

- [ ] **Step 2: Открыть PR и дождаться проверок**

```bash
git push -u origin feat/ghcr-release
gh pr create --base main --title "feat: publish the image to ghcr and automate releases" --body "…"
gh pr checks --watch
```

Ожидается: зелёные `typecheck · test · build`, `e2e (Playwright)`, `gitleaks` и новый **`docker (build only)`**. Последний — первая настоящая проверка того, что `Dockerfile` из задачи 1 собирается в CI.

- [ ] **Step 3: Смержить и посмотреть первый прогон `release.yml`**

```bash
gh pr merge --merge --delete-branch
gh run watch $(gh run list --workflow=Release --limit 1 --json databaseId --jq '.[0].databaseId')
```

Ожидается: `release-please` создаёт PR «chore: release 1.0.0» (релиза ещё нет — `released` будет `false`), `build amd64` и `build arm64` проходят, `merge` публикует `:edge` и `:sha-<короткий>`.

Это первое реальное исполнение `release.yml`: проверить его до мержа нельзя, потому что workflow должен лежать в `main`. При падении — читать лог, чинить отдельным PR, не откатывая сделанное.

- [ ] **Step 4: Сделать пакет публичным**

Пока не сделано, `docker pull` требует логина, и README врёт. Владелец репозитория: GitHub → свой профиль → Packages → `remnawave-xray-ui-editor` → Package settings → Danger Zone → Change visibility → **Public**. Там же, в Manage Actions access, убедиться, что репозиторий `Remnawave-Xray-UI-Editor` связан с пакетом с ролью Write.

Проверка со стороны — без всякой авторизации:

```bash
docker logout ghcr.io
docker manifest inspect ghcr.io/vaqybin/remnawave-xray-ui-editor:edge | jq '.manifests[].platform'
```

Ожидается две платформы: `linux/amd64` и `linux/arm64`. Это же и есть проверка того, что мультиарх-манифест собрался правильно.

- [ ] **Step 5: Смержить релизный PR и проверить релиз**

```bash
gh pr list --search "chore: release"
gh pr merge <номер> --merge
gh run watch $(gh run list --workflow=Release --limit 1 --json databaseId --jq '.[0].databaseId')
```

Ожидается: тег `v1.0.0`, GitHub Release с описанием, и в реестре теги `1.0.0`, `1.0`, `1`, `latest`.

```bash
gh release view v1.0.0
docker manifest inspect ghcr.io/vaqybin/remnawave-xray-ui-editor:1.0.0 >/dev/null && echo "тег 1.0.0 опубликован"
gh attestation verify oci://ghcr.io/vaqybin/remnawave-xray-ui-editor:1.0.0 \
  --repo VAQYBIN/Remnawave-Xray-UI-Editor
```

CHANGELOG первого релиза соберётся по всей истории и выйдет длинным — это нормально и правится руками прямо в релизном PR **до** мержа.

- [ ] **Step 6: Пройти установку так, как её пройдёт пользователь**

В пустом каталоге, командами ровно из README:

```bash
curl -fsSLO https://raw.githubusercontent.com/VAQYBIN/Remnawave-Xray-UI-Editor/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/VAQYBIN/Remnawave-Xray-UI-Editor/main/.env.example
# заполнить .env
docker compose up -d
curl -fsS http://127.0.0.1:3000/health
```

Ожидается ответ `/health` без единого `chown` и без `EACCES` в `docker compose logs`. Это финальная проверка всей задачи: она либо подтверждает обещание README, либо опровергает его.

Запускать в каталоге, отличном от рабочей копии проекта, и на порту, свободном от уже
работающего у владельца контейнера на 5065 — иначе проверяется не то.

- [ ] **Step 7: Убрать одноразовый `release-as`**

Иначе следующий релиз снова попытается выпуститься как 1.0.0 и упадёт на существующем теге.

```bash
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('release-please-config.json','utf8'));
delete c.packages['.']['release-as'];
fs.writeFileSync('release-please-config.json', JSON.stringify(c,null,2)+'\n');
console.log('release-as удалён');
"
node -e "
const c=require('./release-please-config.json');
if('release-as' in c.packages['.']){ console.error('release-as всё ещё на месте'); process.exit(1); }
const m=require('./.release-please-manifest.json');
console.log('манифест:', m['.']);
"
```

Ожидается `release-as удалён` и `манифест: 1.0.0` (манифест обновил сам бот, смержив релизный PR — если там всё ещё `0.0.0`, значит релиз не состоялся, и шаг 5 не выполнен).

Изменение уезжает отдельным PR:

```bash
git checkout -b chore/drop-release-as
git add release-please-config.json
git commit -m "chore: drop the one-shot release-as after 1.0.0"
git push -u origin chore/drop-release-as
gh pr create --base main --title "chore: drop the one-shot release-as after 1.0.0" --body "…"
```

- [ ] **Step 8: Опционально — сделать сборку образа обязательной**

Repository → Settings → Rules → ruleset для `main` → Require status checks to pass → добавить **`docker (build only)`**. Делать только после того, как проверка хотя бы раз прошла на PR (шаг 2): требование проверки, которая не запускается, блокирует мерж намертво — на это уже наступали с CodeQL.

---

## Порядок и зависимости

1 → 2 (compose нужен образ с правами на `/data`), 4 → 5 (workflow читает манифест), 1 → 3, 2 и 5 → 6 (README документирует их команды), всё → 7.

Задачи 1–6 делаются в одной ветке и уезжают одним PR: по отдельности они не дают работающего результата — compose ссылается на образ, которого ещё нет в реестре.
