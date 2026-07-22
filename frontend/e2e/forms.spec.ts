import { expect, test } from '@playwright/test'
import { UUID, mockApi } from './mocks'
import { openOptions, optionList, pickOption } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await page.goto(`/profiles/${UUID}`)
  await expect(page.locator('.react-flow__node[data-id="in:vless-in"]')).toBeVisible()
})

test('правило маршрутизации редактируется формой', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="rule:0"]').click()
  await pickOption(page, inspector.getByLabel('Outbound (куда отправить)'), 'block')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  // Ребро перестроилось на новый outbound, конфиг ушёл в черновик
  await expect(page.locator('.react-flow__edge[data-id="e:rule:0->out:block"]')).toBeVisible()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('матрица security×network в селектах + hysteria2-inbound', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="in:vless-in"]').click()
  // ws не совместим с reality — опция пропадает из селекта шифрования (остаются none и tls)
  await pickOption(page, inspector.getByLabel('Транспорт'), 'ws')
  await openOptions(inspector.getByLabel('Шифрование'))
  await expect(optionList(page)).toHaveCount(2)
  await page.keyboard.press('Escape')
  // hysteria2-протокол: чистый шаблон settings и русская подсказка про сертификат
  await pickOption(page, inspector.getByLabel('Протокол'), 'hysteria')
  await expect(inspector.getByText(/настоящий TLS-сертификат/)).toBeVisible()
})

test('outbound vless: streamSettings Reality с клиентскими полями', async ({ page }) => {
  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="out:direct"]').click()
  await pickOption(page, inspector.getByLabel('Протокол'), 'vless')
  await pickOption(page, inspector.getByLabel('Шифрование'), 'reality')
  // Клиентские поля Reality (outbound-режим StreamForm); серверных кнопок генерации нет
  await inspector.getByLabel('Имя сервера (serverName)').fill('yahoo.com')
  await inspector.getByLabel('Публичный ключ сервера (password)').fill('PBK')
  await expect(inspector.getByText('Сгенерировать ключи')).toHaveCount(0)
  await inspector.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('диалог «Настройки конфига» и DNS-форма', async ({ page }) => {
  await page.getByRole('button', { name: 'Настройки конфига' }).click()
  await pickOption(page, page.getByLabel('Стратегия доменов (domainStrategy)'), 'IPIfNonMatch')
  await page.getByRole('button', { name: 'Закрыть настройки' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  const inspector = page.locator('aside')
  await page.locator('.react-flow__node[data-id="dns"]').click()
  await pickOption(page, inspector.getByLabel('Стратегия запросов (queryStrategy)'), 'UseIPv4')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  // dns-узел остаётся выбранным после применения (getNodeJson('dns') определён)
  await expect(page.locator('.react-flow__node[data-id="dns"]')).toBeVisible()
  await expect(inspector.getByText('dns', { exact: true })).toBeVisible()
})
