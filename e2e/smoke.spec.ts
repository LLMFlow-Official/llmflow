import { expect, Page, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { compressToParam } from '../lib/share'
import { serializeFlow } from '../lib/flow_file'

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
    // The run marks stay on the canvas after the run ends.
    await page.waitForTimeout(3500)
    await expect(page.getByLabel('Done').first()).toBeVisible()

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

test('builds a flow by chatting and undoes the change', async ({ page }) => {
    const errors = await openApp(page)
    await page.getByRole('button', { name: 'Flows menu' }).click()
    await page.getByRole('button', { name: 'New flow' }).click()
    await page.getByRole('button', { name: 'Blank flow' }).click()

    await page.getByRole('tab', { name: 'Build' }).click()
    const box = page.getByRole('textbox', { name: 'Describe the flow or the change' })
    await box.fill('Translate emails into French')
    await box.press('Enter')
    await expect(page.getByText(/here is a simple example flow/)).toBeVisible()
    await expect(page.getByText('2 nodes added')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Flows menu' })).toContainText('Translate emails into French')

    await page.getByRole('button', { name: 'Run the flow' }).click()
    await expect(page.getByText('(Test answer)').first()).toBeVisible()

    await page.getByRole('tab', { name: 'Build' }).click()
    await page.getByRole('button', { name: 'Undo this change' }).click()
    await expect(page.getByText('Undone')).toBeVisible()
    await expect(page.getByText('AI step', { exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
})

test('answering a question with Cmd/Ctrl+Enter keeps the run going', async ({ page }) => {
    await openApp(page)
    const flow = serializeFlow([
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { thread: 'main' } },
        { id: 'human_input_a1', type: 'human_input', position: { x: 0, y: 150 }, data: { thread: 'main', name: 'Ask', mode: 'text', message: 'Your name?' } },
        { id: 'final_output_a2', type: 'final_output', position: { x: 0, y: 300 }, data: { thread: 'main', name: 'Greeting', value: 'Hello {human_input_a1.value}' } },
    ], [
        { id: 'e1', source: 'start', target: 'human_input_a1' },
        { id: 'e2', source: 'human_input_a1', target: 'final_output_a2' },
    ], 'Greeter')
    await page.goto(`/#flow=${await compressToParam(flow)}`)
    await expect(page.getByRole('button', { name: 'Flows menu' })).toContainText('Greeter')

    await page.getByRole('button', { name: 'Run the flow' }).click()
    const answer = page.getByPlaceholder('Type your answer…')
    await answer.fill('Ada')
    await answer.press('ControlOrMeta+Enter')
    await expect(page.getByText('Hello Ada').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run the flow' })).toBeVisible()
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('completed').first()).toBeVisible()
})

test('has no serious accessibility problems', async ({ page }) => {
    await openApp(page)
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter(v => v.impact == 'serious' || v.impact == 'critical')
    expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
})
