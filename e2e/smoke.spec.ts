import { expect, Page, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** A fresh browser with the intro seen and the Test API on. */
async function openApp(page: Page) {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() == 'error' && /Content Security Policy|Refused/.test(m.text())) errors.push(m.text()) })
    await page.addInitScript(() => {
        if (localStorage.getItem('e2e-ready')) return
        localStorage.setItem('e2e-ready', '1')
        localStorage.setItem('introVersion', '2')
        localStorage.setItem('flow-setting-store', JSON.stringify({
            state: { apiKeys: { openai: '', anthropic: '', google: '', compatible: '' }, compatibleBaseUrl: '', rememberKeys: true, analyticsEnabled: false, theme: 'light', maxParallelRequests: 4, requestTimeoutSeconds: 600, devMode: { testOpenAPI: true, showTreads: false, showPropData: false }, accountModels: {} },
            version: 1,
        }))
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Flows menu' })).toBeVisible()
    return errors
}

async function newFlowFromTemplate(page: Page, template: string) {
    await page.getByRole('button', { name: 'Flows menu' }).click()
    await page.getByRole('button', { name: 'New flow' }).click()
    await page.getByRole('button', { name: template }).click()
    await expect(page.getByRole('button', { name: 'Flows menu' })).toContainText(template)
}

test('runs a template flow with the Test API and keeps it in history', async ({ page }) => {
    const errors = await openApp(page)
    await newFlowFromTemplate(page, 'Summarize a text')

    await page.getByRole('button', { name: 'Run the flow' }).click()
    await expect(page.getByText('(Test answer from Summarize)').first()).toBeVisible()

    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('completed').first()).toBeVisible()
    expect(errors).toEqual([])
})

test('reloading keeps the flows', async ({ page }) => {
    await openApp(page)
    await newFlowFromTemplate(page, 'Research with web search')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Flows menu' })).toContainText('Research with web search')
})

test('a loop processes every item', async ({ page }) => {
    await openApp(page)
    await newFlowFromTemplate(page, 'Process a list item by item')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(page.getByText('Ran 3 items')).toBeVisible()
})

test('has no serious accessibility problems', async ({ page }) => {
    await openApp(page)
    const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
    const serious = results.violations.filter(v => v.impact == 'serious' || v.impact == 'critical')
    expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
})
