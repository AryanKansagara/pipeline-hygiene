import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMap, detect, emptyDataset, mergeInto, parseCsv, validate } from './csv.ts'
import { indexHistory, stateAt } from './pipeline.ts'
import type { Dataset } from './types.ts'

const add = (ds: Dataset, text: string) => { const t = parseCsv(text), k = detect(t.rows[0]).kind; return mergeInto(ds, validate(t, autoMap(t.rows[0], k), k)) }
const OPP = 'Opportunity ID,Opportunity Name,Stage,Amount,Close Date,Created Date,Forecast Category\nA,A,Prospecting,100000,12/15/2026,9/10/2026,Commit\n'
const FIELD = 'Opportunity ID,Field / Event,Old Value,New Value,Edit Date\n'
const HIST = 'Id,OpportunityId,CreatedDate,StageName,Amount,CloseDate,ForecastCategory\n'
const at = (ds: Dataset, y: number, m: number, d: number) => stateAt(ds.opps[0], indexHistory(ds.history).get('A'), Date.UTC(y, m - 1, d))!

test('rewinding past a blank amount in field history gives 0', () => {
  const ds = add(add(emptyDataset(), OPP), FIELD + 'A,Amount,,100000,10/20/2026\n')
  assert.equal(at(ds, 2026, 10, 1).amount, 0)
  assert.equal(at(ds, 2026, 10, 21).amount, 100000)
})

test('a blanked amount rewinds to what it was', () => {
  const ds = add(add(emptyDataset(), OPP.replace('100000', '')), FIELD + 'A,Amount,70000,,10/20/2026\n')
  assert.equal(at(ds, 2026, 10, 1).amount, 70000)
  assert.equal(at(ds, 2026, 10, 21).amount, 0)
})

test('blank amounts in Opportunity History are changes', () => {
  const ds = add(add(emptyDataset(), OPP), HIST + '1,A,2026-09-10T00:00:00.000Z,Prospecting,,2026-12-15,Commit\n2,A,2026-10-05T00:00:00.000Z,Prospecting,,2026-12-15,Commit\n3,A,2026-10-20T00:00:00.000Z,Prospecting,100000,2026-12-15,Commit\n')
  assert.deepEqual(ds.history.map(e => [e.field, e.from, e.to]), [['amount', null, 100000]])
  assert.equal(at(ds, 2026, 10, 1).amount, 0)
})

test('an Opportunity History without an Amount column changes no amount', () => {
  const ds = add(add(emptyDataset(), OPP), 'OpportunityId,Edit Date,StageName,CloseDate\nA,2026-09-10,Prospecting,2026-11-15\nA,2026-10-20,Prospecting,2026-12-15\n')
  assert.deepEqual(ds.history.map(e => e.field), ['closeDate'])
  assert.equal(at(ds, 2026, 10, 1).amount, 100000)
})

test('blank stages, categories and close dates are not rewound', () => {
  const ds = add(add(emptyDataset(), OPP), FIELD + 'A,Stage,,Prospecting,10/20/2026\nA,Forecast Category,,Commit,10/20/2026\nA,Close Date,,12/15/2026,10/20/2026\n')
  assert.deepEqual(at(ds, 2026, 10, 1), { stage: 'Prospecting', amount: 100000, closeDate: Date.UTC(2026, 11, 15), forecastCategory: 'Commit' })
})
