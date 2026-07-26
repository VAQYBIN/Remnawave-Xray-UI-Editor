# План: скриншоты интерфейса для README

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** пять снимков работающего редактора, снимаемых одной командой на моках API и встроенных в README так, чтобы продукт можно было оценить, не устанавливая его.

**Architecture:** четвёртый контур Playwright с собственным конфигом и каталогом — отдельно от e2e, потому что съёмка пишет файлы в репозиторий и живёт по другому расписанию, чем тесты. Витринный конфиг заполняет все пять колонок графа; моки переиспользуют `e2e/mocks.ts` приёмом «поздний обработчик перекрывает ранний».

**Tech Stack:** Playwright (chromium), существующие моки API, React Flow, CodeMirror.

## Global Constraints

- Спецификация: `docs/superpowers/specs/2026-07-26-readme-screenshots-design.md`.
- **Анимации не отключать.** `RemeasureOnEnter` пересчитывает якоря рёбер по событию `animationend`; заглушив анимации инъекцией CSS, получим рёбра на 8px ниже гнёзд на каждом кадре с графом. Съёмка их дожидается.
- **Витринный конфиг обязан давать ноль диагностик.** Значок проблемы на герой-кадре читается как «продукт сломан».
- **`e2e/mocks.ts` и `playwright.config.ts` не менять** — на них опираются 51 существующий e2e-тест.
- Кадры: viewport 1440×900, `deviceScaleFactor: 2`, PNG в `docs/screenshots/`. Если файл превышает ~500 КБ — снизить плотность до 1.5 и переснять.
- Каждый кадр перед коммитом просматривается глазами, а не принимается по факту «файл создался».
- Язык: комментарии и README — русский; сообщения коммитов — английский conventional style.

## Раскладка файлов

| Файл | Ответственность |
| --- | --- |
| `frontend/playwright.screenshots.config.ts` (создаётся) | отдельный конфиг: свой `testDir`, viewport, плотность, свой порт |
| `frontend/screenshots/showcase.ts` (создаётся) | витринный конфиг, профиль, сквады, geo-ответы + `mockShowcase(page)` |
| `frontend/screenshots/shots.spec.ts` (создаётся) | пять сценариев съёмки |
| `frontend/package.json` (изменяется) | скрипт `screenshots` |
| `docs/screenshots/*.png` (создаются) | сами кадры |
| `README.md` (изменяется) | герой-кадр и четыре снимка по разделам |
| `CLAUDE.md` (изменяется) | четвёртый контур в описании тестов |

Установленные локаторы приложения (взяты из существующих e2e, не выдуманы):

- узел графа — `.react-flow__node[data-id="<id>"]`, id: `in:<тег>`, `rule:<индекс>`, `bal:<тег>`, `out:<тег>`, `squad:<uuid>`, `obs`;
- инспектор — `page.locator('aside')`, внутри кнопки «Форма» / «JSON узла»;
- редактор — `.cm-content`, всплывашка подсказок — `.cm-tooltip-autocomplete`;
- трасса — кнопка «Куда пойдёт трафик», поле `getByLabel('Адрес')`, панель `.trace-panel`;
- рецепты — кнопка «+ Рецепт», затем кнопка рецепта по имени, затем «Применить» (`exact: true`);
- `Select` рендерится порталом: опции ищутся от страницы как `[role="option"][data-value="<v>"]`.

---

### Task 1: каркас съёмки и герой-кадр

**Files:**
- Create: `frontend/playwright.screenshots.config.ts`, `frontend/screenshots/showcase.ts`, `frontend/screenshots/shots.spec.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `mockShowcase(page)` и `SHOWCASE_UUID` из `showcase.ts`; команда `npm run screenshots -w frontend`; файл `docs/screenshots/topology.png`

- [ ] **Step 1: Убедиться, что снимать пока нечем**

```bash
ls docs/screenshots 2>&1 | head -2
npm run screenshots -w frontend 2>&1 | tail -2
```

Ожидается: каталога нет, скрипта нет (`Missing script: "screenshots"`). Это исходное состояние.

- [ ] **Step 2: Создать конфиг съёмки**

`frontend/playwright.screenshots.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

