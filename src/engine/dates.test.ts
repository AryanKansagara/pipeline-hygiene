import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoMap, detect, parseCsv, parseDate, validate } from './csv.ts'

const read = (text: string) => { const t = parseCsv(text), k = detect(t.rows[0]).kind; return validate(t, autoMap(t.rows[0], k), k) }
const opps = (...closes: string[]) => read('Opportunity ID,Opportunity Name,Stage,Amount,Close Date\n' + closes.map((c, i) => `A${i},A${i},Prospecting,1,"${c}"\n`).join(''))
const iso = (t: number) => new Date(t).toISOString().slice(0, 16)

test('impossible dates and words are row errors', () => {
  const bad = ['2/31/2026', '2026-13-45', '0/0/2026', '1/2/202', 'TBD 12', 'Closed 5', '11/6', '2/29/2026', '2026-02-30', '2026-02-30T10:00:00Z', 'Nov 31, 2026', 'Mayor 5 2026', 'Nov 2026', '2026-11', '0000-00-00', '11/6/2026 13:61', '2026-11-06T25:00', '31/31/2026', 'Deal 2026-11-06', '-11/6/2026', '11/6/2026 soon', 'Foo 6, 2026', '1/2/0202']
  const p = opps(...bad, '11/6/2026')
  assert.deepEqual(p.opps.map(o => o.id), [`A${bad.length}`])
  assert.deepEqual(p.issues.filter(i => i.level === 'error').map(i => i.message), bad.map(b => `"${b}" in Close date is not a date`))
})

test('real dates still parse', () => {
  for (const s of ['11/6/2026', '11-6-2026', '11.6.2026', '11/6/26', '2026-11-06', '2026/11/6', '2026-Nov-06', '46332', '1793923200000', '2026-11-06T00:00:00.000+0000', '11/6/2026, 12:00 AM', '2026-11-05T24:00:00'])
    assert.equal(iso(parseDate(s)), '2026-11-06T00:00', s)
  for (const s of ['11/6/2026 10:00 EST', '2026-11-06T15:00:00Z', '2026-11-06 10:00:00-05:00', '11/6/2026, 3:00 PM', 'Fri, 06 Nov 2026 15:00:00 GMT', 'Fri Nov 06 2026 10:00:00 GMT-0500 (Eastern Standard Time)'])
    assert.equal(iso(parseDate(s)), '2026-11-06T15:00', s)
  assert.equal(iso(parseDate('2/29/2024')), '2024-02-29T00:00')
  assert.equal(iso(parseDate('13/11/2026')), '2026-11-13T00:00')
})

test('month-name dates are the same day in every time zone', () => {
  const was = process.env.TZ
  try {
    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = tz
      for (const s of ['Nov 6, 2026', 'November 6 2026', '6 Nov 2026', '6-Nov-2026', '06-Nov-26', 'Fri, Nov. 6, 2026', 'Friday, November 6, 2026', '2026/11/06']) assert.equal(iso(parseDate(s)), '2026-11-06T00:00', `${s} in ${tz}`)
    }
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was }
})

test('a dash-separated day-first file is read day first throughout', () => {
  assert.deepEqual(opps('13-11-2026', '05-11-2026').opps.map(o => iso(o.closeDate).slice(0, 10)), ['2026-11-13', '2026-11-05'])
  assert.deepEqual(opps('11-13-2026', '05-11-2026').opps.map(o => iso(o.closeDate).slice(0, 10)), ['2026-11-13', '2026-05-11'])
})

test('a date that is impossible either way does not decide the order', () => {
  assert.deepEqual(opps('99/1/2026', '5/11/2026').opps.map(o => iso(o.closeDate).slice(0, 10)), ['2026-05-11'])
})
