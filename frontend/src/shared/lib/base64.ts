// base64 для содержимого YAML-шаблонов. Через TextEncoder, а не btoa(text):
// в живых шаблонах имена групп содержат кириллицу и эмодзи («🌍 VPN»), на
// которых btoa бросает InvalidCharacterError — причём при СОХРАНЕНИИ, когда
// работа уже сделана. Панель хранит encodedTemplateYaml как base64 от utf-8,
// поэтому и обратное преобразование идёт через TextDecoder, а не atob(…) как
// готовую строку.

export function encodeYaml(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeYaml(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
