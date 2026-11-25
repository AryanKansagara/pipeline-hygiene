import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMap, detect, emptyDataset, mergeInto, parseCsv, validate } from './csv.ts'
import { indexHistory, slippage, stageMoves, stateAt } from './pipeline.ts'
import type { Dataset, HistEvent, HistField, Opp } from './types.ts'

const D = (m: number, d: number) => Date.UTC(2026, m - 1, d)
const opp = (o: Partial<Opp> = {}): Opp => ({ id: 'A', name: 'A', account: '', owner: 'Ann', team: 'East', stage: 'S4', amount: 100, closeDate: D(12, 15), created: D(9, 10), nextStep: '', forecastCategory: 'Commit', ...o })
const ev = (from: HistEvent['from'], to: HistEvent['to'], at = D(10, 6), field: HistField = 'closeDate'): HistEvent => ({ oppId: 'A', at, field, from, to })
const order = (history: HistEvent[], o = opp()) => indexHistory(history, [o]).get('A')!.map(e => [e.from, e.to])
const slip = (history: HistEvent[], o = opp()) => { const s = slippage(o, indexHistory(history, [o]).get('A')); return [s.pushes, s.pullIns, s.daysPushed, s.originalClose] }

test('newest first in the same minute: 2 pushes from the report file', () => {
  const add = (ds: Dataset, text: string) => { const t = parseCsv(text), k = detect(t.rows[0]).kind; return mergeInto(ds, validate(t, autoMap(t.rows[0], k), k)) }
  const ds = add(add(emptyDataset(), 'Opportunity ID,Opportunity Name,Stage,Amount,Close Date,Created Date\nA,A,Prospecting,1,12/15/2026,9/10/2026\n'),
    'Opportunity ID,Field / Event,Old Value,New Value,Edit Date\nA,Close Date,11/15/2026,12/15/2026,"10/6/2026, 10:00 AM"\nA,Close Date,10/15/2026,11/15/2026,"10/6/2026, 10:00 AM"\n')
  const evs = indexHistory(ds.history, ds.opps).get('A')
  const s = slippage(ds.opps[0], evs)
  assert.deepEqual([s.pushes, s.pullIns, s.daysPushed, s.originalClose], [2, 0, 61, D(10, 15)])
  assert.equal(stateAt(ds.opps[0], evs, D(10, 1))!.closeDate, D(10, 15))
})

test('any file order of a chain gives the chain', () => {
  const c = [ev(D(10, 1), D(10, 8)), ev(D(10, 8), D(11, 1)), ev(D(11, 1), D(11, 20)), ev(D(11, 20), D(12, 15))]
  for (const p of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]) assert.deepEqual(slip(p.map(i => c[i])), [4, 0, 75, D(10, 1)], String(p))
})

test('the other fields changed in between keep their own order', () => {
  const h = [ev('S3', 'S4', D(10, 6), 'stage'), ev(D(11, 15), D(12, 15)), ev('S2', 'S3', D(10, 6), 'stage'), ev(D(10, 15), D(11, 15))]
  assert.deepEqual(slip(h), [2, 0, 61, D(10, 15)])
  assert.deepEqual(stageMoves(opp({ created: D(9, 1) }), indexHistory(h, [opp()]).get('A'), ['S2', 'S3', 'S4']), { regressed: false, skipped: false })
})

test('there and back in one minute follows the values around it', () => {
  const there = ev(D(11, 1), D(11, 15)), back = ev(D(11, 15), D(11, 1)), both = [[D(11, 1), D(11, 15)], [D(11, 15), D(11, 1)]]
  // Today's value.
  for (const h of [[there, back], [back, there]]) assert.deepEqual(order(h, opp({ closeDate: D(11, 1) })), both)
  // The change before, and the change after.
  const first = ev(D(10, 1), D(11, 1), D(10, 1)), last = ev(D(11, 1), D(12, 15), D(10, 20))
  for (const h of [[there, back], [back, there]]) {
    assert.deepEqual(order([first, ...h]).slice(1), both)
    assert.deepEqual(order([last, ...h]).slice(0, 2), both)
  }
})

test('a loop inside a chain is followed once', () => {
  const h = [ev(1, 2), ev(2, 3), ev(3, 2), ev(2, 4)]
  for (const p of [[3, 2, 1, 0], [1, 3, 0, 2], [0, 1, 2, 3]]) assert.deepEqual(order(p.map(i => h[i]), opp({ closeDate: 4 })), [[1, 2], [2, 3], [3, 2], [2, 4]])
})

test('ascending files, unlinked changes and single changes keep file order', () => {
  const asc = [ev(1, 2, 10), ev(2, 3, 20), ev(3, 4, 20), ev(4, 5, 30)]
  assert.deepEqual(order(asc, opp({ closeDate: 5 })), asc.map(e => [e.from, e.to]))
  const gap = [ev(5, 6), ev(1, 2), ev(8, 9)]
  assert.deepEqual(order(gap), gap.map(e => [e.from, e.to]))
  assert.deepEqual(order([ev(null, 2), ev(null, 3)]), [[null, 2], [null, 3]])
  assert.deepEqual(order([ev(3, 4, 30), ev(1, 2, 10)]), [[1, 2], [3, 4]])
})

test('a blank first value is the start of the chain', () => {
  assert.deepEqual(order([ev(50, 100, D(10, 6), 'amount'), ev(null, 50, D(10, 6), 'amount')]), [[null, 50], [50, 100]])
})

test('many changes in one minute stay fast', () => {
  const h = Array.from({ length: 2000 }, (_, i) => ev(i, i + 1)).reverse()
  const t = Date.now()
  assert.deepEqual(order(h)[0], [0, 1])
  assert.ok(Date.now() - t < 5000)
})
