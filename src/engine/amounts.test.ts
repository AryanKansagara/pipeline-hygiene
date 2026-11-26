import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAmount } from './csv.ts'

const all = (cases: Record<string, number>) => { for (const [s, n] of Object.entries(cases)) assert.equal(parseAmount(s), n, s) }

test('one or two digits after the only comma are decimals', () => {
  all({ '1234,50': 1234.5, '12,5': 12.5, '12,50': 12.5, '1 234,50': 1234.5, '1\u00a0234,50': 1234.5, '1\u202f234,50 €': 1234.5, '-1234,50': -1234.5, '(99,90)': -99.9, 'EUR 1234,5': 1234.5, ',50': 0.5 })
})

test('grouped and plain amounts keep their value', () => {
  all({ '1,234': 1234, '1,234.50': 1234.5, '12,500': 12500, '1,234,567': 1234567, '1,234,567.89': 1234567.89, '1.234,50': 1234.5, '1.234.567': 1234567, '1.234': 1234, '12,34,567.50': 1234567.5, '1,00,000': 100000, '$1,200': 1200, '(300)': -300, 'USD 12,500.00': 12500, '-1,000': -1000, '1e3': 1000, '.5': 0.5, '1234.': 1234, '0': 0, '1000000000000': 1e12 })
})

test('malformed grouping, hexadecimal and words are not numbers', () => {
  for (const s of ['1,2,3', '1,23,4', '1234,567', '1,234,50', '0x10', '1,234.5,6', 'Infinity', 'abc', '1-2', '', '-']) assert.ok(Number.isNaN(parseAmount(s)), s)
})
