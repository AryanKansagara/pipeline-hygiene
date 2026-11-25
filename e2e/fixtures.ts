import { readFileSync } from 'node:fs'
import { test as base, expect, type Locator, type Page } from '@playwright/test'

/** The only external hosts the page asks for: web fonts in index.html. They are answered with an empty stylesheet. */
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export const test = base.extend<{ guard: void }>({
  // Every test: only the app is reachable, and an uncaught page error fails the test.
  guard: [
    async ({ context, baseURL }, use) => {
      const errors: string[] = []
      const external: string[] = []
      const origin = new URL(baseURL!).origin
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin === origin) return route.continue()
        external.push(url.host)
        if (FONT_HOSTS.has(url.host)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
        return route.abort('blockedbyclient')
      })
      context.on('weberror', (e) => errors.push(String(e.error())))
      // The clipboard is replaced so a test can read what the page copied without browser permissions.
      await context.addInitScript(() => {
        const copied: string[] = []
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true })
        Object.assign(window, { __copied: copied })
      })
      await use()
      expect(errors, 'uncaught page errors').toEqual([])
      expect(external.filter((h) => !FONT_HOSTS.has(h)), 'requests to other hosts').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

export const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? '')

/** Creates an empty org and stops on its Data & rules tab. */
export async function newOrg(page: Page) {
  await page.goto('/app')
  const first = page.getByRole('button', { name: 'Import your data' })
  await first.or(page.getByRole('button', { name: 'New org' })).first().click()
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible()
}

/** Hands files to the importer without importing them. */
export const choose = (page: Page, ...files: [name: string, body: string | Buffer][]) =>
  page.locator('input[type=file]').setInputFiles(files.map(([name, body]) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) })))

/** The panel of a chosen file that is waiting to be imported. */
export const pending = (page: Page, name: string): Locator => page.locator('.panel').filter({ has: page.getByRole('heading', { name, exact: true }) }).filter({ hasText: 'Column mapping' })

/** Chooses a file, imports it and waits until the org lists it. */
export async function importFile(page: Page, name: string, body: string | Buffer, kind?: string) {
  await choose(page, [name, body])
  const p = pending(page, name)
  await expect(p).toBeVisible()
  if (kind) await expect(p.getByLabel('Object')).toHaveValue(kind)
  await p.getByRole('button', { name: /^Import / }).click()
  await expect(p).toHaveCount(0)
  await expect(page.getByRole('rowheader', { name, exact: true })).toBeVisible()
}

export async function tab(page: Page, name: 'Overview' | 'Hygiene' | 'Forecast & slippage' | 'Duplicates' | 'History' | 'Data & rules') {
  const link = page.getByRole('navigation', { name: 'Org sections' }).getByRole('link', { name, exact: true })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
}

/** Headline tiles as label -> "value | small print". */
export async function kpis(page: Page) {
  await expect(page.locator('.kpi').first()).toBeVisible()
  const rows = await page.locator('.kpi').evaluateAll((els) => els.map((e) => [e.querySelector('small')?.textContent ?? '', `${e.querySelector('b')?.textContent ?? ''} | ${e.querySelector('p')?.textContent ?? ''}`]))
  return Object.fromEntries(rows)
}

/** Text of every cell of a table row found by its row header. */
export const row = (page: Page, name: string | RegExp) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) })

export async function downloaded(page: Page, click: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), click()])
  return { name: d.suggestedFilename(), text: readFileSync((await d.path())!, 'utf8') }
}

export const toastText = (page: Page) => page.locator('.toasts')

const OPP_HEAD = 'Opportunity ID,Opportunity Name,Account Name,Opportunity Owner,Owner Role,Stage,Amount,Close Date,Created Date,Last Activity,Next Step,Forecast Category,# of Contact Roles'
/** An Opportunities report from its data rows. */
export const oppsCsv = (...rows: string[]) => [OPP_HEAD, ...rows].join('\n') + '\n'
/** A Field History report from its data rows. */
export const historyCsv = (...rows: string[]) => ['Opportunity ID,Field / Event,Old Value,New Value,Edit Date', ...rows].join('\n') + '\n'

/**
 * The hand-worked org. Everything is at midnight, the latest date is 6 Nov 2026 (the as-of date), quarter Q4 2026.
 * Open deals: Alpha 85, Beta 20, Gamma 100, Epsilon 85 (the derivations are in hand-worked.spec.ts).
 */
export const HAND_OPPS = oppsCsv(
  'ALPHA,Alpha,Acme,Ann Lee,East,Negotiation/Review,100000,12/15/2026,9/1/2026,11/6/2026,Sign,Commit,3',
  'BETA,Beta,Bolt,Ann Lee,East,Prospecting,0,10/31/2026,10/20/2026,10/1/2026,,Pipeline,1',
  'GAMMA,Gamma,Coda,Bob Ray,West,Qualification,50000,12/1/2026,10/25/2026,11/5/2026,Demo,Best Case,2',
  'DELTA,Delta,Dune,Bob Ray,West,Closed Won,40000,10/12/2026,8/1/2026,10/12/2026,,Closed,2',
  'EPSILON,Epsilon,Echo,Bob Ray,West,Proposal/Price Quote,30000,1/20/2027,8/10/2026,11/5/2026,Legal,Commit,2',
  'ZETA,Zeta,Zinc,Ann Lee,East,Closed Won,80000,9/10/2026,5/1/2026,9/10/2026,,Closed,2',
  'ETA,Eta,Etch,Ann Lee,East,Closed Won,20000,9/20/2026,6/15/2026,9/20/2026,,Closed,2',
  'THETA,Theta,Thorn,Bob Ray,West,Closed Lost,60000,8/30/2026,5/10/2026,8/30/2026,,Omitted,2',
)
export const HAND_HISTORY = historyCsv(
  'ALPHA,Close Date,10/15/2026,11/15/2026,9/20/2026',
  'ALPHA,Forecast Category,Pipeline,Commit,9/25/2026',
  'ALPHA,Close Date,11/15/2026,12/15/2026,10/20/2026',
  'ALPHA,Stage,Proposal/Price Quote,Negotiation/Review,10/20/2026',
  'DELTA,Forecast Category,Pipeline,Commit,8/5/2026',
  'DELTA,Forecast Category,Commit,Closed,10/12/2026',
  'DELTA,Stage,Negotiation/Review,Closed Won,10/12/2026',
  'EPSILON,Forecast Category,Pipeline,Commit,9/1/2026',
  'EPSILON,Close Date,12/10/2026,1/20/2027,10/14/2026',
  'ZETA,Forecast Category,Pipeline,Commit,6/1/2026',
  'ZETA,Forecast Category,Commit,Closed,9/10/2026',
  'ZETA,Stage,Negotiation/Review,Closed Won,9/10/2026',
  'ETA,Forecast Category,Best Case,Commit,9/15/2026',
  'ETA,Forecast Category,Commit,Closed,9/20/2026',
  'ETA,Stage,Negotiation/Review,Closed Won,9/20/2026',
  'THETA,Forecast Category,Pipeline,Commit,6/1/2026',
  'THETA,Forecast Category,Commit,Omitted,8/30/2026',
  'THETA,Stage,Negotiation/Review,Closed Lost,8/30/2026',
)

export async function handOrg(page: Page) {
  await newOrg(page)
  await importFile(page, 'opps.csv', HAND_OPPS, 'opps')
  await importFile(page, 'history.csv', HAND_HISTORY, 'fieldHistory')
}
