// Панель «Документ» Mihomo поверх общей DocPanel: свои здесь только описания
// списков и отображений (входы, туннели, наборы, провайдеры, подсписки) —
// разметку разделов и карточек несёт общий слой, как у SingboxDocPanel, иначе
// завелась бы вторая копия той же вёрстки.
//
// Записи отображений (наборы, провайдеры, подсписки) адресуются именем — форма
// получает его из последнего сегмента пути, переименование идёт через
// draft.rename с переносом ссылок. Имя входа (listeners[].name) — не ссылка:
// его читает только IN-NAME, чей разбор в referenceSites не входит, поэтому
// пишется оно операцией set, без draft.rename.

import { useMemo, useRef } from 'react'
import type { MihomoDoc } from '../../entities/mihomo'
import { MIHOMO_DOC_SECTIONS, mihomoFieldAt, mihomoFieldsAt, mihomoRefs } from '../../entities/mihomo/schema'
import { startListener, startProvider, startRuleProvider, startSubRule, startTunnel } from '../../entities/mihomo/starters'
import { valueAt } from '../../shared/schema'
import { DocPanel, type DocListSpec, type DocMapSpec } from '../inspector/schema/DocPanel'
import { SchemaForm } from '../inspector/schema/SchemaForm'
import { MihomoListenerForm } from '../inspector/MihomoListenerForm'
import { MihomoProviderForm } from '../inspector/MihomoProviderForm'
import { MihomoRuleProviderForm } from '../inspector/MihomoRuleProviderForm'
import { MihomoSubRuleForm } from '../inspector/MihomoSubRuleForm'
import type { MihomoDraft } from '../editor/useMihomoDraft'

const nameOfPath = (path: (string | number)[]) => String(path[path.length - 1])

export function MihomoDocPanel({ draft, md }: { draft: MihomoDraft; md: MihomoDoc }) {
  // `DocPanel` рендерит `spec.Form` КАК ТИП КОМПОНЕНТА (`<spec.Form .../>`), а
  // не как обычный проп-функцию: другая функция на каждый рендер — для React
  // другой компонент, и он размонтирует/перемонтирует поддерево карточки
  // целиком. Схема поля пишет операцию на каждое нажатие клавиши → новый `md` →
  // новый рендер `MihomoDocPanel` → без мемоизации `lists`/`maps` строились бы
  // заново с новыми `Form`, и любой открытый инпут (тег, url, буфер
  // `MihomoNameField`) слетал бы с фокуса на первом же символе. Поэтому таблицы
  // строятся ОДИН РАЗ (`useMemo` с пустыми зависимостями), а актуальные
  // `draft`/`md` замыкания внутри `Form`/`starter` берут из рефов, а не из
  // параметров функции — иначе они навечно держали бы значения первого рендера.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const mdRef = useRef(md)
  mdRef.current = md

  // Находка ревью I2: без мемоизации `mihomoRefs(md)` пересчитывался на КАЖДЫЙ
  // рендер панели, включая те, что не меняют `md` вовсе (перерисовка родителя
  // по несвязанной причине) — тот же приём, что у `MihomoInspector`.
  // Находка ревью I2: без мемоизации `mihomoRefs(md)` пересчитывался на КАЖДЫЙ
  // рендер панели, включая те, что не меняют `md` вовсе (перерисовка родителя
  // по несвязанной причине) — тот же приём, что у `MihomoInspector`.
  const refs = useMemo(() => mihomoRefs(md), [md])

  const lists = useMemo<Record<string, DocListSpec<MihomoDoc>>>(
    () => ({
      listeners: {
        addLabel: '+ Вход',
        removeLabel: (i) => `Удалить вход #${i + 1}`,
        titleOf: (item, i) => ((item as { name?: unknown } | null)?.name as string) || `вход #${i + 1}`,
        starter: startListener,
        Form: (p) => (
          <MihomoListenerForm
            {...p}
            name={String(p.value.name ?? '')}
            onRename={(to) => {
              p.writer.apply([{ op: 'set', path: [...p.path, 'name'], value: to }])
              return null
            }}
          />
        ),
      },
      tunnels: {
        addLabel: '+ Туннель',
        removeLabel: (i) => `Удалить туннель #${i + 1}`,
        titleOf: (_item, i) => `туннель #${i + 1}`,
        starter: startTunnel,
        Form: (p) => (
          <SchemaForm fields={mihomoFieldsAt(p.path, mdRef.current.json) ?? []} value={p.value} path={p.path} writer={p.writer} refs={p.refs} />
        ),
      },
    }),
    [],
  )

  const maps = useMemo<Record<string, DocMapSpec<MihomoDoc>>>(
    () => ({
      'rule-providers': {
        addLabel: '+ Набор правил',
        removeLabel: (n) => `Удалить набор ${n}`,
        baseName: 'ruleset',
        starter: startRuleProvider,
        Form: (p) => (
          <MihomoRuleProviderForm {...p} name={nameOfPath(p.path)} onRename={(to) => draftRef.current.rename('rule-provider', nameOfPath(p.path), to)} />
        ),
      },
      'proxy-providers': {
        addLabel: '+ Провайдер',
        removeLabel: (n) => `Удалить провайдера ${n}`,
        baseName: 'provider',
        starter: startProvider,
        Form: (p) => (
          <MihomoProviderForm {...p} name={nameOfPath(p.path)} onRename={(to) => draftRef.current.rename('provider', nameOfPath(p.path), to)} />
        ),
      },
      'sub-rules': {
        addLabel: '+ Подсписок',
        removeLabel: (n) => `Удалить подсписок ${n}`,
        baseName: 'sub-rule',
        starter: () => startSubRule(),
        Form: (p) => {
          // Значение отображения приходит объектом ({} у списка) — правила подсписка
          // читаем заново из md.json по пути, а не из p.value.
          const rules = valueAt(mdRef.current.json, p.path)
          return (
            <MihomoSubRuleForm
              rules={Array.isArray(rules) ? rules.map(String) : []}
              path={p.path}
              writer={p.writer}
              refs={p.refs}
              name={nameOfPath(p.path)}
              onRename={(to) => draftRef.current.rename('sub-rule', nameOfPath(p.path), to)}
            />
          )
        },
      },
    }),
    [],
  )

  return (
    <DocPanel
      sections={MIHOMO_DOC_SECTIONS}
      doc={md}
      writer={draft.writer}
      refs={refs}
      fieldsAt={(path, d) => mihomoFieldsAt(path, d.json)}
      fieldAt={(path, d) => mihomoFieldAt(path, d.json)}
      valueOf={(d, path) => valueAt(d.json, path)}
      lists={lists}
      maps={maps}
    />
  )
}
