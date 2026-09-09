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
  const refs = mihomoRefs(md)
  const lists: Record<string, DocListSpec<MihomoDoc>> = {
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
      Form: (p) => <SchemaForm fields={mihomoFieldsAt(p.path, md.json) ?? []} value={p.value} path={p.path} writer={p.writer} refs={p.refs} />,
    },
  }
  const maps: Record<string, DocMapSpec<MihomoDoc>> = {
    'rule-providers': {
      addLabel: '+ Набор правил',
      removeLabel: (n) => `Удалить набор ${n}`,
      baseName: 'ruleset',
      starter: startRuleProvider,
      Form: (p) => (
        <MihomoRuleProviderForm {...p} name={nameOfPath(p.path)} onRename={(to) => draft.rename('rule-provider', nameOfPath(p.path), to)} />
      ),
    },
    'proxy-providers': {
      addLabel: '+ Провайдер',
      removeLabel: (n) => `Удалить провайдера ${n}`,
      baseName: 'provider',
      starter: startProvider,
      Form: (p) => (
        <MihomoProviderForm {...p} name={nameOfPath(p.path)} onRename={(to) => draft.rename('provider', nameOfPath(p.path), to)} />
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
        const rules = valueAt(md.json, p.path)
        return (
          <MihomoSubRuleForm
            rules={Array.isArray(rules) ? rules.map(String) : []}
            path={p.path}
            writer={p.writer}
            refs={p.refs}
            name={nameOfPath(p.path)}
            onRename={(to) => draft.rename('sub-rule', nameOfPath(p.path), to)}
          />
        )
      },
    },
  }
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
