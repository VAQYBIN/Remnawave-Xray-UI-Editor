// Шесть рецептов sing-box как записи обобщённого диалога. Планы уже отдают
// {model}, перевода не требуется (в отличие от xrayRecipes.tsx, где план
// Xray отдавал {config}). Теги выходов поле берёт из модели через
// singboxRefs — у диалога знания о виде документа нет.

import {
  RULE_SET_CATALOG,
  SINGBOX_RECIPES,
  type AdsParams,
  type DnsParams,
  type LocalParams,
  type PrivateParams,
  type SplitParams,
  type WarpParams,
} from '../../entities/singbox/recipes'
import { singboxRefs, type SingboxDoc } from '../../entities/singbox'
import { useWarpAccount } from '../../shared/api'
import { Button } from '../../shared/ui'
import { CheckboxField, MultiSelectField, NumberField, SelectField, StringListField, TextField } from '../inspector/fields'
import type { RecipeEntry } from './RecipesDialog'

// Сама запись SINGBOX_RECIPES уже {id, title, summary, defaults, validate,
// plan} — ровно форма RecipeEntry['recipe']. Достаём её по id, а не
// пересобираем: третье описание одного и того же рецепта разошлось бы с
// первыми двумя на первой же правке таблицы.
function recipeOf(id: string) {
  return SINGBOX_RECIPES.find((r) => r.id === id)!
}

const outboundOptions = (model: SingboxDoc) => singboxRefs(model).outbound.map((t) => ({ value: t, label: t }))

const split: RecipeEntry<SingboxDoc, SplitParams> = {
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
        label="Выход"
        value={value.outbound}
        options={outboundOptions(model)}
        onChange={(v) => onChange({ ...value, outbound: v })}
      />
    </>
  ),
}

const ads: RecipeEntry<SingboxDoc, AdsParams> = {
  recipe: recipeOf('ads'),
  Form: ({ value, onChange }) => (
    <CheckboxField
      label="Также блокировать на уровне DNS (NXDOMAIN)"
      hint="Часть рекламных доменов клиент резолвит до того, как соединение попадёт в правила маршрута"
      value={value.alsoDns || undefined}
      onChange={(v) => onChange({ alsoDns: v ?? false })}
    />
  ),
}

const dns: RecipeEntry<SingboxDoc, DnsParams> = {
  recipe: recipeOf('dns'),
  Form: ({ value, onChange, model }) => (
    <>
      <TextField
        label="Удалённый DNS"
        hint="Адрес сервера DNS-over-TLS, например 1.1.1.1"
        value={value.remote}
        onChange={(v) => onChange({ ...value, remote: v ?? '' })}
      />
      <SelectField
        label="Detour"
        hint="Через какой выход резолвится удалённый DNS"
        value={value.detour}
        options={outboundOptions(model)}
        onChange={(v) => onChange({ ...value, detour: v })}
      />
    </>
  ),
}

const KIND_OPTIONS = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'socks', label: 'SOCKS5' },
  { value: 'http', label: 'HTTP' },
]

const local: RecipeEntry<SingboxDoc, LocalParams> = {
  recipe: recipeOf('local'),
  Form: ({ value, onChange }) => (
    <>
      <SelectField
        label="Тип входа"
        value={value.kind}
        options={KIND_OPTIONS}
        onChange={(v) => onChange({ ...value, kind: v as LocalParams['kind'] })}
      />
      <NumberField label="Порт" value={value.port} min={1} onChange={(v) => onChange({ ...value, port: v ?? value.port })} />
      <CheckboxField
        label="Сделать системным прокси"
        value={value.setSystemProxy || undefined}
        onChange={(v) => onChange({ ...value, setSystemProxy: v ?? false })}
      />
    </>
  ),
}

const priv: RecipeEntry<SingboxDoc, PrivateParams> = {
  recipe: recipeOf('private'),
  Form: ({ value, onChange, model }) => (
    <SelectField label="Выход" value={value.outbound} options={outboundOptions(model)} onChange={(v) => onChange({ outbound: v })} />
  ),
}

function WarpForm({ value, onChange }: { value: WarpParams; onChange: (v: WarpParams) => void }) {
  const account = useWarpAccount()
  return (
    <>
      <TextField label="Тег эндпоинта" value={value.tag} onChange={(v) => onChange({ ...value, tag: v ?? '' })} />
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
          кнопкой перемонтируем поля по значению самого ключа, как у Xray-рецепта WARP */}
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
    </>
  )
}

const warp: RecipeEntry<SingboxDoc, WarpParams> = {
  recipe: recipeOf('warp'),
  Form: ({ value, onChange }) => <WarpForm value={value} onChange={onChange} />,
}

/** Порядок — как в SINGBOX_RECIPES: split, ads, dns, local, private, warp */
export const SINGBOX_RECIPE_ENTRIES: RecipeEntry<SingboxDoc, any>[] = [split, ads, dns, local, priv, warp] // eslint-disable-line @typescript-eslint/no-explicit-any -- параметры у рецептов разные, пара recipe/Form согласована внутри записи
