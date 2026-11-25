import * as XLSX from 'xlsx'
import { choose, expect, HAND_OPPS, importFile, kpis, newOrg, oppsCsv, pending, row, tab, test, toastText } from './fixtures.ts'

const sheet = (rows: unknown[][], type: 'xlsx' | 'biff8' = 'xlsx') => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Report')
  return XLSX.write(wb, { type: 'buffer', bookType: type }) as Buffer
}
const HEAD = ['Opportunity ID', 'Opportunity Name', 'Opportunity Owner', 'Stage', 'Amount', 'Close Date']
const imported = async (page: Parameters<typeof newOrg>[0], text: string) => {
  await tab(page, 'Hygiene')
  await expect(page.locator('table.deals')).toContainText(text)
}

test('formatted report: title block and footer are skipped', async ({ page }) => {
  await newOrg(page)
  const csv = '"Open pipeline"\n"As of 11/6/2026"\n\n' + HEAD.join(',') + '\n006A,First,Ann,Prospecting,"$1,200.50",11/30/2026\n006B,Second,Ann,Prospecting,"USD 2,000",12/15/2026\n\n"Grand Totals (2 records)"\n"Confidential Information - Do Not Distribute"\n"Copyright (c) 2000-2026 salesforce.com, inc. All rights reserved."\n'
  await choose(page, ['formatted.csv', csv])
  await expect(pending(page, 'formatted.csv')).toContainText('header on line 4')
  await expect(pending(page, 'formatted.csv')).toContainText('2 records ready from 2 rows')
  await expect(pending(page, 'formatted.csv')).toContainText('Close dates Nov 30, 2026 to Dec 15, 2026')
})

test('BOM, CRLF and tab-separated files', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'bom.csv', '﻿' + HAND_OPPS.replace(/\n/g, '\r\n'), 'opps')
  await importFile(page, 'tabs.tsv', [HEAD, ['T1', 'Tabbed', 'Ann', 'Prospecting', '10', '1/5/2026']].map(r => r.join('\t')).join('\r\n'), 'opps')
  await expect(page.getByText('9 opportunities')).toBeVisible()
})

test('Excel Unicode Text (UTF-16, tabs)', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'unicode.txt', Buffer.from('\ufeff' + [HEAD, ['U1', 'Société', 'Ann', 'Prospecting', '10', '1/5/2026']].map(r => r.join('\t')).join('\r\n') + '\r\n', 'utf16le'), 'opps')
  await imported(page, 'Société')
})

test('Data Loader opportunities and Opportunity History', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', 'ID,NAME,ACCOUNT.NAME,OWNER.NAME,STAGENAME,AMOUNT,CLOSEDATE,CREATEDDATE,LASTACTIVITYDATE,NEXTSTEP,FORECASTCATEGORYNAME\n006A,Loader deal,Acme,Ann,Prospecting,100,2026-12-15,2026-10-01T00:00:00.000Z,2026-11-06,Call,Commit\n', 'opps')
  await importFile(page, 'hist.csv', 'Id,OpportunityId,CreatedDate,StageName,Amount,CloseDate,ForecastCategory\n1,006A,2026-10-01T00:00:00.000Z,Prospecting,100,2026-10-31,Commit\n2,006A,2026-10-10T00:00:00.000Z,Prospecting,100,2026-11-30,Commit\n3,006A,2026-10-20T00:00:00.000Z,Prospecting,100,2026-12-15,Commit\n', 'history')
  // 31 Oct -> 30 Nov -> 15 Dec: 2 pushes, 30 + 15 days.
  await imported(page, 'pushed 2× · 45d')
})

test('contact roles set the single-threaded rule', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'opps.csv', oppsCsv('A,One,Acme,Ann,East,Prospecting,10,12/15/2026,11/1/2026,11/6/2026,Call,Pipeline,', 'B,Two,Acme,Ann,East,Prospecting,10,12/15/2026,11/1/2026,11/6/2026,Call,Pipeline,'), 'opps')
  await importFile(page, 'roles.csv', 'OpportunityId,ContactId,Role,IsPrimary\nA,003A,Buyer,true\nA,003B,User,false\nB,003C,Buyer,true\n', 'roles')
  await tab(page, 'Hygiene')
  await expect(row(page, /^Two/).locator('.flag')).toHaveText(['Single-threaded'])
  await expect(row(page, /^One/)).toHaveCount(0)
})

test('HubSpot deals: no ID column, left out of the Data Loader file', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['hubspot.csv', 'Deal Name;Deal Stage;Amount;Close Date\nHub deal;appointmentscheduled;$2,500;1/5/2026\n'])
  await expect(pending(page, 'hubspot.csv')).toContainText('HubSpot export')
  await expect(pending(page, 'hubspot.csv')).toContainText('No Opportunity ID column')
  await pending(page, 'hubspot.csv').getByRole('button', { name: 'Import 1' }).click()
  await expect(page.getByRole('rowheader', { name: 'hubspot.csv' })).toBeVisible()
  await imported(page, '$2,500')
})

