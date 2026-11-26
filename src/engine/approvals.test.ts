import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeApprovals } from './actions.ts'
import type { Opp } from './types.ts'

const D = (s: string) => Date.parse(s + 'T00:00:00Z')
const opp = (p: Partial<Opp>): Opp => ({ id: 'A', name: 'A', account: '', owner: 'Ann', team: 'East', stage: 'Prospecting', amount: 1, closeDate: D('2026-10-31'), created: D('2026-09-01'), nextStep: '', forecastCategory: 'Commit', ...p })
const asOf = D('2026-11-06')
const approved = { A: D('2026-11-20') }
const active = (o: Partial<Opp>, from: Record<string, number> | undefined = { A: D('2026-10-31') }, at = asOf) => activeApprovals({ approved, approvedFrom: from }, [opp(o)], at)

test('an approval applies while the deal is open and its date unchanged', () => {
  assert.deepEqual(active({}), approved)
})

test('closed, moved, already applied, expired and unknown deals lapse', () => {
  assert.deepEqual(active({ stage: 'Closed Won', closeDate: D('2026-11-10') }), {})
  assert.deepEqual(active({ stage: 'Closed Lost' }), {})
  assert.deepEqual(active({ closeDate: D('2027-01-15') }), {})
  assert.deepEqual(active({ closeDate: D('2026-11-20') }), {})
  assert.deepEqual(active({}, undefined, D('2026-11-21')), {})
  assert.deepEqual(active({ id: 'B' }), {})
})

test('approvals saved before the replaced date was recorded apply to open deals only', () => {
  assert.deepEqual(activeApprovals({ approved }, [opp({})], asOf), approved)
  assert.deepEqual(activeApprovals({ approved }, [opp({ stage: 'Closed Won' })], asOf), {})
})