// Отдельный контур от e2e: съёмка пишет файлы в репозиторий и живёт по другому
// расписанию, чем тесты. Порт свой, чтобы не драться с e2e за 4173.
export default defineConfig({
  testDir: './screenshots',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    viewport: { width: 1440, height: 900 },
    // README отдаётся и на дисплеях с удвоенной плотностью; кадр в одинарной
    // выглядел бы мылом
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'npm run dev -- --port 4175 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
```

- [ ] **Step 3: Добавить скрипт**

В `frontend/package.json`, в `scripts`, рядом с `e2e`:

```json
"screenshots": "playwright test --config playwright.screenshots.config.ts"
```

- [ ] **Step 4: Написать витринный конфиг**

`frontend/screenshots/showcase.ts`. Требование к содержимому — ноль диагностик и заполненные пять колонок:

```ts
import type { Page } from '@playwright/test'
import { mockApi } from '../e2e/mocks'

export const SHOWCASE_UUID = '22222222-2222-4222-8222-222222222222'

const CONFIG = {
  log: { loglevel: 'warning' },
  dns: { servers: ['1.1.1.1', '8.8.8.8'] },
  inbounds: [
    {
      tag: 'vless-reality',
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none', flow: 'xtls-rprx-vision' },
      streamSettings: {
        network: 'raw',
        security: 'reality',
        realitySettings: {
          dest: 'www.cloudflare.com:443',
          serverNames: ['www.cloudflare.com'],
          privateKey: 'wJPbBTQmXqLKgOSzWq3LRYLnCoRqLdYcOJhLm3PbXGM',
          shortIds: ['6ba85179e30d4fc2'],
        },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    },
    {
      tag: 'trojan-ws',
      port: 8443,
      protocol: 'trojan',
      settings: { clients: [] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        wsSettings: { path: '/ws' },
        tlsSettings: { serverName: 'node.example.com', alpn: ['h2', 'http/1.1'] },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
    {
      tag: 'hysteria2',
      port: 2096,
      protocol: 'hysteria2',
      settings: { clients: [] },
      streamSettings: {
        network: 'hysteria',
        security: 'tls',
        tlsSettings: {
          serverName: 'node.example.com',
          certificates: [{ certificateFile: '/etc/ssl/node.crt', keyFile: '/etc/ssl/node.key' }],
        },
        hysteriaSettings: { version: 2, up: '100 mbps', down: '200 mbps' },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    },
  ],
  outbounds: [
    { tag: 'direct', protocol: 'freedom', settings: {} },
    { tag: 'block', protocol: 'blackhole', settings: {} },
    {
      tag: 'warp',
      protocol: 'wireguard',
      settings: {
        secretKey: 'yBt7BM8lLmQZ0nHrTMBrLZ5x9nZmZQ0JnQ0oNlDpXGo=',
        address: ['172.16.0.2/32', '2606:4700:110:8a1b:c1f2:1a3b:4c5d:6e7f/128'],
        peers: [
          {
            publicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
            endpoint: 'engage.cloudflareclient.com:2408',
          },
        ],
        reserved: [78, 135, 76],
      },
    },
    {
      tag: 'proxy-de',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: 'de.example.com',
            port: 443,
            users: [{ id: '9f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', flow: 'xtls-rprx-vision' }],
          },
        ],
      },
      streamSettings: { network: 'raw', security: 'tls' },
    },
    {
      tag: 'proxy-nl',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: 'nl.example.com',
            port: 443,
            users: [{ id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', flow: 'xtls-rprx-vision' }],
          },
        ],
      },
      streamSettings: { network: 'raw', security: 'tls' },
    },
  ],
  observatory: {
    subjectSelector: ['proxy-'],
    probeUrl: 'https://www.gstatic.com/generate_204',
    probeInterval: '5m',
  },
  routing: {
    domainStrategy: 'IPIfNonMatch',
    rules: [
      { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
      { type: 'field', ip: ['geoip:private'], outboundTag: 'block' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
      { type: 'field', domain: ['geosite:openai', 'geosite:netflix'], outboundTag: 'warp' },
      { type: 'field', network: 'tcp,udp', balancerTag: 'foreign' },
    ],
    balancers: [
      { tag: 'foreign', selector: ['proxy-'], fallbackTag: 'direct', strategy: { type: 'leastPing' } },
    ],
  },
}

const PROFILE = {
  uuid: SHOWCASE_UUID,
  viewPosition: 0,
  name: 'Production',
  config: CONFIG,
  inbounds: [
    { uuid: 'i1', tag: 'vless-reality', type: 'vless', network: 'raw', security: 'reality', port: 443 },
    { uuid: 'i2', tag: 'trojan-ws', type: 'trojan', network: 'ws', security: 'tls', port: 8443 },
    { uuid: 'i3', tag: 'hysteria2', type: 'hysteria2', network: 'hysteria', security: 'tls', port: 2096 },
  ],
  nodes: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-20T12:00:00.000Z',
}

const SQUADS = [
  { uuid: 's1', name: 'Основной', inbounds: [{ uuid: 'i1', tag: 'vless-reality' }] },
  { uuid: 's2', name: 'Мобильные', inbounds: [{ uuid: 'i2', tag: 'trojan-ws' }, { uuid: 'i3', tag: 'hysteria2' }] },
]

/**
 * Поздний обработчик Playwright перекрывает ранний — тот же приём, что в
 * e2e/trace.spec.ts. Общий mockApi не трогаем: на него опирается 51 e2e-тест.
 */
export async function mockShowcase(page: Page) {
  await mockApi(page)
  await page.route('**/api/squads', (r) => r.fulfill({ json: { squads: SQUADS } }))
  // Geo загружены: иначе трассировка честно скажет «нет данных», и панель
  // разбора на скриншоте окажется пустой
  await page.route('**/api/tools/geo/match', (r) =>
    r.fulfill({
      json: {
        loaded: true,
        answers: {
          'geosite:category-ads-all': false,
          'geoip:private': false,
          'geosite:openai': true,
          'geosite:netflix': false,
        },
        missing: [],
      },
    }),
  )
  await page.route(`**/api/profiles/${SHOWCASE_UUID}`, (r) =>
    r.fulfill({ json: { profile: PROFILE } }),
  )
  await page.route('**/api/profiles', (r) => r.fulfill({ json: { profiles: [PROFILE] } }))
}
```

Поля `nodes`, `viewPosition` и структура `inbounds` профиля скопированы по форме из `e2e/mocks.ts` — если фактическая форма в моках иная, брать её оттуда, а не из этого текста.

- [ ] **Step 5: Написать съёмку герой-кадра**

`frontend/screenshots/shots.spec.ts`:

```ts
import { test } from '@playwright/test'
import { SHOWCASE_UUID, mockShowcase } from './showcase'

const OUT = '../docs/screenshots'

/**
 * Анимации НЕ глушим: RemeasureOnEnter пересчитывает якоря рёбер по событию
 * animationend, и без него все рёбра уедут на 8px ниже своих гнёзд. Вместо
 * этого дожидаемся, пока входная анимация карточек отыграет (задержки по
 * колонкам — до 210 мс) и React Flow перемерит хэндлы.
 */
async function settle(page: import('@playwright/test').Page) {
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running'),
    undefined,
    { timeout: 5_000 },
  )
  await page.waitForTimeout(300)
}

test('топология — герой-кадр', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.screenshot({ path: `${OUT}/topology.png` })
})
```

- [ ] **Step 6: Снять и посмотреть глазами**

```bash
npm run screenshots -w frontend 2>&1 | tail -5
ls -la docs/screenshots/
```

Ожидается: файл `topology.png` создан. Дальше — **обязательно открыть его и посмотреть**. Проверить по списку:

1. видны все пять колонок (сквады, inbound'ы, правила, балансер, outbound'ы);
2. **рёбра начинаются ровно в гнёздах узлов**, а не ниже — если ниже, `settle` не дождался анимаций;
3. нет значков проблем на узлах и нет ошибок в статус-баре;
4. граф не обрезан и не ужат в угол — при необходимости добавить `fitView`-паузу или увеличить viewport;
5. вес файла в пределах ~500 КБ.

При расхождении — править и переснимать до совпадения со списком.

- [ ] **Step 7: Коммит**

```bash
git add frontend/playwright.screenshots.config.ts frontend/screenshots frontend/package.json docs/screenshots/topology.png
git commit -m "feat(docs): screenshot harness and topology hero shot"
```

---

### Task 2: инспектор и JSON с автоподсказками

**Files:**
- Modify: `frontend/screenshots/shots.spec.ts`

**Interfaces:**
- Consumes: `mockShowcase`, `settle` из задачи 1
- Produces: `docs/screenshots/inspector-reality.png`, `docs/screenshots/json-intellisense.png`

- [ ] **Step 1: Добавить съёмку формы инспектора**

```ts
test('инспектор — форма Reality', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.locator('.react-flow__node[data-id="in:vless-reality"]').click()
  const inspector = page.locator('aside')
  await inspector.waitFor({ state: 'visible' })
  // Reality лежит в сворачиваемой секции: на закрытой секции показывать нечего
  const reality = inspector.getByRole('button', { name: /Reality/ })
  if (await reality.count()) await reality.first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/inspector-reality.png` })
})
```

- [ ] **Step 2: Добавить съёмку JSON с подсказками**

```ts
test('JSON узла — автоподсказки', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.locator('.react-flow__node[data-id="in:vless-reality"]').click()
  const inspector = page.locator('aside')
  await inspector.getByRole('button', { name: 'JSON узла' }).click()
  const content = inspector.locator('.cm-content')
  await content.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('{ "protocol": "vless", "settings": { "')
  await page.keyboard.press('Control+Space')
  await page.locator('.cm-tooltip-autocomplete').waitFor({ state: 'visible' })
  await page.screenshot({ path: `${OUT}/json-intellisense.png` })
})
```

- [ ] **Step 3: Снять и посмотреть**

```bash
npm run screenshots -w frontend 2>&1 | tail -5
```

Открыть оба файла. Проверить: на первом видна форма с полями Reality и кнопкой генерации ключей, панель не обрезана; на втором открыт список подсказок с читаемыми пунктами (`flow`, `fallbacks`), а не пустая всплывашка.

Если имя сворачиваемой секции Reality в интерфейсе иное — взять фактическое из `frontend/src/features/inspector/StreamForm.tsx` и поправить локатор.

- [ ] **Step 4: Коммит**

```bash
git add frontend/screenshots/shots.spec.ts docs/screenshots/inspector-reality.png docs/screenshots/json-intellisense.png
git commit -m "feat(docs): inspector form and json intellisense shots"
```

---

### Task 3: трассировка и рецепты

**Files:**
- Modify: `frontend/screenshots/shots.spec.ts`

**Interfaces:**
- Consumes: `mockShowcase`, `settle`
- Produces: `docs/screenshots/trace.png`, `docs/screenshots/recipes.png`

- [ ] **Step 1: Добавить съёмку трассировки**

Цель — `chatgpt.com`: по мокам geo `geosite:openai` отвечает `true`, значит побеждает правило WARP, а два блокирующих выше него честно не срабатывают. Панель разбора при этом непустая.

```ts
test('трассировка — куда пойдёт трафик', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await page.getByLabel('Адрес').fill('chatgpt.com')
  await page.locator('.trace-panel').waitFor({ state: 'visible' })
  // Ввод проходит через useDebounced (600 мс) — снимать раньше нечего
  await page.waitForTimeout(1_200)
  await page.screenshot({ path: `${OUT}/trace.png` })
})
```

- [ ] **Step 2: Добавить съёмку рецептов**

```ts
test('рецепты — изменения до применения', async ({ page }) => {
  await mockShowcase(page)
  await page.goto(`/profiles/${SHOWCASE_UUID}`)
  await settle(page)
  await page.getByRole('button', { name: '+ Рецепт' }).click()
  await page.getByRole('button', { name: /Цепочка через другой сервер/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/recipes.png` })
})
```

Рецепт цепочки выбран намеренно: у него есть и форма параметров, и список изменений — кадр показывает обе половины диалога. Если его точное имя в интерфейсе иное, взять фактическое из `frontend/src/entities/xray/recipes/index.ts`.

- [ ] **Step 3: Снять и посмотреть**

```bash
npm run screenshots -w frontend 2>&1 | tail -5
ls -la docs/screenshots/
```

Открыть оба. Проверить: на трассировке виден подсвеченный путь на графе, вердикты на правилах и текст «Победило правило #…»; на рецептах — форма параметров и список «+ добавим / ✓ уже есть», диалог не обрезан по высоте.

- [ ] **Step 4: Коммит**

```bash
git add frontend/screenshots/shots.spec.ts docs/screenshots/trace.png docs/screenshots/recipes.png
git commit -m "feat(docs): trace and recipes shots"
```

---

### Task 4: встраивание в README и документация

**Files:**
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: пять файлов из `docs/screenshots/`
- Produces: README, по которому продукт оценивается без установки

- [ ] **Step 1: Вставить герой-кадр**

В `README.md`, в центрирующий `<div align="center">`, после блока бейджей и перед `</div>`:

```markdown
<img src="docs/screenshots/topology.png" alt="Топология трафика: сквады, inbound'ы, правила маршрутизации, балансер и outbound'ы соединены кабелями" width="900" />
```

`width` задан явно: без него GitHub растянет кадр удвоенной плотности на всю ширину колонки.

- [ ] **Step 2: Расставить остальные по разделам**

- `inspector-reality.png` — в «✨ Возможности», сразу после пункта про формы;
- `json-intellisense.png` — там же, после пункта про экзотику и JSON узла;
- `trace.png` — в «🔎 Диагностика конфига», после абзаца про трассировщик;
- `recipes.png` — в «🧩 Рецепты», после таблицы рецептов.

У каждого — осмысленный русский `alt`, описывающий содержимое, а не имя файла: README читают и с экранного диктора.

- [ ] **Step 3: Описать четвёртый контур**

В `README.md`, раздел «🧪 Тестирование», после списка трёх контуров:

````markdown
Скриншоты для этого README — четвёртый, отдельный контур: он не проверяет ничего, а пишет
файлы в `docs/screenshots/`. Пересобрать после заметных изменений интерфейса:

```bash
npm run screenshots -w frontend
```
````

В `CLAUDE.md`, где перечислены три контура фронтенда, добавить четвёртый той же строкой формата: `**скриншоты** (`screenshots/*.spec.ts`, свой конфиг и порт 4175) пишут `docs/screenshots/` и в `npm test`/`npm run e2e` не входят`.

- [ ] **Step 4: Проверить, что все картинки на месте и подключены**

```bash
node -e "
const fs=require('fs');
const md=fs.readFileSync('README.md','utf8');
const files=fs.readdirSync('docs/screenshots').filter(f=>f.endsWith('.png'));
let bad=0;
for(const f of files){ const used=md.includes('docs/screenshots/'+f); console.log((used?'✓':'✗')+' '+f+'  '+(fs.statSync('docs/screenshots/'+f).size/1024|0)+' КБ'); if(!used) bad++; }
const refs=[...md.matchAll(/docs\/screenshots\/([\w.-]+)/g)].map(m=>m[1]);
for(const r of new Set(refs)) if(!files.includes(r)){ console.log('✗ в README есть ссылка на несуществующий '+r); bad++; }
if(bad){ process.exit(1); }
console.log('все кадры на месте и подключены');
"
```

Ожидается: пять строк со значком `✓`, вес каждого в пределах ~500 КБ, и `все кадры на месте и подключены`.

- [ ] **Step 5: Убедиться, что съёмка не попала в тестовые контуры**

```bash
npm test -w frontend 2>&1 | grep -E "Test Files|Tests " | tail -2
npx playwright test --list --config playwright.config.ts 2>&1 | tail -2
```

Ожидается: юниты в прежнем количестве (676), а список e2e **не содержит** `shots.spec.ts` — иначе съёмка будет запускаться на каждом PR и писать файлы в CI. Вторую команду выполнять из каталога `frontend`.

- [ ] **Step 6: Коммит**

```bash
git add README.md CLAUDE.md
git commit -m "docs(readme): show the editor with screenshots"
```

---

## Порядок и зависимости

1 → 2, 3 (обе переиспользуют `settle` и `mockShowcase`), 1–3 → 4. Задачи 2 и 3 независимы между собой и могут идти в любом порядке.

Всё уезжает одним PR: README со ссылками на ещё не закоммиченные картинки — сломанные изображения на главной странице репозитория.
