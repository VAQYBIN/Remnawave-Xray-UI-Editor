# Интерфейс поддержки Sing-box (план 2 из 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Открыть шаблон типа `SINGBOX` в редакторе так же полноценно, как открываются `XRAY_JSON` и `MIHOMO`: граф маршрутизации, формы вместо ручного JSON, подсказки, трассировка, проверка ядром, сохранение с защитой от параллельной правки и импорт из каталога.

**Architecture:** Третья сборка поверх уже разрезанной оболочки (`useDocumentDraft` → `EditorShell` → `GraphCanvas`, параметризованной `DocumentAdapter`). Общий слой не меняется: если правка в нём понадобится — это сигнал, что разрез был неверен, и она обсуждается отдельно. Модель, словарь, диагностики и трассировка готовы планом 1 (`entities/singbox`); здесь к ним добавляются граф, мутации, формы, подсказки и страница. Единица правки — НОВАЯ МОДЕЛЬ, а не текстовый сплайс: содержимое лежит в `templateJson` объектом, панель форматирования не хранит, и архитектура сплайсов, защищавшая якоря и комментарий-маркер YAML у Mihomo, здесь не нужна и не применяется.

**Tech Stack:** TypeScript, React 19, Vite, zod 4, CodeMirror 6, React Flow 12 (`@xyflow/react`), zustand, TanStack Query, vitest 4 (jsdom), Playwright. Новых npm-зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-09-07-singbox-templates-design.md`

**Предшественник:** `docs/superpowers/plans/2026-09-08-singbox-plan1-core.md` — ВЫПОЛНЕН. Всё, на что этот план опирается в `entities/singbox` и на бэкенде, уже существует и покрыто тестами.

## Global Constraints

- Целевая версия ядра — **sing-box 1.13.x**.
- Ключ панели в документе — `remnawave.includeProxies` (**camelCase**). Единственное осмысленное значение — `false`.
- Панель дописывает серверы **в конец** массива `outbounds`; списки `outbounds` у групп перезаписывает целиком, кроме групп с `includeProxies: false`; ключ `remnawave` вырезает из результата.
- `route.final` пуст → ядро берёт **первый** элемент `outbounds`. В трёх шаблонах каталога из трёх поле не задано — это норма, а не исключение.
- Схема разбора **сквозная**: незнакомые ключи проходят насквозь и не делают документ невалидным. Форма, не умеющая выразить значение, показывает его на чтение с названной причиной, а не прячет и не портит.
- **Список выходов группы — только на чтение**, пока не поставлен `includeProxies: false`.
- **Общий слой редактора не меняется** (`useDocumentDraft`, `EditorShell`, `GraphCanvas`, `DocumentAdapter`). Исключения ровно два, оба аддитивные и названы поимённо в задачах: расширение union `SearchHit['kind']` (задача 3) и расширение `edgeHues` новыми префиксами id (задача 6).
- **Тесты Xray и Mihomo не меняются ни в одной задаче.** Их неизменность — доказательство, что общий слой не тронут. Проверка: `git diff --stat` по `frontend/test` показывает только новые файлы `singbox-*`.
- Язык UI, сообщений об ошибках, текстов диагностик и комментариев — **русский**; коммиты — English conventional style (`feat(frontend): ...`).
- Фикстуры фронтенда читаются через `?raw`-импорт Vite (`singboxFixture` в `frontend/test/helpers.ts`), а НЕ через `node:fs`/`new URL(..., import.meta.url)`: `frontend/tsconfig.json` держит `types: ["vite/client"]` без типов Node, а в jsdom глобальный `URL` — это whatwg-url, ломающий разрешение `file:`-адреса с буквой диска. Помощник уже существует; править `helpers.ts` не нужно.
- **Мутационная проверка обязательна:** каждый значимый тест доказывается сломанным кодом и наблюдаемым красным, после чего правка отменяется обратной правкой (не `git checkout --`). Мутация никогда не определяется как замена на пустую строку.
- Проверки перед коммитом: `npm test -w frontend`, `npm run typecheck -w frontend`. Вывод не пропускать через `| tail` — код возврата возьмётся от `tail`.

## Три решения, расходящиеся со спекой

Спека — авторитет, и расхождения с ней здесь не молчаливые, а названные. Каждое найдено сверкой спеки с уже написанным кодом.

**1. Цель трассировки — `TraceTarget`, а не строка (задача 9).** Спека перечисляет восемь проверяемых условий, среди них `port` и `port_range`. План 1 дал `traceSingbox(doc, target: string)` — с такой целью порт неизвестен, и оба условия вынужденно останавливают проход. При этом общий тип цели `TraceTarget` (`entities/xray/traceMatch.ts`) существует с самого начала проекта, его заполняет общий `TraceBar` и читают обе прежние трассировки. То есть план 1 не «недоделал» цель, а разошёлся с проектом, заведя свою. Задача 8 это исправляет.

**2. Условие `network` становится девятым проверяемым (задача 9).** Прямое следствие первого решения. `TraceTarget.network` — это `tcp` либо `udp`, и пользователь ввёл его сам. Оставить `network` в останавливающих значило бы объяснять остановку фразой «транспорт цели трассировки неизвестен», то есть **соврать человеку про то, что он только что набрал**. Ложное объяснение хуже отсутствующей проверки: по нему идут искать несуществующую причину. Поэтому проверяемых условий девять, и в коде это записано словами.

**3. Дефолтный маршрут отмечается на КАРТОЧКЕ выхода, а не стилем ребра (задача 2).** Спека говорит «отмечен отдельным стилем ребра», но ребра у дефолтного маршрута нет: у него нет узла-источника — это свойство документа (`route.final` либо позиция первого элемента), а не связь двух узлов. Рисовать ребро «из ниоткуда» пришлось бы заводить фиктивный узел. У Xray эта же задача решена флагом `isDefault` на данных узла выхода и подписью на карточке (`OutboundNodeData.isDefault`), и второй механизм для того же факта стал бы второй истиной. Берём приём Xray.

**Одно уточнение, а не расхождение.** Спека говорит «четыре колонки: входы → правила → группы → выходы». Это порядок ПОЛОС, а не обещание, что групп ровно одна колонка: `selector` перечисляет `urltest`, а группа с `includeProxies: false` может ссылаться на любые группы — вложенность произвольной глубины. Полоса групп разворачивается в столько колонок, сколько требует документ, тем же расчётом глубины, что у Mihomo. `GraphCanvas` это уже поддерживает: ключ подписи колонки — вид ВМЕСТЕ с координатой, ровно ради нескольких колонок одного вида.

---

## Структура файлов

**Создаются (модель и граф):**
- `frontend/src/entities/singbox/docPath.ts` — маршрутизация словаря по дереву документа: путь курсора → секция словаря.
- `frontend/src/entities/singbox/search.ts` — поиск узлов графа по строке.
- `frontend/src/entities/graph/singbox/types.ts` — данные узлов графа.
- `frontend/src/entities/graph/singbox/buildGraph.ts` — построение графа и раскладка.
- `frontend/src/entities/graph/singbox/locate.ts` — путь диагностики → id узла, счётчики проблем.
- `frontend/src/entities/graph/singbox/mutations.ts` — коммутация и правки структуры документа.

**Создаются (оболочка и холст):**
- `frontend/src/features/editor/singboxAdapter.ts` — реализация `DocumentAdapter<SingboxDoc>`.
- `frontend/src/features/editor/useSingboxDraft.ts` — черновик sing-box поверх `useDocumentDraft`.
- `frontend/src/features/editor/SingboxJsonView.tsx` — текстовая вкладка со своим линтером и подсказками.
- `frontend/src/features/topology/singboxNodes.tsx` — карточки узлов.
- `frontend/src/features/topology/SingboxTopology.tsx` — граф поверх `GraphCanvas`.
- `frontend/src/features/topology/SingboxInspector.tsx` — разводка форм по выбранному узлу.

**Создаются (формы инспектора):**
- `frontend/src/features/inspector/SingboxExtraFields.tsx` — блок «Ещё поля» по словарю, общий для всех форм sing-box.
- `frontend/src/features/inspector/SingboxOutboundForm.tsx` — выход-сервер и группа (включая «Закрепить список»).
- `frontend/src/features/inspector/SingboxRuleForm.tsx` — правило маршрута.
- `frontend/src/features/inspector/SingboxInboundForm.tsx` — вход клиента.
- `frontend/src/features/inspector/SingboxRuleSetForm.tsx` — набор правил.
- `frontend/src/features/inspector/SingboxDnsServerForm.tsx` — DNS-сервер.

**Создаются (подсказки, диагностика, страница):**
- `frontend/src/features/editor/singboxIntellisense/{context,complete,hover,index}.ts` — подсказки и наведение на вкладке JSON.
- `frontend/src/features/diagnostics/SingboxTracePanel.tsx` — разбор трассы.
- `frontend/src/features/diagnostics/SingboxCheckDialog.tsx` — отчёт проверки ядром.
- `frontend/src/features/templates/SingboxEditorPage.tsx` — страница редактора.

**Правятся:**
- `frontend/src/entities/singbox/trace.ts` — цель становится `TraceTarget` (задача 9).
- `frontend/src/entities/singbox/index.ts` — реэкспорт новых модулей.
- `frontend/src/entities/graph/search.ts` — новые значения в union `SearchHit['kind']` (задача 3).
- `frontend/src/features/topology/edges.tsx` — префиксы id sing-box в `edgeHues` (задача 6).
- `frontend/src/features/editor/configFile.ts` — различение формата при загрузке файла (задача 13).
- `frontend/src/features/templates/TemplateEditorPage.tsx` — третья ветка типа.
- `frontend/src/features/templates/TemplatesPage.tsx` — `SINGBOX` в наборе `EDITABLE`.
- `frontend/src/features/templates/CreateTemplateDialog.tsx` — третий тип при создании.
- `frontend/src/shared/api/hooks.ts` — `useSingboxTest`, расширение union у `useCreateTemplate`.
- `frontend/e2e/mocks.ts` — шаблон `SINGBOX`, запись каталога, `mockSingbox`.
- `CLAUDE.md`, `README.md` — документация (задача 15).

**Тесты:** по файлу на задачу — `frontend/test/singbox-*.test.{ts,tsx}`, плюс `frontend/e2e/singbox.spec.ts`.

---

### Task 1: Маршрутизация словаря по дереву документа

Словарь плана 1 (`entities/singbox/docSchema.ts`) — плоский: десять секций, у каждой список полей, и составные ключи внутри секции записаны через точку (`clash_api.external_controller`). Формам этого достаточно: форма знает свою секцию. Подсказкам — нет: они идут по дереву CodeMirror и должны сами понять, в какой секции стоит курсор. Эта задача добавляет недостающий слой — и НЕ трогает сам словарь, который уже покрыт тестами.

**Files:**
- Create: `frontend/src/entities/singbox/docPath.ts`
- Test: `frontend/test/singbox-doc-path.test.ts`

**Interfaces:**
- Consumes: `SingboxSectionName`, `SINGBOX_SECTIONS`, `SingboxField`, `fieldFor` из `entities/singbox/docSchema`.
- Produces:
  - `descendSingbox(section: SingboxSectionName | undefined, key: string, props: Record<string, string>): SingboxSectionName | undefined`
  - `sectionAtPath(path: readonly (string | number)[], typeAt: (path: readonly (string | number)[]) => string | undefined): SingboxSectionName | undefined`
  - `nestedFields(section: SingboxSectionName, head: string): SingboxField[]`
  - `nestedNamespaceDoc(section: SingboxSectionName, head: string): string | undefined`

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-doc-path.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  descendSingbox,
  nestedFields,
  nestedNamespaceDoc,
  sectionAtPath,
} from '../src/entities/singbox/docPath'

/** Тип элемента по пути: тесты подставляют его вручную, в редакторе — читается из документа */
function typeAt(types: Record<string, string>) {
  return (path: readonly (string | number)[]) => types[path.join('.')]
}

describe('маршрутизация словаря sing-box по дереву', () => {
  it('корневые контейнеры ведут в свои секции', () => {
    expect(descendSingbox('root', 'route', {})).toBe('route')
    expect(descendSingbox('root', 'dns', {})).toBe('dns')
    expect(descendSingbox('root', 'inbounds', {})).toBe('inbound')
    expect(descendSingbox('root', 'experimental', {})).toBe('experimental')
  })

  it('элемент outbounds — сервер, а группа выбирается по типу', () => {
    // Группа и сервер лежат в одном массиве и отличаются ТОЛЬКО полем type:
    // без него подсказка предлагала бы outbounds группе и url серверу
    expect(descendSingbox('root', 'outbounds', {})).toBe('outbound')
    expect(descendSingbox('root', 'outbounds', { type: 'selector' })).toBe('group')
    expect(descendSingbox('root', 'outbounds', { type: 'urltest' })).toBe('group')
    expect(descendSingbox('root', 'outbounds', { type: 'shadowsocks' })).toBe('outbound')
  })

  it('правила и наборы правил лежат внутри route', () => {
    expect(descendSingbox('route', 'rules', {})).toBe('route-rule')
    expect(descendSingbox('route', 'rule_set', {})).toBe('rule-set')
  })

  it('вложенные правила логического правила — те же правила маршрута', () => {
    // type: logical несёт rules с такими же условиями: своя секция для них была
    // бы копией route-rule, расходящейся с оригиналом на первом же поле
    expect(descendSingbox('route-rule', 'rules', {})).toBe('route-rule')
  })

  it('серверы DNS — своя секция', () => {
    expect(descendSingbox('dns', 'servers', {})).toBe('dns-server')
  })

  it('незнакомый ключ секции не даёт секции', () => {
    expect(descendSingbox('root', 'brand_new_section', {})).toBeUndefined()
    expect(descendSingbox(undefined, 'route', {})).toBeUndefined()
  })

  it('путь целиком разрешается в секцию', () => {
    const types = typeAt({ 'outbounds.1': 'selector' })
    expect(sectionAtPath([], types)).toBe('root')
    expect(sectionAtPath(['route'], types)).toBe('route')
    expect(sectionAtPath(['route', 'rules', 0], types)).toBe('route-rule')
    expect(sectionAtPath(['route', 'rules', 0, 'rules', 2], types)).toBe('route-rule')
    expect(sectionAtPath(['outbounds', 0], types)).toBe('outbound')
    expect(sectionAtPath(['outbounds', 1], types)).toBe('group')
    expect(sectionAtPath(['dns', 'servers', 0], types)).toBe('dns-server')
  })

  it('путь, уходящий в незнакомое, секции не имеет', () => {
    // Молчание лучше догадки: подсказка по чужой секции читается как знание
    expect(sectionAtPath(['route', 'rules', 0, 'whatever'], typeAt({}))).toBeUndefined()
  })

  it('вложенное отображение отдаёт свои листья и общее описание', () => {
    const fields = nestedFields('experimental', 'clash_api')
    expect(fields.length).toBeGreaterThan(0)
    // Ключи листьев — КОРОТКИЕ: внутри отображения пишут external_controller,
    // а не clash_api.external_controller
    expect(fields.every((f) => !f.key.includes('.'))).toBe(true)
    expect(nestedNamespaceDoc('experimental', 'clash_api')).toMatch(/clash_api/)
    expect(nestedNamespaceDoc('experimental', 'no_such_key')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: из каталога `frontend` — `npx vitest run test/singbox-doc-path.test.ts`
Expected: FAIL — модуля `docPath` не существует.

- [ ] **Step 3: Реализовать маршрутизацию**

Создать `frontend/src/entities/singbox/docPath.ts`:

```ts
// Где в словаре искать ключ, стоящий вот в этом месте документа.
//
// Словарь (`docSchema.ts`) плоский: десять секций, у каждой список ключей.
// Формам этого хватает — форма знает свою секцию. Подсказкам не хватает: они
// идут по дереву текста и обязаны сами понять, куда попал курсор. Отсюда этот
// слой — и он ОТДЕЛЬНЫЙ файл, а не поле в словаре: словарь описывает ключи, а
// здесь описан документ, и смешивать два описания значит менять оба ради одного.
//
// Приём взят у Xray (`entities/xray/docSchema.ts`, функция `descend`): спуск на
// один шаг, где следующая секция зависит не только от ключа, но и от уже
// прочитанных скаляров текущего объекта.

import { SINGBOX_SECTIONS, type SingboxField, type SingboxSectionName } from './docSchema'

/** Типы выходов, у которых своя секция словаря: список участников вместо адреса сервера */
const GROUP_TYPES = new Set(['selector', 'urltest'])

/**
 * Спуск на один шаг: из секции по ключу в следующую секцию.
 *
 * `props` — скаляры ТЕКУЩЕГО объекта, уже прочитанные из документа. Нужны ровно
 * одному переходу, зато принципиально: группа и сервер лежат в одном массиве
 * `outbounds` и отличаются только полем `type`. Без него подсказка предлагала бы
 * серверу `outbounds`, а группе — `server` и `password`.
 */
export function descendSingbox(
  section: SingboxSectionName | undefined,
  key: string,
  props: Record<string, string>,
): SingboxSectionName | undefined {
  if (section === undefined) return undefined
  if (section === 'root') {
    if (key === 'inbounds') return 'inbound'
    if (key === 'outbounds' || key === 'endpoints') {
      return GROUP_TYPES.has(props.type ?? '') ? 'group' : 'outbound'
    }
    if (key === 'route') return 'route'
    if (key === 'dns') return 'dns'
    if (key === 'experimental') return 'experimental'
    return undefined
  }
  if (section === 'route') {
    if (key === 'rules') return 'route-rule'
    if (key === 'rule_set') return 'rule-set'
    return undefined
  }
  // Логическое правило несёт вложенные правила с теми же условиями. Своя секция
  // для них была бы копией этой и разошлась бы с оригиналом на первом же поле
  if (section === 'route-rule' && key === 'rules') return 'route-rule'
  if (section === 'dns' && key === 'servers') return 'dns-server'
  if (section === 'dns' && key === 'rules') return 'route-rule'
  return undefined
}

/**
 * Секция для пути целиком. `typeAt` спрашивает у документа поле `type` объекта,
 * лежащего по пути, — читать документ сам этот модуль не умеет и не должен: у
 * подсказок дерево CodeMirror, у резолверов диагностик — разобранная модель, и
 * общий обход был бы третьим разбором того же документа.
 */
export function sectionAtPath(
  path: readonly (string | number)[],
  typeAt: (path: readonly (string | number)[]) => string | undefined,
): SingboxSectionName | undefined {
  let section: SingboxSectionName | undefined = 'root'
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    // Индекс массива секцию не меняет: элемент списка — это тот же вид объекта,
    // что назвал ключ списка. Тип элемента спрашиваем ЗДЕСЬ, на индексе, потому
    // что у каждого элемента он свой
    if (typeof step === 'number') continue
    const at = path.slice(0, i + 2)
    const props = typeof path[i + 1] === 'number' ? { type: typeAt(at) ?? '' } : {}
    section = descendSingbox(section, step, props)
    if (section === undefined) return undefined
  }
  return section
}

/**
 * Листья вложенного отображения с КОРОТКИМИ ключами: внутри `clash_api` пишут
 * `external_controller`, а не `clash_api.external_controller`.
 */
export function nestedFields(section: SingboxSectionName, head: string): SingboxField[] {
  const prefix = `${head}.`
  return SINGBOX_SECTIONS[section]
    .filter((field) => field.key.startsWith(prefix))
    .map((field) => ({ ...field, key: field.key.slice(prefix.length) }))
}

/**
 * Описание самого вложенного отображения — ОДНИМ текстом на обоих потребителей,
 * подсказку при наборе и наведение на уже написанный ключ. Ровно та же ошибка,
 * что чинилась у Mihomo: пока текст жил внутри подсказок, редактор описывал ключ,
 * пока его печатают, и молчал, стоило его дописать.
 */
export function nestedNamespaceDoc(
  section: SingboxSectionName,
  head: string,
): string | undefined {
  const leaves = nestedFields(section, head)
  if (leaves.length === 0) return undefined
  return `Вложенное отображение: ${leaves.map((f) => f.key).join(', ')}`
}
```

- [ ] **Step 4: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-doc-path.test.ts` (из `frontend`) и `npm run typecheck -w frontend`
Expected: PASS.

Если тест про `nestedFields`/`nestedNamespaceDoc` красный из-за того, что в словаре нет ни одного составного ключа с головой `clash_api`, — НЕ подгонять тест под словарь молча: посмотреть `SINGBOX_SECTIONS.experimental`, взять оттуда реально существующий составной ключ и назвать замену в отчёте. Составные ключи в словаре есть по построению (тип `SingboxField.key` описан как «Ключ или путь через точку внутри секции»), но какая именно голова там лежит — факт словаря, а не этого плана.

- [ ] **Step 5: Мутационная проверка**

