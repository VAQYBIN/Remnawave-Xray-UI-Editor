/**
 * Контрактный тест на уровне типов. Ничего не выполняет: падает на
 * `tsc --noEmit`, если наши интерфейсы разошлись с официальным контрактом
 * панели. Пакет подключён ТОЛЬКО как devDependency и только через import type —
 * в рантайме его нет, поэтому терпимость к новым полям панели сохраняется
 * (см. тест «новые поля панели проходят насквозь»).
 */
import type { GetSubscriptionTemplateCommand, UpdateSubscriptionTemplateCommand } from '@remnawave/backend-contract'
import type { SubscriptionTemplate, TemplateType } from '../src/remnawave/types.js'

type PanelTemplate = GetSubscriptionTemplateCommand.Response['response']

// Ответ панели обязан подходить под наш тип: иначе клиент врёт о том, что читает
const _fromPanel: SubscriptionTemplate = null as unknown as PanelTemplate

// Наше перечисление типов обязано совпадать с контрактным
type PanelTemplateType = PanelTemplate['templateType']
const _typeToPanel: PanelTemplateType = null as unknown as TemplateType
const _typeFromPanel: TemplateType = null as unknown as PanelTemplateType

// Тело обновления, которое шлёт клиент, обязано быть допустимым для панели
const _updateBody: UpdateSubscriptionTemplateCommand.RequestBody = {
  uuid: '00000000-0000-0000-0000-000000000000',
  name: 'x',
  templateJson: {},
}

export type { PanelTemplate }
