import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

afterEach(() => cleanup())

/*
 * Потолок ожидания у `findBy*`/`waitFor` — свой, и `testTimeout` его НЕ
 * покрывает: он срабатывает раньше и сообщает «элемент не найден», а не
 * «тест не уложился». Умолчание в 1000 мс стоит ниже честной цены здешних
 * ожиданий — «имя профиля — ссылка на редактор» в обычном прогоне идёт
 * 1066 мс, то есть уже за пределом, и под нагрузкой проигрывал стабильно.
 *
 * 5 с — выше разброса машины и заведомо НИЖЕ общего потолка теста (30 с):
 * так падение остаётся внятным («элемента нет»), а не превращается в
 * «тест не уложился», из которого причина не читается.
 */
configure({ asyncUtilTimeout: 5_000 })

// React Flow требует ResizeObserver; в jsdom его нет
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom не реализует Blob.text() — читаем через FileReader, он там есть
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(this)
    })
  }
}

// jsdom не реализует HTMLDialogElement.showModal/close
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