1. В `descendSingbox` убрать разбор `props.type` (всегда возвращать `'outbound'`) — краснеет тест про группу по типу. Вернуть.
2. В `sectionAtPath` убрать `continue` на числовом шаге — краснеет тест про путь целиком (`['outbounds', 0]`). Вернуть.
3. В `descendSingbox` убрать ветку `section === 'route-rule' && key === 'rules'` — краснеет тест про вложенные правила. Вернуть.
4. В `nestedFields` убрать `.slice(prefix.length)` — краснеет тест про короткие ключи листьев. Вернуть.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/singbox/docPath.ts frontend/test/singbox-doc-path.test.ts
git commit -m "feat(frontend): route the sing-box dictionary by document path"
```

---

### Task 2: Граф — узлы и построение

**Files:**
- Create: `frontend/src/entities/graph/singbox/types.ts`, `frontend/src/entities/graph/singbox/buildGraph.ts`
- Test: `frontend/test/singbox-graph.test.ts`

**Interfaces:**
- Consumes: `SingboxDoc`, `SingboxOutbound` (`entities/singbox/types`); `outboundsOf`, `groupsOf`, `panelFillsGroup`, `defaultRoute`, `PROXY_OUTBOUND_TYPES`, `GROUP_OUTBOUND_TYPES` (`entities/singbox/outbounds`); `rulesOf`, `ruleAction`, `ruleTarget`, `conditionKeysOf`, `NON_TERMINAL_ACTIONS` (`entities/singbox/rules`); `IssueCount` (`entities/graph/types`).
- Produces:
  - `SINGBOX_COLUMN_W = 430`, `SINGBOX_ROW_H = 130`
  - типы данных узлов: `SingboxInboundNodeData`, `SingboxRuleNodeData`, `SingboxGroupNodeData`, `SingboxOutNodeData`, `SingboxHostsNodeData`, `SingboxBuiltinNodeData`
  - `TERMINAL_BUILTINS: ReadonlySet<string>` — `reject`, `hijack-dns`, `bypass`
  - `groupDepths(doc: SingboxDoc): Map<string, number>`
  - `buildSingboxGraph(doc: SingboxDoc): { nodes: Node[]; edges: Edge[] }`
  - `layoutSingbox(nodes: Node[]): Node[]`

Схема id узлов — она же контракт для задач 3, 5, 6, 7: `inbound:<tag>`, `rule:<index>`, `group:<tag>`, `out:<tag>`, `hosts:panel`, `builtin:<action>`.

Схема id рёбер: `e:sbin:<tag>-><node>`, `e:sbrule:<index>-><node>`, `e:sbgroup:<tag>-><node>`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDoc } from '../src/entities/singbox/types'
import { buildSingboxGraph, groupDepths, layoutSingbox } from '../src/entities/graph/singbox/buildGraph'
import { singboxFixture } from './helpers'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

function fixtureDoc(name: 'default' | 'bundle' | 'legacy'): SingboxDoc {
  return parseSingbox(singboxFixture(name)).doc!
}

function ids(d: SingboxDoc): string[] {
  return buildSingboxGraph(d).nodes.map((n) => n.id)
}

describe('граф sing-box', () => {
  it('настоящие шаблоны каталога строятся и дают узлы всех колонок', () => {
    const graph = buildSingboxGraph(fixtureDoc('bundle'))
    const kinds = new Set(graph.nodes.map((n) => (n.data as { kind: string }).kind))
    expect(kinds.has('singbox-inbound')).toBe(true)
    expect(kinds.has('singbox-rule')).toBe(true)
    expect(kinds.has('singbox-group')).toBe(true)
    expect(kinds.has('singbox-out')).toBe(true)
  })

  it('узел подстановки появляется, только когда панели есть куда класть серверы', () => {
    expect(ids(fixtureDoc('default'))).toContain('hosts:panel')
    const pinned = doc(`{"outbounds":[
      {"type":"selector","tag":"g","outbounds":["direct"],"remnawave":{"includeProxies":false}},
      {"type":"direct","tag":"direct"}
    ]}`)
    // Все группы закреплены — панель не подставит ничего, и узла подстановки нет:
    // пустой узел «сюда придут серверы» соврал бы про этот документ
    expect(ids(pinned)).not.toContain('hosts:panel')
  })

  it('из заполняемой панелью группы ребро идёт в подстановку, из закреплённой — по её списку', () => {
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"free","outbounds":null},
      {"type":"selector","tag":"pinned","outbounds":["direct"],"remnawave":{"includeProxies":false}},
      {"type":"direct","tag":"direct"}
    ]}`)
    const edges = buildSingboxGraph(d).edges.map((e) => e.id)
    expect(edges).toContain('e:sbgroup:free->hosts:panel')
    expect(edges).toContain('e:sbgroup:pinned->out:direct')
    expect(edges).not.toContain('e:sbgroup:pinned->hosts:panel')
  })

  it('ребро «вход → правило» рисуется только по ссылке правила на вход', () => {
    const d = doc(`{"inbounds":[{"type":"tun","tag":"tun-in"},{"type":"mixed","tag":"mix"}],
      "outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[{"inbound":["tun-in"],"outbound":"direct"},{"domain":"a.com","outbound":"direct"}]}}`)
    const edges = buildSingboxGraph(d).edges.map((e) => e.id)
    expect(edges).toContain('e:sbin:tun-in->rule:0')
    // Второе правило входа не называет: связь «просто так» изобразила бы поток,
    // которого у sing-box нет — вход не привязан к маршруту
    expect(edges.some((e) => e.endsWith('->rule:1'))).toBe(false)
    expect(edges.some((e) => e.startsWith('e:sbin:mix'))).toBe(false)
  })

  it('нетерминальное действие рёбер не даёт, а reject ведёт во встроенный узел', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[{"action":"sniff"},{"domain":"a.com","action":"reject"}]}}`)
    const graph = buildSingboxGraph(d)
    expect(graph.edges.some((e) => e.id.startsWith('e:sbrule:0'))).toBe(false)
    expect(graph.nodes.map((n) => n.id)).toContain('builtin:reject')
    expect(graph.edges.map((e) => e.id)).toContain('e:sbrule:1->builtin:reject')
  })

  it('встроенный узел заводится только под то действие, которое в документе есть', () => {
    const d = doc(`{"outbounds":[{"type":"direct","tag":"direct"}],
      "route":{"rules":[{"protocol":"dns","action":"hijack-dns"}]}}`)
    const nodes = ids(d)
    expect(nodes).toContain('builtin:hijack-dns')
    expect(nodes).not.toContain('builtin:reject')
    expect(nodes).not.toContain('builtin:bypass')
  })

  it('дефолтный выход помечен на карточке, а не отдельным ребром', () => {
    const byFinal = buildSingboxGraph(
      doc(`{"outbounds":[{"type":"direct","tag":"a"},{"type":"direct","tag":"b"}],"route":{"final":"b"}}`),
    )
    const marked = byFinal.nodes.filter((n) => (n.data as { isDefault?: boolean }).isDefault)
    expect(marked.map((n) => n.id)).toEqual(['out:b'])
    expect(byFinal.edges.some((e) => e.id.includes('final'))).toBe(false)

    // final не задан — дефолт задаёт ПОЗИЦИЯ первого элемента, и это надо
    // показать: глазами такое в документе не видно
    const byPosition = buildSingboxGraph(
      doc('{"outbounds":[{"type":"direct","tag":"a"},{"type":"direct","tag":"b"}]}'),
    )
    expect(byPosition.nodes.filter((n) => (n.data as { isDefault?: boolean }).isDefault).map((n) => n.id))
      .toEqual(['out:a'])
  })

  it('дублирующийся тег не теряет узел, а схлопывается в один', () => {
    // React Flow на дубликате id не падает, а тихо теряет узел с холста
    const d = doc('{"outbounds":[{"type":"direct","tag":"d"},{"type":"direct","tag":"d"}]}')
    const nodes = ids(d)
    expect(nodes.filter((id) => id === 'out:d')).toHaveLength(1)
  })

  it('кольцо ссылок между группами не вешает расчёт глубины', () => {
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"a","outbounds":["b"],"remnawave":{"includeProxies":false}},
      {"type":"selector","tag":"b","outbounds":["a"],"remnawave":{"includeProxies":false}}
    ]}`)
    expect(() => groupDepths(d)).not.toThrow()
    expect(() => buildSingboxGraph(d)).not.toThrow()
  })

  it('раскладка разносит колонки по X', () => {
    const placed = layoutSingbox(buildSingboxGraph(fixtureDoc('bundle')).nodes)
    expect(new Set(placed.map((n) => n.position.x)).size).toBeGreaterThan(2)
  })

  it('порядок внутри колонки — порядок объявления, а не алфавит', () => {
    // Пользователь ищет выход там, где он стоит в его файле
    const d = doc('{"outbounds":[{"type":"direct","tag":"я"},{"type":"direct","tag":"а"}]}')
    const placed = layoutSingbox(buildSingboxGraph(d).nodes)
    const column = placed.filter((n) => n.id.startsWith('out:'))
    expect(column.map((n) => n.id)).toEqual(['out:я', 'out:а'])
    // И разнесены по вертикали, а не сложены друг на друга
    expect(column[0]!.position.y).not.toBe(column[1]!.position.y)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-graph.test.ts`
Expected: FAIL — модуля `buildGraph` не существует.

- [ ] **Step 3: Написать типы данных узлов**

Создать `frontend/src/entities/graph/singbox/types.ts`:

```ts
// Данные узлов графа sing-box. Все интерфейсы расширяют Record<string, unknown> —
// этого требует @xyflow/react от данных узла.

import type { IssueCount } from '../types'

export interface SingboxInboundNodeData extends Record<string, unknown> {
  kind: 'singbox-inbound'
  index: number
  tag: string
  type: string
  /** Порт прослушивания; у tun его нет вовсе */
  port?: number | string
  issueCount?: IssueCount
}

export interface SingboxRuleNodeData extends Record<string, unknown> {
  kind: 'singbox-rule'
  index: number
  /** Действие правила; у правила без него — 'route', так его понимает и ядро */
  action: string
  /** Условия правила короткими строками: их читает человек на карточке */
  summary: string[]
  /** Имена наборов правил: набор — свойство правила, а не узел графа */
  ruleSets: string[]
  /**
   * Цель правила — заполняется ВСЕГДА, даже когда она не разрешается ни в один
   * узел и ребро не рисуется. Цель бывает именем сервера, который подставит
   * панель: без поля пользователь видел бы узел правила без единого упоминания
   * того, куда оно ведёт.
   */
  target?: string
  traceState?: 'yes' | 'no' | 'unknown' | 'winner'
  issueCount?: IssueCount
}

export interface SingboxGroupNodeData extends Record<string, unknown> {
  kind: 'singbox-group'
  index: number
  tag: string
  type: string
  /** Сколько имён перечислено в документе вручную */
  listed: number
  /** Заполнит ли список панель: от этого зависит и ребро, и доступность формы */
  panelFills: boolean
  issueCount?: IssueCount
}

export interface SingboxOutNodeData extends Record<string, unknown> {
  kind: 'singbox-out'
  index: number
  tag: string
  type: string
  /** Сюда уйдёт трафик, не совпавший ни с одним правилом */
  isDefault: boolean
  /** Добавит ли панель этот выход в списки групп: своё для четвёрки протоколов */
  panelPicks: boolean
  issueCount?: IssueCount
}

export interface SingboxHostsNodeData extends Record<string, unknown> {
  kind: 'singbox-hosts'
  /** Сколько групп получит серверы от панели */
  groups: number
}

export interface SingboxBuiltinNodeData extends Record<string, unknown> {
  kind: 'singbox-builtin'
  action: string
}
```

- [ ] **Step 4: Написать построение графа**

Создать `frontend/src/entities/graph/singbox/buildGraph.ts`:

```ts
// Граф sing-box: входы → правила → группы → выходы.
//
// Полос четыре, но колонок может быть больше: группа ссылается на группу
// (`selector` перечисляет `urltest`, а закреплённая группа — вообще любые), и
// полоса групп разворачивается по глубине ссылок, как у Mihomo. Кольцо ссылок
// глубину не вешает: узел, уже находящийся в обходе, даёт нулевой вклад, а сама
// ошибка приходит диагностикой из validate.ts.
//
// DNS в граф не идёт: это независимый от маршрута механизм, и на одном холсте
// получились бы два разных графа поверх друг друга. DNS живёт в формах,
// диагностиках и подсказках.

import type { Edge, Node } from '@xyflow/react'
import {
  GROUP_OUTBOUND_TYPES,
  PROXY_OUTBOUND_TYPES,
  defaultRoute,
  groupsOf,
  outboundsOf,
  panelFillsGroup,
} from '../../singbox/outbounds'
import { NON_TERMINAL_ACTIONS, conditionKeysOf, ruleAction, ruleTarget, rulesOf } from '../../singbox/rules'
import type { SingboxDoc, SingboxOutbound } from '../../singbox/types'

export const SINGBOX_COLUMN_W = 430
export const SINGBOX_ROW_H = 130

/**
 * Действия, которые ЗАВЕРШАЮТ подбор, но выход не называют. Спека перечисляла
 * только `reject`, и это был бы верный список, если бы остальные два вели себя
 * иначе. Они ведут себя так же: трассировка называет победителем и `hijack-dns`,
 * и `bypass`. Оставить их без узла значило бы нарисовать их как `sniff` —
 * правилом, которое никуда не ведёт, — а они ведут, просто не в outbound.
 */
export const TERMINAL_BUILTINS: ReadonlySet<string> = new Set(['reject', 'hijack-dns', 'bypass'])

function tagOf(outbound: SingboxOutbound): string | undefined {
  return typeof outbound.tag === 'string' && outbound.tag !== '' ? outbound.tag : undefined
}

function listedTags(group: SingboxOutbound): string[] {
  return Array.isArray(group.outbounds)
    ? group.outbounds.filter((t): t is string => typeof t === 'string')
    : []
}

/**
 * Глубина группы = насколько далеко она стоит от выходов. Считается от нуля у
 * группы, не ссылающейся на другие группы. Ссылки берутся только у закреплённых
 * групп и у списков, записанных в документе: у заполняемой панелью группы список
 * всё равно будет затёрт, и строить по нему глубину значило бы раскладывать граф
 * по данным, которых в отданном клиенту конфиге не будет.
 */
export function groupDepths(doc: SingboxDoc): Map<string, number> {
  const groups = new Map<string, SingboxOutbound>()
  for (const group of groupsOf(doc)) {
    const tag = tagOf(group)
    if (tag !== undefined && !groups.has(tag)) groups.set(tag, group)
  }
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const depth = (tag: string): number => {
    const known = depths.get(tag)
    if (known !== undefined) return known
    // Узел уже в обходе — кольцо ссылок (A → B → A). Возвращаем 0, а не
    // рекурсируем дальше: ошибку кольца ловит validateSingbox, граф просто
    // должен нарисоваться без переполнения стека
    if (visiting.has(tag)) return 0
    const group = groups.get(tag)
    if (group === undefined) return 0
    visiting.add(tag)
    let max = 0
    for (const child of listedTags(group)) {
      if (groups.has(child)) max = Math.max(max, depth(child) + 1)
    }
    visiting.delete(tag)
    depths.set(tag, max)
    return max
  }

  for (const tag of groups.keys()) depth(tag)
  return depths
}

/** Короткие подписи условий правила для карточки */
function summaryOf(rule: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of conditionKeysOf(rule)) {
    const raw = rule[key]
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw)
    out.push(value === '' ? key : `${key}: ${value}`)
  }
  return out
}

export function buildSingboxGraph(doc: SingboxDoc): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Единая точка добавления узла на все виды сразу. Документ ВПРАВЕ содержать
  // два выхода с одним тегом (это диагностируемая ошибка, а не повод спрятать
  // граф), а тег группы может совпасть с тегом сервера. React Flow на дубликате
  // id не падает, а тихо теряет узел с холста — поэтому дедупликация одна на
  // все виды, а не заплатка на каждую коллизию. Побеждает первый добавленный.
  const nodeIds = new Set<string>()
  const pushNode = (node: Node) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  // Одно и то же имя встречается в списках дважды (или у нескольких правил одна
  // цель) — без дедупликации id ребра задвоится и React Flow сломается на рендере
  const edgeIds = new Set<string>()
  const pushEdge = (id: string, source: string, target: string) => {
    if (edgeIds.has(id)) return
    edgeIds.add(id)
    edges.push({ id, source, target })
  }

  const outbounds = outboundsOf(doc)
  const fallback = defaultRoute(doc)
  const depths = groupDepths(doc)
  const maxDepth = Math.max(0, ...depths.values())
  // Полосы: входы, правила, затем группы по глубине, затем выходы
  const inboundColumn = 0
  const ruleColumn = 1
  const groupColumn = (tag: string) => 2 + (maxDepth - (depths.get(tag) ?? 0))
  const outColumn = 2 + maxDepth + 1

  const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
  inbounds.forEach((inbound, index) => {
    const tag = tagOf(inbound as SingboxOutbound)
    if (tag === undefined) return
    pushNode({
      id: `inbound:${tag}`,
      type: 'singboxInbound',
      position: { x: inboundColumn * SINGBOX_COLUMN_W, y: 0 },
      data: {
        kind: 'singbox-inbound',
        index,
        tag,
        type: String(inbound.type ?? ''),
        port: inbound.listen_port as number | string | undefined,
      },
    })
  })

  const groupTags = new Set<string>()
  outbounds.forEach((outbound, index) => {
    const tag = tagOf(outbound)
    if (tag === undefined) return
    if (GROUP_OUTBOUND_TYPES.has(outbound.type)) {
      groupTags.add(tag)
      pushNode({
        id: `group:${tag}`,
        type: 'singboxGroup',
        position: { x: groupColumn(tag) * SINGBOX_COLUMN_W, y: 0 },
        data: {
          kind: 'singbox-group',
          index,
          tag,
          type: outbound.type,
          listed: listedTags(outbound).length,
          panelFills: panelFillsGroup(outbound),
        },
      })
      return
    }
    pushNode({
      id: `out:${tag}`,
      type: 'singboxOut',
      position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
      data: {
        kind: 'singbox-out',
        index,
        tag,
        type: outbound.type,
        isDefault: fallback.tag === tag,
        panelPicks: PROXY_OUTBOUND_TYPES.has(outbound.type),
      },
    })
  })

  // Эндпоинты (WireGuard, Tailscale) — такая же адресуемая тегом цель маршрута,
  // как выход, и живут в той же колонке. Формами они не правятся (осознанный
  // YAGNI спеки), но спрятать их с холста значило бы соврать, что маршрут ведёт
  // в никуда
  const endpoints = Array.isArray(doc.endpoints) ? doc.endpoints : []
  endpoints.forEach((endpoint, index) => {
    const tag = tagOf(endpoint as SingboxOutbound)
    if (tag === undefined) return
    pushNode({
      id: `out:${tag}`,
      type: 'singboxOut',
      position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
      data: {
        kind: 'singbox-out',
        index: outbounds.length + index,
        tag,
        type: String((endpoint as { type?: unknown }).type ?? 'endpoint'),
        isDefault: fallback.tag === tag,
        panelPicks: false,
      },
    })
  })

  const filled = groupsOf(doc).filter(panelFillsGroup)
  if (filled.length > 0) {
    pushNode({
      id: 'hosts:panel',
      type: 'singboxHosts',
      position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
      data: { kind: 'singbox-hosts', groups: filled.length },
    })
  }

  for (const group of groupsOf(doc)) {
    const tag = tagOf(group)
    if (tag === undefined) continue
    if (panelFillsGroup(group)) {
      // Список этой группы панель затрёт целиком — рисовать его рёбрами значило
      // бы изображать связи, которых в отданном клиенту конфиге не будет
      pushEdge(`e:sbgroup:${tag}->hosts:panel`, `group:${tag}`, 'hosts:panel')
      continue
    }
    for (const target of listedTags(group)) {
      const id = groupTags.has(target) ? `group:${target}` : `out:${target}`
      if (!nodeIds.has(id)) continue
      pushEdge(`e:sbgroup:${tag}->${id}`, `group:${tag}`, id)
    }
  }

  rulesOf(doc).forEach((rule, index) => {
    const action = ruleAction(rule)
    const target = action === 'route' ? ruleTarget(rule) : undefined
    pushNode({
      id: `rule:${index}`,
      type: 'singboxRule',
      position: { x: ruleColumn * SINGBOX_COLUMN_W, y: index * SINGBOX_ROW_H },
      data: {
        kind: 'singbox-rule',
        index,
        action,
        summary: summaryOf(rule),
        ruleSets: Array.isArray(rule.rule_set)
          ? rule.rule_set.filter((s): s is string => typeof s === 'string')
          : typeof rule.rule_set === 'string'
            ? [rule.rule_set]
            : [],
        target,
      },
    })

    // Вход не привязан к маршруту у sing-box: ребро рисуется ТОЛЬКО когда
    // правило само назвало вход через `inbound`. Связь «просто так» изобразила
    // бы поток, которого нет
    const named = Array.isArray(rule.inbound)
      ? rule.inbound.filter((t): t is string => typeof t === 'string')
      : typeof rule.inbound === 'string'
        ? [rule.inbound]
        : []
    for (const inTag of named) {
      if (!nodeIds.has(`inbound:${inTag}`)) continue
      pushEdge(`e:sbin:${inTag}->rule:${index}`, `inbound:${inTag}`, `rule:${index}`)
    }

    if (NON_TERMINAL_ACTIONS.has(action)) return
    if (TERMINAL_BUILTINS.has(action)) {
      pushNode({
        id: `builtin:${action}`,
        type: 'singboxBuiltin',
        position: { x: outColumn * SINGBOX_COLUMN_W, y: 0 },
        data: { kind: 'singbox-builtin', action },
      })
      pushEdge(`e:sbrule:${index}->builtin:${action}`, `rule:${index}`, `builtin:${action}`)
      return
    }
    if (target === undefined) return
    const id = groupTags.has(target) ? `group:${target}` : `out:${target}`
    if (!nodeIds.has(id)) return
    pushEdge(`e:sbrule:${index}->${id}`, `rule:${index}`, id)
  })

  return { nodes, edges }
}

