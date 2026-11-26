import { downloaded, expect, importFile, newOrg, oppsCsv, row, tab, test } from './fixtures.ts'

const deal = (close: string, activity = '11/6/2026') => oppsCsv(`A,Alpha,Acme,Ann,East,Prospecting,100,${close},9/10/2026,${activity},Call,Commit,3`)

test('an approval survives an unchanged re-import and lapses when the rep moves the date', async ({ page }) => {
  await newOrg(page)
  await importFile(page, 'week1.csv', deal('10/31/2026'))
  await tab(page, 'Hygiene')
  await row(page, /^Alpha/).getByRole('button', { name: 'Approve 2026-11-20' }).click()
  await expect(page.getByText('1 approved')).toBeVisible()
  await tab(page, 'Data & rules')
  await importFile(page, 'same.csv', deal('10/31/2026'))
  await tab(page, 'Hygiene')
  await expect(page.getByText('1 approved')).toBeVisible()
  expect((await downloaded(page, () => page.getByRole('button', { name: 'Download update CSV' }).click())).text).toContain('A,2026-11-20,Alpha,2026-10-31')

  await tab(page, 'Data & rules')
  await importFile(page, 'moved.csv', deal('11/3/2026'))
  await tab(page, 'Hygiene')
  await expect(page.getByText('0 approved')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download update CSV' })).toBeDisabled()
  await row(page, /^Alpha/).getByRole('button', { name: 'Approve 2026-11-20' }).click()
  await expect(page.getByText('1 approved')).toBeVisible()
  await row(page, /^Alpha/).getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('0 approved')).toBeVisible()
})
