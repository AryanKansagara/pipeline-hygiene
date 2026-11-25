import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeDateUpdateCsv, mergePlanCsv, survivorshipCsv } from './actions.ts'
import { parseCsv, toCsv } from './csv.ts'
import { findDuplicates } from './dedupe.ts'
import type { Party } from './types.ts'

const cell = (v: string | number) => parseCsv(toCsv([[v, 'x', 'y']]), ',').rows[0][0]

test('cells that would run as formulas become text', () => {
  for (const s of ['=HYPERLINK("http://evil.example","Open")', '=1+1', '@SUM(A1)', '\t=1', '\r=1', '+cmd|x', '-cmd|x', "-2+3+cmd|' /C calc'!A0", '+A1', '-A1', '--A1', '-1+1', '+1*2', '-(1)&A1', '+SUM(1)', '- call back'])
    assert.equal(cell(s), `'${s}`, s)
})

test('phones, amounts, IDs and ordinary text are unchanged', () => {
  for (const s of ['+1 (415) 555-0100', '+44 20 7946 0958', '+1.415.555.0100', '+1 415-555-0100 x12', '+49 30/123456 ext. 7', '-1234.5', '-1,234.50', '-$500', '-€1.234,50', '- 5', '-5%', '+5', '-1e5', '-', '', '0065g00000AbCdE', '0065g00000AbCdEAAV', 'name:=x', 'a=b', 'O\'Neil', "'quoted", '(415) 555-0100', 'x@y.com', '#1 Deal', ' spaced', 'two\nlines'])
    assert.equal(cell(s), s, s)
  assert.equal(cell(-12.5), '-12.5')
})

test('merge plan, survivorship and update files', () => {
  const name = '=HYPERLINK("http://evil.example","Open")'
  const p = (id: string, phone: string): Party => ({ id, kind: 'lead', name, email: 'cy@dune.com', phone, fields: { 'Full name': id === '00QA' ? name : '@x', Phone: phone } })
  const { clusters } = findDuplicates([p('00QA', '+1 415 555 0100'), p('00QB', '+1 415 555 0101')])
  assert.equal(clusters.length, 1)
  const files = [mergePlanCsv(clusters), survivorshipCsv(clusters), closeDateUpdateCsv({ A: 0 }, new Map([['A', { name, old: 0 }]]))]
  for (const f of files) for (const c of parseCsv(f, ',').rows.flat()) assert.doesNotMatch(c, /^[=@]/)
  assert.match(files[1], /,\+1 415 555 0100,/)
})
