import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accuracy, hasStageHistory } from './pipeline.ts'
import { generate, sampleConfig } from './sample.ts'
import { defaultConfig, type Dataset, type HistEvent, type Opp } from './types.ts'

const D = (s: string) => Date.parse(s + 'T00:00:00Z')
const cfg = { ...defaultConfig(), asOf: D('2026-11-06') }
const won = (id: string, close: string): Opp => ({ id, name: id, account: '', owner: 'Ann', team: 'East', stage: 'Closed Won', amount: 100, closeDate: D(close), created: D('2026-01-10'), nextStep: '', forecastCategory: 'Closed' })
const ds = (history: HistEvent[]): Dataset => ({ opps: [won('a', '2026-09-15'), won('b', '2026-06-15')], history, parties: [] })
const closed = (id: string, at: string): HistEvent => ({ oppId: id, at: D(at), field: 'stage', from: 'Negotiation/Review', to: 'Closed Won' })

test('no history: nothing is measured and nobody is labelled', () => {
  const a = accuracy(ds([]), cfg)
  assert.equal(a.quarters.length, 0)
  assert.equal(a.team.mape, null)
  assert.equal(a.owners[0].label, 'Not enough data')
})

test('history without stage changes cannot rebuild a call either', () => {
  const h: HistEvent[] = [{ oppId: 'a', at: D('2026-02-01'), field: 'amount', from: 90, to: 100 }]
  assert.equal(hasStageHistory(ds(h)), false)
  assert.equal(accuracy(ds(h), cfg).quarters.length, 0)
})

test('only quarters whose measuring date is inside the history are kept', () => {
  // Week 3 of Q3 is 15 July, of Q2 15 April. History starts on 10 July, then on 15 July, then on 16 July.
  const start = (at: string) => accuracy(ds([{ oppId: 'b', at: D(at), field: 'amount', from: 1, to: 100 }, closed('a', '2026-09-15')]), cfg).quarters.map(q => q.key)
  assert.deepEqual(start('2026-07-10'), ['2026-Q3'])
  assert.deepEqual(start('2026-07-15'), ['2026-Q3'])
  assert.deepEqual(start('2026-07-16'), [])
})

test('the sample org keeps its six measured quarters', () => {
  assert.equal(accuracy(generate('saas'), sampleConfig('saas')).quarters.length, 6)
})
