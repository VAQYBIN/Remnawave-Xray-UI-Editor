// IntelliSense для JSON-редакторов Xray-конфига: контекстные автоподсказки
// (ключи + enum-значения) и hover-тултипы. Источник подсказок регистрируется в
// language-data JSON — плагин autocompletion уже включён basicSetup'ом @uiw, так
// что второй экземпляр не нужен.
//
// rootKind определяет, с какого узла docSchema начинается документ: 'config' для
// вкладки JSON целиком, 'inbound'/'outbound'/'rule'/'dns' — для JSON отдельного
// узла в инспекторе.

import { acceptCompletion } from '@codemirror/autocomplete'
import { jsonLanguage } from '@codemirror/lang-json'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { makeCompletionSource } from './complete'
import { makeHover } from './hover'
import type { XrayRootKind } from './context'

export type { XrayRootKind } from './context'

export function xrayIntellisense(rootKind: XrayRootKind): Extension {
  return [
    jsonLanguage.data.of({ autocomplete: makeCompletionSource(rootKind) }),
    // Tab применяет подсказку, когда выпадашка открыта. acceptCompletion вернёт
    // false, если подсказок нет — тогда Tab (высокий приоритет пропускает его
    // дальше) отработает как обычный отступ из basicSetup.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    makeHover(rootKind),
  ]
}
