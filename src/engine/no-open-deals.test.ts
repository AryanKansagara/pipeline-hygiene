import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hygiene, snapClean, snapScore, snapshot, type Snapshot } from './pipeline.ts'
import { defaultConfig, type Dataset, type Opp } from './types.ts'

const D = (m: number, d: number) => Date.UTC(2026, m - 1, d)
const opp = (stage: string): Opp => ({ id: stage, name: stage, account: '', owner: 'Ann', team: 'East', stage, amount: 100, closeDate: D(11, 10), created: D(11, 1), lastActivity: D(11, 5), nextStep: 'Call', forecastCategory: '' })
const org = (...stages: string[]): Dataset => ({ opps: stages.map(opp), history: [], parties: [] })
const cfg = { ...defaultConfig(), asOf: D(11, 6) }

test('nothing open is not a score', () => {
  for (const ds of [org(), org('Closed Won', 'Closed Lost')]) {
    assert.ok(Number.isNaN(hygiene(ds, cfg).total.score))
    const s = snapshot(ds, cfg, 'x', 0)
    assert.deepEqual([s.score, s.clean, s.open], [null, null, 0])
    assert.deepEqual([snapScore(s), snapClean(s)], [null, null])
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
  }
})

test('one open deal is scored as before, also at 0', () => {
  assert.equal(snapScore(snapshot(org('Closed Won', 'Prospecting'), cfg, 'x', 0)), 100)
  assert.equal(snapScore({ score: 0, clean: 0, open: 1 } as Snapshot), 0)
})

test('older snapshots that recorded 100 without open deals are missing too', () => {
  assert.equal(snapScore({ score: 100, clean: 1, open: 0 } as Snapshot), null)
  assert.equal(snapClean({ score: 100, clean: 1, open: 0 } as Snapshot), null)
})
