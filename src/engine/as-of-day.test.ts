import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conversion, snapshot, waterfall, weeklyCalls } from './pipeline.ts'
import { generate, sampleConfig } from './sample.ts'
import { DAY, defaultConfig, type Dataset, type HistEvent, type Opp } from './types.ts'

const D = (s: string) => Date.parse(s)
const deal = (id: string, p: Partial<Opp> = {}): Opp => ({ id, name: id, account: '', owner: 'Ann', team: 'East', stage: 'Prospecting', amount: 100, closeDate: D('2026-12-15'), created: D('2026-09-01'), nextStep: '', forecastCategory: 'Commit', ...p })
const cfg = defaultConfig()
// As-of date 6 Nov. On that day: A went from Pipeline to Commit, B (30) was pushed to January, C (50) was created in Commit,
// D went from 10 to 25. E was already won for 7. Start: B 30 + D 10 = 40 (E closes in October). Today: 100 + 50 + 25 + 7 = 182.
const ten = D('2026-11-06T10:00:00Z')
const ds: Dataset = {
  opps: [deal('A'), deal('B', { amount: 30, closeDate: D('2027-01-15') }), deal('C', { amount: 50, created: ten }), deal('D', { amount: 25 }), deal('E', { amount: 7, stage: 'Closed Won', forecastCategory: 'Closed', closeDate: D('2026-10-20') })],
  history: [
    { oppId: 'A', at: ten, field: 'forecastCategory', from: 'Pipeline', to: 'Commit' },
    { oppId: 'B', at: ten, field: 'closeDate', from: D('2026-12-01'), to: D('2027-01-15') },
    { oppId: 'D', at: D('2026-11-06T23:59:00Z'), field: 'amount', from: 10, to: 25 },
  ] satisfies HistEvent[],
  parties: [],
}

test('the last step holds the changes of the as-of day', () => {
  const w = waterfall(ds, cfg)
  assert.equal(w.start, 40)
  assert.equal(w.end, 182)
  const last = w.steps.at(-1)!
  assert.deepEqual([last.start, last.pushed, last.added, last.amount, last.end], [47, -30, 150, 15, 182])
  for (const s of w.steps) assert.equal(s.start + s.pushed + s.lost + s.downgraded + s.added + s.amount, s.end)
})

test('snapshots and velocity include the as-of day', () => {
  assert.equal(snapshot(ds, cfg, 'x', 0).commit, 182)
  assert.equal(conversion(ds, cfg).openCount, 4)
})

test('a later as-of date changes nothing more, an earlier one does not see the day', () => {
  assert.equal(waterfall(ds, { ...cfg, asOf: D('2026-11-07T00:00:00Z') }).end, 182)
  assert.equal(waterfall(ds, { ...cfg, asOf: D('2026-11-05T00:00:00Z') }).end, 47)
})

test('weekly rows keep their start-of-day meaning until the as-of day itself', () => {
  // 5 Nov is the sixth week start of Q4 (1 Oct + 35 days).
  const shift = { ...ds, history: ds.history.map(e => ({ ...e, at: e.at - DAY })), opps: ds.opps.map(o => o.id === 'C' ? { ...o, created: ten - DAY } : o) }
  const on = weeklyCalls(shift, { ...cfg, asOf: D('2026-11-05T00:00:00Z') }).weeks.at(-1)!
  const after = weeklyCalls(shift, { ...cfg, asOf: D('2026-11-06T00:00:00Z') }).weeks.at(-1)!
  assert.equal(on.at, after.at)
  assert.deepEqual([on.commit, after.commit], [182, 47])
})

test('the sample org, with everything at midnight, is unchanged', () => {
  const w = waterfall(generate('saas'), sampleConfig('saas'))
  assert.equal(Math.round(w.end / 1e5) / 10, 31.3)
  assert.equal(Math.round(w.realisticEnd / 1e5) / 10, 23.4)
})
