import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMap, detect, emptyDataset, idKey, mergeInto, parseCsv, validate } from './csv.ts'
import type { Dataset } from './types.ts'

// Checksum by hand for 0065g 00000 AbCdE: no capitals = A, none = A, letters 1, 3 and 5 = 1 + 4 + 16 = 21 = V.
const S = '0065g00000AbCdE', L = S + 'AAV'
const add = (ds: Dataset, text: string) => { const t = parseCsv(text), k = detect(t.rows[0]).kind; return mergeInto(ds, validate(t, autoMap(t.rows[0], k), k)) }
const opps = (...ids: string[]) => 'Opportunity ID,Opportunity Name,Stage,Close Date,Amount\n' + ids.map(i => `${i},${i},Prospecting,12/15/2026,10\n`).join('')
const hist = (id: string) => `Opportunity ID,Field / Event,Old Value,New Value,Edit Date\n${id},Close Date,11/15/2026,12/15/2026,10/20/2026\n`
const roles = (...ids: string[]) => 'OpportunityId,ContactId,Role\n' + ids.map((i, n) => `${i},c${n},Buyer\n`).join('')

test('the 18-character form is recognised by its checksum only', () => {
  assert.equal(idKey(L), S)
  assert.equal(idKey(S), S)
  assert.equal(idKey('006000000000000AAA'), '006000000000000')
  for (const id of [S + 'AAW', S + 'aav', S.toUpperCase() + 'AAV', 'name:acme|deal', 'OPP-1', '', L + 'A', 'ABCDEFGHIJKLMNOPQR']) assert.equal(idKey(id), id)
})

for (const [a, b] of [[S, L], [L, S]]) test(`history and roles for ${b.length} characters reach a deal with ${a.length}`, () => {
  const ds = add(add(add(emptyDataset(), opps(a, 'OTHER')), hist(b)), roles(b, b))
  assert.equal(ds.history[0].oppId, a)
  assert.equal(ds.opps.find(o => o.id === a)!.contactRoles, 2)
  assert.equal(ds.opps.find(o => o.id === 'OTHER')!.contactRoles, 0)
})

test('history imported before the deals is attached when they arrive', () => {
  const ds = add(add(emptyDataset(), hist(L)), opps(S))
  assert.equal(ds.history[0].oppId, S)
})

test('re-importing in the other form updates the deal and keeps its first ID; the same change is kept once', () => {
  const ds = add(add(add(add(emptyDataset(), opps(S)), hist(S)), opps(L)), hist(L))
  assert.deepEqual(ds.opps.map(o => o.id), [S])
  assert.equal(ds.opps[0].name, L)
  assert.equal(ds.history.length, 1)
})

test('data doubled before the fix is joined on the next import', () => {
  const saved: Dataset = { ...emptyDataset(), opps: [...add(emptyDataset(), opps(S)).opps, ...add(emptyDataset(), opps(L)).opps], history: add(emptyDataset(), hist(L)).history }
  const ds = add(saved, opps('NEW'))
  assert.deepEqual(ds.opps.map(o => o.id), [S, 'NEW'])
  assert.equal(ds.history[0].oppId, S)
})

test('IDs that differ only in case are different records; accounts match across forms', () => {
  assert.equal(add(emptyDataset(), opps(S, '0065g00000abcde')).opps.length, 2)
  const acc = (id: string) => `Account ID,Account Name,Website\n${id},Acme,acme.com\n`
  assert.equal(add(add(emptyDataset(), acc(S)), acc(L)).parties.length, 1)
})

test('an opportunities import leaves role counts from an earlier roles export alone', () => {
  const ds = add(add(add(emptyDataset(), opps(S)), roles(S, S)), opps(L))
  assert.equal(ds.opps[0].contactRoles, 2)
})
