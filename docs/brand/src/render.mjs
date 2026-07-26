/**
 * Рендер фирменных изображений из board.html.
 *
 *   node docs/brand/src/render.mjs
 *
 * Нужен установленный chromium Playwright (`npx playwright install chromium`
 * из каталога frontend). Размер картинки задаётся боксом элемента в вёрстке,
 * поэтому social-preview выходит ровно 1280×640 при scale = 1.
 */
import { chromium } from 'playwright'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const board = pathToFileURL(join(here, 'board.html')).href
const brand = join(here, '..')
const publicDir = join(here, '..', '..', '..', 'frontend', 'public')

/** scale: множитель плотности — лок-апы отдаём @2x, остальное 1:1 по спецификации GitHub */
const shots = [
  { id: 'social', dir: brand, file: 'social-preview.png', scale: 1 },
  { id: 'avatar', dir: brand, file: 'avatar.png', scale: 1 },
  { id: 'logo-dark', dir: brand, file: 'logo.png', scale: 2 },
  { id: 'logo-light', dir: brand, file: 'logo-light.png', scale: 2 },
  // Плитка приложения: Safari/iOS не умеют SVG-иконку, ей нужен растр
  { id: 'touch-icon', dir: publicDir, file: 'apple-touch-icon.png', scale: 1 },
]

const browser = await chromium.launch()

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    deviceScaleFactor: shot.scale,
  })
  const page = await context.newPage()
  await page.goto(board, { waitUntil: 'networkidle' })
  // Без этого веб-шрифты успевают подставиться уже после снимка
  await page.evaluate(() => document.fonts.ready)
  await page.locator(`#${shot.id}`).screenshot({ path: join(shot.dir, shot.file) })
  console.log(`${shot.file} — готово`)
  await context.close()
}

await browser.close()
