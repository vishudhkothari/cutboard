import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { shiftDay, today } from '../src/lib/planEngine.js'

// Fresh demo contexts only; no real account or browser profile is used.
const date = today(), year = +date.slice(0, 4), key = 'cutboard:demo:v3'
const setup = { name: 'Consistency check', age: 30, height: 180, sex: 'male', startWeight: 85, startBF: 20, goalBF: 12, goalWeight: 79, startDate: `${year - 1}-12-20`, cutLength: 365, stepGoal: 10000, activity: 'mod', manualCalTarget: 2000 }
const log = (day, fields = {}) => ({ date: day, steps: 10000, sleep: 7.5, meals: [{ name: 'Daily food', cals: 2000, protein: 140 }], foodComplete: true, activityComplete: true, planSnapshot: { source: 'captured', eatTarget: 2000, stepGoal: 10000 }, ...fields })
const historicalDate = `${year - 1}-12-31`
const seed = [['setup', setup], ['recipes', []], ['workout_history', []], ['routines', []]]
for (let offset = 119; offset >= 5; offset--) {
  const day = shiftDay(date, -offset)
  if (day < setup.startDate || offset % 9 === 0) continue
  seed.push([`log:${day}`, log(day, { steps: offset % 5 === 0 ? 8000 : 10000, sleep: offset % 4 === 0 ? 6 : 7.5, meals: [{ name: 'Daily food', cals: offset % 7 === 0 ? 2400 : 2000, protein: 140 }] })])
}
seed.push(
  [`log:${historicalDate}`, log(historicalDate, { steps: 6000, meals: [{ name: 'Old food', cals: 1800 }], planSnapshot: { source: 'captured', eatTarget: 1800, stepGoal: 6000 } })],
  [`log:${shiftDay(date, -4)}`, log(shiftDay(date, -4), { meals: [{ name: 'Daily food', cals: 2500 }] })],
  [`log:${shiftDay(date, -2)}`, log(shiftDay(date, -2), { steps: 5000, sleep: 6, meals: [{ name: 'Lunch', cals: 1200 }], foodComplete: false, activityComplete: false })],
  [`log:${shiftDay(date, -1)}`, log(shiftDay(date, -1), { steps: 8000, planSnapshot: { source: 'captured', eatTarget: 2000, stepGoal: 8000 } })],
  [`log:${date}`, log(date, { foodComplete: false, activityComplete: false })],
)
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
await context.addInitScript(({ key, seed }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed)) }, { key, seed })
const page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(10000)
const progress = () => page.getByRole('button', { name: 'Progress', exact: true }).first().click()
const panel = page.locator('section.consistency')
const cell = day => panel.locator(`button[data-date="${day}"]`)
const level = day => cell(day).getAttribute('data-level')
await mkdir('artifacts', { recursive: true })
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  await progress()
  await panel.getByRole('heading', { name: 'Consistency', exact: true }).waitFor()
  assert.equal(await level(date), '3')
  assert.equal(await level(shiftDay(date, -1)), '3')
  assert.equal(await level(shiftDay(date, -2)), '0')
  assert.equal(await level(shiftDay(date, -3)), 'empty')
  assert.equal(await level(shiftDay(date, -4)), '2')
  assert.equal(await panel.getByText('Target met', { exact: true }).count(), 3)
  assert.doesNotMatch(await panel.innerText(), /Finish food log|Confirm final steps/)
  for (const [name, expected] of [['Diet', '3'], ['Steps', '3'], ['Sleep', '3'], ['All habits', '3']]) {
    await panel.getByRole('button', { name, exact: true }).click()
    assert.equal(await level(date), expected)
  }
  await cell(shiftDay(date, -4)).click()
  await panel.getByText('Outside target', { exact: true }).waitFor()
  await cell(date).focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(await cell(shiftDay(date, -7)).getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('End')
  assert.equal(await cell(date).getAttribute('aria-pressed'), 'true')
  await panel.getByLabel('Consistency year').selectOption(String(year - 1))
  assert.equal(await level(historicalDate), '3')
  assert.equal(await cell(historicalDate).getAttribute('aria-pressed'), 'true')
  assert.match(await panel.locator('.consistency-detail').innerText(), /1,800 \/ 1,800 kcal/)
  assert.match(await panel.locator('.consistency-detail').innerText(), /6,000 \/ 6,000 steps/)
  await panel.getByLabel('Consistency year').selectOption(String(year))
  const future = shiftDay(date, 1)
  if (future.startsWith(String(year))) assert.equal(await cell(future).isDisabled(), true)
  console.log('PASS saved totals score without sign-off, habit filters, calendar gaps, historical goals, year navigation and keyboard selection')

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1100 })
    await panel.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}px`)
    assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), `Card overflow at ${width}px`)
    const scroll = panel.locator('.consistency-scroll')
    if (width < 768) {
      assert.ok(await scroll.evaluate(element => element.scrollWidth > element.clientWidth), 'Calendar should scroll within the card')
      await scroll.evaluate(element => { element.scrollLeft = 0 })
      assert.equal(await scroll.evaluate(element => element.scrollLeft), 0)
      await cell(date).scrollIntoViewIfNeeded()
    }
    await panel.screenshot({ path: `artifacts/consistency-${width}.png` })
  }
  await cell(shiftDay(date, -1)).click()
  await panel.getByRole('button', { name: /Open .* log/ }).click()
  assert.equal(await page.getByLabel('Steps', { exact: true }).inputValue(), '8000')
  const persisted = await page.evaluate(({ key, date }) => new Map(JSON.parse(localStorage.getItem(key))).get(`log:${date}`), { key, date })
  assert.deepEqual(persisted, seed.find(([name]) => name === `log:${date}`)[1])
  console.log('PASS desktop and 390px/320px layouts, contained calendar scrolling, and opening a historical daily log')

  const emptyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await emptyContext.addInitScript(({ key, setup, date }) => localStorage.setItem(key, JSON.stringify([['setup', { ...setup, startDate: date }]])), { key, setup, date })
  const emptyPage = await emptyContext.newPage()
  emptyPage.on('pageerror', error => errors.push(error.message))
  await emptyPage.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  await emptyPage.getByRole('button', { name: 'Progress', exact: true }).first().click()
  await emptyPage.getByRole('heading', { name: 'Consistency', exact: true }).waitFor()
  assert.equal(await emptyPage.locator(`.consistency-cell[data-date="${date}"]`).getAttribute('data-level'), 'empty')
  assert.doesNotMatch(await emptyPage.locator('section.consistency').innerText(), /NaN|undefined|Infinity/)
  assert.equal(await emptyPage.locator('.consistency-stats strong').first().innerText(), '0 / 1')
  await emptyContext.close()

  const zeroContext = await browser.newContext({ serviceWorkers: 'block' })
  await zeroContext.addInitScript(({ key, setup, date, yesterday, start }) => localStorage.setItem(key, JSON.stringify([
    ['setup', { ...setup, startDate: start }],
    [`log:${date}`, { date, steps: 0, sleep: 0, meals: [] }],
    [`log:${yesterday}`, { date: yesterday, steps: '10000', sleep: '8', meals: [] }],
  ])), { key, setup, date, yesterday: shiftDay(date, -1), start: shiftDay(date, -6) })
  const zeroPage = await zeroContext.newPage()
  zeroPage.on('pageerror', error => errors.push(error.message))
  await zeroPage.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  await zeroPage.getByRole('button', { name: 'Progress', exact: true }).first().click()
  assert.match(await zeroPage.getByText('7d Avg Sleep', { exact: true }).locator('..').innerText(), /4\s*hrs/)
  assert.match(await zeroPage.getByText('7d Avg Steps', { exact: true }).locator('..').innerText(), /5,000/)
  await zeroContext.close()
  assert.deepEqual(errors, [])
  console.log('PASS first-day empty state, recorded zeros in averages, missing days excluded and no browser runtime errors')
} finally {
  await context.close()
  await browser.close()
}
