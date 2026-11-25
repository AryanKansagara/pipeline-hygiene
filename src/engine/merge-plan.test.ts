import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canMerge, mergePlanCsv } from './actions.ts'
import { autoMap, detect, emptyDataset, mergeInto, parseCsv, validate } from './csv.ts'
import { findDuplicates } from './dedupe.ts'
import type { Dataset } from './types.ts'

const add = (ds: Dataset, text: string) => { const t = parseCsv(text), k = detect(t.rows[0]).kind; return mergeInto(ds, validate(t, autoMap(t.rows[0], k), k)) }
const clusters = (...files: string[]) => findDuplicates(files.reduce(add, emptyDataset()).parties).clusters
const planned = (...files: string[]) => mergePlanCsv(clusters(...files)).trim().split('\r\n').slice(1)
const NO_ID = 'Company name,Company domain name\nAcme Inc,acme.com\nACME LLC,acme.com\n'
const WITH_ID = 'Account ID,Account Name,Website\n001A,Bolt Inc,bolt.com\n001B,Bolt LLC,bolt.com\n'

test('records without an ID column are clustered but not planned', () => {
  assert.equal(clusters(NO_ID).length, 1)
  assert.equal(canMerge(clusters(NO_ID)[0]), false)
  assert.deepEqual(planned(NO_ID), [])
})

test('contacts keyed by email are not planned either', () => {
  assert.deepEqual(planned('First Name,Last Name,Email,Title\nAna,Diaz,ana@coda.com,CEO\nAna,Diaz,ana@coda.co,CEO\n'), [])
})

test('clusters with IDs are still planned', () => {
  const p = planned(NO_ID, WITH_ID)
  assert.equal(p.length, 1)
  assert.match(p[0], /^Account,A\d,1,001A,Bolt Inc,001B,Bolt LLC,,,/)
})

test('one name-keyed record keeps its whole cluster out', () => {
  assert.deepEqual(planned(WITH_ID, 'Account Name,Website\nBolt Corp,bolt.com\n'), [])
})