test('contacts and leads', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'contacts.csv', 'Contact ID,First Name,Last Name,Email,Account Name\n003A,Ana,Diaz,ana@coda.com,Coda\n003B,Ana,Diaz,ANA@coda.com,Coda Inc\n003C,Ben,Ash,ben@coda.com,Coda\n', 'contact')
  await importFile(page, 'leads.csv', 'Lead ID,First Name,Last Name,Company,Email,Lead Status\n00QA,Cy,Fox,Dune,cy@dune.com,Open\n00QB,Cy,Fox,Dune LLC,cy@dune.com,Open\n', 'lead')
  await tab(page, 'Duplicates')
  expect((await kpis(page))['Duplicate clusters']).toBe('2 | 0 accounts · 1 contacts · 1 leads')
})

for (const type of ['xlsx', 'biff8'] as const) test(`workbook (${type}): real date cells and numbers`, async ({ page }) => {
  await newOrg(page)
  const name = type === 'xlsx' ? 'report.xlsx' : 'report.xls'
  await importFile(page, name, sheet([['Pipeline report'], [], HEAD, ['006A', 'Sheet deal', 'Ann', 'Prospecting', 1500, 46027]], type), 'opps')
  // Serial 46027 is 5 Jan 2026.
  await imported(page, 'Jan 5, 2026')
  await imported(page, '$1,500')
})

test('a workbook with separators in its title', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'report.xlsx', sheet([['Pipeline | EMEA | Q4; weekly; all | reps | teams | deals'], [], HEAD, ['006A', 'Sheet | deal', 'Ann', 'Prospecting', 1500, 46027]]), 'opps')
  await imported(page, 'Sheet | deal')
})

test('re-import updates by ID instead of duplicating', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'one.csv', HEAD.join(',') + '\nA,One,Ann,Prospecting,10,1/5/2026\n')
  await importFile(page, 'two.csv', HEAD.join(',') + '\nA,One,Ann,Prospecting,20,1/6/2026\n')
  await expect(page.getByText('1 opportunities')).toBeVisible()
  await imported(page, '$20')
})

test('bad rows are listed with their line and the good ones still import', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['mixed.csv', HEAD.join(',') + '\nA,One,Ann,Prospecting,100,11/30/2026\nB,Two,Ann,,100,11/30/2026\nC,Three,Ann,Prospecting,abc,11/30/2026\nD,Four,Ann,Prospecting,10,someday\n'])
  const p = pending(page, 'mixed.csv')
  await expect(p).toContainText('1 records ready from 4 rows, 3 skipped')
  await expect(p.locator('.error-row')).toHaveText(['line 3Stage is empty', 'line 4"abc" in Amount is not a number', 'line 5"someday" in Close date is not a date'])
})

test('a column can be mapped by hand', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['odd.csv', 'Opportunity ID,Opportunity Name,Stage,Expected By\nA,One,Prospecting,1/5/2026\n'])
  const p = pending(page, 'odd.csv')
  await expect(p).toContainText('Required column "Close date" is not mapped.')
  await expect(p.getByRole('button', { name: /^Import/ })).toBeDisabled()
  await p.getByLabel('Close date *').selectOption({ label: 'Expected By' })
  await p.getByRole('button', { name: 'Import 1' }).click()
  await imported(page, 'Jan 5, 2026')
})

test('empty and header-only files say so', async ({ page }) => {
  await newOrg(page)
  for (const [name, body] of [['empty.csv', ''], ['header.csv', HEAD.join(',') + '\n'], ['blank.csv', '\n\n\n'], ['empty.xlsx', sheet([])]] as const) {
    await choose(page, [name, body])
    await expect(toastText(page)).toContainText(`${name} has no data rows.`)
    await expect(pending(page, name)).toHaveCount(0)
  }
})

test('a picture or a cut-off workbook is refused', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['logo.xlsx', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')])
  await expect(toastText(page)).toContainText('logo.xlsx:')
  const whole = sheet([HEAD, ['006A', 'Sheet deal', 'Ann', 'Prospecting', 1500, 46027]])
  await choose(page, ['cut.xlsx', whole.subarray(0, whole.length / 2)])
  await expect(toastText(page)).toContainText('cut.xlsx:')
  await expect(page.getByText('Column mapping')).toHaveCount(0)
})

test('unrelated CSV and JSON cannot be imported', async ({ page }) => {
  await newOrg(page)
  await choose(page, ['expenses.csv', 'Day,Shop,Total\n1/1/2026,Cafe,4\n1/2/2026,Cafe,5\n'])
  await expect(pending(page, 'expenses.csv').getByRole('button', { name: /^Import/ })).toBeDisabled()
  await expect(pending(page, 'expenses.csv')).toContainText('Required column "Stage" is not mapped.')
  await choose(page, ['data.txt', '{"deals":[\n{"a":1,"b":2,"c":3},\n{"a":1,"b":2,"c":3}]}'])
  await expect(toastText(page).or(pending(page, 'data.txt')).first()).toBeVisible()
  if (await pending(page, 'data.txt').count()) await expect(pending(page, 'data.txt').getByRole('button', { name: /^Import/ })).toBeDisabled()
})
