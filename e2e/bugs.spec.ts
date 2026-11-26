import { choose, downloaded, expect, historyCsv, importFile, kpis, newOrg, oppsCsv, pending, row, tab, test, toastText } from './fixtures.ts'

// Known bugs, pinned with `test.fail`. The fix for an issue turns its test into a normal one.
// Everything before the last assertions waits as usual; the last ones are immediate reads of a settled page.

const deal = (id: string, o: { name?: string; stage?: string; amount?: string; close?: string; created?: string; activity?: string; fc?: string; roles?: string } = {}) =>
  `${id},${o.name ?? id},Acme,Ann,East,${o.stage ?? 'Prospecting'},${o.amount ?? '100000'},${o.close ?? '12/15/2026'},${o.created ?? '9/10/2026'},${o.activity ?? '11/6/2026'},Call,${o.fc ?? 'Commit'},${o.roles ?? '3'}`

test('#2 an approved close date is dropped once the deal has closed', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'week1.csv', oppsCsv(deal('A', { close: '10/31/2026' }), deal('B', { close: '10/30/2026' })))
  await tab(page, 'Hygiene')
  await row(page, /^A\b/).getByRole('button', { name: 'Approve 2026-11-20' }).click()
  await expect(page.getByText('1 approved')).toBeVisible()
  await tab(page, 'Data & rules')
  await importFile(page, 'week2.csv', oppsCsv(deal('A', { close: '11/10/2026', stage: 'Closed Won', fc: 'Closed' }), deal('B', { close: '10/30/2026' })))
  await tab(page, 'Hygiene')
  await expect(row(page, /^B\b/)).toBeVisible()
  expect(await page.locator('.badge', { hasText: 'approved' }).textContent()).toBe('0 approved')
})

test('#3 a decimal comma is not a thousands separator', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['euro.csv', oppsCsv(deal('A', { amount: '"1234,50"' }), deal('B', { amount: '"1,234.50"' }))])
  await expect(pending(page, 'euro.csv')).toContainText('2 records ready')
  await pending(page, 'euro.csv').getByRole('button', { name: /^Import/ }).click()
  await tab(page, 'Overview')
  expect((await kpis(page))['Open pipeline']).toContain('$2k | ')
})

test('#4 without history there is no accuracy and nobody is a sandbagger', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('W', { stage: 'Closed Won', close: '9/15/2026', created: '1/10/2026', fc: 'Closed' }), deal('A')))
  await tab(page, 'Overview')
  expect((await kpis(page))['Forecast accuracy (week 3)']).toBe('— | Needs a closed quarter with history')
  expect(await row(page, 'Ann').textContent()).not.toContain('Sandbagging')
})

test('#5 15- and 18-character Salesforce IDs are the same record', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('0065g00000AbCdE', { name: 'Quartz', roles: '' })), 'opps')
  await importFile(page, 'history.csv', 'Id,OpportunityId,CreatedDate,StageName,Amount,CloseDate,ForecastCategory\n1,0065g00000AbCdEAAV,2026-09-12T00:00:00.000Z,Prospecting,100000,2026-10-15,Commit\n2,0065g00000AbCdEAAV,2026-10-01T00:00:00.000Z,Prospecting,100000,2026-11-15,Commit\n3,0065g00000AbCdEAAV,2026-10-20T00:00:00.000Z,Prospecting,100000,2026-12-15,Commit\n', 'history')
  await importFile(page, 'roles.csv', 'OpportunityId,ContactId,Role,IsPrimary\n0065g00000AbCdEAAV,003A,Buyer,true\n0065g00000AbCdEAAV,003B,User,false\n', 'roles')
  await tab(page, 'Hygiene')
  await expect(row(page, /^Quartz/)).toBeVisible()
  expect(await row(page, /^Quartz/).locator('.flag').allTextContents()).toEqual(['Stuck in stage', 'Close date pushed repeatedly'])
})

test.fail('#6 commit today includes the changes made today', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('A')))
  await importFile(page, 'history.csv', historyCsv('A,Forecast Category,Pipeline,Commit,"11/6/2026, 10:00 AM"'))
  await tab(page, 'Overview')
  expect((await kpis(page))['Q4 2026 commit today']).toContain('$100k | ')
})

test.fail('#7 sparse last rows are kept', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['accounts.csv', 'Account ID,Account Name,Website\n001,Acme,acme.com\n002,Beta,\n003,Gamma,\n'])
  await expect(pending(page, 'accounts.csv')).toBeVisible()
  expect(await pending(page, 'accounts.csv').textContent()).toContain('3 records ready from 3 rows')
})

test.fail('#7 a cut-off last row is reported', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['cut.csv', oppsCsv(deal('A')) + 'B,Tw'])
  await expect(pending(page, 'cut.csv')).toBeVisible()
  expect(await pending(page, 'cut.csv').textContent()).toContain('1 records ready from 2 rows, 1 skipped')
})

