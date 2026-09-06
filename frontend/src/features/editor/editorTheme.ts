// Оформление CodeMirror, общее для текстовых вкладок обоих редакторов
// (JSON у Xray, YAML у Mihomo). Две копии темы разъехались бы при первой же
// правке токенов, поэтому она живёт одна и здесь.

import { EditorView } from '@uiw/react-codemirror'

export const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--void)', fontSize: '13px', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: 'var(--void)', borderRight: '1px solid var(--rail)' },
})
