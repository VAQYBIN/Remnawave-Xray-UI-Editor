import { expect, test } from '@playwright/test'
import { mockApi, mockTemplates, NEW_TEMPLATE_UUID, TEMPLATE_UUID } from './mocks'
import { pickOption } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('список шаблонов открывается переключателем из профилей', async ({ page }) => {
  await mockTemplates(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Шаблоны' }).click()
  await expect(page.getByRole('link', { name: 'Xray Default' })).toBeVisible()
  // Неподдерживаемый тип виден, но не кликается — панель редактирует его сама.
  // heading, а не getByText: карточка ещё содержит чип с тем же словом «MIHOMO»
  await expect(page.getByRole('heading', { name: 'Mihomo' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mihomo' })).toHaveCount(0)
})

test('группа подстановки нарисована на холсте и правится формой', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  const group = page.locator('.react-flow__node[data-id="inj:0"]')
  await expect(group).toBeVisible()
  // Схема именования — префикс "proxy": узел печатает предсказанные теги
  await expect(group).toContainText('proxy')
  await group.click()
  const inspector = page.locator('aside')
  await pickOption(page, inspector.getByLabel('Пул выбора хостов'), 'ALL')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByRole('button', { name: 'Сохранить в панель' })).toBeEnabled()
})

test('в топбаре шаблона нет проверки ядром и рецептов', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await expect(page.getByRole('button', { name: 'Проверить конфиг' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Рецепт/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Куда пойдёт трафик' })).toBeVisible()
})

test('трассировка называет подстановку, а не выдуманный выход', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.getByRole('button', { name: 'Куда пойдёт трафик' }).click()
  await page.getByLabel('Адрес').fill('ya.ru')
  await expect(page.getByText(/подстановка|подставит панель/)).toBeVisible({ timeout: 5000 })
})

test('сохранение проходит и черновик исчезает', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.locator('.react-flow__node[data-id="inj:0"]').click()
  const inspector = page.locator('aside')
  await pickOption(page, inspector.getByLabel('Пул выбора хостов'), 'ALL')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  // exact: true — иначе матчится и заголовок скрытого диалога «Сбросить черновик»
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  // Скоуп по диалогу, а не .last(): у самого диалога — нативная роль и доступное
  // имя (aria-label={title}), кнопка внутри не зависит от порядка узлов в DOM
  await page
    .getByRole('dialog', { name: 'Сохранить в панель' })
    .getByRole('button', { name: /Сохранить|Подтвердить/ })
    .click()
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)
})

test('конфликт по хэшу предлагает загрузить версию панели', async ({ page }) => {
  await mockTemplates(page, { conflict: true })
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.locator('.react-flow__node[data-id="inj:0"]').click()
  const inspector = page.locator('aside')
  await pickOption(page, inspector.getByLabel('Пул выбора хостов'), 'ALL')
  await inspector.getByRole('button', { name: 'Применить' }).click()

  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page
    .getByRole('dialog', { name: 'Сохранить в панель' })
    .getByRole('button', { name: /Сохранить|Подтвердить/ })
    .click()
  await expect(page.getByText('Конфликт версий')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Загрузить версию панели' })).toBeVisible()
})

test('конфликт «Перезаписать» отправляет второй PATCH с хэшем панели и сохраняет', async ({ page }) => {
  // Первый PATCH отвечает 409, второй (уже с хэшем из тела конфликта) — успехом
  await mockTemplates(page, { conflictOnce: true })
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.locator('.react-flow__node[data-id="inj:0"]').click()
  const inspector = page.locator('aside')
  await pickOption(page, inspector.getByLabel('Пул выбора хостов'), 'ALL')
  await inspector.getByRole('button', { name: 'Применить' }).click()

  await page.getByRole('button', { name: 'Сохранить в панель' }).click()
  await page
    .getByRole('dialog', { name: 'Сохранить в панель' })
    .getByRole('button', { name: /Сохранить|Подтвердить/ })
    .click()
  const conflictDialog = page.getByRole('dialog', { name: 'Конфликт версий' })
  await expect(conflictDialog).toBeVisible()

  await conflictDialog.getByRole('button', { name: 'Перезаписать' }).click()
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)
})

test('сброс черновика пишет историю — отмена возвращает правку', async ({ page }) => {
  await mockTemplates(page)
  await page.goto(`/templates/${TEMPLATE_UUID}`)
  await page.locator('.react-flow__node[data-id="inj:0"]').click()
  const inspector = page.locator('aside')
  await pickOption(page, inspector.getByLabel('Пул выбора хостов'), 'ALL')
  await inspector.getByRole('button', { name: 'Применить' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Сбросить к версии панели' }).click()
  const resetDialog = page.getByRole('dialog', { name: 'Сбросить черновик' })
  await expect(resetDialog).toBeVisible()
  await resetDialog.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await expect(page.getByText('черновик', { exact: true })).toHaveCount(0)

  // Сброс обязан записать текущий текст в историю: иначе отменять нечего и
  // кнопка отмены останется заблокированной. Порядок записи и очистки при
  // этом не важен — resetDraft держит текст в замыкании, а не читает из стора
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByText('черновик', { exact: true })).toBeVisible()
})

test('создание уводит в редактор нового шаблона', async ({ page }) => {
  await mockTemplates(page)
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Создать шаблон' }).click()
  await page.getByLabel('Имя шаблона').fill('New One')
  // exact: true — иначе подстрока задевает «Создать шаблон», открывшую диалог
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(NEW_TEMPLATE_UUID))
})

test('удаление спрашивает подтверждение', async ({ page }) => {
  await mockTemplates(page)
  await page.goto('/templates')
  await page.getByRole('button', { name: 'Удалить' }).first().click()
  await expect(page.getByText(/нельзя отменить/)).toBeVisible()
})
