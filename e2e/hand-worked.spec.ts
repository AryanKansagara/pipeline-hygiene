import { downloaded, expect, handOrg, historyCsv, importFile, kpis, newOrg, oppsCsv, row, tab, test } from './fixtures.ts'

// Every expected number below was worked out on paper from the rows in fixtures.ts and the documented rules.

test('hygiene: scores, flags and roll-ups', async ({ page }) => {
  await handOrg(page)
  await tab(page, 'Overview')
  const k = await kpis(page)
  // Alpha 100-15 (2 pushes); Beta 100-25-20-10-15-10 (past due, 36 idle days, no step, 0 amount, 1 role); Gamma 100;
  // Epsilon 100-15 (88 days in stage). (85+20+100+85)/4 = 72.5, rounded 73. 1 of 4 clean.
  expect(k['Pipeline hygiene']).toBe('73/100 | 25% of open deals are clean')
  // Open 100+0+50+30 = 180k; all but Gamma flagged = 130k.
  expect(k['Open pipeline']).toBe('$180k | $130k sits on flagged deals')
  // Ann (85+20)/2 = 52.5; Bob (100+85)/2 = 92.5.
  await expect(row(page, 'Ann Lee')).toContainText('53')
  await expect(row(page, 'Bob Ray')).toContainText('93')
  await expect(page.getByText('data as of Nov 6, 2026')).toBeVisible()

  await tab(page, 'Hygiene')
  await expect(row(page, /^Alpha/).locator('.flag')).toHaveText(['Close date pushed repeatedly'])
  // 15 Oct to 15 Nov is 31 days, 15 Nov to 15 Dec is 30.
  await expect(row(page, /^Alpha/)).toContainText('pushed 2× · 61d')
  await expect(row(page, /^Alpha/)).toContainText('17d in stage')
  await expect(row(page, /^Beta/).locator('.flag')).toHaveText(['Close date in the past', 'No recent activity', 'Missing next step', 'Amount is 0 or blank', 'Single-threaded'])
  await expect(row(page, /^Beta/)).toContainText('20')
  await expect(row(page, /^Epsilon/).locator('.flag')).toHaveText(['Stuck in stage'])
  await expect(row(page, /^Epsilon/)).toContainText('88d in stage')
  await expect(row(page, /^Gamma/)).toHaveCount(0)
})

test('commit waterfall and weekly call', async ({ page }) => {
  await handOrg(page)
  await tab(page, 'Overview')
  // 1 Oct: Alpha 100 (close 15 Nov then) + Delta 40 + Epsilon 30 (close 10 Dec then) = 170k.
  // Epsilon moves to January on 14 Oct (week 2). Today: Delta won 40 + Alpha 100 = 140k. Fewer than 5 closed deals: no realistic slip.
  await expect(page.getByRole('img', { name: 'Commit waterfall for Q4 2026' })).toHaveAttribute('aria-label', 'Commit waterfall for Q4 2026: $170k at week 1, $140k today, $140k after realistic close dates')
  expect((await kpis(page))['Q4 2026 commit today']).toBe('$140k | Realistic: $140k (0 deals likely to slip)')
  await page.getByRole('button', { name: /^Wk 2:/ }).click()
  await expect(page.locator('.step-detail')).toContainText('−$30,000 net')
  await expect(page.locator('.step-detail li')).toHaveText(['pushed Epsilon · Bob Ray −$30k'])

  await tab(page, 'Forecast & slippage')
  // Won, Commit (with won), Best case (+ Gamma 50), Pipeline (+ Beta 0).
  await expect(page.getByRole('row').filter({ hasText: 'Oct 1, 2026' }).first().getByRole('cell')).toHaveText(['Oct 1, 2026', '$0', '$170k', '$170k', '$170k'])
  await expect(page.getByRole('row').filter({ hasText: 'Nov 5, 2026' }).first().getByRole('cell')).toHaveText(['Nov 5, 2026', '$40k', '$140k', '$190k', '$190k'])
})

test('forecast accuracy, slippage and velocity', async ({ page }) => {
  await handOrg(page)
  await tab(page, 'Forecast & slippage')
  // Q3, week 3 = 15 Jul. Called: Zeta 80 + Theta 60 = 140k (Eta was Best Case). Won: 80 + 20 = 100k. Error +40%.
  const cells = (n: string) => page.locator('.panel', { hasText: 'Accuracy by rep' }).getByRole('row').filter({ has: page.getByRole('rowheader', { name: n }) }).getByRole('cell')
  await expect(cells('Whole team')).toHaveText(['40%', '+40%', 'Over-forecasting', '+40%'])
  // Ann called 80, won 100: -20%. Bob called 60, won 0: a 100% miss.
  await expect(cells('Ann Lee')).toHaveText(['20%', '−20%', 'Accurate', '−20%'])
  await expect(cells('Bob Ray')).toHaveText(['100%', '+100%', 'Over-forecasting', '+100%'])
  await expect(page.getByRole('img', { name: 'Forecast accuracy 60%' })).toBeVisible()
  // 14 Oct 10 Dec -> 20 Jan = 41 days.
  await expect(page.locator('.panel', { hasText: 'Most-pushed open deals' }).last().getByRole('row').filter({ hasText: 'Epsilon' }).getByRole('cell')).toHaveText(['1', '41', 'Dec 10, 2026 → Jan 20, 2027'])
  // 3 won of 4 closed; (72+132+97)/3 = 100.3 days; 140k/3 = 46.7k; 4 open * 0.75 * 46,667 / 100.33 = 1,395 a day.
  await expect(page.getByText('Win rate 75% · cycle 100 days · avg won $47k · velocity $1k/day')).toBeVisible()
})

