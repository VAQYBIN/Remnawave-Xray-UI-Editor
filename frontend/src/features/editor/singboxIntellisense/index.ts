// IntelliSense текстовой вкладки sing-box: контекстные подсказки ключей и
// значений плюс наведение по схеме `entities/singbox/schema` (дерево полей с
// условиями `when`, а не плоский словарь секций, как было раньше). Собран так
// же, как `xrayIntellisense` и `mihomoIntellisense`: источник регистрируется
// данными языка, а не вторым экземпляром autocompletion — плагин уже включён
// basicSetup'ом @uiw.
//
// Корень у документа ровно один (`root`), поэтому параметра вида документа
// здесь нет: у Xray он нужен для JSON отдельного узла в инспекторе, а формы
// sing-box правят модель, а не текст.

import { acceptCompletion } from '@codemirror/autocomplete'
import { jsonLanguage } from '@codemirror/lang-json'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { singboxCompletionSource } from './complete'
import { singboxHover } from './hover'

export { singboxPathAt, singboxFields, type SingboxCursor } from './context'
export { singboxCompletionSource } from './complete'
export { hoverSingboxAt, singboxHover, type SingboxHover } from './hover'

export function singboxIntellisense(): Extension {
  return [
    jsonLanguage.data.of({ autocomplete: singboxCompletionSource }),
    // Tab применяет подсказку, когда выпадашка открыта. acceptCompletion вернёт
    // false, если подсказок нет — тогда Tab (высокий приоритет пропускает его
    // дальше) отработает как обычный отступ из basicSetup.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    singboxHover(),
  ]
}
