import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMap, detect, emptyDataset, mergeInto, parseCsv, validate } from './csv.ts'
import { conversion, isClosed, isLost, isWon } from './pipeline.ts'
import { defaultConfig } from './types.ts'

const LOST = ['Closed Lost', 'closedlost', 'Closed Lost - Competitor Won', 'Lost (competitor won)', 'Not Won', 'Closed - Not Won', 'NOT_WON', 'notwon', "Won't buy", 'Won’t proceed', 'Dead', 'Disqualified', 'Closed']
const WON = ['Closed Won', 'closedwon', 'Won', 'Closed/Won', 'Closed - Won', 'won - renewal']
const OPEN = ['Prospecting', 'Negotiation/Review', 'appointmentscheduled', 'Id. Decision Makers', 'Proposal/Price Quote']

test('lost beats won', () => {
  for (const s of LOST) assert.deepEqual([isWon(s), isLost(s), isClosed(s)], [false, true, true], s)
})

test('won and open stages are unchanged', () => {
  for (const s of WON) assert.deepEqual([isWon(s), isLost(s)], [true, false], s)
  for (const s of OPEN) assert.equal(isClosed(s), false, s)
})

test('imported lost deals are omitted and do not raise the win rate', () => {
  const t = parseCsv('Opportunity ID,Opportunity Name,Stage,Amount,Close Date,Created Date\n' + [...LOST, 'Closed Won', 'Prospecting'].map((s, i) => `A${i},A${i},${s},10,10/20/2026,9/1/2026\n`).join(''))
  const k = detect(t.rows[0]).kind
  const ds = mergeInto(emptyDataset(), validate(t, autoMap(t.rows[0], k), k))
  assert.deepEqual(ds.opps.map(o => o.forecastCategory), [...LOST.map(() => 'Omitted'), 'Closed', 'Pipeline'])
  assert.equal(conversion(ds, defaultConfig()).winRate, 1 / (LOST.length + 1))
})