test.fail('#7 an unclosed quote is reported', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['unclosed.csv', oppsCsv(deal('A'), deal('B').replace('Call', '"Call'), deal('C'))])
  await expect(pending(page, 'unclosed.csv')).toBeVisible()
  expect(await pending(page, 'unclosed.csv').textContent()).toMatch(/line 3.*quote/i)
})

test.fail('#8 an impossible date is an error', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['dates.csv', oppsCsv(deal('A'), deal('B', { close: '2/31/2026' }), deal('C', { close: 'TBD 12' }), deal('D'))])
  await expect(pending(page, 'dates.csv')).toBeVisible()
  expect(await pending(page, 'dates.csv').textContent()).toContain('2 records ready from 4 rows, 2 skipped')
})

test.fail('#9 a formula in a name cannot run from an exported file', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'leads.csv', 'Lead ID,First Name,Last Name,Company,Email,Lead Status\n00QA,=cmd(),Fox,Dune,cy@dune.com,Open\n00QB,=cmd(),Fox,Dune,cy@dune.com,Open\n', 'lead')
  await tab(page, 'Duplicates')
  const plan = await downloaded(page, () => page.getByRole('button', { name: 'Download merge plan CSV' }).click())
  expect(plan.text).not.toMatch(/(^|,|")=cmd/m)
})

test.fail('#10 ISO-8859-1 exports keep their accents', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'latin1.csv', Buffer.from(oppsCsv(deal('A', { name: 'Société', close: '1/5/2026' })), 'latin1'))
  await tab(page, 'Hygiene')
  await expect(page.locator('table.deals tbody tr')).toHaveCount(1)
  expect(await page.locator('table.deals tbody').textContent()).toContain('Société')
})

test.fail('#11 a shared social host does not make two companies one', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'accounts.csv', 'Account ID,Account Name,Website\n001,Blue Bakery,https://www.facebook.com/bluebakery\n002,Zed Plumbing,https://facebook.com/zedplumb\n003,Coda,coda.com\n', 'account')
  await tab(page, 'Duplicates')
  expect((await kpis(page))['Duplicate clusters']).toContain('0 | ')
})

test.fail('#12 a blank amount is rewound', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('A')))
  await importFile(page, 'history.csv', historyCsv('A,Forecast Category,Pipeline,Commit,9/20/2026', 'A,Amount,,100000,10/20/2026'))
  await tab(page, 'Overview')
  expect(await page.getByRole('img', { name: 'Commit waterfall for Q4 2026' }).getAttribute('aria-label')).toContain('$0 at week 1, $100k today')
})

test.fail('#13 separators in a title line do not break the table', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['title.csv', '"Pipeline | EMEA | Q4"\n\n' + oppsCsv(deal('A'), deal('B'))])
  await expect(pending(page, 'title.csv').or(toastText(page).getByText('title.csv')).first()).toBeVisible()
  expect(await page.locator('main').textContent()).toContain('2 records ready from 2 rows')
})

test.fail('#14 the merge plan has no made-up IDs', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'companies.csv', 'Company name,Company domain name,Phone Number,City\nAcme Inc,acme.com,,Oslo\nACME LLC,acme.com,,Oslo\n', 'account')
  await tab(page, 'Duplicates')
  await expect(page.locator('.cluster')).toHaveCount(1)
  const button = page.getByRole('button', { name: 'Download merge plan CSV' })
  const text = await button.isDisabled() ? '' : (await downloaded(page, () => button.click())).text
  expect(text).not.toContain('name:')
})

test.fail('#15 lost to a competitor is not won', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('A', { close: '10/20/2026', stage: 'Closed Lost - Competitor Won', fc: 'Omitted' }), deal('B', { amount: '50000' })))
  await tab(page, 'Overview')
  expect((await kpis(page))['Q4 2026 commit today']).toContain('$50k | ')
})

test.fail('#16 no open deals is not a perfect score', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('A', { close: '10/20/2026', stage: 'Closed Lost', fc: 'Omitted' })))
  await tab(page, 'Overview')
  expect((await kpis(page))['Pipeline hygiene']).not.toContain('100')
})

test.fail('#17 same-minute changes listed newest first are chained', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('A')))
  await importFile(page, 'history.csv', historyCsv('A,Close Date,11/15/2026,12/15/2026,"10/6/2026, 10:00 AM"', 'A,Close Date,10/15/2026,11/15/2026,"10/6/2026, 10:00 AM"'))
  await tab(page, 'Hygiene')
  await expect(row(page, /^A\b/)).toBeVisible()
  expect(await row(page, /^A\b/).textContent()).toContain('pushed 2× · 61d')
})

test.fail('#18 a planned activity does not move the as-of date past today', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv(deal('A', { activity: '3/1/2099' })))
  await tab(page, 'Overview')
  await kpis(page)
  expect(await page.locator('.proj-head').textContent()).not.toContain('2099')
})