/**
 * Расстановка по вертикали внутри колонки. Порядок — это порядок появления узла
 * в графе, то есть порядок объявления в документе. Сортировать по имени нельзя:
 * пользователь ищет выход там, где он стоит в его файле.
 */
export function layoutSingbox(nodes: Node[]): Node[] {
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const x = node.position.x
    const row = rows.get(x) ?? 0
    rows.set(x, row + 1)
    return { ...node, position: { x, y: row * SINGBOX_ROW_H } }
  })
}
```

- [ ] **Step 5: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-graph.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (10 тестов).

- [ ] **Step 6: Мутационная проверка**

1. `pushNode`: убрать проверку `nodeIds.has(node.id)` — краснеет тест про дублирующийся тег. Вернуть.
2. Ребро «вход → правило» рисовать для ВСЕХ правил, а не только для назвавших вход, — краснеет тест про `inbound`. Вернуть.
3. В ветке `panelFillsGroup(group)` убрать `continue` и рисовать список рёбрами — краснеет тест про заполняемую группу. Вернуть.
4. `TERMINAL_BUILTINS` сузить до `new Set(['reject'])` — краснеет тест про `hijack-dns`. Вернуть.
5. `isDefault: fallback.tag === tag` заменить на `isDefault: index === 0` — краснеет тест про дефолт по `final`. Вернуть.
6. В `groupDepths` убрать защиту `visiting` — тест про кольцо падает переполнением стека. Вернуть.
7. В `layoutSingbox` отсортировать узлы колонки по `id` — краснеет тест про порядок объявления. Вернуть.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/entities/graph/singbox frontend/test/singbox-graph.test.ts
git commit -m "feat(frontend): build the sing-box routing graph"
```

---

### Task 3: Резолвер диагностик и поиск

**Files:**
- Create: `frontend/src/entities/graph/singbox/locate.ts`, `frontend/src/entities/singbox/search.ts`
- Modify: `frontend/src/entities/graph/search.ts` (только union `SearchHit['kind']`)
- Test: `frontend/test/singbox-locate.test.ts`

**Interfaces:**
- Consumes: схема id узлов из задачи 2; `ValidationIssue`, `PathParts` (`entities/xray`); `IssueCount` (`entities/graph/types`); `firstMatch`, `SearchHit` (`entities/graph/search`); `outboundsOf`, `groupsOf` (`entities/singbox/outbounds`); `rulesOf`, `ruleAction`, `ruleTarget`, `conditionKeysOf` (`entities/singbox/rules`).
- Produces:
  - `singboxNodeIdForPath(parts: PathParts, doc: SingboxDoc): string | null`
  - `singboxIssueCounts(issues: ValidationIssue[], doc: SingboxDoc): Record<string, IssueCount>`
  - `searchSingbox(doc: SingboxDoc, query: string): SearchHit[]`
  - в `SearchHit['kind']` добавляются `'singbox-inbound' | 'singbox-rule' | 'singbox-group' | 'singbox-out'`

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-locate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import { validateSingbox } from '../src/entities/singbox/validate'
import type { SingboxDoc } from '../src/entities/singbox/types'
import { singboxIssueCounts, singboxNodeIdForPath } from '../src/entities/graph/singbox/locate'
import { searchSingbox } from '../src/entities/singbox/search'
import { singboxFixture } from './helpers'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

const SAMPLE = doc(`{
  "inbounds": [{"type":"tun","tag":"tun-in"}],
  "outbounds": [
    {"type":"selector","tag":"выбор","outbounds":null},
    {"type":"direct","tag":"direct"},
    {"type":"shadowsocks","tag":"ss-ru","server":"1.2.3.4","server_port":443}
  ],
  "route": {"rules":[{"domain":"a.com","outbound":"direct"}],"rule_set":[{"tag":"ru"}]}
}`)

describe('путь диагностики sing-box ведёт к узлу', () => {
  it('выход и группа адресуются тегом, а не индексом', () => {
    // Индекс — позиция в массиве, а id узла построен по ТЕГУ: сходить за тегом
    // в документ обязан резолвер, иначе диагностика уводила бы в пустоту
    expect(singboxNodeIdForPath(['outbounds', 1, 'type'], SAMPLE)).toBe('out:direct')
    expect(singboxNodeIdForPath(['outbounds', 0, 'outbounds'], SAMPLE)).toBe('group:выбор')
  })

  it('правило маршрута адресуется индексом', () => {
    expect(singboxNodeIdForPath(['route', 'rules', 0, 'outbound'], SAMPLE)).toBe('rule:0')
  })

  it('вход адресуется тегом', () => {
    expect(singboxNodeIdForPath(['inbounds', 0], SAMPLE)).toBe('inbound:tun-in')
  })

  it('несуществующая позиция узла не имеет', () => {
    expect(singboxNodeIdForPath(['outbounds', 99], SAMPLE)).toBeNull()
    expect(singboxNodeIdForPath(['route', 'rules', 7], SAMPLE)).toBeNull()
  })

  it('диагностика уровня секции узла не имеет', () => {
    // Показать её на первом попавшемся выходе значило бы соврать про место
    expect(singboxNodeIdForPath(['outbounds'], SAMPLE)).toBeNull()
    expect(singboxNodeIdForPath(['route', 'rules'], SAMPLE)).toBeNull()
  })

  it('набор правил и dns узлами не рисуются', () => {
    // rule_set — свойство правила, а не колонка графа; dns — независимый от
    // маршрута механизм и на холст не идёт вовсе (см. спеку)
    expect(singboxNodeIdForPath(['route', 'rule_set', 0], SAMPLE)).toBeNull()
    expect(singboxNodeIdForPath(['dns', 'servers', 0], SAMPLE)).toBeNull()
  })

  it('счётчики раскладываются по узлам и не смешивают уровни', () => {
    const d = doc(`{"outbounds":[
      {"type":"selector","tag":"g","outbounds":[],"remnawave":{"includeProxies":false}}
    ]}`)
    const counts = singboxIssueCounts(validateSingbox(d), d)
    expect(counts['group:g']!.errors).toBeGreaterThan(0)
    expect(counts['group:g']!.warnings).toBe(0)
  })
})

