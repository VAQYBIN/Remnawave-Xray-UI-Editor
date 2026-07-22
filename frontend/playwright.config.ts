import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // 127.0.0.1, а не localhost: на этой машине резолвинг localhost уходит в
  // IPv6 (::1), а исходящие соединения к ::1 в этой песочнице блокируются
  // (connect EACCES) — явный IPv4-адрес обходит проблему.
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
