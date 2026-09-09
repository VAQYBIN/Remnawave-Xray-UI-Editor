// Шесть рецептов Mihomo как записи обобщённого диалога — по образцу
// singboxRecipes.tsx. Планы уже отдают {model}, перевода не требуется. Теги
// целей (прокси, группы, встроенные DIRECT/REJECT/PASS) поле берёт из модели
// через mihomoRefs — у диалога знания о виде документа нет.

import {
  MIHOMO_RECIPES,
  RULE_SET_CATALOG,
  type AdsParams,
  type DnsParams,
  type LocalParams,
  type PrivateParams,
  type SplitParams,
  type WarpParams,
} from '../../entities/mihomo/recipes'
import { mihomoRefs } from '../../entities/mihomo/schema'
import type { MihomoDoc } from '../../entities/mihomo'
import { useWarpAccount } from '../../shared/api'
import { Button } from '../../shared/ui'
import { CheckboxField, MultiSelectField, NumberField, SelectField, StringListField, TextField } from '../inspector/fields'
import type { RecipeEntry } from './RecipesDialog'

// Сама запись MIHOMO_RECIPES уже {id, title, summary, defaults, validate,
// plan} — ровно форма RecipeEntry['recipe']. Достаём её по id, а не
// пересобираем: второе описание одного и того же рецепта разошлось бы с
// первым на первой же правке таблицы.
function recipeOf(id: string) {
  return MIHOMO_RECIPES.find((r) => r.id === id)!
}

const targetOptions = (model: MihomoDoc) => (mihomoRefs(model)['proxy-target'] ?? []).map((t) => ({ value: t, label: t }))

const split: RecipeEntry<MihomoDoc, SplitParams> = {
  recipe: recipeOf('split'),
  Form: ({ value, onChange, model }) => (
    <>
      <MultiSelectField
        label="Наборы правил"
        hint="Категории из каталога MetaCubeX/meta-rules-dat"
        options={RULE_SET_CATALOG.map((s) => ({ value: s.id, label: s.title }))}
        value={value.sets.length > 0 ? value.sets : undefined}
        onChange={(v) => onChange({ ...value, sets: v ?? [] })}
      />
      <SelectField
        label="Цель"
        hint="Прокси, группа либо встроенные DIRECT/REJECT"
        value={value.target}
        options={targetOptions(model)}
        onChange={(v) => onChange({ ...value, target: v ?? '' })}
      />
    </>
  ),
}

const ads: RecipeEntry<MihomoDoc, AdsParams> = {
  recipe: recipeOf('ads'),
  Form: () => null,
}

const dns: RecipeEntry<MihomoDoc, DnsParams> = {
  recipe: recipeOf('dns'),
  Form: ({ value, onChange }) => (
    <>
      <TextField
        label="Удалённый DNS"
        hint="Адрес сервера, например https://1.1.1.1/dns-query"
        value={value.remote}
        onChange={(v) => onChange({ ...value, remote: v ?? '' })}
      />
      <TextField
        label="Локальный DNS"
        hint="Бутстрап-сервер для резолва самого удалённого DNS"
        value={value.local}
        onChange={(v) => onChange({ ...value, local: v ?? '' })}
      />
      <CheckboxField
        label="fake-ip"
        hint="enhanced-mode: fake-ip и диапазон 198.18.0.1/16"
        value={value.fakeIp || undefined}
        onChange={(v) => onChange({ ...value, fakeIp: v ?? false })}
      />
    </>
  ),
}

const local: RecipeEntry<MihomoDoc, LocalParams> = {
  recipe: recipeOf('local'),
  Form: ({ value, onChange }) => (
    <>
      <NumberField label="Порт" value={value.port} min={1} onChange={(v) => onChange({ ...value, port: v ?? value.port })} />
      <CheckboxField
        label="Разрешить LAN"
        value={value.allowLan || undefined}
        onChange={(v) => onChange({ ...value, allowLan: v ?? false })}
      />
    </>
  ),
}

const priv: RecipeEntry<MihomoDoc, PrivateParams> = {
  recipe: recipeOf('private'),
  Form: () => null,
}

function WarpForm({ value, onChange }: { value: WarpParams; onChange: (v: WarpParams) => void }) {
  const account = useWarpAccount()
  return (
    <>
      <TextField label="Имя сервера" value={value.name} onChange={(v) => onChange({ ...value, name: v ?? '' })} />
      <div className="row">
        <Button
          disabled={account.isPending}
          onClick={() =>
            account.mutate(undefined, {
              onSuccess: (data) =>
                onChange({ ...value, privateKey: data.secretKey, addresses: data.address, reserved: data.reserved }),
            })
          }
        >
          {account.isPending ? 'Регистрируем…' : 'Получить ключи'}
        </Button>
        <span className="muted">Ключи выдаёт Cloudflare — как утилита wgcf</span>
      </div>
      {account.isError && <span className="field-error">{(account.error as Error).message}</span>}
      <TextField
        label="Приватный ключ"
        mono
        value={value.privateKey}
        onChange={(v) => onChange({ ...value, privateKey: v ?? '' })}
      />
      {/* StringListField читает value только при монтировании — после заливки ключей
          кнопкой перемонтируем поля по значению самого ключа, как у рецептов Xray/sing-box */}
      <StringListField
        key={`addr:${value.privateKey}`}
        label="Адреса интерфейса"
        value={value.addresses.length > 0 ? value.addresses : undefined}
        onChange={(v) => onChange({ ...value, addresses: v ?? [] })}
      />
      <StringListField
        key={`res:${value.privateKey}`}
        label="Reserved (по числу на строку)"
        placeholder={'51\n68\n99'}
        value={value.reserved.length > 0 ? value.reserved.map(String) : undefined}
        onChange={(v) => onChange({ ...value, reserved: (v ?? []).map(Number).filter((n) => Number.isFinite(n)) })}
      />
      <NumberField label="MTU" value={value.mtu} onChange={(v) => onChange({ ...value, mtu: v ?? 1280 })} />
      <CheckboxField
        label="Завести группу select с этим сервером"
        value={value.group || undefined}
        onChange={(v) => onChange({ ...value, group: v ?? false })}
      />
    </>
  )
}

const warp: RecipeEntry<MihomoDoc, WarpParams> = {
  recipe: recipeOf('warp'),
  Form: ({ value, onChange }) => <WarpForm value={value} onChange={onChange} />,
}

/** Порядок — как в MIHOMO_RECIPES: split, ads, dns, local, private, warp */
export const MIHOMO_RECIPE_ENTRIES: RecipeEntry<MihomoDoc, any>[] = [split, ads, dns, local, priv, warp] // eslint-disable-line @typescript-eslint/no-explicit-any -- параметры у рецептов разные, пара recipe/Form согласована внутри записи
