import { WARP_SERVICES, type WarpParams } from '../../../entities/xray'
import { useWarpAccount } from '../../../shared/api'
import { Button } from '../../../shared/ui'
import { MultiSelectField, NumberField, StringListField, TextField } from '../../inspector/fields'

export function WarpForm({
  value,
  onChange,
}: {
  value: WarpParams
  onChange: (v: WarpParams) => void
}) {
  const account = useWarpAccount()

  return (
    <>
      <TextField
        label="Тег outbound’а"
        value={value.tag}
        onChange={(v) => onChange({ ...value, tag: v ?? '' })}
      />
      <MultiSelectField
        label="Сервисы"
        hint="Категории geosite, которые пойдут через WARP"
        options={WARP_SERVICES}
        value={value.services.length > 0 ? value.services : undefined}
        onChange={(v) => onChange({ ...value, services: v ?? [] })}
      />
      <StringListField
        label="Свои домены и категории"
        hint="По одному в строке: example.com, domain:example.org, geosite:netflix"
        placeholder={'example.com\ngeosite:netflix'}
        value={value.domains.length > 0 ? value.domains : undefined}
        onChange={(v) => onChange({ ...value, domains: v ?? [] })}
      />
      <div className="row">
        <Button
          disabled={account.isPending}
          onClick={() =>
            account.mutate(undefined, {
              onSuccess: (data) =>
                onChange({
                  ...value,
                  secretKey: data.secretKey,
                  addresses: data.address,
                  reserved: data.reserved,
                }),
            })
          }
        >
          {account.isPending ? 'Регистрируем…' : 'Получить ключи'}
        </Button>
        <span className="muted">Ключи выдаёт Cloudflare — как утилита wgcf</span>
      </div>
      {account.isError && <span className="field-error">{(account.error as Error).message}</span>}
      <TextField
        label="Приватный ключ (secretKey)"
        mono
        value={value.secretKey}
        onChange={(v) => onChange({ ...value, secretKey: v ?? '' })}
      />
      {/* StringListField читает value только при монтировании — после заливки
          ключей кнопкой перемонтируем поля по значению самого ключа */}
      <StringListField
        key={`addr:${value.secretKey}`}
        label="Адреса интерфейса"
        hint="Как в конфиге WireGuard: 172.16.0.2/32 и адрес IPv6"
        value={value.addresses.length > 0 ? value.addresses : undefined}
        onChange={(v) => onChange({ ...value, addresses: v ?? [] })}
      />
      <StringListField
        key={`res:${value.secretKey}`}
        label="Reserved (по числу на строку)"
        hint="Три байта client id WARP; нечисловые строки игнорируются"
        placeholder={'51\n68\n99'}
        value={value.reserved.length > 0 ? value.reserved.map(String) : undefined}
        onChange={(v) =>
          onChange({
            ...value,
            reserved: (v ?? []).map(Number).filter((n) => Number.isFinite(n)),
          })
        }
      />
      <NumberField label="MTU" value={value.mtu} onChange={(v) => onChange({ ...value, mtu: v ?? 1280 })} />
    </>
  )
}
