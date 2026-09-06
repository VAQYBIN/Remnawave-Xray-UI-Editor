// IntelliSense текстовой вкладки Mihomo: контекстные подсказки ключей и
// значений плюс hover-тултипы по словарю docSchema. Собран так же, как
// xrayIntellisense: источник регистрируется данными языка, а не вторым
// экземпляром autocompletion — плагин уже включён basicSetup'ом @uiw.

import { acceptCompletion } from '@codemirror/autocomplete'
import { yamlLanguage } from '@codemirror/lang-yaml'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { mihomoCompletionSource } from './complete'
import { mihomoHover } from './hover'

export { contextAt, type MihomoCursor } from './context'
export { mihomoCompletionSource } from './complete'

export function mihomoIntellisense(): Extension {
  return [
    yamlLanguage.data.of({ autocomplete: mihomoCompletionSource }),
    // Tab применяет подсказку, когда выпадашка открыта. acceptCompletion вернёт
    // false, если подсказок нет — тогда Tab (высокий приоритет пропускает его
    // дальше) отработает как обычный отступ из basicSetup.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    mihomoHover(),
  ]
}
