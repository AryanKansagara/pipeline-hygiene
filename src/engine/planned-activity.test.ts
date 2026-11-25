import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asOfDate, hygiene } from './pipeline.ts'
import { DAY, defaultConfig, type Dataset, type Opp } from './types.ts'

const D = (m: number, d: number, h = 0) => Date.UTC(2026, m - 1, d, h)
const opp = (o: Partial<Opp> = {}): Opp => ({ id: 'A', name: 'A', account: '', owner: 'Ann', team: 'East', stage: 'Prospecting', amount: 100, closeDate: D(12, 15), created: D(11, 1), lastActivity: D(11, 5), nextStep: 'Call', forecastCategory: 'Commit', ...o })
const org = (...opps: Opp[]): Dataset => ({ opps, history: [], parties: [] })
const cfg = defaultConfig()
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const zone = (tz: string, f: () => void) => { const was = process.env.TZ; process.env.TZ = tz; try { f() } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was } }

test('a planned activity does not set the as-of date', () => {
  const ds = org(opp(), opp({ id: 'B', lastActivity: Date.UTC(2099, 2, 1) }))
  assert.equal(iso(asOfDate(ds, cfg, D(11, 10, 12))), '2026-11-05')
  const h = hygiene(ds, cfg)
  assert.equal(iso(h.asOf), '2026-11-05')
  assert.ok(h.rows.every(r => !r.flags.includes('pastDue') && !r.flags.includes('stale')))
})

test('future created dates and changes are ignored too', () => {
  const ds = org(opp({ created: D(12, 1), lastActivity: undefined }), opp({ id: 'B' }))
  ds.history.push({ oppId: 'B', at: D(12, 2), field: 'amount', from: 1, to: 2 })
  assert.equal(iso(asOfDate(ds, cfg, D(11, 10, 12))), '2026-11-05')
})

test('with nothing up to today the as-of date is today', () => {
  assert.equal(iso(asOfDate(org(opp({ created: D(12, 1), lastActivity: D(12, 2) })), cfg, D(11, 10, 12))), '2026-11-10')
})

test('today counts, by the calendar of the reader', () => {
  zone('UTC', () => assert.equal(iso(asOfDate(org(opp({ lastActivity: D(11, 10) })), cfg, D(11, 10, 1))), '2026-11-10'))
  // 10 Nov 08:00 in Tokyo is 9 Nov 23:00 UTC.
  zone('Asia/Tokyo', () => assert.equal(iso(asOfDate(org(opp({ lastActivity: D(11, 10) })), cfg, D(11, 9, 23))), '2026-11-10'))
  // 9 Nov 18:00 in Los Angeles is 10 Nov 02:00 UTC: an activity on the 10th is tomorrow, a change at 01:00 UTC has happened.
  zone('America/Los_Angeles', () => {
    const ds = org(opp({ lastActivity: D(11, 10) }), opp({ id: 'B' }))
    assert.equal(iso(asOfDate(ds, cfg, D(11, 10, 2))), '2026-11-05')
    ds.history.push({ oppId: 'B', at: D(11, 10, 1), field: 'amount', from: 1, to: 2 })
    assert.equal(iso(asOfDate(ds, cfg, D(11, 10, 2))), '2026-11-10')
  })
})

test('a chosen as-of date is kept, even after today', () => {
  assert.equal(asOfDate(org(opp()), { ...cfg, asOf: Date.UTC(2099, 0, 1) + DAY / 2 }), Date.UTC(2099, 0, 1))
})
