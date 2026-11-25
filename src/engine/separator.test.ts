import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMap, detect, findHeaderRow, parseCsv, validate } from './csv.ts'

const read = (text: string) => { const t = findHeaderRow(parseCsv(text)), k = detect(t.rows[0]).kind; return validate(t, autoMap(t.rows[0], k), k) }
const HEAD = ['Opportunity ID', 'Opportunity Name', 'Stage', 'Close Date', 'Amount']
const table = (d: string, n = 2) => [HEAD, ...Array.from({ length: n }, (_, i) => [`A${i}`, `Deal ${i}`, 'Prospecting', '12/15/2026', '10'])].map(r => r.join(d)).join('\n') + '\n'
const SEPARATORS = [[',', 'comma'], ['\t', 'tab'], [';', 'semicolon'], ['|', 'pipe']] as const

for (const [d, name] of SEPARATORS) test(`a ${name} table is read under any title`, () => {
  for (const title of ['', 'Pipeline', 'Pipeline | EMEA | Q4', '"Pipeline | EMEA | Q4"', 'Open; EMEA; all; reps; now; here; too', 'As of Nov 6, 2026', '"As of Nov 6, 2026, 10:00, EMEA, NA, APAC"', 'A | B\nC | D; E; F', 'Say "a | b | c"']) {
    if (title.replace(/^".*"$/, '').split(d).length > 2) continue // Cannot be told from a header.
    for (const n of [1, 2, 60]) for (const eol of ['\n', '\r\n', '\r'])
      assert.equal(read(((title && title + '\n\n') + table(d, n)).replace(/\n/g, eol)).opps.length, n, `${title} ${n} ${JSON.stringify(eol)}`)
  }
})

test('separators inside cells do not count', () => {
  assert.equal(read('Opportunity ID,Opportunity Name,Stage,Close Date\n' + 'A,"x;y;z;w;v|u",Prospecting,12/15/2026\n'.repeat(3)).opps.length, 3)
  assert.equal(read('Opportunity ID,Opportunity Name,Stage,Close Date\n' + 'A,x;y;z;w;v,Prospecting,12/15/2026\n'.repeat(3)).opps.length, 3)
  assert.equal(read('Deal Name;Deal Stage;Amount;Close Date\n' + 'Hub, the deal, again;open;$2,500;1/5/2026\n').opps.length, 1)
  assert.deepEqual(read('Account Name;Website\nSmith, John, Jr;s.com\nDoe, Jane, Sr;d.com\n').parties.map(p => p.name), ['Smith, John, Jr', 'Doe, Jane, Sr'])
  assert.equal(read('Opportunity ID,Opportunity Name,Stage,Close Date\nA,"two\nlines; with | these; and; more",Prospecting,12/15/2026\n').opps.length, 1)
})

test('an unclosed quote is still reported, not read with another separator', () => {
  const p = read('Opportunity ID,Opportunity Name,Stage,Close Date,Amount\nA,"x,Prospecting,12/15/2026,1\n' + 'B,a;b,Prospecting,12/15/2026,1\n'.repeat(9))
  assert.match(p.issues[0].message, /A quote opened here is never closed/)
})

test('a separator can be given', () => {
  assert.deepEqual(parseCsv('a|b|c|d\n1,2\n', ',').rows, [['a|b|c|d'], ['1', '2']])
})
