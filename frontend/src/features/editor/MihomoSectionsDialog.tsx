// Секции документа, у которых нет узлов графа: корневые настройки, dns, tun,
// sniffer, profile и наборы правил. Узлами они и не должны быть — это словари и
// глобальные настройки, а не маршруты, — но править их надо, и диалог здесь тот
// же приём, что ConfigSettingsDialog у Xray.

import {
  fieldsOf,
  locateMihomo,
  ruleProvidersOf,
  type MihomoDoc,
  type MihomoSectionName,
} from '../../entities/mihomo'
import type { PathParts } from '../../entities/xray'
import { CollapsibleSection, Dialog } from '../../shared/ui'
import { MihomoFieldsForm } from '../inspector/MihomoFieldsForm'
import type { MihomoDraft } from './useMihomoDraft'

/** Секции верхнего уровня: заголовок диалога, имя словаря и путь до отображения */
const SECTIONS: { title: string; section: MihomoSectionName; parts: PathParts }[] = [
  // Корень — само отображение документа, поэтому путь пуст
  { title: 'Общие настройки', section: 'root', parts: [] },
  { title: 'DNS', section: 'dns', parts: ['dns'] },
  { title: 'TUN', section: 'tun', parts: ['tun'] },
  { title: 'Снифер', section: 'sniffer', parts: ['sniffer'] },
  { title: 'Профиль', section: 'profile', parts: ['profile'] },
]

interface Props {
  open: boolean
  md: MihomoDoc
  draft: MihomoDraft
  onClose: () => void
}

export function MihomoSectionsDialog({ open, md, draft, onClose }: Props) {
  const ruleProviders = ruleProvidersOf(md)
  return (
    <Dialog open={open} title="Секции документа" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Правки применяются к черновику сразу, как и в формах инспектора.
      </p>

      {SECTIONS.map(({ title, section, parts }) => {
        // Секции в документе нет вовсе — стена запертых полей объяснила бы это
        // двадцать раз подряд и ни разу не сказала главного: завести саму секцию
        // форма не умеет, это структурная правка, а она живёт в тексте.
        const missing = parts.length > 0 && locateMihomo(md, parts) === null
        return (
          <CollapsibleSection key={section} title={title} defaultOpen={section === 'root'}>
            {missing ? (
              <p className="muted">
                Секции «{String(parts[0])}» в документе нет. Заведите её на вкладке YAML — форма
                добавляет ключи в существующие секции, но не создаёт новые.
              </p>
            ) : (
              <MihomoFieldsForm md={md} parts={parts} fields={fieldsOf(section)} draft={draft} />
            )}
          </CollapsibleSection>
        )
      })}

      {ruleProviders.length > 0 && (
        <>
          <h3>Наборы правил</h3>
          {ruleProviders.map((provider) => (
            <CollapsibleSection key={provider.name} title={provider.name}>
              <MihomoFieldsForm
                md={md}
                parts={['rule-providers', provider.name]}
                fields={fieldsOf('rule-provider')}
                draft={draft}
              />
            </CollapsibleSection>
          ))}
        </>
      )}
    </Dialog>
  )
}
