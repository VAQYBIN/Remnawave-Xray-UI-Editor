import { defineConfig } from '@playwright/test'

// Отдельный контур от e2e: съёмка ничего не проверяет, а пишет файлы в
// docs/screenshots/ и живёт по другому расписанию, чем тесты. Порт свой, чтобы
// не драться с e2e за 4173.
export default defineConfig({
  testDir: './screenshots',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    // 1680 — чтобы топбар помещался целиком: на 1440 «Сохранить в панель»
    // обрезается, а обрезанная кнопка на герой-кадре читается как дефект
    viewport: { width: 1680, height: 920 },
    // README отдаётся и на дисплеях с удвоенной плотностью; кадр в одинарной
    // выглядел бы мылом
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'npm run dev -- --port 4175 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