test('approved fix, rep email and commit pack', async ({ page }) => {
  await handOrg(page)
  await tab(page, 'Hygiene')
  // Past due and no push pattern to learn from: 6 Nov + 14 days.
  await row(page, /^Beta/).getByRole('button', { name: 'Approve 2026-11-20' }).click()
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Download update CSV' }).click())
  expect(csv.name).toBe('close-date-updates-2026-11-06.csv')
  expect(csv.text).toBe('Id,CloseDate,"Name (reference only, do not map)",Previous CloseDate (reference only)\r\nBETA,2026-11-20,Beta,2026-10-31\r\n')

  await page.getByLabel('Rep', { exact: true }).selectOption('Ann Lee')
  await expect(page.locator('pre.email')).toContainText('2 of your open deals ($100,000) need a quick update')
  await expect(page.locator('pre.email')).toContainText('1. Beta (Bolt, $0, Prospecting)')
  await expect(page.locator('pre.email')).toContainText('close date pushed 2 times (61 days): what changed?')

  await page.getByRole('link', { name: 'Forecast-call pack' }).click()
  expect((await kpis(page))['Commit called']).toBe('$140k | −$30k since week 1')
  const pack = await downloaded(page, () => page.getByRole('button', { name: 'Download commit deals CSV' }).click())
  expect(pack.text.trim().split('\r\n').slice(1)).toEqual(['ALPHA,Alpha,Ann Lee,Negotiation/Review,100000,2026-12-15,,,85,pushed'])
})

test('rules: weights, switches and thresholds move the score as worked out', async ({ page }) => {
  await handOrg(page)
  // Past due costs 5 instead of 25: Beta 40. (85+40+100+85)/4 = 77.5 -> 78.
  const weight = page.getByLabel('Weight for Close date in the past')
  await weight.fill('5')
  await expect(weight).toHaveValue('5')
  // Stuck in stage off: Epsilon 100. (85+40+100+100)/4 = 81.25 -> 81, 2 of 4 clean.
  const stuck = page.getByLabel('Enable Stuck in stage')
  await stuck.dispatchEvent('click')
  await expect(stuck).not.toBeChecked()
  // Three pushes needed: Alpha 100. (100+40+100+100)/4 = 85, 3 of 4 clean.
  const pushes = page.getByLabel('Flag after N close-date pushes')
  await pushes.fill('3')
  await expect(pushes).toHaveValue('3')
  await tab(page, 'Overview')
  expect((await kpis(page))['Pipeline hygiene']).toBe('85/100 | 75% of open deals are clean')
})

test('duplicates: confidence, master, merge plan and survivorship', async ({ page }) => {
  await newOrg(page)
  // 001B fills the most fields. Same name 0.85 and same domain 0.8: 1 - 0.15*0.2 = 97%. 001E shares neither.
  await importFile(page, 'accounts.csv', [
    'Account ID,Account Name,Website,Phone,Industry',
    '001A,Acme Inc,https://www.acme.com,,',
    '001B,"ACME, Inc.",acme.com,(415) 555-0100,Software',
    '001C,Acme LLC,http://acme.com/about,,Retail',
    '001D,The Acme Co.,acme.com,,Retail',
    '001E,Zenith Freight,zenith.com,(212) 555-0177,Freight',
  ].join('\n'), 'account')
  await tab(page, 'Duplicates')
  const k = await kpis(page)
  expect(k['Records checked']).toContain('5 | ')
  expect(k['Duplicate clusters']).toBe('1 | 1 accounts · 0 contacts · 0 leads')
  expect(k['Records to merge away']).toBe('3 | 60.0% of the base')
  // 1 master + 3 duplicates at most 2 per call = 2 merges.
  expect(k['Merge operations']).toContain('2 | ')
  await expect(page.locator('.cluster .conf')).toHaveText('97%')
  await expect(page.locator('.members .master')).toContainText('001B')

  const plan = await downloaded(page, () => page.getByRole('button', { name: 'Download merge plan CSV' }).click())
  expect(plan.text.trim().split('\r\n').slice(1)).toEqual([
    'Account,A1,1,001B,"ACME, Inc.",001A,Acme Inc,001C,Acme LLC,97%,Same normalised name; Same domain (acme.com)',
    'Account,A1,2,001B,"ACME, Inc.",001D,The Acme Co.,,,97%,Same normalised name; Same domain (acme.com)',
  ])
  const surv = await downloaded(page, () => page.getByRole('button', { name: 'Survivorship preview CSV' }).click())
  expect(surv.text).toContain('A1,001B,Industry,Software,001B,Retail')
  expect(surv.text).not.toContain('Phone')

  await page.getByRole('button', { name: 'Not duplicates' }).click()
  await expect(page.getByText('No clusters at this threshold.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('1 cluster marked as not duplicates.')).toBeVisible()
})

test('a close date moved earlier is not a push', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv('A,Alpha,Acme,Ann,East,Prospecting,100,12/15/2026,9/1/2026,11/6/2026,Call,Commit,3'))
  // 15 Nov -> 30 Dec is a push of 45 days; 30 Dec -> 15 Dec is a pull-in. One push stays under the limit of two.
  await importFile(page, 'history.csv', historyCsv('A,Close Date,11/15/2026,12/30/2026,10/1/2026', 'A,Close Date,12/30/2026,12/15/2026,10/20/2026'))
  await tab(page, 'Hygiene')
  await expect(row(page, /^Alpha/)).toContainText('pushed 1× · 45d')
  await expect(row(page, /^Alpha/).locator('.flag')).toHaveText(['Stuck in stage'])
})