describe('поиск узлов sing-box', () => {
  it('находит выход по тегу и называет, чем совпало', () => {
    const hits = searchSingbox(SAMPLE, 'ss-ru')
    expect(hits.map((h) => h.nodeId)).toContain('out:ss-ru')
    expect(hits.find((h) => h.nodeId === 'out:ss-ru')!.matchedOn).toMatch(/тег/i)
  })

  it('находит правило по условию, а не только по цели', () => {
    const hits = searchSingbox(SAMPLE, 'a.com')
    expect(hits.map((h) => h.nodeId)).toContain('rule:0')
  })

  it('находит группу по тегу и по типу', () => {
    expect(searchSingbox(SAMPLE, 'выбор').map((h) => h.nodeId)).toContain('group:выбор')
    expect(searchSingbox(SAMPLE, 'selector').map((h) => h.nodeId)).toContain('group:выбор')
  })

  it('пустой запрос не находит ничего', () => {
    expect(searchSingbox(SAMPLE, '   ')).toEqual([])
  })

  it('на настоящем шаблоне каталога поиск не падает и что-то находит', () => {
    const bundle = parseSingbox(singboxFixture('bundle')).doc!
    expect(searchSingbox(bundle, 'direct').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-locate.test.ts`
Expected: FAIL — модулей `locate` и `search` не существует.

- [ ] **Step 3: Расширить union видов узла в общем поиске**

В `frontend/src/entities/graph/search.ts` дописать в union `SearchHit['kind']` четыре значения — правка АДДИТИВНАЯ, ни одна существующая ветка не меняется:

```ts
  kind:
    | 'inbound' | 'outbound' | 'rule' | 'squad' | 'dns' | 'balancer' | 'inject'
    | 'mihomo-group' | 'mihomo-rule' | 'mihomo-provider' | 'mihomo-hosts'
    | 'singbox-inbound' | 'singbox-rule' | 'singbox-group' | 'singbox-out'
```

- [ ] **Step 4: Написать резолвер**

Создать `frontend/src/entities/graph/singbox/locate.ts`:

```ts
// Соответствие «путь диагностики → узел графа». Живёт рядом с buildGraph,
// потому что схему id (`inbound:<tag>`, `rule:<index>`, `group:<tag>`,
// `out:<tag>`) задаёт именно он.
//
// Диагностики адресуют выход ПОЗИЦИЕЙ в массиве, а узел графа назван ТЕГОМ:
// перевод между ними — работа этого файла, и делать его где-то ещё значило бы
// завести вторую схему id.

import type { PathParts, ValidationIssue } from '../../xray/config'
import type { IssueCount } from '../types'
import { GROUP_OUTBOUND_TYPES, outboundsOf } from '../../singbox/outbounds'
import { rulesOf } from '../../singbox/rules'
import type { SingboxDoc } from '../../singbox/types'

export function singboxNodeIdForPath(parts: PathParts, doc: SingboxDoc): string | null {
  const [head, second, third, fourth] = parts

  if (head === 'inbounds' && typeof second === 'number') {
    const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
    const tag = inbounds[second]?.tag
    return typeof tag === 'string' && tag !== '' ? `inbound:${tag}` : null
  }

  if (head === 'outbounds' || head === 'endpoints') {
    // Диагностика уровня всей секции узла не имеет: показать её на первом
    // попавшемся выходе значило бы соврать про место проблемы
    if (typeof second !== 'number') return null
    const list = head === 'outbounds' ? outboundsOf(doc) : Array.isArray(doc.endpoints) ? doc.endpoints : []
    const item = list[second]
    if (item === undefined) return null
    const tag = (item as { tag?: unknown }).tag
    if (typeof tag !== 'string' || tag === '') return null
    const type = (item as { type?: unknown }).type
    return typeof type === 'string' && GROUP_OUTBOUND_TYPES.has(type) ? `group:${tag}` : `out:${tag}`
  }

  if (head === 'route' && second === 'rules' && typeof third === 'number') {
    return rulesOf(doc)[third] === undefined ? null : `rule:${third}`
  }

  // Вложенное правило логического правила рисуется той же карточкой, что и само
  // правило: отдельных узлов у вложенных условий на графе нет по устройству
  if (head === 'route' && second === 'rules' && typeof third === 'number' && fourth === 'rules') {
    return rulesOf(doc)[third] === undefined ? null : `rule:${third}`
  }

  // rule_set — свойство правила, а не колонка графа (наборов в живом шаблоне до
  // девяти, колонка из них была бы шумом). dns на холст не идёт вовсе.
  return null
}

export function singboxIssueCounts(
  issues: ValidationIssue[],
  doc: SingboxDoc,
): Record<string, IssueCount> {
  const counts: Record<string, IssueCount> = {}
  for (const issue of issues) {
    const id = singboxNodeIdForPath(issue.parts, doc)
    if (id === null) continue
    const entry = (counts[id] ??= { errors: 0, warnings: 0 })
    if (issue.level === 'error') entry.errors += 1
    else entry.warnings += 1
  }
  return counts
}
```

- [ ] **Step 5: Написать поиск**

Создать `frontend/src/entities/singbox/search.ts`:

```ts
// Поиск узлов графа sing-box по строке. Ищем по тому, что человек видит на
// карточке: тег и тип выхода, тег и тип группы, условия и цель правила.
//
// `firstMatch` берётся из общего модуля, а не пишется своя: результаты всех
// поисков рисует один SearchBox, и «почему нашлось» обязано звучать одинаково.
// У Mihomo здесь была копия, и финальное ревью поймало её разъехавшейся с
// оригиналом дважды — по формату и по поведению.

import { firstMatch, type SearchHit } from '../graph/search'
import { GROUP_OUTBOUND_TYPES, outboundsOf } from './outbounds'
import { conditionKeysOf, ruleAction, ruleTarget, rulesOf } from './rules'
import type { SingboxDoc } from './types'

const LIMIT = 20

export function searchSingbox(doc: SingboxDoc, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < LIMIT) hits.push(hit)
  }

  const inbounds = Array.isArray(doc.inbounds) ? doc.inbounds : []
  for (const inbound of inbounds) {
    const tag = inbound.tag
    if (typeof tag !== 'string' || tag === '') continue
    const matched = firstMatch(needle, [
      { label: 'тег', value: tag },
      { label: 'тип', value: inbound.type },
    ])
    if (matched !== undefined) {
      push({ nodeId: `inbound:${tag}`, kind: 'singbox-inbound', title: tag, matchedOn: matched })
    }
  }

  for (const outbound of outboundsOf(doc)) {
    const tag = outbound.tag
    if (typeof tag !== 'string' || tag === '') continue
    const group = GROUP_OUTBOUND_TYPES.has(outbound.type)
    const matched = firstMatch(needle, [
      { label: 'тег', value: tag },
      { label: 'тип', value: outbound.type },
      { label: 'сервер', value: outbound.server },
      { label: 'участник', value: outbound.outbounds },
    ])
    if (matched === undefined) continue
    push({
      nodeId: group ? `group:${tag}` : `out:${tag}`,
      kind: group ? 'singbox-group' : 'singbox-out',
      title: tag,
      matchedOn: matched,
    })
  }

  rulesOf(doc).forEach((rule, index) => {
    const conditions = conditionKeysOf(rule).map((key) => {
      const raw = rule[key]
      return Array.isArray(raw) ? raw.join(', ') : String(raw)
    })
    const matched = firstMatch(needle, [
      { label: 'условие', value: conditions },
      { label: 'цель', value: ruleTarget(rule) },
      { label: 'действие', value: ruleAction(rule) },
      { label: 'набор', value: rule.rule_set },
    ])
    if (matched === undefined) return
    push({
      nodeId: `rule:${index}`,
      kind: 'singbox-rule',
      title: `Правило #${index + 1}`,
      matchedOn: matched,
    })
  })

  return hits
}
```

- [ ] **Step 6: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-locate.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (12 тестов).

- [ ] **Step 7: Мутационная проверка**

1. В `singboxNodeIdForPath` вернуть `out:${second}` (индекс вместо тега) — краснеет тест про адресацию тегом. Вернуть.
2. Убрать проверку `GROUP_OUTBOUND_TYPES.has(type)` — краснеет тест про группу. Вернуть.
3. Разрешить путь уровня секции (`typeof second !== 'number'` → возвращать `out:0`) — краснеет тест про диагностику секции. Вернуть.
4. В `searchSingbox` убрать поле `условие` из `firstMatch` — краснеет тест про поиск правила по условию. Вернуть.
5. Убрать проверку `needle === ''` — краснеет тест про пустой запрос. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/entities/graph/singbox/locate.ts frontend/src/entities/singbox/search.ts \
        frontend/src/entities/graph/search.ts frontend/test/singbox-locate.test.ts
git commit -m "feat(frontend): resolve sing-box diagnostics and search to graph nodes"
```

---

### Task 4: Адаптер документа и черновик

**Files:**
- Create: `frontend/src/features/editor/singboxAdapter.ts`, `frontend/src/features/editor/useSingboxDraft.ts`
- Modify: `frontend/src/entities/singbox/index.ts` (реэкспорт `search`, `docPath`)
- Test: `frontend/test/singbox-draft.test.tsx`

**Interfaces:**
- Consumes: `DocumentAdapter` (`features/editor/documentAdapter`), `useDocumentDraft`, `DocumentDraft` (`features/editor/useDocumentDraft`), `formatConfig` (`features/editor/useConfigDraft`), задачи 1–3.
- Produces:
  - `singboxAdapter: DocumentAdapter<SingboxDoc>`
  - `SingboxDraft extends DocumentDraft<SingboxDoc>` с полями: `doc: SingboxDoc | undefined`, `json: unknown | undefined`, `changeDoc(next: SingboxDoc): void`, `trace: SingboxTraceResult | undefined`, `checkOpen`/`setCheckOpen`, `importOpen`/`setImportOpen`
  - `useSingboxDraft(options: { docKey: string; panelJson: unknown; baseVersion: string }): SingboxDraft`

`changeDoc` и `json` — центральные для всех последующих задач: формы и мутации графа получают новую модель и отдают её сюда, а страница берёт `json` для сохранения в панель.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-draft.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import { useSingboxDraft } from '../src/features/editor/useSingboxDraft'
import { singboxAdapter } from '../src/features/editor/singboxAdapter'
import { parseSingbox } from '../src/entities/singbox/parse'

const PANEL = {
  outbounds: [
    { type: 'selector', tag: 'выбор', outbounds: null },
    { type: 'direct', tag: 'direct' },
  ],
  route: { rules: [{ domain: 'a.com', outbound: 'direct' }] },
}

beforeEach(() => {
  localStorage.clear()
})

describe('адаптер документа sing-box', () => {
  it('на разбираемом тексте даёт модель и диагностики', () => {
    const res = singboxAdapter.parse(JSON.stringify(PANEL))
    expect(res.model).toBeDefined()
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('на битом JSON модели нет, а объяснение есть', () => {
    // Одна опечатка не должна лишать пользователя объяснения
    const res = singboxAdapter.parse('{ "outbounds": [')
    expect(res.model).toBeUndefined()
    expect(res.issues.length).toBeGreaterThan(0)
  })

  it('счётчики и переход по пути идут через один и тот же резолвер', () => {
    const model = parseSingbox(JSON.stringify(PANEL)).doc!
    expect(singboxAdapter.nodeIdForPath(['outbounds', 1], model)).toBe('out:direct')
    expect(singboxAdapter.issueCounts([], model)).toEqual({})
  })
})

describe('черновик sing-box', () => {
  it('текст черновика — отформатированный документ панели', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u1', panelJson: PANEL, baseVersion: 'h1' }),
    )
    expect(result.current.text).toBe(JSON.stringify(PANEL, null, 2))
    expect(result.current.dirty).toBe(false)
    expect(result.current.doc).toBeDefined()
  })

  it('changeDoc пишет новую модель текстом и заводит запись в историю', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u2', panelJson: PANEL, baseVersion: 'h1' }),
    )
    act(() => {
      result.current.changeDoc({ ...result.current.doc!, route: { rules: [], final: 'direct' } })
    })
    expect(result.current.dirty).toBe(true)
    expect(JSON.parse(result.current.text).route.final).toBe('direct')
    expect(result.current.undoAvailable).toBe(true)
    act(() => result.current.doUndo())
    expect(JSON.parse(result.current.text).route.final).toBeUndefined()
  })

  it('json отдаёт разобранный ТЕКСТ, а не модель схемы', () => {
    // В панель уходит то, что человек видит на вкладке JSON. Печатать обратно
    // модель значило бы отправить не тот документ, который он правил руками
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u3', panelJson: PANEL, baseVersion: 'h1' }),
    )
    act(() => result.current.writeDraft('{"outbounds":[],"unknown_key":7}', { history: false }))
    expect(result.current.json).toEqual({ outbounds: [], unknown_key: 7 })
  })

  it('на неразбираемом тексте json пуст, а не наполовину собран', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u4', panelJson: PANEL, baseVersion: 'h1' }),
    )
    act(() => result.current.writeDraft('{ бред', { history: false }))
    expect(result.current.json).toBeUndefined()
    expect(result.current.hasErrors).toBe(true)
  })

  it('цель трассировки без адреса разбора не даёт', () => {
    const { result } = renderHook(() =>
      useSingboxDraft({ docKey: 'u5', panelJson: PANEL, baseVersion: 'h1' }),
    )
    expect(result.current.trace).toBeUndefined()
    act(() => result.current.setTraceTarget({ address: 'a.com', port: 443, network: 'tcp' }))
    expect(result.current.trace?.winner?.target).toBe('direct')
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-draft.test.tsx`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Написать адаптер**

Создать `frontend/src/features/editor/singboxAdapter.ts`:

```ts
// Адаптер документа для шаблонов sing-box. Ни одной новой строки логики: только
// раскладка уже работающих функций модели по полям интерфейса — как у Xray.

import { parseSingbox, validateSingbox, type SingboxDoc } from '../../entities/singbox'
import { searchSingbox } from '../../entities/singbox/search'
import { singboxIssueCounts, singboxNodeIdForPath } from '../../entities/graph/singbox/locate'
import type { DocumentAdapter } from './documentAdapter'

export const singboxAdapter: DocumentAdapter<SingboxDoc> = {
  parse: (text) => {
    const res = parseSingbox(text)
    // Модель гасим ровно тогда, когда её нет: разбор либо дал документ, либо
    // объяснил, почему не дал. Диагностики возвращаются в обоих случаях
    if (res.doc === undefined) return { model: undefined, issues: res.issues }
    return { model: res.doc, issues: [...res.issues, ...validateSingbox(res.doc)] }
  },
  issueCounts: (issues, doc) => singboxIssueCounts(issues, doc),
  nodeIdForPath: (parts, doc) => singboxNodeIdForPath(parts, doc),
  // Контекст графа у шаблона пуст — сквадов здесь нет
  search: (doc, _ctx, query) => searchSingbox(doc, query),
}
```

- [ ] **Step 4: Написать черновик**

Создать `frontend/src/features/editor/useSingboxDraft.ts`:

```ts
// Черновик шаблона sing-box поверх общего ядра.
//
// Единица правки — НОВАЯ МОДЕЛЬ, а не текстовый сплайс: содержимое шаблона
// панель хранит объектом, форматирование не переживает сохранение в принципе, и
// защищать в тексте нечего — ни якорей, ни комментария-маркера, ради которых
// сплайсы заводились у Mihomo. Печать документа обратно здесь не потеря, а
// нормальный путь правки, тот же, что у Xray.

import { useCallback, useMemo, useState } from 'react'
import type { GraphContext } from '../../entities/graph/types'
import { traceSingbox, type SingboxDoc, type SingboxTraceResult } from '../../entities/singbox'
import { formatConfig } from './useConfigDraft'
import { singboxAdapter } from './singboxAdapter'
import { useDocumentDraft, type DocumentDraft } from './useDocumentDraft'

/** Сквадов у шаблона нет; константа, а не литерал — литерал сбрасывал бы мемоизацию */
const NO_CONTEXT: GraphContext = {}

export interface SingboxDraft extends DocumentDraft<SingboxDoc> {
  doc: SingboxDoc | undefined
  /**
   * Документ, разобранный из ТЕКСТА черновика. Именно он уходит в панель:
   * человек правит текст, и отправлять вместо него результат схемы значило бы
   * отправить не тот документ, который он видел.
   */
  json: unknown | undefined
  changeDoc: (next: SingboxDoc) => void
  trace: SingboxTraceResult | undefined
  checkOpen: boolean
  setCheckOpen: (open: boolean) => void
  importOpen: boolean
  setImportOpen: (open: boolean) => void
}

export interface SingboxDraftOptions {
  docKey: string
  /** Содержимое шаблона панели — объект из templateJson */
  panelJson: unknown
  baseVersion: string
}

export function useSingboxDraft({
  docKey,
  panelJson,
  baseVersion,
}: SingboxDraftOptions): SingboxDraft {
  const panelText = useMemo(() => formatConfig(panelJson), [panelJson])
  const core = useDocumentDraft({
    docKind: 'template',
    docKey,
    panelText,
    baseVersion,
    ctx: NO_CONTEXT,
    adapter: singboxAdapter,
  })

  const [checkOpen, setCheckOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const changeDoc = useCallback(
    (next: SingboxDoc) => {
      core.writeDraft(formatConfig(next), { history: true })
    },
    [core],
  )

  const json = useMemo<unknown | undefined>(() => {
    try {
      return JSON.parse(core.text)
    } catch {
      return undefined
    }
  }, [core.text])

  const trace = useMemo<SingboxTraceResult | undefined>(() => {
    if (core.model === undefined || core.traceTarget === null) return undefined
    return traceSingbox(core.model, core.traceTarget)
  }, [core.model, core.traceTarget])

  return {
    ...core,
    doc: core.model,
    json,
    changeDoc,
    trace,
    checkOpen,
    setCheckOpen,
    importOpen,
    setImportOpen,
  }
}
```

- [ ] **Step 5: Дописать реэкспорты**

В `frontend/src/entities/singbox/index.ts` добавить две строки:

```ts
export * from './docPath'
export * from './search'
```

- [ ] **Step 6: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-draft.test.tsx` и `npm run typecheck -w frontend`
Expected: PASS (8 тестов).

Тест про трассировку зелёный только после задачи 8 (пока `traceSingbox` принимает строку). Порядок задач при этом НЕ меняем: до задачи 8 этот один тест помечается `it.skip` с комментарием «ждёт задачи 8: цель трассировки станет TraceTarget», и задача 8 обязана его включить обратно. Пропуск без причины в коде запрещён — причина пишется рядом.

- [ ] **Step 7: Мутационная проверка**

1. В `singboxAdapter.parse` вернуть `model: res.doc` даже при `res.doc === undefined` — краснеет тест про битый JSON (типчек тоже). Вернуть.
2. В `parse` убрать склейку `validateSingbox` — краснеет тест про счётчики в задаче 3 и тест «на разбираемом тексте» здесь не покраснеет: проверить дополнительно `singboxAdapter.parse` на документе с кольцом групп и убедиться, что диагностика есть. Вернуть.
3. `changeDoc` писать с `{ history: false }` — краснеет тест про undo. Вернуть.
4. `json` считать как `core.model` вместо `JSON.parse(core.text)` — краснеет тест про незнакомый ключ. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/editor/singboxAdapter.ts frontend/src/features/editor/useSingboxDraft.ts \
        frontend/src/entities/singbox/index.ts frontend/test/singbox-draft.test.tsx
git commit -m "feat(frontend): sing-box document adapter and draft"
```

---

### Task 5: Мутации графа и структуры документа

**Files:**
- Create: `frontend/src/entities/graph/singbox/mutations.ts`
- Test: `frontend/test/singbox-mutations.test.ts`

**Interfaces:**
- Consumes: схема id узлов и рёбер из задачи 2; `panelFillsGroup`, `groupsOf`, `outboundsOf`, `GROUP_OUTBOUND_TYPES` (`entities/singbox/outbounds`); `rulesOf`, `ruleAction` (`entities/singbox/rules`).
- Produces:
  - `isValidSingboxConnection(source: string, target: string): boolean`
  - `SingboxRefusal = 'invalid-pair' | 'already-connected' | 'panel-fills-group' | 'panel-hosts-edge' | 'rule-target-required' | 'not-found'`
  - `singboxRefusalText(refusal: SingboxRefusal): string`
  - `SingboxEditResult = { doc?: SingboxDoc; refusal?: SingboxRefusal }`
  - `connectSingbox(doc, source, target): SingboxEditResult`
  - `disconnectSingbox(doc, edgeId): SingboxEditResult`
  - `addRule(doc, rule: SingboxRule, at?: number): SingboxDoc`
  - `removeAt(doc, nodeId): SingboxEditResult`
  - `moveRule(doc, index, dir: -1 | 1): SingboxEditResult`
  - `outboundByTag(doc, tag): SingboxOutbound | undefined`
  - `withOutboundAt(doc, tag, next: SingboxOutbound): SingboxDoc` — замена элемента `outbounds` целиком: форма отдаёт новый элемент, а документ собирает инспектор

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-mutations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDoc } from '../src/entities/singbox/types'
import {
  addRule,
  connectSingbox,
  disconnectSingbox,
  isValidSingboxConnection,
  moveRule,
  removeAt,
  singboxRefusalText,
  withOutboundAt,
} from '../src/entities/graph/singbox/mutations'

function doc(json: string): SingboxDoc {
  return parseSingbox(json).doc!
}

const BASE = doc(`{
  "outbounds": [
    {"type":"selector","tag":"free","outbounds":null},
    {"type":"selector","tag":"pinned","outbounds":["direct"],"remnawave":{"includeProxies":false}},
    {"type":"direct","tag":"direct"},
    {"type":"shadowsocks","tag":"ss","server":"1.2.3.4","server_port":443}
  ],
  "route": {"rules":[{"domain":"a.com","outbound":"direct"},{"action":"sniff"}]}
}`)

describe('допустимость коммутации sing-box', () => {
  it('правило и группа тянутся в группу и в выход', () => {
    expect(isValidSingboxConnection('rule:0', 'out:direct')).toBe(true)
    expect(isValidSingboxConnection('rule:0', 'group:free')).toBe(true)
    expect(isValidSingboxConnection('group:pinned', 'out:ss')).toBe(true)
  })

  it('в правило и во вход кабель не входит, из подстановки не выходит', () => {
    expect(isValidSingboxConnection('out:direct', 'rule:0')).toBe(false)
    expect(isValidSingboxConnection('rule:0', 'inbound:tun-in')).toBe(false)
    expect(isValidSingboxConnection('hosts:panel', 'out:direct')).toBe(false)
    expect(isValidSingboxConnection('rule:0', 'hosts:panel')).toBe(false)
  })
})

describe('коммутация sing-box', () => {
  it('правило меняет цель, а не копит их', () => {
    const res = connectSingbox(BASE, 'rule:0', 'group:free')
    expect(res.refusal).toBeUndefined()
    expect(res.doc!.route!.rules![0]!.outbound).toBe('free')
  })

  it('повторное соединение — отказ с причиной, а не пустая правка', () => {
    const res = connectSingbox(BASE, 'rule:0', 'out:direct')
    expect(res.doc).toBeUndefined()
    expect(res.refusal).toBe('already-connected')
    expect(singboxRefusalText('already-connected')).toMatch(/уже/i)
  })

  it('в заполняемую панелью группу вручную не дописать', () => {
    // Список затрёт панель: запись в него исчезнет при первой же выдаче
    // подписки, а редактор отчитался бы об успехе
    const res = connectSingbox(BASE, 'group:free', 'out:ss')
    expect(res.doc).toBeUndefined()
    expect(res.refusal).toBe('panel-fills-group')
    expect(singboxRefusalText('panel-fills-group')).toMatch(/includeProxies/)
  })

  it('в закреплённую группу дописать можно', () => {
    const res = connectSingbox(BASE, 'group:pinned', 'out:ss')
    expect(res.refusal).toBeUndefined()
    expect(res.doc!.outbounds![1]!.outbounds).toEqual(['direct', 'ss'])
  })

  it('вход не мутируется', () => {
    const before = JSON.stringify(BASE)
    connectSingbox(BASE, 'group:pinned', 'out:ss')
    expect(JSON.stringify(BASE)).toBe(before)
  })
})

describe('разрыв связи sing-box', () => {
  it('связь закреплённой группы разрывается', () => {
    const res = disconnectSingbox(BASE, 'e:sbgroup:pinned->out:direct')
    expect(res.doc!.outbounds![1]!.outbounds).toEqual([])
  })

  it('у правила связь не разорвать, только сменить', () => {
    // Правило без выхода — не правило: у ядра ему некуда отправлять трафик
    const res = disconnectSingbox(BASE, 'e:sbrule:0->out:direct')
    expect(res.refusal).toBe('rule-target-required')
  })

  it('связь с узлом подстановки создаёт панель, а не документ', () => {
    const res = disconnectSingbox(BASE, 'e:sbgroup:free->hosts:panel')
    expect(res.refusal).toBe('panel-hosts-edge')
    expect(singboxRefusalText('panel-hosts-edge')).toMatch(/панел/i)
  })
})

describe('правки структуры sing-box', () => {
  it('правило добавляется в конец и в указанную позицию', () => {
    const appended = addRule(BASE, { domain: 'b.com', outbound: 'direct' })
    expect(appended.route!.rules).toHaveLength(3)
    expect(appended.route!.rules![2]!.domain).toBe('b.com')
    const inserted = addRule(BASE, { domain: 'c.com', outbound: 'direct' }, 0)
    expect(inserted.route!.rules![0]!.domain).toBe('c.com')
  })

  it('правило переезжает вверх и вниз, а на границе отказывает', () => {
    const down = moveRule(BASE, 0, 1)
    expect(down.doc!.route!.rules![1]!.domain).toBe('a.com')
    expect(moveRule(BASE, 0, -1).refusal).toBe('not-found')
  })

  it('замена элемента переживает переименование тега', () => {
    // Ищем по ПРЕЖНЕМУ тегу: форма вправе его сменить, и поиск по новому не
    // нашёл бы ничего, молча потеряв правку
    const next = withOutboundAt(BASE, 'ss', { type: 'shadowsocks', tag: 'ss-2', server: '1.2.3.4' })
    expect(next.outbounds![3]!.tag).toBe('ss-2')
    expect(next.outbounds).toHaveLength(4)
  })

  it('удаляются и правило, и выход', () => {
    expect(removeAt(BASE, 'rule:1').doc!.route!.rules).toHaveLength(1)
    expect(removeAt(BASE, 'out:ss').doc!.outbounds).toHaveLength(3)
    expect(removeAt(BASE, 'hosts:panel').refusal).toBe('panel-hosts-edge')
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-mutations.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать мутации**

Создать `frontend/src/entities/graph/singbox/mutations.ts`:

```ts
// Коммутация кабелем и правки структуры документа. Каждая операция возвращает
// НОВЫЙ документ либо причину отказа; вход не мутируется никогда — его ещё
// держит React, и правка на месте не вызвала бы перерисовку.
//
// Пустой результат сам по себе ничего не объясняет, а кабель, отскакивающий
// молча, читается как поломка редактора, — поэтому причина обязательна и
// переводится на русский в одном месте.

import { GROUP_OUTBOUND_TYPES, panelFillsGroup } from '../../singbox/outbounds'
import { rulesOf } from '../../singbox/rules'
import type { SingboxDoc, SingboxOutbound, SingboxRule } from '../../singbox/types'

type NodeKind = 'inbound' | 'rule' | 'group' | 'out' | 'hosts' | 'builtin'

function split(id: string): { kind: NodeKind; rest: string } | null {
  const at = id.indexOf(':')
  if (at < 0) return null
  const kind = id.slice(0, at)
  if (
    kind !== 'inbound' && kind !== 'rule' && kind !== 'group' &&
    kind !== 'out' && kind !== 'hosts' && kind !== 'builtin'
  ) {
    return null
  }
  return { kind, rest: id.slice(at + 1) }
}

export function isValidSingboxConnection(source: string, target: string): boolean {
  const from = split(source)
  const to = split(target)
  if (from === null || to === null) return false
  // Узел подстановки закрыт с обеих сторон: его содержимое создаёт панель, и
  // кабелем оно не задаётся — ребро сюда рисует граф по факту заполнения
  if (from.kind === 'hosts' || to.kind === 'hosts') return false
  // Вход не привязан к маршруту у sing-box: связь задаёт правило полем inbound,
  // а не кабель
  if (from.kind === 'inbound' || to.kind === 'inbound') return false
  if (to.kind === 'rule' || to.kind === 'builtin') return false
  return from.kind === 'rule' || from.kind === 'group'
}

export type SingboxRefusal =
  | 'invalid-pair'
  | 'already-connected'
  | 'panel-fills-group'
  | 'panel-hosts-edge'
  | 'rule-target-required'
  | 'not-found'

export function singboxRefusalText(refusal: SingboxRefusal): string {
  switch (refusal) {
    case 'invalid-pair':
      return 'Такие узлы не соединяются.'
    case 'already-connected':
      return 'Связь уже есть — документ от повтора не изменится.'
    case 'panel-fills-group':
      return 'Список этой группы заполняет панель: она затрёт его целиком тегами серверов подписки, и дописанное здесь исчезнет при первой же выдаче. Чтобы править список руками, закрепите его — это ключ remnawave.includeProxies: false в форме группы.'
    case 'panel-hosts-edge':
      return 'Эту связь создаёт панель, а не документ: серверы подписки она подставит в группу сама. Записи под это ребро в документе нет — разрывать нечего.'
    case 'rule-target-required':
      return 'У правила цель обязательна: правило без выхода ядру не конфиг. Связь можно сменить, но не убрать.'
    case 'not-found':
      return 'Узел или связь в документе не найдены.'
  }
}

export interface SingboxEditResult {
  doc?: SingboxDoc
  /** undefined — правка построена; иначе документа нет, и здесь причина */
  refusal?: SingboxRefusal
}

/** Глубокая копия: вход — документ, который ещё держит React */
function clone(doc: SingboxDoc): SingboxDoc {
  return structuredClone(doc) as SingboxDoc
}

function findOutbound(doc: SingboxDoc, tag: string): number {
  const list = Array.isArray(doc.outbounds) ? doc.outbounds : []
  return list.findIndex((o) => o.tag === tag)
}

/** Имя узла-цели по его id: и группа, и выход адресуются одним и тем же тегом */
function targetTag(id: string): string | null {
  const to = split(id)
  return to === null || (to.kind !== 'group' && to.kind !== 'out') ? null : to.rest
}

export function connectSingbox(doc: SingboxDoc, source: string, target: string): SingboxEditResult {
  if (!isValidSingboxConnection(source, target)) return { refusal: 'invalid-pair' }
  const from = split(source)!
  const tag = targetTag(target)
  if (tag === null) return { refusal: 'invalid-pair' }

  if (from.kind === 'rule') {
    const index = Number(from.rest)
    const rules = rulesOf(doc)
    if (!Number.isInteger(index) || rules[index] === undefined) return { refusal: 'not-found' }
    if (rules[index]!.outbound === tag) return { refusal: 'already-connected' }
    const next = clone(doc)
    const rule = next.route!.rules![index]!
    rule.outbound = tag
    // Действие маршрутное: правило с action: reject и полем outbound ядро
    // прочитает как reject, и кабель тянулся бы вхолостую
    delete rule.action
    return { doc: next }
  }

  const at = findOutbound(doc, from.rest)
  if (at < 0) return { refusal: 'not-found' }
  const group = doc.outbounds![at]!
  if (!GROUP_OUTBOUND_TYPES.has(group.type)) return { refusal: 'invalid-pair' }
  if (panelFillsGroup(group)) return { refusal: 'panel-fills-group' }
  const listed = Array.isArray(group.outbounds) ? group.outbounds : []
  if (listed.includes(tag)) return { refusal: 'already-connected' }
  const next = clone(doc)
  next.outbounds![at]!.outbounds = [...listed, tag]
  return { doc: next }
}

const EDGE_RE = /^e:sb(in|rule|group):(.+?)->(.+)$/

export function disconnectSingbox(doc: SingboxDoc, edgeId: string): SingboxEditResult {
  const match = EDGE_RE.exec(edgeId)
  if (match === null) return { refusal: 'not-found' }
  const [, from, owner, target] = match
  if (target === 'hosts:panel') return { refusal: 'panel-hosts-edge' }
  if (from === 'rule') return { refusal: 'rule-target-required' }
  if (from === 'in') return { refusal: 'invalid-pair' }

  const at = findOutbound(doc, owner!)
  if (at < 0) return { refusal: 'not-found' }
  const group = doc.outbounds![at]!
  if (panelFillsGroup(group)) return { refusal: 'panel-fills-group' }
  const tag = targetTag(target!)
  if (tag === null) return { refusal: 'not-found' }
  const listed = Array.isArray(group.outbounds) ? group.outbounds : []
  if (!listed.includes(tag)) return { refusal: 'not-found' }
  const next = clone(doc)
  next.outbounds![at]!.outbounds = listed.filter((t) => t !== tag)
  return { doc: next }
}

/** Новое правило. `at === undefined` — в конец: у sing-box выигрывает ПЕРВОЕ совпавшее */
export function addRule(doc: SingboxDoc, rule: SingboxRule, at?: number): SingboxDoc {
  const next = clone(doc)
  next.route ??= {}
  const rules = Array.isArray(next.route.rules) ? next.route.rules : []
  const index = at === undefined ? rules.length : Math.max(0, Math.min(at, rules.length))
  next.route.rules = [...rules.slice(0, index), rule, ...rules.slice(index)]
  return next
}

export function moveRule(doc: SingboxDoc, index: number, dir: -1 | 1): SingboxEditResult {
  const rules = rulesOf(doc)
  const to = index + dir
  if (rules[index] === undefined || rules[to] === undefined) return { refusal: 'not-found' }
  const next = clone(doc)
  const list = next.route!.rules!
  const moved = list[index]!
  list[index] = list[to]!
  list[to] = moved
  return { doc: next }
}

export function removeAt(doc: SingboxDoc, nodeId: string): SingboxEditResult {
  const node = split(nodeId)
  if (node === null) return { refusal: 'not-found' }
  if (node.kind === 'hosts') return { refusal: 'panel-hosts-edge' }
  if (node.kind === 'builtin') return { refusal: 'invalid-pair' }

  if (node.kind === 'rule') {
    const index = Number(node.rest)
    if (rulesOf(doc)[index] === undefined) return { refusal: 'not-found' }
    const next = clone(doc)
    next.route!.rules = next.route!.rules!.filter((_, i) => i !== index)
    return { doc: next }
  }

  if (node.kind === 'inbound') {
    const list = Array.isArray(doc.inbounds) ? doc.inbounds : []
    const at = list.findIndex((i) => i.tag === node.rest)
    if (at < 0) return { refusal: 'not-found' }
    const next = clone(doc)
    next.inbounds = next.inbounds!.filter((_, i) => i !== at)
    return { doc: next }
  }

  const at = findOutbound(doc, node.rest)
  if (at < 0) return { refusal: 'not-found' }
  const next = clone(doc)
  next.outbounds = next.outbounds!.filter((_, i) => i !== at)
  return { doc: next }
}

/** Тип выхода по тегу — нужен формам и топологии, чтобы не разбирать документ второй раз */
export function outboundByTag(doc: SingboxDoc, tag: string): SingboxOutbound | undefined {
  const at = findOutbound(doc, tag)
  return at < 0 ? undefined : doc.outbounds![at]
}

/**
 * Замена элемента `outbounds` целиком. Форма отдаёт НОВЫЙ элемент, а не патч:
 * так она не обязана знать, где он лежит, а документ собирается ровно в одном
 * месте. Тег для поиска берётся ПРЕЖНИЙ — форма имеет право его переименовать,
 * и искать по новому значило бы не найти ничего.
 */
export function withOutboundAt(doc: SingboxDoc, tag: string, next: SingboxOutbound): SingboxDoc {
  const at = findOutbound(doc, tag)
  if (at < 0) return doc
  const copy = clone(doc)
  copy.outbounds![at] = next
  return copy
}
```

- [ ] **Step 4: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-mutations.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (13 тестов).

- [ ] **Step 5: Мутационная проверка**

1. В `connectSingbox` убрать проверку `panelFillsGroup(group)` — краснеет тест про заполняемую панелью группу. Вернуть.
2. Убрать `delete rule.action` — тест про смену цели останется зелёным; добавить в него правило с `action: 'reject'` и убедиться, что после смены цели действия нет. Вернуть.
3. В `isValidSingboxConnection` разрешить `to.kind === 'rule'` — краснеет тест про «в правило кабель не входит». Вернуть.
4. В `disconnectSingbox` убрать ветку `from === 'rule'` — краснеет тест про правило. Вернуть.
5. В `clone` вернуть сам `doc` без копии — краснеет тест «вход не мутируется». Вернуть.
6. `addRule` при заданном `at` всё равно дописывать в конец — краснеет тест про вставку в позицию. Вернуть.
7. В `withOutboundAt` искать по тегу НОВОГО элемента (`next.tag`) — краснеет тест про переименование выхода. Вернуть.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/entities/graph/singbox/mutations.ts frontend/test/singbox-mutations.test.ts
git commit -m "feat(frontend): sing-box graph mutations refuse instead of corrupting"
```

---

### Task 6: Карточки узлов и топология

**Files:**
- Create: `frontend/src/features/topology/singboxNodes.tsx`, `frontend/src/features/topology/SingboxTopology.tsx`
- Modify: `frontend/src/features/topology/edges.tsx` (только `edgeHues`)
- Test: `frontend/test/singbox-topology.test.tsx`

**Interfaces:**
- Consumes: `GraphCanvas` и его пропсы (`features/topology/GraphCanvas`), `edgeTypes` (`features/topology/edges`), задачи 2 и 5, `SingboxDraft` (задача 4).
- Produces:
  - `singboxNodeTypes: Record<string, ComponentType<NodeProps>>`
  - `SINGBOX_TARGET_KINDS = ['group', 'out'] as const`
  - `singboxColumns(nodes: Node[]): { kind: string; title: string; x: number }[]`
  - `singboxTraceStateOf(result: SingboxTraceResult | undefined, ruleIndex: number): 'yes' | 'no' | 'unknown' | 'winner' | undefined`
  - `nextRule(): SingboxRule` — заготовка нового правила
  - `SingboxTopology({ draft, doc, dockExtra, dockRow })`

Разметка и классы карточек — те же, что у карточек Xray и Mihomo (`fnode`, `fnode-bal`, `fnode-out`, `fnode-inj`, `node-issue`): один патчбей, одна дизайн-система, новых стилей не заводим.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-topology.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { edgeHues } from '../src/features/topology/edges'
import {
  SINGBOX_TARGET_KINDS,
  singboxColumns,
  singboxTraceStateOf,
} from '../src/features/topology/SingboxTopology'
import { buildSingboxGraph, layoutSingbox } from '../src/entities/graph/singbox/buildGraph'
import { parseSingbox } from '../src/entities/singbox/parse'
import { singboxFixture } from './helpers'

const graph = layoutSingbox(buildSingboxGraph(parseSingbox(singboxFixture('bundle')).doc!).nodes)

describe('колонки графа sing-box', () => {
  it('подписаны по виду узла и знают свою координату', () => {
    const columns = singboxColumns(graph)
    expect(columns.length).toBeGreaterThan(1)
    expect(columns.every((c) => typeof c.x === 'number')).toBe(true)
    expect(columns.map((c) => c.title)).toContain('правила')
  })

  it('колонка одного вида может быть не одна', () => {
    // Ключ подписи в GraphCanvas — вид ВМЕСТЕ с координатой, ровно ради этого
    const nodes = [
      { id: 'group:a', position: { x: 0, y: 0 }, data: { kind: 'singbox-group' } },
      { id: 'group:b', position: { x: 430, y: 0 }, data: { kind: 'singbox-group' } },
    ] as never
    expect(singboxColumns(nodes)).toHaveLength(2)
  })
})

describe('цвет кабеля sing-box', () => {
  it('правило и группа — переключатели: сталь на входе, янтарь на выходе', () => {
    expect(edgeHues('e:sbrule:0->out:direct')).toEqual(['var(--cable-steel)', 'var(--ember)'])
    expect(edgeHues('e:sbgroup:g->out:direct')).toEqual(['var(--cable-steel)', 'var(--ember)'])
  })

  it('кабель от входа начинается индиго', () => {
    expect(edgeHues('e:sbin:tun-in->rule:0')[0]).toBe('var(--flux)')
  })

  it('прежние правила Xray не тронуты', () => {
    // Контрольная группа разреза: правка edgeHues обязана быть аддитивной
    expect(edgeHues('e:rule:0->out:x')).toEqual(['var(--cable-steel)', 'var(--ember)'])
    expect(edgeHues('e:squad:1->in:a')).toEqual(['var(--flux)', 'var(--flux)'])
  })
})

describe('вердикт трассировки на карточке', () => {
  const result = {
    verdicts: [
      { index: 0, state: 'no' as const },
      { index: 1, state: 'yes' as const, target: 'direct' },
    ],
    caveats: [],
    winner: { ruleIndex: 1, target: 'direct' },
  }

  it('победитель отделён от обычного совпадения', () => {
    expect(singboxTraceStateOf(result, 1)).toBe('winner')
    expect(singboxTraceStateOf(result, 0)).toBe('no')
  })

  it('правило, до которого проход не дошёл, вердикта не имеет', () => {
    // У него не «нет данных» — его просто не проверяли
    expect(singboxTraceStateOf(result, 5)).toBeUndefined()
    expect(singboxTraceStateOf(undefined, 0)).toBeUndefined()
  })
})

describe('гнёзда коммутации', () => {
  it('каждый вид цели назван в SINGBOX_TARGET_KINDS', () => {
    // Вид отсюда обязан иметь правило подсветки в tokens.css, иначе data-accepts
    // проставится, а цель не подсветится — кабель тянется вслепую
    expect([...SINGBOX_TARGET_KINDS]).toEqual(['group', 'out'])
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-topology.test.tsx`
Expected: FAIL — модуля `SingboxTopology` нет, `edgeHues` не знает префиксов sing-box.

- [ ] **Step 3: Расширить окраску кабелей**

В `frontend/src/features/topology/edges.tsx`, в `edgeHues`, ПЕРЕД финальным `return [STEEL, STEEL]` добавить три строки (правка аддитивная, прежние ветки не трогаются):

```ts
  // Sing-box: та же метафора, что у Xray, — индиго на входе, сталь у правила и
  // у группы (оба переключатели, а не источники), янтарь на выходе
  if (id.startsWith('e:sbin:')) return [FLUX, STEEL]
  if (id.startsWith('e:sbrule:') || id.startsWith('e:sbgroup:')) return [STEEL, EMBER]
```

- [ ] **Step 4: Написать карточки узлов**

Создать `frontend/src/features/topology/singboxNodes.tsx`. Шесть компонентов по числу видов узла; форма каждого — как у `mihomoNodes.tsx`: `frame(kind, selected)` для класса, `IssueBadge` для счётчика проблем, `<Handle>` ровно с той связностью, которую разрешает `isValidSingboxConnection`.

```tsx
// Карточки узлов графа sing-box. Разметка и классы — те же, что у карточек Xray
// и Mihomo: один патчбей, одна дизайн-система, новых стилей не заводим.

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { IssueCount } from '../../entities/graph/types'
import type {
  SingboxBuiltinNodeData,
  SingboxGroupNodeData,
  SingboxHostsNodeData,
  SingboxInboundNodeData,
  SingboxOutNodeData,
  SingboxRuleNodeData,
} from '../../entities/graph/singbox/types'

const TRACE_LABEL: Record<string, string> = {
  yes: 'совпало',
  no: 'не совпало',
  // 'unknown' здесь про САМО правило: его условие проверить нечем. Остановка —
  // следствие такого вердикта, а не его смысл, и подпись говорит о причине
  unknown: 'проверить нечем',
  winner: 'маршрут',
}

function IssueBadge({ count }: { count?: IssueCount }) {
  if (!count) return null
  const total = count.errors + count.warnings
  if (total === 0) return null
  const error = count.errors > 0
  return (
    <span
      className={`node-issue node-issue-${error ? 'error' : 'warn'}`}
      aria-label={
        error ? `проблем: ${total}, из них ошибок: ${count.errors}` : `предупреждений: ${total}`
      }
    >
      {error ? '!' : '?'}
      {total > 1 ? ` ${total}` : ''}
    </span>
  )
}

function frame(kind: string, selected: boolean | undefined): string {
  return [
    'fnode',
    kind === 'group' ? 'fnode-bal' : '',
    kind === 'out' || kind === 'builtin' ? 'fnode-out' : '',
    kind === 'hosts' ? 'fnode-inj' : '',
    selected ? 'fnode-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function SingboxInboundNode({ data, selected }: { data: SingboxInboundNodeData; selected?: boolean }) {
  return (
    <div className={frame('inbound', selected)}>
      <div className="fnode-head">
        <span className="fnode-title">{data.tag}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-sub">
        {data.type}
        {data.port === undefined ? '' : ` · ${data.port}`}
      </div>
      {/* Гнезда-цели у входа нет: в него кабель не входит */}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function SingboxRuleNode({ data, selected }: { data: SingboxRuleNodeData; selected?: boolean }) {
  return (
    <div className={frame('rule', selected)} data-trace={data.traceState}>
      <div className="fnode-head">
        <span className="fnode-title">Правило #{data.index + 1}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-sub">{data.summary.join(' · ') || 'без условий — совпадает со всем'}</div>
      {data.ruleSets.length > 0 && <div className="fnode-sub">наборы: {data.ruleSets.join(', ')}</div>}
      {data.action !== 'route' && <div className="fnode-sub">действие: {data.action}</div>}
      {data.traceState !== undefined && (
        <span className="node-trace">{TRACE_LABEL[data.traceState]}</span>
      )}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function SingboxGroupNode({ data, selected }: { data: SingboxGroupNodeData; selected?: boolean }) {
  return (
    <div className={frame('group', selected)}>
      <div className="fnode-head">
        <span className="fnode-title">{data.tag}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-sub">{data.type}</div>
      <div className="fnode-sub">
        {data.panelFills ? 'список заполнит панель' : `закреплён, имён: ${data.listed}`}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function SingboxOutNode({ data, selected }: { data: SingboxOutNodeData; selected?: boolean }) {
  return (
    <div className={frame('out', selected)}>
      <div className="fnode-head">
        <span className="fnode-title">{data.tag}</span>
        <IssueBadge count={data.issueCount} />
      </div>
      <div className="fnode-sub">{data.type}</div>
      {/* Дефолтный маршрут задаётся либо route.final, либо ПОЗИЦИЕЙ первого
          элемента — второе глазами в документе не видно, и подпись здесь
          единственное место, где это сказано */}
      {data.isDefault && <div className="fnode-sub">по умолчанию</div>}
      {!data.panelPicks && data.type !== 'direct' && (
        <div className="fnode-sub">панель не добавит в группы</div>
      )}
      {/* Гнезда-источника нет: выход — конец маршрута */}
      <Handle type="target" position={Position.Left} />
    </div>
  )
}

function SingboxHostsNode({ data }: { data: SingboxHostsNodeData; selected?: boolean }) {
  return (
    <div className={frame('hosts', false)}>
      <div className="fnode-head">
        <span className="fnode-title">Серверы подписки</span>
      </div>
      <div className="fnode-sub">их подставит панель, групп: {data.groups}</div>
      {/* Оба гнезда закрыты: содержимое узла создаёт панель, кабелем его не
          задают — ребро сюда рисует граф по факту заполнения группы */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

function SingboxBuiltinNode({ data, selected }: { data: SingboxBuiltinNodeData; selected?: boolean }) {
  return (
    <div className={frame('builtin', selected)}>
      <div className="fnode-head">
        <span className="fnode-title">{data.action}</span>
      </div>
      <div className="fnode-sub">исход маршрута, а не выход</div>
      <Handle type="target" position={Position.Left} isConnectable={false} />
    </div>
  )
}

export const singboxNodeTypes = {
  singboxInbound: SingboxInboundNode,
  singboxRule: SingboxRuleNode,
  singboxGroup: SingboxGroupNode,
  singboxOut: SingboxOutNode,
  singboxHosts: SingboxHostsNode,
  singboxBuiltin: SingboxBuiltinNode,
} as unknown as Record<string, React.ComponentType<NodeProps>>
```

- [ ] **Step 5: Написать топологию**

Создать `frontend/src/features/topology/SingboxTopology.tsx` по образцу `MihomoTopology.tsx`. Ключевые части (полностью, а не отсылкой):

```tsx
const COLUMN_TITLE: Record<string, string> = {
  'singbox-inbound': 'входы',
  'singbox-rule': 'правила',
  'singbox-group': 'группы',
}

/**
 * Подписи колонок. Вид узла берём из `data.kind`, а не из `node.type`: это
 * намеренно разные имена (`type: 'singboxGroup'` при `kind: 'singbox-group'`), и
 * по `type` подписи молча обнулились бы — GraphCanvas сверяет колонку с `kind`.
 */
export function singboxColumns(nodes: Node[]): { kind: string; title: string; x: number }[] {
  const seen = new Map<string, { kind: string; title: string; x: number }>()
  for (const node of nodes) {
    const kind = String((node.data as { kind?: unknown }).kind ?? '')
    const key = `${kind}:${node.position.x}`
    if (seen.has(key)) continue
    seen.set(key, { kind, title: COLUMN_TITLE[kind] ?? 'выходы', x: node.position.x })
  }
  return [...seen.values()].sort((a, b) => a.x - b.x)
}

/** Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла */
export const SINGBOX_TARGET_KINDS = ['group', 'out'] as const

/**
 * Состояние правила для бейджа на карточке: победитель отделён от обычного
 * совпадения. Правила, до которых проход не дошёл, вердикта не имеют — и бейджа
 * не получают: у них не «нет данных», их просто не проверяли.
 */
export function singboxTraceStateOf(
  result: SingboxTraceResult | undefined,
  ruleIndex: number,
): 'yes' | 'no' | 'unknown' | 'winner' | undefined {
  if (result === undefined) return undefined
  if (result.winner?.ruleIndex === ruleIndex) return 'winner'
  return result.verdicts.find((v) => v.index === ruleIndex)?.state
}

/** Заготовка нового правила: совпадает со всем и ведёт в прямой выход */
export function nextRule(): SingboxRule {
  return { domain: [], outbound: 'direct' }
}
```

Сам компонент повторяет структуру `MihomoTopology`:
- `useMemo` строит `layoutSingbox(buildSingboxGraph(doc).nodes)` и рёбра;
- второй `useMemo` домешивает в узлы `deletable: false`, сохранённую позицию, `selected`, `issueCount` из `draft.nodeIssues`, и `traceState` только узлам `kind === 'singbox-rule'`;
- `isValidConnection` зовёт `isValidSingboxConnection(conn.source ?? '', conn.target ?? '')`;
- `onConnect` вызывает `apply(connectSingbox(doc, source, target))`, где `apply` пишет `draft.changeDoc(res.doc)` либо ставит `refusal` в состояние;
- `onEdgesDelete` при `deleted.length > 1` показывает диалог «За раз разрывается одна связь» и НЕ применяет ничего — молчаливое частичное выполнение это порча, писатель видит исчезнувшие рёбра и не знает, что применилось;
- `dockActions` — кнопка «+ Правило» (`draft.changeDoc(addRule(doc, nextRule()))`);
- `children` у `GraphCanvas` — два `Dialog`: отказ (текст через `singboxRefusalText`) и множественный разрыв.

В `GraphCanvas` уходит: `docKey={draft.storageKey}`, `nodes`, `edges`, `nodeTypes={singboxNodeTypes}`, `edgeTypes`, `selectedId={draft.selectedNode}`, `onSelect={draft.setSelectedNode}`, `isValidConnection`, `onConnect`, `onEdgesDelete`, `targetKinds={SINGBOX_TARGET_KINDS}`, `columns={singboxColumns(nodes)}`, `focus={draft.focus}`, `hint` (только при пустом графе), `dockActions`, `dockExtra`, `dockRow`.

- [ ] **Step 6: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-topology.test.tsx` и `npm run typecheck -w frontend`
Expected: PASS (8 тестов).

- [ ] **Step 7: Мутационная проверка**

1. В `singboxColumns` сделать ключом только `kind` — краснеет тест про несколько колонок одного вида. Вернуть.
2. В `singboxTraceStateOf` убрать ветку `winner` — краснеет тест про победителя. Вернуть.
3. В `edgeHues` поставить новые ветки ПОСЛЕ `return [STEEL, STEEL]` — краснеют тесты про цвет sing-box. Вернуть.
4. `SINGBOX_TARGET_KINDS` дополнить `'rule'` — краснеет тест про виды целей. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/topology/singboxNodes.tsx frontend/src/features/topology/SingboxTopology.tsx \
        frontend/src/features/topology/edges.tsx frontend/test/singbox-topology.test.tsx
git commit -m "feat(frontend): sing-box topology on the shared canvas"
```

---

### Task 7: Формы инспектора

**Files:**
- Create: `frontend/src/features/inspector/SingboxExtraFields.tsx`, `SingboxOutboundForm.tsx`, `SingboxRuleForm.tsx`, `SingboxInboundForm.tsx`, `SingboxRuleSetForm.tsx`, `SingboxDnsServerForm.tsx`
- Test: `frontend/test/singbox-forms.test.tsx`

**Interfaces:**
- Consumes: примитивы `features/inspector/fields.tsx` (`TextField`, `NumberField`, `SelectField`, `StringListField`, `CheckboxField`, `PortField`) и `collections.tsx` (`KeyValueField`), `CollapsibleSection` из `shared/ui`; словарь `SINGBOX_SECTIONS`/`fieldFor` и `nestedFields` (задача 1).
- Produces: шесть компонентов, у всех одна форма пропсов — `{ value: T; onChange: (next: T) => void; ... }`; правка идёт `structuredClone` + мутация копии + `onChange(next)`, как у `RuleForm` (Xray).

Формы правят МОДЕЛЬ, а не текст: у sing-box нет ни якорей, ни комментария-маркера, ради которых у Mihomo заводились сплайсы. Отсюда и отсутствие механики отказов `lockOf`: причин «форме некуда вписать ключ» здесь не бывает.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-forms.test.tsx`. Проверки (полный код каждой — в шагах ниже, здесь перечень с ассертами):

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxExtraFields } from '../src/features/inspector/SingboxExtraFields'
import { SingboxOutboundForm } from '../src/features/inspector/SingboxOutboundForm'
import { SingboxRuleForm } from '../src/features/inspector/SingboxRuleForm'
import { selectOption } from './helpers'

describe('форма выхода sing-box', () => {
  it('у группы список участников показан на чтение, пока его заполняет панель', () => {
    const onChange = vi.fn()
    render(
      <SingboxOutboundForm
        value={{ type: 'selector', tag: 'g', outbounds: null }}
        knownTags={['direct']}
        onChange={onChange}
      />,
    )
    expect(screen.getByText(/заполн\w+ панел/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Участники')).toBeNull()
  })

  it('кнопка закрепления ставит ключ панели и открывает список', async () => {
    const onChange = vi.fn()
    render(
      <SingboxOutboundForm
        value={{ type: 'selector', tag: 'g', outbounds: null }}
        knownTags={['direct']}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /закрепить/i }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ remnawave: { includeProxies: false } }),
    )
  })

  it('обратная кнопка снимает ключ целиком, а не ставит true', () => {
    // includeProxies: true — не «как было»: осмысленное значение у ключа ровно
    // одно, и оставлять его в документе значит хранить след правки
    const onChange = vi.fn()
    render(
      <SingboxOutboundForm
        value={{ type: 'selector', tag: 'g', outbounds: [], remnawave: { includeProxies: false } }}
        knownTags={['direct']}
        onChange={onChange}
      />,
    )
    screen.getByRole('button', { name: /открепить/i }).click()
    expect(onChange).toHaveBeenCalledWith(expect.not.objectContaining({ remnawave: expect.anything() }))
  })

  it('у сервера показаны адрес и порт, а списка участников нет', () => {
    render(
      <SingboxOutboundForm
        value={{ type: 'shadowsocks', tag: 's', server: '1.2.3.4', server_port: 443 }}
        knownTags={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Сервер')).toHaveValue('1.2.3.4')
    expect(screen.queryByText(/заполн\w+ панел/i)).toBeNull()
  })
})

describe('форма правила sing-box', () => {
  it('правит условие и не теряет незнакомые ключи', () => {
    const onChange = vi.fn()
    render(
      <SingboxRuleForm
        value={{ domain_suffix: ['a.com'], outbound: 'direct', brand_new: 1 }}
        outboundTags={['direct', 'proxy']}
        ruleSetTags={[]}
        onChange={onChange}
      />,
    )
    screen.getByLabelText('Суффикс домена')
    // Схема сквозная: ключ, которого форма не знает, обязан пережить правку
    expect(onChange).not.toHaveBeenCalled()
  })

  it('смена действия на reject убирает поле выхода', async () => {
    const onChange = vi.fn()
    render(
      <SingboxRuleForm
        value={{ domain: ['a.com'], outbound: 'direct' }}
        outboundTags={['direct']}
        ruleSetTags={[]}
        onChange={onChange}
      />,
    )
    await selectOption('Действие', 'reject')
    const next = onChange.mock.calls.at(-1)![0]
    expect(next.action).toBe('reject')
    // Ядро при action: reject поле outbound игнорирует, и держать его в
    // документе значит показывать связь, которой нет
    expect(next.outbound).toBeUndefined()
  })
})

describe('блок «Ещё поля»', () => {
  it('показывает незаполненные ключи секции и не дублирует заполненные', () => {
    render(
      <SingboxExtraFields
        section="route"
        value={{ final: 'direct' }}
        skip={['final', 'rules', 'rule_set']}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('final')).toBeNull()
    expect(screen.getByText(/Ещё поля/)).toBeInTheDocument()
  })

  it('значение, которое форма выразить не может, показано на чтение с причиной', () => {
    render(
      <SingboxExtraFields
        section="route"
        value={{ default_domain_resolver: { server: 'dns-local' } }}
        skip={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/вкладке JSON/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-forms.test.tsx`
Expected: FAIL — компонентов нет.

- [ ] **Step 3: Написать блок «Ещё поля»**

Создать `frontend/src/features/inspector/SingboxExtraFields.tsx`:

```tsx
// Поля секции по словарю: всё, чему не нашлось места в основной форме.
//
// Форма не прячет то, чего не умеет: значение вложенного отображения или списка
// объектов показывается на чтение с названной причиной. Спрятать значило бы
// соврать, что его нет, а вписать наугад — испортить документ.

import { CollapsibleSection, TextInput } from '../../shared/ui'
import { SINGBOX_SECTIONS, type SingboxField, type SingboxSectionName } from '../../entities/singbox'
import { CheckboxField, NumberField, SelectField, StringListField, TextField, Field } from './fields'

const READ_ONLY_NOTE =
  'Значение — вложенная структура; правится на вкладке JSON.'

function isScalarField(field: SingboxField): boolean {
  return field.type === 'string' || field.type === 'number' || field.type === 'boolean' || field.type === 'strings'
}

export function SingboxExtraFields({
  section,
  value,
  skip,
  onChange,
}: {
  section: SingboxSectionName
  value: Record<string, unknown>
  /** Ключи, которые уже показаны основной формой: второй раз их рисовать незачем */
  skip: string[]
  onChange: (next: Record<string, unknown>) => void
}) {
  const skipped = new Set(skip)
  // Составные ключи (`clash_api.external_controller`) в этот список не идут: их
  // показывает форма своего отображения, а здесь они читались бы как ключ с
  // точкой в имени
  const fields = SINGBOX_SECTIONS[section].filter((f) => !skipped.has(f.key) && !f.key.includes('.'))
  const filled = fields.filter((f) => value[f.key] !== undefined)
  const rest = fields.filter((f) => value[f.key] === undefined)

  const patch = (key: string, next: unknown) => {
    const copy = { ...value }
    if (next === undefined || next === '') delete copy[key]
    else copy[key] = next
    onChange(copy)
  }

  const row = (field: SingboxField) => {
    const current = value[field.key]
    if (!isScalarField(field)) {
      return (
        <Field key={field.key} label={field.key} hint={`${field.doc} ${READ_ONLY_NOTE}`}>
          <TextInput readOnly value={JSON.stringify(current ?? null)} />
        </Field>
      )
    }
    if (field.enum) {
      return (
        <SelectField
          key={field.key}
          label={field.key}
          hint={field.doc}
          value={typeof current === 'string' ? current : ''}
          options={[{ value: '', label: '(не задано)' }, ...field.enum.map((e) => ({ value: e.value, label: e.value }))]}
          onChange={(v) => patch(field.key, v === '' ? undefined : v)}
        />
      )
    }
    if (field.type === 'boolean') {
      return (
        <CheckboxField
          key={field.key}
          label={field.key}
          hint={field.doc}
          value={typeof current === 'boolean' ? current : undefined}
          onChange={(v) => patch(field.key, v)}
        />
      )
    }
    if (field.type === 'number') {
      return (
        <NumberField
          key={field.key}
          label={field.key}
          value={typeof current === 'number' ? current : undefined}
          onChange={(v) => patch(field.key, v)}
        />
      )
    }
    if (field.type === 'strings') {
      return (
        <StringListField
          key={field.key}
          label={field.key}
          hint={field.doc}
          value={Array.isArray(current) ? (current as string[]) : undefined}
          onChange={(v) => patch(field.key, v)}
        />
      )
    }
    return (
      <TextField
        key={field.key}
        label={field.key}
        hint={field.doc}
        value={typeof current === 'string' ? current : undefined}
        onChange={(v) => patch(field.key, v)}
      />
    )
  }

  return (
    <>
      {filled.map(row)}
      {rest.length > 0 && (
        <CollapsibleSection title={`Ещё поля (${rest.length})`}>{rest.map(row)}</CollapsibleSection>
      )}
    </>
  )
}
```

- [ ] **Step 4: Написать форму выхода**

Создать `frontend/src/features/inspector/SingboxOutboundForm.tsx`. Форма обслуживает и сервер, и группу: их разводит поле `type`. Ключевая часть — список участников:

```tsx
const panelFills = GROUP_OUTBOUND_TYPES.has(value.type) && value.remnawave?.includeProxies !== false

// Список выходов группы — только на чтение, пока его заполняет панель. Показать
// его редактируемым значило бы предложить правку, которая исчезнет при первой же
// выдаче подписки: панель перезаписывает список ЦЕЛИКОМ.
{panelFills ? (
  <Field label="Участники" hint="Список заполнит панель тегами серверов подписки — целиком, что бы здесь ни стояло.">
    <TextInput readOnly value={(value.outbounds ?? []).join(', ')} />
  </Field>
) : (
  <StringListField label="Участники" value={value.outbounds ?? []} onChange={(v) => patch({ outbounds: v ?? [] })} />
)}

<Button variant="ghost" onClick={() => patch(panelFills
  ? { remnawave: { includeProxies: false }, outbounds: value.outbounds ?? [] }
  // Снимаем ключ целиком, а не ставим true: осмысленное значение у него ровно
  // одно, и `true` осталось бы следом правки в отданном клиенту конфиге
  : { remnawave: undefined })}>
  {panelFills ? 'Закрепить список' : 'Открепить список'}
</Button>
```

Остальные поля основной части формы: `tag` (`TextField`), `type` (`SelectField` по `fieldFor('outbound', 'type')?.enum`), а для сервера — `server` и `server_port`. Ключи протокола (`password`, `method`, `uuid`, `flow` и прочие) основная часть НЕ перечисляет: их набор зависит от протокола, и захардкоженный список разошёлся бы со словарём на первом же добавленном ключе. Они приходят из блока «Ещё поля», который берёт их из словаря:

```tsx
// skip — ровно то, что уже нарисовано выше: второй раз показывать ключ незачем.
// Список назван поимённо, а не собран из JSX: собранный расходился бы с
// разметкой молча, стоило убрать одно поле
const SHOWN_GROUP = ['tag', 'type', 'outbounds', 'remnawave']
const SHOWN_SERVER = ['tag', 'type', 'server', 'server_port']

<SingboxExtraFields
  section={isGroup ? 'group' : 'outbound'}
  value={value}
  skip={isGroup ? SHOWN_GROUP : SHOWN_SERVER}
  onChange={(next) => onChange(next as SingboxOutbound)}
/>
```

- [ ] **Step 5: Написать формы правила, входа, набора и DNS-сервера**

`SingboxRuleForm` — условия (`domain`, `domain_suffix`, `domain_keyword`, `domain_regex`, `ip_cidr`, `port`, `port_range`, `ip_is_private`, `rule_set`, `inbound`, `protocol`, `clash_mode`), затем действие и цель:

```tsx
// Ядро при нетерминальном или не-маршрутном действии поле outbound не читает.
// Держать его в документе значит показывать связь, которой нет, — поэтому смена
// действия его убирает, а не прячет
function setAction(next: string) {
  patch((d) => {
    if (next === 'route') delete d.action
    else {
      d.action = next
      delete d.outbound
    }
  })
}
```

`SingboxInboundForm` — `tag`, `type`, `listen`, `listen_port`, плюс `SingboxExtraFields section="inbound"`.
`SingboxRuleSetForm` — `tag`, `type`, `format`, `url`, `download_detour`, плюс `SingboxExtraFields section="rule-set"`.
`SingboxDnsServerForm` — `tag`, `type`, `server`, `detour`, плюс `SingboxExtraFields section="dns-server"`.

- [ ] **Step 6: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-forms.test.tsx` и `npm run typecheck -w frontend`
Expected: PASS (8 тестов).

- [ ] **Step 7: Мутационная проверка**

1. В `SingboxOutboundForm` показать список редактируемым при `panelFills` — краснеет тест про чтение. Вернуть.
2. Кнопку «Открепить» заменить на `{ remnawave: { includeProxies: true } }` — краснеет тест про снятие ключа. Вернуть.
3. В `setAction` убрать `delete d.outbound` — краснеет тест про reject. Вернуть.
4. В `SingboxExtraFields` показывать не-скалярные поля обычным `TextField` — краснеет тест про чтение с причиной. Вернуть.
5. Убрать фильтр `!f.key.includes('.')` — краснеет тест про незаполненные ключи (в списке появится составной ключ). Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/inspector/Singbox*.tsx frontend/test/singbox-forms.test.tsx
git commit -m "feat(frontend): sing-box inspector forms over the model"
```

---

### Task 8: Инспектор — разводка форм по выбранному узлу

**Files:**
- Create: `frontend/src/features/topology/SingboxInspector.tsx`
- Test: `frontend/test/singbox-inspector.test.tsx`

**Interfaces:**
- Consumes: формы задачи 7, `SingboxDraft` (задача 4), `removeAt`/`moveRule`/`outboundByTag` (задача 5).
- Produces: `SingboxInspector({ draft, doc, nodeId, onClose })`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-inspector.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SingboxInspector } from '../src/features/topology/SingboxInspector'
import { parseSingbox } from '../src/entities/singbox/parse'
import type { SingboxDraft } from '../src/features/editor/useSingboxDraft'

const DOC = parseSingbox(`{
  "inbounds": [{"type":"tun","tag":"tun-in"}],
  "outbounds": [
    {"type":"selector","tag":"g","outbounds":null},
    {"type":"direct","tag":"direct"}
  ],
  "route": {"rules":[{"domain":["a.com"],"outbound":"direct"},{"action":"sniff"}]}
}`).doc!

/** Подставной черновик: инспектору нужны ровно эти поля, и подделывать больше нечего */
function makeDraft(selectedNode: string | null): SingboxDraft {
  return {
    selectedNode,
    changeDoc: vi.fn(),
    setSelectedNode: vi.fn(),
  } as unknown as SingboxDraft
}

describe('инспектор sing-box', () => {
  it('выбирает форму по префиксу id узла', () => {
    const { rerender } = render(
      <SingboxInspector draft={makeDraft('out:direct')} doc={DOC} nodeId="out:direct" />,
    )
    expect(screen.getByLabelText('Тег')).toHaveValue('direct')

    rerender(<SingboxInspector draft={makeDraft('rule:0')} doc={DOC} nodeId="rule:0" />)
    expect(screen.getByLabelText('Действие')).toBeInTheDocument()

    rerender(<SingboxInspector draft={makeDraft('inbound:tun-in')} doc={DOC} nodeId="inbound:tun-in" />)
    expect(screen.getByLabelText('Тег')).toHaveValue('tun-in')
  })

  it('узел подстановки показывает справку, а не форму', () => {
    // Содержимое создаёт панель: полей, которые тут можно править, нет вовсе
    render(<SingboxInspector draft={makeDraft('hosts:panel')} doc={DOC} nodeId="hosts:panel" />)
    expect(screen.getByText(/подставит панель/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Тег')).toBeNull()
  })

  it('кнопки порядка и удаления действуют на ВЫБРАННЫЙ узел, а не на проп', async () => {
    // Разойдись эти два источника — кнопка удалила бы не то, что на экране
    const draft = makeDraft('rule:1')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="rule:0" />)
    await userEvent.click(screen.getByRole('button', { name: /удалить правило/i }))
    const next = (draft.changeDoc as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    // Удалено правило #2 (выбранное), а не #1 из пропа
    expect(next.route.rules).toHaveLength(1)
    expect(next.route.rules[0].domain).toEqual(['a.com'])
  })

  it('удаление узла подстановки отказывает с причиной, а не молчит', async () => {
    const draft = makeDraft('hosts:panel')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="hosts:panel" />)
    expect(screen.queryByRole('button', { name: /удалить/i })).toBeNull()
    expect(draft.changeDoc).not.toHaveBeenCalled()
  })

  it('правка формы уходит одной записью в changeDoc', async () => {
    const draft = makeDraft('out:direct')
    render(<SingboxInspector draft={draft} doc={DOC} nodeId="out:direct" />)
    await userEvent.clear(screen.getByLabelText('Тег'))
    await userEvent.type(screen.getByLabelText('Тег'), 'd2')
    const calls = (draft.changeDoc as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.at(-1)![0].outbounds[1].tag).toBe('d2')
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-inspector.test.tsx`
Expected: FAIL — компонента нет.

- [ ] **Step 3: Реализовать инспектор**

```tsx
type Kind = 'inbound' | 'rule' | 'group' | 'out' | 'hosts' | 'builtin' | 'other'

function kindOf(nodeId: string): Kind {
  const prefix = nodeId.slice(0, nodeId.indexOf(':'))
  return prefix === 'inbound' || prefix === 'rule' || prefix === 'group' ||
    prefix === 'out' || prefix === 'hosts' || prefix === 'builtin'
    ? prefix
    : 'other'
}

// Источник ОДИН — выбранный в черновике узел. Кнопки «Выше»/«Ниже»/«Удалить»
// действуют на выбор, и разойдись эти два источника, кнопка удалила бы не то,
// что на экране. Проп остаётся входом «покажи вот этот узел» и работает, пока
// выбора нет вовсе, — на этом стоят прямые рендеры в тестах.
const shownId = draft.selectedNode ?? nodeId
```

Разводка: `out`/`group` → `SingboxOutboundForm` (значение берётся `outboundByTag(doc, tag)`), `rule` → `SingboxRuleForm`, `inbound` → `SingboxInboundForm`, `hosts` → справочная карточка, `builtin` → статичный текст про исход маршрута, `other` → «Для этого узла формы нет.»

Правка любой формы уходит одной записью: `draft.changeDoc(withOutboundAt(doc, index, next))` — то есть форма отдаёт НОВЫЙ элемент, а инспектор кладёт его в копию документа.

- [ ] **Step 4: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-inspector.test.tsx` и `npm run typecheck -w frontend`
Expected: PASS (5 тестов).

- [ ] **Step 5: Мутационная проверка**

1. `shownId` брать из пропа `nodeId` вместо `draft.selectedNode` — краснеет тест про кнопки. Вернуть.
2. Для `hosts` рендерить форму выхода — краснеет тест про справку. Вернуть.
3. Удаление `hosts:panel` выполнять молча — краснеет тест про отказ. Вернуть.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/topology/SingboxInspector.tsx frontend/test/singbox-inspector.test.tsx
git commit -m "feat(frontend): sing-box inspector dispatches forms by node"
```

---

### Task 9: Трассировка — цель `TraceTarget` и панель разбора

Задача исправляет решение плана 1 и добавляет интерфейс. Обоснование — в разделе «Три решения, расходящиеся со спекой»: цель трассировки в проекте одна на все документы, и своя строка у sing-box была расхождением, из-за которого `port` и `port_range` не проверялись вопреки спеке.

**Files:**
- Modify: `frontend/src/entities/singbox/trace.ts`
- Create: `frontend/src/features/diagnostics/SingboxTracePanel.tsx`
- Test: `frontend/test/singbox-trace.test.ts` (дополняется), `frontend/test/singbox-trace-panel.test.tsx` (создаётся)

**Interfaces:**
- Consumes: `TraceTarget` (`entities/xray/traceMatch`), `SingboxTraceResult` (план 1).
- Produces: `traceSingbox(doc: SingboxDoc, target: TraceTarget): SingboxTraceResult`; `SingboxTracePanel({ result, onClose, onSelectRule })`.

- [ ] **Step 1: Дописать падающие тесты в `frontend/test/singbox-trace.test.ts`**

Все существующие вызовы `traceSingbox(doc, 'a.com')` заменяются на `traceSingbox(doc, { address: 'a.com', port: 443, network: 'tcp' })`. Это НЕ подгонка тестов под код: тип цели меняется намеренно, и старая форма вызова перестаёт компилироваться. Плюс новые проверки:

```ts
it('порт проверяется, а не останавливает проход', () => {
  const d = doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port":[443],"outbound":"d"}]}}')
  expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp' }).winner?.target).toBe('d')
  const miss = traceSingbox(d, { address: 'a.com', port: 80, network: 'tcp' })
  expect(miss.stopped).toBeUndefined()
  expect(miss.verdicts[0]!.state).toBe('no')
})

it('диапазон портов разбирается в обе стороны и с открытым краем', () => {
  const d = doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port_range":["1000:2000"],"outbound":"d"}]}}')
  expect(traceSingbox(d, { address: 'a.com', port: 1500, network: 'tcp' }).winner).toBeDefined()
  expect(traceSingbox(d, { address: 'a.com', port: 80, network: 'tcp' }).verdicts[0]!.state).toBe('no')
})

it('неразбираемый диапазон портов останавливает, а не считается промахом', () => {
  const d = doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"port_range":["хлам"],"outbound":"d"}]}}')
  expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp' }).stopped).toBeDefined()
})

it('транспорт проверяется: пользователь его ввёл, и говорить «неизвестен» было бы враньём', () => {
  const d = doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"network":"udp","outbound":"d"}]}}')
  expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'udp' }).winner?.target).toBe('d')
  expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp' }).verdicts[0]!.state).toBe('no')
})

it('IP назначения из цели отвечает на ip_cidr при доменной цели', () => {
  // Поле заполняет пользователь: сервер домены не резолвит
  const d = doc('{"outbounds":[{"type":"direct","tag":"d"}],"route":{"rules":[{"ip_cidr":["10.0.0.0/8"],"outbound":"d"}]}}')
  expect(traceSingbox(d, { address: 'a.com', port: 443, network: 'tcp', ip: '10.1.2.3' }).winner).toBeDefined()
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-trace.test.ts`
Expected: FAIL — типчек ругается на объект вместо строки, новые проверки красные.

- [ ] **Step 3: Переписать цель трассировки**

В `frontend/src/entities/singbox/trace.ts`:

```ts
import { ipInCidr, isIpAddress, type MatchState, type TraceTarget } from '../xray/traceMatch'

/**
 * Цель трассировки — общий для всех документов `TraceTarget`, а не своя строка.
 * План 1 завёл строку, и с ней `port`/`port_range` вынужденно останавливали
 * проход, хотя спека числит их проверяемыми. Тип цели в проекте один: его
 * заполняет общий `TraceBar`, его читают трассировки Xray и Mihomo, и вторая
 * форма цели рядом с ним была расхождением, а не упрощением.
 */
interface Ctx {
  /** Имя запроса; пусто, если цель задана адресом */
  host: string
  /** Адрес назначения: сама цель, если это IP, либо поле «IP назначения» */
  ip: string | undefined
  port: number
  network: 'tcp' | 'udp'
  sniffs: boolean
}

function contextOf(doc: SingboxDoc, target: TraceTarget): Ctx {
  const address = target.address.trim()
  const targetIsIp = isIpAddress(address)
  return {
    host: targetIsIp ? '' : address,
    // IP берётся из цели, если она сама адрес, иначе из поля, которое заполнил
    // пользователь: домены сервер не резолвит, и выдумывать адрес нельзя
    ip: targetIsIp ? address : target.ip?.trim() || undefined,
    port: target.port,
    network: target.network,
    sniffs: documentSniffs(doc),
  }
}
```

Условия `port`, `port_range`, `network` переезжают из «непроверяемых» в `checkCondition`:

```ts
    case 'port':
      return values(raw).some((p) => Number(p) === ctx.port) ? YES : NO
    case 'port_range': {
      const ranges = values(raw)
      let usable = false
      for (const range of ranges) {
        const parsed = parsePortRange(range)
        if (parsed === null) continue
        usable = true
        if (ctx.port >= parsed.from && ctx.port <= parsed.to) return YES
      }
      if (usable) return NO
      // Неразбираемый диапазон — это не промах: ядро отвергнет такой документ
      // вместе с правилом, и делать вид, что правило не совпало, значит дать
      // уверенный ответ по строке, смысла которой мы не знаем
      return { state: 'unknown', reason: `диапазон портов «${ranges.join(', ')}» не разбирается` }
    }
    case 'network':
      return values(raw).some((n) => n === ctx.network) ? YES : NO
```

и добавляется разбор диапазона:

```ts
/** `1000:2000`, `:2000`, `1000:` — форма ядра (sing-box, route rule port_range) */
function parsePortRange(raw: string): { from: number; to: number } | null {
  const at = raw.indexOf(':')
  if (at < 0) return null
  const from = raw.slice(0, at).trim()
  const to = raw.slice(at + 1).trim()
  const lo = from === '' ? 0 : Number(from)
  const hi = to === '' ? 65535 : Number(to)
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return null
  return { from: lo, to: hi }
}
```

`CHECKABLE_CONDITIONS` в `entities/singbox/rules.ts` дополняется `'network'`, и рядом пишется причина — та, что в шапке плана: оставить его останавливающим значило бы объяснять остановку фразой про неизвестный транспорт, то есть соврать про то, что пользователь только что ввёл.

Из `reasonFor` удаляется запись `network`; записи `port`/`port_range` удаляются вместе с прежней веткой.

- [ ] **Step 4: Написать панель разбора**

Создать `frontend/src/features/diagnostics/SingboxTracePanel.tsx` — сестра `MihomoTracePanel`. Отличие ровно одно и оно существенное: у sing-box `stopped.index` бывает `null` — остановка не на правиле, а до списка (цель не задана) или после него (дефолт из документа не выводится). Это отдельная ветка текста, которой у Mihomo нет.

```tsx
// Разбирать `result` на переменные нельзя: связь победителя с остановкой живёт в
// типе результата (`SingboxTraceOutcome`), и деструктуризация её теряет.
function Verdict({ outcome }: { outcome: SingboxTraceOutcome }) {
  if (outcome.stopped !== undefined) {
    const where =
      outcome.stopped.index === null
        ? 'Разбор не начался'
        : `Проход остановлен на правиле #${outcome.stopped.index + 1}`
    return <span className="field-warning">{`${where}: ${outcome.stopped.reason}`}</span>
  }
  const { winner } = outcome
  return winner.ruleIndex === null ? (
    <span>Ни одно правило не совпало — трафик уходит в «{winner.target}»</span>
  ) : (
    <span>Победило правило #{winner.ruleIndex + 1} → «{winner.target}»</span>
  )
}
```

- [ ] **Step 5: Написать тесты панели**

Создать `frontend/test/singbox-trace-panel.test.tsx`: остановка на правиле, остановка вне списка (`index: null`), дефолтный маршрут, победившее правило, оговорка про незаданный `final`, усечение списка вердиктов. Фикстуры собираются НАСТОЯЩИМ разбором (`traceSingbox` по маленькому документу), а не литералами результата: литерал разрешил бы состояние, которого тип не допускает.

- [ ] **Step 6: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-trace.test.ts test/singbox-trace-panel.test.tsx`, затем `npm run typecheck -w frontend`
Expected: PASS. Включить обратно тест из задачи 4, помеченный `it.skip` («ждёт задачи 9»).

- [ ] **Step 7: Мутационная проверка**

1. `case 'port'` вернуть в непроверяемые — краснеет тест про порт. Вернуть.
2. В `parsePortRange` считать пустой край нулём в обе стороны (`hi = 0`) — краснеет тест про диапазон. Вернуть.
3. Неразбираемый диапазон считать промахом (`return NO`) — краснеет тест про остановку. Вернуть.
4. `case 'network'` вернуть в непроверяемые — краснеет тест про транспорт. Вернуть.
5. В `contextOf` игнорировать `target.ip` — краснеет тест про IP при доменной цели. Вернуть.
6. В `SingboxTracePanel` убрать ветку `index === null` — краснеет тест про остановку вне списка. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/entities/singbox/trace.ts frontend/src/entities/singbox/rules.ts \
        frontend/src/features/diagnostics/SingboxTracePanel.tsx frontend/test/singbox-trace*.test.*
git commit -m "fix(frontend): sing-box trace takes the shared target, not a bare string"
```

---

### Task 10: Подсказки и наведение на вкладке JSON

**Files:**
- Create: `frontend/src/features/editor/singboxIntellisense/{context.ts,complete.ts,hover.ts,index.ts}`, `frontend/src/features/editor/SingboxJsonView.tsx`
- Test: `frontend/test/singbox-intellisense.test.ts`

**Interfaces:**
- Consumes: `ensureSyntaxTree`/`syntaxTree` (`@codemirror/language`), `hoverTooltip` (`@codemirror/view`), `renderHoverTooltip` (`features/editor/hoverTooltipDom`), `locateRange`/`diagnosticsFor` (`features/editor/jsonLocate`), задача 1 (`sectionAtPath`, `nestedFields`, `nestedNamespaceDoc`), словарь плана 1.
- Produces:
  - `singboxPathAt(state: EditorState, pos: number): { path: (string | number)[]; section: SingboxSectionName | undefined; existingKeys: string[] } | null`
  - `singboxCompletionSource(ctx: CompletionContext): CompletionResult | null`
  - `hoverSingboxAt(state: EditorState, pos: number): { key: string; field: SingboxField; from: number; to: number } | null` — чистая, без EditorView и DOM: её и проверяют тесты
  - `singboxHover(): Extension`
  - `singboxIntellisense(): Extension`
  - `SingboxJsonView({ text, onChange, reveal })`

Документ — JSON, поэтому приём тот же, что у Xray, а не у Mihomo: дерево CodeMirror и подъём от курсора к корню. Два бюджета `ensureSyntaxTree` разного назначения сохраняются: **100 мс** на подсказки (считаются на каждое нажатие клавиши) и **5000 мс** на разовый переход по клику (уже живёт в `jsonLocate.ts`, переиспользуется как есть).

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-intellisense.test.ts`. Тесты строят `EditorState` с `json()` и зовут функции напрямую — редактор поднимать не нужно:

```ts
import { json } from '@codemirror/lang-json'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { singboxPathAt } from '../src/features/editor/singboxIntellisense/context'
import { hoverSingboxAt } from '../src/features/editor/singboxIntellisense/hover'

function stateAt(text: string): EditorState {
  return EditorState.create({ doc: text, extensions: [json()] })
}

/** Позиция курсора обозначается символом | и вырезается перед разбором */
function at(marked: string): { state: EditorState; pos: number } {
  const pos = marked.indexOf('|')
  return { state: stateAt(marked.replace('|', '')), pos }
}

describe('контекст подсказок sing-box', () => {
  it('корень документа', () => {
    const { state, pos } = at('{\n  "lo|"\n}')
    expect(singboxPathAt(state, pos)!.section).toBe('root')
  })

  it('элемент outbounds различает группу и сервер по типу', () => {
    const group = at('{"outbounds":[{"type":"selector","ou|"}]}')
    expect(singboxPathAt(group.state, group.pos)!.section).toBe('group')
    const server = at('{"outbounds":[{"type":"shadowsocks","se|"}]}')
    expect(singboxPathAt(server.state, server.pos)!.section).toBe('outbound')
  })

  it('правило маршрута и вложенное правило логического — одна секция', () => {
    const rule = at('{"route":{"rules":[{"do|"}]}}')
    expect(singboxPathAt(rule.state, rule.pos)!.section).toBe('route-rule')
    const nested = at('{"route":{"rules":[{"type":"logical","rules":[{"do|"}]}]}}')
    expect(singboxPathAt(nested.state, nested.pos)!.section).toBe('route-rule')
  })

  it('уже написанные ключи объекта известны — их подсказка не предлагает второй раз', () => {
    const { state, pos } = at('{"route":{"final":"d","ru|"}}')
    expect(singboxPathAt(state, pos)!.existingKeys).toContain('final')
  })

  it('место, которого словарь не описывает, секции не имеет', () => {
    // Молчание там, где сказать нечего: выдуманное описание читается как знание
    const { state, pos } = at('{"unknown_section":{"a|"}}')
    expect(singboxPathAt(state, pos)!.section).toBeUndefined()
  })
})

describe('наведение sing-box', () => {
  it('описывает ключ секции', () => {
    const state = stateAt('{"route":{"final":"direct"}}')
    const found = hoverSingboxAt(state, state.doc.toString().indexOf('final') + 2)
    expect(found!.field.doc).toMatch(/\S/)
  })

  it('описывает и ключ-раздел, за которым стоит не значение', () => {
    // `route` в словаре есть как ключ секции root — молчать на нём незачем
    const state = stateAt('{"route":{"rules":[]}}')
    const found = hoverSingboxAt(state, state.doc.toString().indexOf('route') + 2)
    expect(found!.field.doc).toMatch(/[Мм]аршрут/)
  })

  it('молчит там, где словарь ничего не описывает', () => {
    const state = stateAt('{"outbounds":[{"type":"direct","brand_new":1}]}')
    expect(hoverSingboxAt(state, state.doc.toString().indexOf('brand_new') + 2)).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-intellisense.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Написать контекст**

Создать `frontend/src/features/editor/singboxIntellisense/context.ts`:

```ts
// Где стоит курсор: путь от корня документа и секция словаря для этого места.
//
// Дерево тянем сами, а не берём готовое из состояния: `syntaxTree(state)` отдаёт
// снимок, сделанный при создании LanguageState, а `ensureSyntaxTree` двигает
// parse-контекст, снимок не обновляя. На большом документе начальный тайм-слайс
// до хвоста не доходит — и подсказки в конце файла молча выдавали бы контекст по
// недоразобранному дереву. Ту же грабли обходит jsonLocate.ts, но бюджет там на
// порядок больше: там разовый переход по клику, а здесь работа на каждое
// нажатие клавиши.

const PARSE_BUDGET_MS = 100
```

Функция `singboxPathAt` поднимается от `resolveInner(pos, -1)` до корня, собирая путь: ключ `Property` даёт строковый шаг, индекс в `Array` — числовой. Затем зовёт `sectionAtPath(path, typeAt)` из задачи 1, где `typeAt` читает скаляр `type` у объекта, лежащего по пути. Возвращает ещё и `existingKeys` — имена свойств объекта под курсором.

- [ ] **Step 4: Написать подсказки и наведение**

`complete.ts` — три ветки, как у Xray: значение (по регэкспу `/"([^"]+)"\s*:\s*("?)([^"{}[\],]*)$/` — предлагает `enum` поля), ключ (по `/[{,]\s*("?)([A-Za-z0-9_$-]*)$/` — предлагает поля секции минус `existingKeys`), элемент массива (`/[[,]\s*("?)([^"{}[\],]*)$/`). Ключи без совпадения регэкспа и без явного вызова не показываются (`if (!km && !ctx.explicit) return null`).

`hover.ts` — экспортирует чистую `hoverSingboxAt(state, pos): { key: string; field: SingboxField; from: number; to: number } | null` (её и проверяют тесты — без EditorView и DOM) и обёртку `singboxHover()` поверх `hoverTooltip`, рисующую DOM через ОБЩИЙ `renderHoverTooltip` из `../hoverTooltipDom`: он принимает описание структурным типом (`type`/`doc`/`enum`), и словарь sing-box подходит под него как есть.

`index.ts`:

```ts
export function singboxIntellisense(): Extension {
  return [
    jsonLanguage.data.of({ autocomplete: singboxCompletionSource }),
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    singboxHover(),
  ]
}
```

- [ ] **Step 5: Написать текстовую вкладку**

Создать `frontend/src/features/editor/SingboxJsonView.tsx` — копия структуры `JsonView.tsx` с двумя заменами: линтер зовёт `validateSingbox` поверх `parseSingbox`, а подсказки — `singboxIntellisense()`. Отдельный компонент, а не проп у `JsonView`: тот держит линтер Xray прямо внутри, и параметризация превратила бы его в развилку на каждый вид документа. У Mihomo по той же причине свой `YamlView`.

```tsx
function singboxLinter() {
  return linter((view) => {
    const text = view.state.doc.toString()
    const parsed = parseSingbox(text)
    const issues = parsed.doc === undefined ? parsed.issues : [...parsed.issues, ...validateSingbox(parsed.doc)]
    return diagnosticsFor(view.state, issues)
  })
}
```

- [ ] **Step 6: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-intellisense.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (8 тестов).

- [ ] **Step 7: Мутационная проверка**

1. `PARSE_BUDGET_MS` заменить на `syntaxTree(state)` без `ensureSyntaxTree` — тест на коротком документе останется зелёным; добавить проверку на документе в ~3000 строк (сгенерировать в тесте повтором правил) и убедиться, что она краснеет. Вернуть.
2. В `singboxPathAt` игнорировать `type` при спуске — краснеет тест про группу и сервер. Вернуть.
3. Убрать сбор `existingKeys` — краснеет тест про уже написанные ключи. Вернуть.
4. В `hoverSingboxAt` возвращать описание при `section === undefined` — краснеет тест про молчание. Вернуть.

- [ ] **Step 8: Коммит**

```bash
git add frontend/src/features/editor/singboxIntellisense frontend/src/features/editor/SingboxJsonView.tsx \
        frontend/test/singbox-intellisense.test.ts
git commit -m "feat(frontend): sing-box completions and hover on the JSON tab"
```

---

### Task 11: Диалог проверки ядром

**Files:**
- Create: `frontend/src/features/diagnostics/SingboxCheckDialog.tsx`
- Modify: `frontend/src/shared/api/hooks.ts` (добавляется `useSingboxTest`)
- Test: `frontend/test/singbox-check-dialog.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`shared/api/client`), роут `POST /api/tools/singbox-test` из плана 1 (тело `{ templateJson: unknown }`, ответ `{ available: boolean; ok: boolean; errors: string[] }`).
- Produces: `useSingboxTest()`, `SingboxCheckDialog({ open, text, onClose })`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-check-dialog.test.tsx`:

```tsx
describe('отчёт проверки ядром sing-box', () => {
  it('нет бинаря — сказано, что о шаблоне не сказано ничего', async () => {
    // available: false — это не вердикт о документе, и читаться должно иначе
  })
  it('успех несёт оговорку про подменённые серверы', async () => {})
  it('отказ несёт ТУ ЖЕ оговорку: там она нужнее', async () => {
    // Ядро могло назвать имя или позицию, которых в файле пользователя нет,
    // и без оговорки он пойдёт искать у себя то, чего не писал
  })
  it('при отсутствующем бинаре оговорки нет: ядро не запускалось', async () => {})
  it('неразбираемый черновик объясняется до запроса, а не 400-м с сервера', async () => {
    // Кнопку жмут именно тогда, когда с документом что-то не так
  })
  it('проверка запускается на ОТКРЫТИЕ, а не на монтирование', async () => {
    // Диалог смонтирован вместе со страницей, а проверка запускает процесс на
    // сервере; text меняется на каждое нажатие клавиши — перезапускать на нём
    // проверку нельзя, снимок берётся на момент открытия
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-check-dialog.test.tsx`
Expected: FAIL — компонента и хука нет.

- [ ] **Step 3: Добавить хук**

В `frontend/src/shared/api/hooks.ts` рядом с `useMihomoTest`:

```ts
export interface SingboxTestResult {
  available: boolean
  ok: boolean
  errors: string[]
}

/**
 * Проверка шаблона sing-box ядром. Тело — РАЗОБРАННЫЙ документ, а не текст: у
 * JSON-шаблона содержимое и есть объект, и слать строку значило бы завести
 * второй формат тела там, где панель хранит первый.
 */
export function useSingboxTest() {
  return useMutation({
    mutationFn: (input: { templateJson: unknown }) =>
      apiFetch<SingboxTestResult>('/api/tools/singbox-test', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}
```

- [ ] **Step 4: Написать диалог**

Создать `frontend/src/features/diagnostics/SingboxCheckDialog.tsx` — сестра `MihomoCheckDialog`. Три состояния ответа читаются по-разному (`available: false` / `ok: true` / `ok: false`), четвёртое приходит обычной ошибкой мутации. Отличия от Mihomo:

```tsx
// Источник истины — ТЕКСТ черновика: проверяется то, что видит пользователь.
// Разбираем его здесь, а не отправляем модель схемы: модель — производная, и
// отправить её значило бы проверить не тот документ, который правили руками.
// Разбор может не удаться — и тогда объяснение даём СРАЗУ, не тревожа сервер:
// кнопку жмут именно тогда, когда с документом что-то не так.
useEffect(() => {
  if (!open) return
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    setLocalError(`Черновик не разбирается как JSON: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  setLocalError(null)
  test.mutate({ templateJson: parsed })
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [open])
```

Оговорка — своя, про то, что реально делает `backend/src/singbox/dummyOutbounds.ts`, а не переписанная у Mihomo:

```
Ядро смотрело не ваш документ дословно: в конец списка выходов дописаны
фиктивные серверы (настоящие подставляет панель), их теги подставлены в списки
групп, а ключ remnawave вырезан — ядро строго к незнакомым полям. Поэтому оно
может назвать тег или позицию, которых в вашем шаблоне нет, а успех говорит о
структуре, но не о работоспособности конкретных серверов.
```

- [ ] **Step 5: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-check-dialog.test.tsx` и `npm run typecheck -w frontend`
Expected: PASS (6 тестов).

- [ ] **Step 6: Мутационная проверка**

1. Показывать оговорку только при `ok: true` — краснеет тест про отказ. Вернуть.
2. Показывать оговорку и при `available: false` — краснеет тест про отсутствующий бинарь. Вернуть.
3. Запускать мутацию в `useEffect` без зависимости от `open` (на монтирование) — краснеет тест про открытие. Вернуть.
4. Убрать `try/catch` вокруг `JSON.parse` — краснеет тест про неразбираемый черновик. Вернуть.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/diagnostics/SingboxCheckDialog.tsx frontend/src/shared/api/hooks.ts \
        frontend/test/singbox-check-dialog.test.tsx
git commit -m "feat(frontend): sing-box core check report with its own caveat"
```

---

### Task 12: Страница редактора и маршрутизация по типу

**Files:**
- Create: `frontend/src/features/templates/SingboxEditorPage.tsx`
- Modify: `frontend/src/features/templates/TemplateEditorPage.tsx`, `TemplatesPage.tsx`, `CreateTemplateDialog.tsx`, `frontend/src/shared/api/hooks.ts`
- Test: `frontend/test/singbox-page.test.tsx`

**Interfaces:**
- Consumes: `EditorShell` и его пропсы, `useSingboxDraft` (задача 4), `SingboxTopology` (задача 6), `SingboxInspector` (задача 8), `SingboxTracePanel` (задача 9), `SingboxJsonView` (задача 10), `SingboxCheckDialog` (задача 11), `TraceBar`, `ImportTemplateDialog`, `useSaveTemplate`, `ConflictError`.
- Produces: `SingboxEditorPage({ template, hash })`.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-page.test.tsx`:

```tsx
describe('страница шаблона sing-box', () => {
  it('шаблон SINGBOX открывается в редакторе, а не ведёт в панель', () => {})
  it('текстовая вкладка подписана JSON', () => {
    // docFormat не передаётся вовсе: умолчание 'json' и есть правда о документе
  })
  it('сохранение шлёт templateJson и expectedHash', () => {
    // Содержимое приходит ровно одним полем: YAML-поле на JSON-шаблоне бэкенд
    // отвергает четырёхсотым, и слать оба значило бы спрятать эту защиту
  })
  it('конфликт по хэшу предлагает выбор, а не решает сам', () => {})
  it('сохранение заблокировано, пока в документе есть ошибки', () => {})
  it('в список редактируемых типов добавлен SINGBOX', () => {
    expect([...EDITABLE]).toContain('SINGBOX')
  })
  it('диалог создания предлагает три типа и не сводит третий ко второму', () => {
    // Прежний onChange сводил всё, что не MIHOMO, к XRAY_JSON тернарником — с
    // третьим типом это молча ломается
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-page.test.tsx`
Expected: FAIL — страницы нет, `EDITABLE` без `SINGBOX`.

- [ ] **Step 3: Написать страницу**

Создать `frontend/src/features/templates/SingboxEditorPage.tsx`. Раскодирование содержимого здесь НЕ нужно (в отличие от Mihomo): у JSON-типа содержимое лежит объектом в `templateJson`, `atob` не участвует и белого экрана не будет.

```tsx
/** Пустое содержимое — константа, а не литерал в пропе: литерал был бы новым по
 *  ссылке на каждый рендер и сбрасывал мемоизацию форматирования */
const EMPTY_SINGBOX: Record<string, never> = {}

export function SingboxEditorPage({ template, hash }: { template: TemplateOfType<'SINGBOX'>; hash: string }) {
  const draft = useSingboxDraft({
    docKey: template.uuid,
    panelJson: isDictionary(template.templateJson) ? template.templateJson : EMPTY_SINGBOX,
    baseVersion: hash,
  })
  ...
  function doSave(expectedHash: string) {
    // В панель уходит РАЗОБРАННЫЙ текст черновика: человек правит текст, и
    // отправлять вместо него результат схемы значило бы отправить не тот
    // документ, который он видел
    save.mutate({ templateJson: draft.json, expectedHash }, { ... })
  }
```

Блокировка сохранения — по `draft.hasErrors`, как у Xray, и это НЕ копия чужого решения:

```tsx
// У Mihomo сохранение блокирует только синтаксис: там почти все диагностики —
// предупреждения об именах, которых редактор знать не может. Здесь наоборот: все
// ошибки sing-box (кольцо групп, дубль тега, отсутствующий rule_set, ссылка в
// пустоту у документа без серверов от панели) — дефекты, которые панель не
// починит, и сохранять их значит отдать клиенту заведомо сломанную подписку.
const blocked = draft.hasErrors
```

В `EditorShell` уходит: `draft`, `kind="templates"`, `back`, `title={template.name}`, `subtitle="шаблон SINGBOX"`, `tabs={{ graph: 'Топология' }}`, `validLabel="Документ разбирается, замечаний нет"` (обязателен без умолчания: «Конфиг валиден» здесь соврало бы — документ это клиентская подписка, а не конфиг ядра ноды), `canvas={<SingboxTopology ... dockRow={<TraceBar value={draft.traceTarget} onChange={draft.setTraceTarget} />} />}`, `textView={<SingboxJsonView ... />}`, плюс `children` с диалогами: `SingboxCheckDialog`, `ImportTemplateDialog docType="SINGBOX"`, конфликт версий.

`docFormat` НЕ передаётся: умолчание `'json'` и есть правда о формате, а явный проп был бы вторым её объявлением.

`TraceBar` идёт БЕЗ `showProcess`: правил по процессу sing-box не проверяет (`process_*` в останавливающих), и поле было бы приглашением заполнить то, на что ни одно правило не посмотрит.

- [ ] **Step 4: Дописать маршрутизацию и списки**

**Про долг из спеки.** Спека числит за этим файлом хардкод `docType="XRAY_JSON"` («долг плана 2 Mihomo»). Сверка с кодом показывает, что как значение пропа он уже устранён: `ImportTemplateDialog` получает `docType={template.templateType}`. Осталось единственное вхождение литерала — в ТИПЕ сборки Xray (`template: TemplateOfType<'XRAY_JSON'>`), и это не долг, а ровно тот приём сужения, ради которого заведён `isTemplateOfType`. Долг закрыт; проверить это первым делом и НЕ «чинить» типизацию, приняв её за хардкод.

В `TemplateEditorPage.tsx` — третья ветка ПЕРЕД тупиком, тем же предикатом:

```tsx
if (isTemplateOfType(template, 'SINGBOX')) {
  return <SingboxEditorPage key={template.uuid} template={template} hash={hash} />
}
```

и в тексте тупика перечисление открываемых типов дополняется третьим — иначе сообщение осталось бы враньём.

В `TemplatesPage.tsx`: `const EDITABLE: ReadonlySet<TemplateType> = new Set(['XRAY_JSON', 'MIHOMO', 'SINGBOX'])`, комментарий рядом обновляется («умеет три типа; остальные три…»).

В `CreateTemplateDialog.tsx` — третий пункт и честное сужение вместо тернарника:

```tsx
type CreatableType = 'XRAY_JSON' | 'MIHOMO' | 'SINGBOX'
const TYPES: Option[] = [
  { value: 'XRAY_JSON', label: 'Xray (JSON)' },
  { value: 'MIHOMO', label: 'Mihomo (YAML)' },
  { value: 'SINGBOX', label: 'Sing-box (JSON)' },
]
// Прежний тернарник сводил всё, что не MIHOMO, к XRAY_JSON — с третьим типом
// это молча выбирало бы не то, что нажали
const isCreatable = (v: string): v is CreatableType => TYPES.some((t) => t.value === v)
```

В `shared/api/hooks.ts` union у `useCreateTemplate` расширяется до `'XRAY_JSON' | 'MIHOMO' | 'SINGBOX'`.

- [ ] **Step 5: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-page.test.tsx` и `npm run typecheck -w frontend`
Expected: PASS (7 тестов).

- [ ] **Step 6: Мутационная проверка**

1. Ветку `SINGBOX` в `TemplateEditorPage` поставить ПОСЛЕ тупика — краснеет тест про открытие в редакторе. Вернуть.
2. Слать `encodedTemplateYaml` вместо `templateJson` — краснеет тест про сохранение. Вернуть.
3. `blocked` заменить на `false` — краснеет тест про блокировку. Вернуть.
4. В `CreateTemplateDialog` вернуть тернарник — краснеет тест про три типа. Вернуть.
5. Убрать `SINGBOX` из `EDITABLE` — краснеет тест про список. Вернуть.

- [ ] **Step 7: Коммит**

```bash
git add frontend/src/features/templates frontend/src/shared/api/hooks.ts frontend/test/singbox-page.test.tsx
git commit -m "feat(frontend): open SINGBOX templates in the editor"
```

---

### Task 13: Различение формата при загрузке файла

**Files:**
- Modify: `frontend/src/features/editor/configFile.ts`
- Test: `frontend/test/singbox-config-file.test.ts`

**Interfaces:**
- Consumes: `parseImported` (существующая функция разбора JSON-файла).
- Produces: `looksLikeSingbox(value: unknown): boolean`, `looksLikeXrayConfig(value: unknown): boolean` (публичная версия существующей внутренней проверки), новый параметр у разбора: `parseImportedJson(raw: string, expect: 'xray' | 'singbox')`.

Sing-box и Xray — оба JSON, и оба держат в корне `inbounds` и `outbounds`. Без различения редактор молча принял бы чужой документ — тот же класс ошибки, от которого уже закрывается `looksLikeXray` у Mihomo.

- [ ] **Step 1: Написать падающие тесты**

Создать `frontend/test/singbox-config-file.test.ts`:

```ts
describe('различение JSON-документов при загрузке файла', () => {
  it('признак sing-box — route/experimental, признак Xray — routing/policy', () => {
    expect(looksLikeSingbox({ inbounds: [], outbounds: [], route: { rules: [] } })).toBe(true)
    expect(looksLikeSingbox({ inbounds: [], outbounds: [], routing: { rules: [] } })).toBe(false)
    expect(looksLikeXrayConfig({ inbounds: [], outbounds: [], routing: { rules: [] } })).toBe(true)
  })

  it('конфиг Xray в редактор sing-box не грузится', () => {
    const res = parseImportedJson(JSON.stringify({ inbounds: [], outbounds: [], routing: {} }), 'singbox')
    expect('error' in res).toBe(true)
    expect((res as { error: string }).error).toMatch(/Xray/)
  })

  it('шаблон sing-box в редактор Xray не грузится', () => {
    const res = parseImportedJson(JSON.stringify({ inbounds: [], outbounds: [], route: {} }), 'xray')
    expect('error' in res).toBe(true)
    expect((res as { error: string }).error).toMatch(/sing-box/i)
  })

  it('документ без признаков обоих принимается: признак — не обязанность', () => {
    // Ни один признак не является обязательным полем формата: документ без
    // route и без routing валиден для обоих, и отказывать по отсутствию
    // признака значило бы отвергать законный файл
    expect('text' in parseImportedJson('{"outbounds":[]}', 'singbox')).toBe(true)
  })

  it('бэкап панели разворачивается и проверяется по содержимому', () => {})
})
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npx vitest run test/singbox-config-file.test.ts`
Expected: FAIL — функций нет.

- [ ] **Step 3: Реализовать различение**

```ts
/**
 * Признаки формата — по разделам МАРШРУТИЗАЦИИ, а не по корню целиком: `inbounds`
 * и `outbounds` есть у обоих форматов, и по ним они неразличимы. У sing-box
 * маршрут лежит в `route` (плюс свой `experimental`), у Xray — в `routing`
 * (плюс `policy`).
 *
 * Признак — не обязанность: документ без обоих разделов валиден для каждого из
 * форматов, и отказывать по отсутствию признака значило бы отвергать законный
 * файл. Отказ строится только на признаке ЧУЖОГО формата.
 */
export function looksLikeSingbox(value: unknown): boolean {
  if (!isObject(value)) return false
  return isObject(value['route']) || isObject(value['experimental'])
}

export function looksLikeXrayConfig(value: unknown): boolean {
  if (!isObject(value)) return false
  return isObject(value['routing']) || isObject(value['policy'])
}
```

`parseImportedJson(raw, expect)` разворачивает обёртки существующим `unwrapConfig`, затем отказывает при признаке чужого формата с русским текстом, называющим оба формата.

**Существующую `looksLikeXray` в YAML-ветке НЕ трогать.** Она стоит в `parseImportedYaml`, охраняет редактор Mihomo и проверяет корень по `inbounds`+`outbounds` — под этот признак подходит и документ sing-box, так что загруженный в редактор Mihomo он будет отвергнут с формулировкой про Xray. Формулировка неточна, но отказ верен, а расширение той проверки — правка чужой ветки ради текста сообщения: заводить её здесь значит трогать код Mihomo в задаче про sing-box. Отмечено как известное и оставлено.

- [ ] **Step 4: Прогнать тесты и типчек**

Run: `npx vitest run test/singbox-config-file.test.ts` и `npm run typecheck -w frontend`
Expected: PASS (5 тестов).

- [ ] **Step 5: Мутационная проверка**

1. `looksLikeSingbox` строить по `'inbounds' in value && 'outbounds' in value` — краснеет тест про признаки. Вернуть.
2. Отказывать при ОТСУТСТВИИ своего признака — краснеет тест про документ без признаков. Вернуть.
3. Убрать проверку в ветке `'xray'` — краснеет тест про шаблон sing-box в редакторе Xray. Вернуть.

- [ ] **Step 6: Коммит**

```bash
git add frontend/src/features/editor/configFile.ts frontend/test/singbox-config-file.test.ts
git commit -m "fix(frontend): tell sing-box and xray documents apart on file import"
```

---

### Task 14: Сквозные сценарии

**Files:**
- Create: `frontend/e2e/singbox.spec.ts`
- Modify: `frontend/e2e/mocks.ts`
- Test: сам спек

**Interfaces:**
- Consumes: `mockApi` и форма моков из `e2e/mocks.ts`.
- Produces: `SINGBOX_UUID`, `SINGBOX_JSON`, `SINGBOX_TEMPLATE`, `CATALOG_SINGBOX_JSON`, `mockSingbox(page, opts?)`.

- [ ] **Step 1: Дописать моки**

В `frontend/e2e/mocks.ts` — зеркально `MIHOMO_TEMPLATE`, но поля содержимого поменяны местами:

```ts
export const SINGBOX_UUID = '55555555-5555-4555-8555-555555555555'

export const SINGBOX_TEMPLATE = {
  uuid: SINGBOX_UUID,
  viewPosition: 2,
  name: 'Singbox',
  tags: [],
  templateType: 'SINGBOX',
  // JSON-тип: содержимое в templateJson, а encodedTemplateYaml пуст. У MIHOMO
  // ровно наоборот, и мок обязан повторять контракт панели, а не удобство теста
  templateJson: SINGBOX_JSON,
  encodedTemplateYaml: null,
}
```

`SINGBOX_JSON` — небольшой документ с двумя входами, селектором, `direct`, тремя правилами (`sniff`, `domain_suffix` в селектор, `ip_is_private` в `direct`) и без `route.final` — как в настоящих шаблонах каталога. Запись каталога с `type: 'SINGBOX'` добавляется в `CATALOG_ENTRIES`, содержимое — в `CATALOG_CONTENT`; существующая запись `singbox-legacy` (тип, которого в контракте панели нет) остаётся на месте: это отдельный проверяемый случай «незнакомый тип».

`mockSingbox(page, opts)` повторяет `mockMihomo` с роутом `**/api/tools/singbox-test`.

- [ ] **Step 2: Написать сценарии**

Создать `frontend/e2e/singbox.spec.ts` — по одному тесту на требование спеки:

Первый сценарий — целиком кодом, остальные по его образцу:

```ts
import { expect, test } from '@playwright/test'
import { mockApi, mockSingbox, SINGBOX_UUID } from './mocks'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await mockSingbox(page)
  await page.goto(`/templates/${SINGBOX_UUID}`)
  await expect(page.locator('[data-id="group:Выбор"]')).toBeVisible()
})

test('шаблон sing-box открывается в редакторе, а не ведёт в панель', async ({ page }) => {
  await expect(page.getByText('Откройте его в панели')).toHaveCount(0)
  await expect(page.getByText('шаблон SINGBOX')).toBeVisible()
  // Подпись текстовой вкладки выводится из docFormat, а он у sing-box json
  await expect(page.getByRole('button', { name: 'JSON' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'YAML' })).toHaveCount(0)
})
```

1. **«шаблон sing-box открывается в редакторе, а не ведёт в панель»** — код выше.
2. **«правка формы группы правит документ и не трогает чужие ключи»** — клик по узлу группы, «Закрепить список», проверка что в JSON появился `remnawave.includeProxies: false`, а остальные ключи документа не изменились.
3. **«список группы до закрепления только на чтение»** — поле участников недоступно для ввода, рядом сказано, чем панель его заменит.
4. **«сохранение шлёт templateJson, конфликт по хэшу предлагает выбор»** — PATCH мокается 409, проверяется тело запроса (`templateJson` есть, `encodedTemplateYaml` нет, `expectedHash` есть) и диалог «Конфликт версий».
5. **«трассировка называет ПЕРВОЕ совпавшее правило и усекает список»** — ввод адреса и порта, проверка `data-winner`, числа разобранных правил и бейджа «маршрут» на карточке.
6. **«трассировка честно останавливается на непроверяемом условии»** — цель, доходящая до правила с `rule_set`, показывает остановку с названной причиной, а не победителя.
7. **«проверка ядром показывает отчёт с оговоркой про фиктивные серверы»** — текст `/фиктивн/i` при обоих вердиктах.
8. **«импорт из каталога подставляет содержимое в черновик, а не в панель»** — фильтр по своему типу, импорт, смена холста, метка «черновик», PATCH не вызывался, `Ctrl+Z` возвращает как было.
9. **«клик по диагностике ведёт к её месту в тексте»** — сломать документ, кликнуть проблему, проверить позицию каретки.

- [ ] **Step 3: Прогнать e2e**

Run: `npm run e2e -w frontend`
Expected: PASS целиком, включая все прежние спеки — их неизменность доказывает, что общий слой не тронут.

- [ ] **Step 4: Мутационная проверка**

E2E доказываются тем же способом: 1) убрать ветку `SINGBOX` из `TemplateEditorPage` — краснеет тест 1; 2) слать при сохранении оба поля содержимого — краснеет тест 4; 3) сделать список группы редактируемым всегда — краснеет тест 3. Каждая правка отменяется обратной.

- [ ] **Step 5: Коммит**

```bash
git add frontend/e2e/singbox.spec.ts frontend/e2e/mocks.ts
git commit -m "test(frontend): end-to-end scenarios for the sing-box editor"
```

---

### Task 15: Документация

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/plans/2026-09-08-singbox-plan1-core.md`

- [ ] **Step 1: Обновить `CLAUDE.md`**

Раздел про `entities/singbox` уже говорит «модель без интерфейса» и прямо называет это границей плана 1 — теперь это неправда, и абзац переписывается: у sing-box есть страница, граф, формы и подсказки. Дописываются:
- строка про `SingboxEditorPage` в перечень редакторов шаблона и третья ветка `TemplateEditorPage`;
- абзац про граф sing-box рядом с абзацем про граф Mihomo: четыре полосы, полоса групп разворачивается по глубине, `hosts:panel` заводится только когда панели есть куда класть серверы, `builtin:<action>` — три терминальных действия, DNS в граф не идёт;
- предложение про то, что список выходов группы редактируется только после `includeProxies: false`, и почему;
- предложение про цель трассировки: она общая (`TraceTarget`) у всех трёх документов.

- [ ] **Step 2: Обновить `README.md`**

Там, где перечислены поддерживаемые типы шаблонов, добавляется Sing-box; в разделе про переменные окружения `SINGBOX_BIN` уже описан планом 1 — проверить и не дублировать.

- [ ] **Step 3: Отметить план 1 выполненным**

В шапку `2026-09-08-singbox-plan1-core.md` дописать строку «ВЫПОЛНЕН» с датой и перечнем коммитов — так же, как это сделано у планов Mihomo.

- [ ] **Step 4: Финальная проверка целиком**

Run: `npm test -w frontend`, `npm test -w backend`, `npm run typecheck -w frontend`, `npm run typecheck -w backend`, `npm run e2e -w frontend`, `npm run build`
Expected: PASS целиком. Плюс `git diff --stat <база ветки> -- frontend/test` — в выводе только новые файлы `singbox-*`: ни один тест Xray или Mihomo не изменён.

- [ ] **Step 5: Коммит**

```bash
git add CLAUDE.md README.md docs/superpowers/plans/2026-09-08-singbox-plan1-core.md
git commit -m "docs: record the sing-box editor in the project guide"
```

---

## Что этот план НЕ делает

- **Формы для `endpoints`** — осознанный YAGNI спеки: в шаблонах каталога их нет. На графе они как выходы есть (иначе маршрут вёл бы в никуда), в блоке «Ещё поля» описываются словарём, но своей формы не получают.
- **Трассировка раздела `dns`** — `dns.rules` это отдельный механизм со своим набором условий; сначала маршрут.
- **Редакторы `CLASH` и `STASH`** — следующими итерациями; `XRAY_BASE64` редактированию не подлежит по природе формата.
- **Инлайновые наборы правил** (`type: "inline"` с правилами прямо в документе) трассировка по-прежнему считает непроверяемыми, хотя содержимое у неё под рукой. Это долг, замеченный при выполнении плана 1; закрывать его здесь значило бы расширять охват трассировки в задаче, которая её только подключает к интерфейсу.
