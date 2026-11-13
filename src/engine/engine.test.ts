import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeDateUpdateCsv, exportCsvs, mergePlanCsv, ownerEmail, survivorshipCsv } from './actions.ts'
import { autoMap, detect, findHeaderRow, mergeInto, parseAmount, parseCsv, parseDate, validate, emptyDataset } from './csv.ts'
import { clusterKey, domainOf, findDuplicates, reviewed, jaroWinkler, mergeBatches, normName, normPhone, pickMaster, survivorship, trigram, type Cluster } from './dedupe.ts'
import { accuracy, callAt, checkOpp, closeModel, conversion, datasetAt, fcResolver, hygiene, indexHistory, quarterOf, realisticClose, slippage, stateAt, waterfall } from './pipeline.ts'
import { generate, sampleConfig, SAMPLE_AS_OF } from './sample.ts'
import { readWorkbook, serialToIso } from './xlsx.ts'
import { DAY, defaultConfig, type Dataset, type HistEvent, type Opp, type Party } from './types.ts'

const D = (s: string) => Date.parse(s + 'T00:00:00Z')
const opp = (p: Partial<Opp> = {}): Opp => ({ id: 'o1', name: 'Deal', account: 'Acme', owner: 'Ann', team: 'East', stage: 'Qualification', amount: 1000, closeDate: D('2026-12-15'), created: D('2026-09-01'), lastActivity: D('2026-11-01'), nextStep: 'Call', forecastCategory: 'Pipeline', contactRoles: 3, ...p })
const cfg = (p = {}) => ({ ...defaultConfig(), asOf: D('2026-11-06'), ...p })

// ---------- Parsing ----------

test('parses quoted CSV with embedded newlines and keeps line numbers', () => {
  const t = parseCsv('Id,Name\n1,"Big\ndeal"\n2,"Say ""hi"""\n')
  assert.deepEqual(t.rows[1], ['1', 'Big\ndeal'])
  assert.equal(t.rows[2][1], 'Say "hi"')
  assert.deepEqual(t.lines, [1, 2, 4])
})

test('report export: title block and grand totals footer are dropped', () => {
  const t = findHeaderRow(parseCsv('"Open pipeline"\n"As of 11/6/2026"\n\nOpportunity ID,Opportunity Name,Stage,Close Date\n006A,X,Prospecting,11/30/2026\n\n"Grand Totals (1 record)"\n"Copyright (c) 2000-2026 salesforce.com, inc. All rights reserved."\n'))
  assert.equal(t.rows[0][0], 'Opportunity ID')
  assert.equal(t.rows.length, 2)
  assert.equal(t.lines[1], 5)
})

test('dates: US report format, ISO, day-first, and garbage', () => {
  assert.equal(parseDate('11/6/2026'), D('2026-11-06'))
  assert.equal(parseDate('2026-11-06'), D('2026-11-06'))
  assert.equal(parseDate('2026-11-06T10:00:00.000+0000'), D('2026-11-06') + 10 * 3600_000)
  assert.equal(parseDate('6/11/2026', true), D('2026-11-06'))
  assert.equal(parseDate('25/12/2026'), D('2026-12-25'))
  assert.ok(Number.isNaN(parseDate('next week')))
})

test('amounts: currency prefixes, thousands separators, parentheses', () => {
  assert.equal(parseAmount('USD 12,500.00'), 12500)
  assert.equal(parseAmount('$1,200'), 1200)
  assert.equal(parseAmount('(300)'), -300)
  assert.equal(parseAmount('1.234,50'), 1234.5)
})

test('detects report, Data Loader, history, field history, HubSpot and dedupe objects', () => {
  assert.deepEqual(detect(['Opportunity ID', 'Opportunity Name', 'Stage', 'Close Date', 'Amount']), { kind: 'opps', source: 'report' })
  assert.deepEqual(detect(['ID', 'NAME', 'STAGENAME', 'CLOSEDATE', 'OWNER.NAME']), { kind: 'opps', source: 'dataloader' })
  assert.equal(detect(['Opportunity ID', 'Field / Event', 'Old Value', 'New Value', 'Edit Date']).kind, 'fieldHistory')
  assert.equal(detect(['Opportunity ID', 'From Stage', 'To Stage', 'Amount', 'Close Date', 'Last Modified']).kind, 'history')
  assert.equal(detect(['Record ID', 'Deal Name', 'Deal Stage', 'Close Date', 'Amount']).source, 'hubspot')
  assert.equal(detect(['Account ID', 'Account Name', 'Website', 'Billing City']).kind, 'account')
  assert.equal(detect(['Lead ID', 'First Name', 'Last Name', 'Company', 'Lead Status']).kind, 'lead')
  assert.equal(detect(['Contact ID', 'First Name', 'Last Name', 'Email', 'Account Name']).kind, 'contact')
})

test('validation reports bad rows with their line numbers and still imports the rest', () => {
  const t = parseCsv('Opportunity ID,Opportunity Name,Opportunity Owner,Stage,Amount,Close Date\nA,One,Ann,Prospecting,100,11/30/2026\nB,Two,Bob,,200,11/30/2026\nC,Three,Cy,Prospecting,abc,11/30/2026\nD,Four,Di,Prospecting,10,someday\n')
  const p = validate(t, autoMap(t.rows[0], 'opps'), 'opps')
  assert.equal(p.opps.length, 1)
  assert.equal(p.skipped, 3)
  assert.deepEqual(p.issues.filter(i => i.level === 'error').map(i => i.line), [3, 4, 5])
})

test('missing required mapping is a single header error', () => {
  const t = parseCsv('Opportunity ID,Stage\nA,Prospecting\n')
  const p = validate(t, autoMap(t.rows[0], 'opps'), 'opps')
  assert.ok(p.issues.some(i => i.line === 1 && /Close date/.test(i.message)))
  assert.equal(p.opps.length, 0)
})

test('Opportunity History state rows become field changes', () => {
  const t = parseCsv('Opportunity ID,Stage,Amount,Close Date,Forecast Category,Edit Date\nA,Prospecting,100,10/31/2026,Pipeline,9/1/2026\nA,Proposal/Price Quote,100,11/30/2026,Commit,10/20/2026\n')
  const p = validate(t, autoMap(t.rows[0], 'history'), 'history')
  assert.deepEqual(p.history.map(e => e.field).sort(), ['closeDate', 'forecastCategory', 'stage'])
  assert.equal(p.history.find(e => e.field === 'closeDate')!.to, D('2026-11-30'))
})

test('Field History keeps only forecast-relevant fields and converts values', () => {
  const t = parseCsv('Opportunity ID,Field / Event,Old Value,New Value,Edit Date\nA,Close Date,10/31/2026,12/15/2026,10/25/2026\nA,Description,x,y,10/25/2026\nA,Amount,"$1,000.00","$1,500.00",10/26/2026\n')
  const p = validate(t, autoMap(t.rows[0], 'fieldHistory'), 'fieldHistory')
  assert.equal(p.history.length, 2)
  assert.equal(p.history[1].to, 1500)
})

test('re-importing merges by ID and contact-role exports set role counts', () => {
  let ds: Dataset = emptyDataset()
  const t = parseCsv('Opportunity ID,Opportunity Name,Opportunity Owner,Stage,Close Date\nA,One,Ann,Prospecting,11/30/2026\nB,Two,Ann,Prospecting,11/30/2026\n')
  ds = mergeInto(ds, validate(t, autoMap(t.rows[0], 'opps'), 'opps'))
  ds = mergeInto(ds, validate(t, autoMap(t.rows[0], 'opps'), 'opps'))
  assert.equal(ds.opps.length, 2)
  const r = parseCsv('OpportunityId,ContactId,Role\nA,c1,Decision Maker\nA,c2,Champion\n')
  ds = mergeInto(ds, validate(r, autoMap(r.rows[0], 'roles'), 'roles'))
  assert.equal(ds.opps.find(o => o.id === 'A')!.contactRoles, 2)
  assert.equal(ds.opps.find(o => o.id === 'B')!.contactRoles, 0)
})

// ---------- Hygiene ----------

test('a clean deal scores 100; each rule hits and costs its weight', () => {
  const c = cfg()
  const order = c.stages
  assert.deepEqual(checkOpp(opp({ created: D('2026-10-20') }), [], c, c.asOf!, order).flags, [])
  assert.equal(checkOpp(opp({ created: D('2026-10-20') }), [], c, c.asOf!, order).score, 100)
  const bad = checkOpp(opp({ closeDate: D('2026-10-01'), lastActivity: D('2026-09-01'), nextStep: '', amount: 0, contactRoles: 1 }), [], c, c.asOf!, order)
  assert.deepEqual(bad.flags, ['pastDue', 'stale', 'noNextStep', 'stageAge', 'zeroAmount', 'singleThreaded'])
  assert.equal(bad.score, Math.max(0, 100 - 25 - 20 - 10 - 15 - 15 - 10))
})

test('pushes, regressions and skips come from history', () => {
  const c = cfg()
  const ev: HistEvent[] = [
    { oppId: 'o1', at: D('2026-09-10'), field: 'closeDate', from: D('2026-10-15'), to: D('2026-11-15') },
    { oppId: 'o1', at: D('2026-10-10'), field: 'closeDate', from: D('2026-11-15'), to: D('2026-12-15') },
    { oppId: 'o1', at: D('2026-09-05'), field: 'stage', from: 'Prospecting', to: 'Value Proposition' },
    { oppId: 'o1', at: D('2026-10-20'), field: 'stage', from: 'Value Proposition', to: 'Qualification' },
  ].sort((a, b) => a.at - b.at) as HistEvent[]
  const r = checkOpp(opp(), ev, c, c.asOf!, c.stages)
  assert.ok(r.flags.includes('pushed') && r.flags.includes('stageRegressed') && r.flags.includes('stageSkipped'))
  assert.equal(r.slip.pushes, 2)
  assert.equal(r.slip.daysPushed, 61)
  assert.equal(r.daysInStage, 17)
})

test('owner and team scores are the mean of open deal scores; closed deals are ignored', () => {
  const ds: Dataset = { opps: [opp({ id: 'a', created: D('2026-10-20') }), opp({ id: 'b', nextStep: '', created: D('2026-10-20') }), opp({ id: 'c', stage: 'Closed Lost', nextStep: '' })], history: [], parties: [] }
  const h = hygiene(ds, cfg())
  assert.equal(h.total.open, 2)
  assert.equal(h.owners[0].score, 95)
  assert.equal(h.teams[0].key, 'East')
  assert.equal(h.owners[0].clean, 0.5)
})

// ---------- History, forecast, accuracy ----------

test('stateAt rewinds stage, amount and close date', () => {
  const o = opp({ stage: 'Negotiation/Review', amount: 1500 })
  const ev: HistEvent[] = [
    { oppId: 'o1', at: D('2026-10-01'), field: 'amount', from: 1000, to: 1500 },
    { oppId: 'o1', at: D('2026-10-10'), field: 'stage', from: 'Qualification', to: 'Negotiation/Review' },
    { oppId: 'o1', at: D('2026-10-20'), field: 'closeDate', from: D('2026-11-15'), to: D('2026-12-15') },
  ]
  assert.deepEqual(stateAt(o, ev, D('2026-09-15')), { stage: 'Qualification', amount: 1000, closeDate: D('2026-11-15'), forecastCategory: 'Pipeline' })
  assert.equal(stateAt(o, ev, D('2026-10-15'))!.stage, 'Negotiation/Review')
  assert.equal(stateAt(o, ev, D('2026-08-01')), null)
})

test('fiscal quarters honour the fiscal start month', () => {
  assert.equal(quarterOf(D('2026-11-06')).key, '2026-Q4')
  const fy = quarterOf(D('2026-11-06'), 2)
  assert.equal(fy.key, '2026-Q4')
  assert.equal(fy.start, D('2026-11-01'))
  assert.equal(quarterOf(D('2027-01-15'), 2).key, '2026-Q4')
})

test('waterfall explains the change in commit deal by deal', () => {
  const q = quarterOf(D('2026-11-06'))
  const opps = [
    opp({ id: 'push', amount: 100, forecastCategory: 'Commit', closeDate: D('2027-01-20'), created: D('2026-09-01') }),
    opp({ id: 'lost', amount: 50, forecastCategory: 'Omitted', stage: 'Closed Lost', closeDate: D('2026-10-20'), created: D('2026-09-01') }),
    opp({ id: 'new', amount: 30, forecastCategory: 'Commit', closeDate: D('2026-12-01'), created: D('2026-10-12') }),
  ]
  const history: HistEvent[] = [
    { oppId: 'push', at: D('2026-10-14'), field: 'closeDate', from: D('2026-12-10'), to: D('2027-01-20') },
    { oppId: 'lost', at: D('2026-10-20'), field: 'stage', from: 'Negotiation/Review', to: 'Closed Lost' },
    { oppId: 'lost', at: D('2026-10-20'), field: 'forecastCategory', from: 'Commit', to: 'Omitted' },
  ]
  const w = waterfall({ opps, history, parties: [] }, cfg(), undefined, q)
  assert.equal(w.start, 150)
  assert.equal(w.end, 30)
  const sum = (k: 'pushed' | 'lost' | 'added') => w.steps.reduce((s, x) => s + x[k], 0)
  assert.equal(sum('pushed'), -100)
  assert.equal(sum('lost'), -50)
  assert.equal(sum('added'), 30)
  for (const s of w.steps) assert.equal(s.start + s.pushed + s.lost + s.downgraded + s.added + s.amount, s.end)
})

test('forecast category is inferred from stage when the export has no category history', () => {
  const ds: Dataset = { opps: [opp({ id: 'a', stage: 'Negotiation/Review', forecastCategory: 'Commit' }), opp({ id: 'b', stage: 'Qualification', forecastCategory: 'Pipeline' })], history: [{ oppId: 'b', at: D('2026-10-01'), field: 'stage', from: 'Negotiation/Review', to: 'Qualification' }], parties: [] }
  const fc = fcResolver(ds)
  const idx = indexHistory(ds.history)
  const c = callAt(ds, idx, quarterOf(D('2026-11-06')), D('2026-09-20'), fc)
  assert.equal(c.commit, 2000)
})

test('accuracy: MAPE and bias per owner, sandbagger detected', () => {
  // Ann commits 50 at week 3 and wins 100 every quarter; Bob commits 100 and wins 100.
  const opps: Opp[] = []
  for (const [i, qs] of ['2026-01-01', '2026-04-01', '2026-07-01'].entries()) {
    const s = D(qs)
    opps.push(opp({ id: `a${i}`, owner: 'Ann', stage: 'Closed Won', forecastCategory: 'Closed', amount: 50, created: s - 40 * DAY, closeDate: s + 60 * DAY }))
    opps.push(opp({ id: `a${i}x`, owner: 'Ann', stage: 'Closed Won', forecastCategory: 'Closed', amount: 50, created: s - 40 * DAY, closeDate: s + 70 * DAY }))
    opps.push(opp({ id: `b${i}`, owner: 'Bob', stage: 'Closed Won', forecastCategory: 'Closed', amount: 100, created: s - 40 * DAY, closeDate: s + 60 * DAY }))
  }
  const history: HistEvent[] = opps.map(o => ({ oppId: o.id, at: o.closeDate, field: 'stage' as const, from: 'Negotiation/Review', to: 'Closed Won' }))
  history.push(...opps.flatMap(o => o.id.endsWith('x')
    ? [{ oppId: o.id, at: o.closeDate - 5 * DAY, field: 'forecastCategory' as const, from: 'Best Case', to: 'Commit' }, { oppId: o.id, at: o.closeDate, field: 'forecastCategory' as const, from: 'Commit', to: 'Closed' }]
    : [{ oppId: o.id, at: o.created + DAY, field: 'forecastCategory' as const, from: 'Pipeline', to: 'Commit' }, { oppId: o.id, at: o.closeDate, field: 'forecastCategory' as const, from: 'Commit', to: 'Closed' }]))
  const a = accuracy({ opps, history, parties: [] }, cfg())
  const ann = a.owners.find(o => o.owner === 'Ann')!, bob = a.owners.find(o => o.owner === 'Bob')!
  assert.equal(ann.cells.filter(c => c.err !== null).length, 3)
  assert.ok(Math.abs(ann.mape! - 0.5) < 1e-9)
  assert.ok(Math.abs(ann.bias! + 0.5) < 1e-9)
  assert.equal(ann.label, 'Sandbagging')
  assert.equal(bob.mape, 0)
  assert.equal(bob.label, 'Accurate')
})

test('realistic close uses the owner pattern after the same number of pushes', () => {
  const opps: Opp[] = []
  const history: HistEvent[] = []
  for (let i = 0; i < 6; i++) {
    const id = `w${i}`
    opps.push(opp({ id, stage: 'Closed Won', closeDate: D('2026-06-30'), created: D('2026-01-01') }))
    history.push({ oppId: id, at: D('2026-03-01'), field: 'closeDate', from: D('2026-04-01'), to: D('2026-05-01') })
    history.push({ oppId: id, at: D('2026-04-25'), field: 'closeDate', from: D('2026-05-01'), to: D('2026-06-30') })
  }
  const ds = { opps, history, parties: [] }
  const m = closeModel(ds, indexHistory(history))
  const fresh = realisticClose(opp({ closeDate: D('2026-11-20') }), [], m, D('2026-11-06'), 1)
  assert.equal(fresh.slipDays, 90)
  assert.equal(fresh.basis, 'owner')
  assert.equal(fresh.pSlipQuarter, 1)
  const once: HistEvent[] = [{ oppId: 'o1', at: D('2026-10-01'), field: 'closeDate', from: D('2026-10-20'), to: D('2026-11-20') }]
  assert.equal(realisticClose(opp({ closeDate: D('2026-11-20') }), once, m, D('2026-11-06'), 1).slipDays, 60)
})

test('slippage tracks pull-ins and amount drift', () => {
  const ev: HistEvent[] = [
    { oppId: 'o1', at: D('2026-09-02'), field: 'amount', from: 800, to: 1000 },
    { oppId: 'o1', at: D('2026-09-03'), field: 'closeDate', from: D('2026-12-31'), to: D('2026-12-15') },
  ]
  const s = slippage(opp(), ev)
  assert.equal(s.pushes, 0)
  assert.equal(s.pullIns, 1)
  assert.equal(s.amountDrift, 200)
})

test('stage conversion counts advancing and lost deals per stage', () => {
  const ds: Dataset = {
    opps: [opp({ id: 'w', stage: 'Closed Won' }), opp({ id: 'l', stage: 'Closed Lost' })],
    history: [
      { oppId: 'w', at: D('2026-09-11'), field: 'stage', from: 'Prospecting', to: 'Qualification' },
      { oppId: 'w', at: D('2026-09-21'), field: 'stage', from: 'Qualification', to: 'Closed Won' },
      { oppId: 'l', at: D('2026-09-06'), field: 'stage', from: 'Prospecting', to: 'Closed Lost' },
    ], parties: [],
  }
  const v = conversion(ds, cfg())
  const p = v.stages.find(s => s.stage === 'Prospecting')!
  assert.equal(p.entered, 2)
  assert.equal(p.conversion, 0.5)
  assert.equal(p.avgDays, 7.5)
  assert.equal(v.winRate, 0.5)
})

// ---------- Dedupe ----------

test('name normalisation strips legal suffixes, punctuation and domains', () => {
  for (const n of ['Acme Inc', 'ACME, Inc.', 'Acme Incorporated', 'The Acme Co.', 'acme.com', 'Acme LLC']) assert.equal(normName(n), 'acme')
  assert.equal(normName('Inc.'), 'inc')
  assert.equal(normName('Smith & Sons Ltd'), 'smith and sons')
})

test('domains, phones and similarity measures', () => {
  assert.equal(domainOf('https://www.Acme.com/about'), 'acme.com')
  assert.equal(domainOf('jane@acme.com'), 'acme.com')
  assert.equal(domainOf('jane@gmail.com'), '')
  assert.equal(normPhone('+1 (415) 555-0100'), normPhone('415.555.0100'))
  assert.ok(Math.abs(jaroWinkler('martha', 'marhta') - 0.9611) < 0.001)
  assert.equal(jaroWinkler('abc', 'xyz'), 0)
  assert.equal(trigram('acme', 'acme'), 1)
})

const acct = (id: string, name: string, p: Partial<Party> = {}): Party => ({ id, kind: 'account', name, fields: { 'Account name': name, ...(p.website ? { Website: p.website } : {}), ...(p.phone ? { Phone: p.phone } : {}) }, ...p })

test('clusters Acme variants, leaves different companies apart', () => {
  const parties = [
    acct('1', 'Acme Inc', { website: 'https://www.acme.com', phone: '(415) 555-0100', created: D('2019-01-01') }),
    acct('2', 'ACME, Inc.'),
    acct('3', 'acme.com', { phone: '415-555-0100' }),
    acct('4', 'Acme Logistics', { website: 'acmelogistics.com' }),
    acct('5', 'Globex Corporation'),
  ]
  const r = findDuplicates(parties)
  assert.equal(r.clusters.length, 1)
  assert.deepEqual(r.clusters[0].members.map(m => m.id).sort(), ['1', '2', '3'])
  assert.equal(r.clusters[0].master.id, '1')
  assert.ok(r.clusters[0].confidence >= 0.75)
})

test('a rejected cluster stays rejected when the master or threshold changes', () => {
  const parties = [acct('1', 'Acme Inc', { website: 'acme.com' }), acct('2', 'ACME, Inc.', { website: 'acme.com' }), acct('3', 'Initech LLC', { website: 'initech.com' }), acct('4', 'Initech', { website: 'initech.com' })]
  const first = findDuplicates(parties, 0.75, 'complete')
  assert.equal(first.clusters.length, 2)
  const rejected = [clusterKey(first.clusters.find(c => c.members.some(m => m.id === '3'))!)]
  const again = findDuplicates(parties, 0.7, 'oldest')
  const kept = reviewed(again.clusters, rejected)
  assert.equal(kept.length, 1)
  assert.deepEqual(kept[0].members.map(m => m.id).sort(), ['1', '2'])
})

test('contacts match on email; different people at the same company do not', () => {
  const c = (id: string, name: string, email: string): Party => ({ id, kind: 'contact', name, email, fields: { Name: name, Email: email } })
  const r = findDuplicates([c('a', 'Jane Doe', 'jane@acme.com'), c('b', 'J. Doe', 'jane@acme.com'), c('c', 'John Doe', 'john@acme.com')])
  assert.equal(r.clusters.length, 1)
  assert.deepEqual(r.clusters[0].members.map(m => m.id).sort(), ['a', 'b'])
})

test('master rules: most complete, most recent activity, oldest', () => {
  const a = acct('a', 'X', { website: 'x.com', phone: '1', created: D('2020-01-01'), lastActivity: D('2026-01-01') })
  const b = acct('b', 'X', { created: D('2018-01-01'), lastActivity: D('2026-10-01') })
  assert.equal(pickMaster([a, b], 'complete').id, 'a')
  assert.equal(pickMaster([a, b], 'activity').id, 'b')
  assert.equal(pickMaster([a, b], 'oldest').id, 'b')
})

test('survivorship fills blanks from duplicates and lists conflicts', () => {
  const m = acct('m', 'Acme Inc', { website: 'acme.com' })
  const d = acct('d', 'ACME, Inc.', { phone: '415' })
  const cl: Cluster = { id: 'A1', kind: 'account', members: [m, d], master: m, confidence: 0.9, links: [] }
  const s = survivorship(cl)
  assert.deepEqual(s.find(x => x.field === 'Phone'), { field: 'Phone', value: '415', from: 'd', conflict: [] })
  assert.deepEqual(s.find(x => x.field === 'Account name')!.conflict, ['ACME, Inc.'])
  assert.match(survivorshipCsv([cl]), /A1,m,Phone,415,d/)
})

test('merge plan respects the 3-records-per-merge limit', () => {
  const members = ['m', 'd1', 'd2', 'd3', 'd4'].map(i => acct(i, 'Acme'))
  const cl: Cluster = { id: 'A1', kind: 'account', members, master: members[0], confidence: 0.91, links: [{ a: 'm', b: 'd1', confidence: 0.91, reasons: ['Same normalised name'] }] }
  assert.deepEqual(mergeBatches(cl), [['d1', 'd2'], ['d3', 'd4']])
  const csv = mergePlanCsv([cl]).trim().split('\r\n')
  assert.equal(csv.length, 3)
  assert.match(csv[1], /^Account,A1,1,m,Acme,d1,Acme,d2,Acme,91%/)
})

// ---------- Actions ----------

test('owner email lists flagged deals worst first; Data Loader file has Id and CloseDate', () => {
  const c = cfg()
  const c2 = { ...c, defaultStageDays: 365 }
  const rows = [checkOpp(opp({ id: 'x', name: 'Small fix', nextStep: '' }), [], c2, c.asOf!, c.stages), checkOpp(opp({ id: 'y', name: 'Big mess', nextStep: '', closeDate: D('2026-10-01') }), [], c2, c.asOf!, c.stages), checkOpp(opp({ id: 'z' }), [], c2, c.asOf!, c.stages)]
  const e = ownerEmail('Ann Lee', rows)
  assert.match(e.subject, /2 deals/)
  assert.ok(e.body.indexOf('Big mess') < e.body.indexOf('Small fix'))
  assert.ok(e.body.startsWith('Hi Ann,'))
  const csv = closeDateUpdateCsv({ y: D('2026-12-15') }, new Map([['y', { name: 'Big mess', old: D('2026-10-01') }]]))
  assert.equal(csv.split('\r\n')[1], 'y,2026-12-15,Big mess,2026-10-01')
})

// ---------- Samples ----------

test('synthetic SaaS org: planted sandbaggers and pushers are found', () => {
  const ds = generate('saas')
  const c = sampleConfig('saas')
  assert.ok(ds.opps.length > 3000)
  assert.equal(new Set(ds.opps.map(o => o.owner)).size, 40)
  const a = accuracy(ds, c)
  // Archetypes repeat every 10 reps: index 0 and 8 sandbag, 1 and 5 push.
  assert.equal(a.owners.find(o => o.owner === 'Maya Okafor')!.label, 'Sandbagging')
  assert.equal(a.owners.find(o => o.owner === 'Chloe Ferreira')!.label, 'Sandbagging')
  assert.equal(a.owners.find(o => o.owner === 'Liam Lindqvist')!.label, 'Over-forecasting')
  const w = waterfall(ds, c)
  assert.ok(w.projected.length > 0 && w.realisticEnd < w.end)
  assert.equal(hygiene(ds, c).asOf, SAMPLE_AS_OF)
})

test('synthetic account base: most of the 300 planted duplicates are found', () => {
  const ds = generate('dupes')
  const r = findDuplicates(ds.parties)
  const dupAccounts = r.clusters.filter(c => c.kind === 'account').reduce((s, c) => s + c.members.length - 1, 0)
  assert.ok(dupAccounts >= 270 && dupAccounts <= 310, `found ${dupAccounts}`)
  const acme = r.clusters.find(c => c.members.some(m => m.name === 'acme.com'))!
  assert.ok(acme.members.some(m => m.name === 'ACME, Inc.'))
  assert.ok(r.clusters.some(c => c.kind === 'contact') && r.clusters.some(c => c.kind === 'lead'))
})

test('datasetAt rebuilds a past week: later deals vanish, closed deals reopen', () => {
  const ds: Dataset = {
    opps: [opp({ id: 'old', stage: 'Closed Won', created: D('2026-09-01') }), opp({ id: 'new', created: D('2026-10-25') })],
    history: [{ oppId: 'old', at: D('2026-10-20'), field: 'stage', from: 'Negotiation/Review', to: 'Closed Won' }], parties: [],
  }
  const past = datasetAt(ds, D('2026-10-10'))
  assert.deepEqual(past.opps.map(o => [o.id, o.stage]), [['old', 'Negotiation/Review']])
  assert.equal(past.history.length, 0)
  assert.equal(past.opps[0].lastActivity, D('2026-10-10'))
})

test('sample exported as report CSVs re-imports to the same scores, waterfall and duplicates', () => {
  const ds = generate('saas'), cfg = sampleConfig('saas')
  let back = emptyDataset()
  for (const [name, text] of exportCsvs(ds)) {
    const t = findHeaderRow(parseCsv(text))
    const d = detect(t.rows[0])
    const p = validate(t, autoMap(t.rows[0], d.kind), d.kind)
    assert.equal(p.issues.filter(i => i.level === 'error').length, 0, name)
    back = mergeInto(back, p)
  }
  assert.equal(back.opps.length, ds.opps.length)
  assert.equal(hygiene(back, cfg).total.score, hygiene(ds, cfg).total.score)
  const a = waterfall(back, cfg), b = waterfall(ds, cfg)
  assert.equal(a.end, b.end)
  assert.equal(a.realisticEnd, b.realisticEnd)
  assert.equal(findDuplicates(back.parties).clusters.length, findDuplicates(ds.parties).clusters.length)
})

// ---------- XLSX ----------

test('Excel serial dates become ISO, including times and the 1904 date system', () => {
  assert.equal(serialToIso(46332), '2026-11-06')
  assert.equal(serialToIso(46332.5), '2026-11-06T12:00:00')
  assert.equal(serialToIso(46332 - 1462, true), '2026-11-06')
})

test('formatted report XLSX: title block skipped, date cells read as dates whatever their format', async () => {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([
    ['Open pipeline'], ['As of 11/6/2026'], [],
    ['Opportunity ID', 'Opportunity Name', 'Opportunity Owner', 'Stage', 'Amount', 'Close Date', 'Created Date'],
    ['006A', 'Acme renewal', 'Ann Lee', 'Proposal', 12500, 46356, 46201],
    ['006B', 'Globex pilot', 'Raj Patel', 'Prospecting', 4000, 46387, 46300],
    [], ['Grand Totals (2 records)'],
  ])
  // A UK-formatted close date and a US-formatted created date: both must come through unambiguous.
  for (const [a, z] of [['F5', 'dd/mm/yyyy'], ['F6', 'dd/mm/yyyy'], ['G5', 'm/d/yy'], ['G6', 'm/d/yy']]) ws[a].z = z
  ws.E5.z = ws.E6.z = '"$"#,##0.00'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const t = findHeaderRow(await readWorkbook(buf))
  assert.equal(t.rows[0][0], 'Opportunity ID')
  assert.equal(t.rows.length, 3)
  const d = detect(t.rows[0])
  const p = validate(t, autoMap(t.rows[0], d.kind), d.kind)
  assert.equal(p.issues.filter(i => i.level === 'error').length, 0)
  assert.equal(p.opps[0].amount, 12500)
  assert.equal(p.opps[0].closeDate, D('2026-11-30'))
  assert.equal(p.opps[0].created, D('2026-06-28'))
  assert.equal(p.opps[1].closeDate, D('2026-12-31'))
})

test('legacy .xls workbooks are read too', async () => {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Account ID', 'Account Name', 'Website'], ['001A', 'Acme, Inc.', 'acme.com']]), 'S')
  const t = await readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer)
  assert.deepEqual(t.rows[1], ['001A', 'Acme, Inc.', 'acme.com'])
})

// ---------- Real-world layouts ----------
// Excerpts written to match the layout of HubSpot's published sample import files
// (knowledge.hubspot.com/import-and-export/sample-import-files, checked Nov 2026); values are our own.

test('HubSpot deals import file: semicolons, $ amounts, no ID or owner column', () => {
  const t = findHeaderRow(parseCsv('Deal Name;Deal Stage;Pipeline;Amount;Close Date;Product of Interest;Point of Contact\r\nHarbor Labs;Appointment Scheduled;Sales Pipeline;$3,760;3/16/2026;Paper;Dana Ruiz\r\nKiln & Co;Closed Won;Sales Pipeline;$15,000;11/11/2025;CRM;Sam Ortiz\r\n'))
  const d = detect(t.rows[0])
  assert.deepEqual(d, { kind: 'opps', source: 'hubspot' })
  const p = validate(t, autoMap(t.rows[0], d.kind), d.kind)
  assert.equal(p.issues.filter(i => i.level === 'error').length, 0)
  assert.equal(p.opps.length, 2)
  assert.equal(p.opps[0].id, 'name:harbor labs')
  assert.equal(p.opps[0].owner, 'Unassigned')
  assert.equal(p.opps[0].amount, 3760)
  assert.equal(p.opps[1].closeDate, D('2025-11-11'))
  assert.ok(p.issues.some(i => /matched by name/.test(i.message)))
})

test('HubSpot contacts and companies files: "Email Address" and "Phone Number" headers, keyed by email or name', () => {
  const c = findHeaderRow(parseCsv('First Name,Last Name,Email Address,Favorite Food,Mobile phone number\nDana,Ruiz,dana@harborlabs.com,Tea,+18005550101\n'))
  const dc = detect(c.rows[0])
  assert.equal(dc.kind, 'contact')
  const pc = validate(c, autoMap(c.rows[0], 'contact'), 'contact')
  assert.equal(pc.parties[0].id, 'name:dana@harborlabs.com')
  assert.equal(pc.parties[0].phone, '+18005550101')
  assert.equal(pc.parties[0].fields['Favorite Food'], 'Tea')
  const a = findHeaderRow(parseCsv('﻿Name,Company domain name,Phone Number,City\nHarbor Labs,harborlabs.com,555-0101,Portland\n'))
  assert.equal(detect(a.rows[0]).kind, 'account')
  const pa = validate(a, autoMap(a.rows[0], 'account'), 'account')
  assert.equal(pa.parties[0].website, 'harborlabs.com')
  assert.equal(pa.parties[0].id, 'name:harbor labs')
})

test('Excel serial numbers in a General-format date column are dates, not year 43175', () => {
  assert.equal(parseDate('43175'), D('2018-03-16'))
  assert.equal(parseDate('46332.75'), D('2026-11-06') + 18 * 3600_000)
  assert.ok(Number.isNaN(parseDate('12345')))
})

test('Data Loader update file leaves out deals that were imported without an ID', () => {
  const names = new Map([['006A', { name: 'A', old: D('2026-11-01') }], ['name:b', { name: 'B', old: D('2026-11-01') }]])
  const csv = closeDateUpdateCsv({ '006A': D('2026-12-01'), 'name:b': D('2026-12-01') }, names)
  assert.equal(csv.trim().split('\r\n').length, 2)
  assert.ok(!csv.includes('name:b'))
})

test('accuracy: a rep who commits and wins nothing is an over-forecaster, not "not enough data"', () => {
  const opps: Opp[] = []
  const history: HistEvent[] = []
  for (const [i, qs] of ['2026-01-01', '2026-04-01', '2026-07-01'].entries()) {
    const s = D(qs)
    opps.push(opp({ id: `c${i}`, owner: 'Cy', stage: 'Closed Lost', forecastCategory: 'Omitted', amount: 80, created: s - 40 * DAY, closeDate: s + 80 * DAY }))
    history.push({ oppId: `c${i}`, at: s - 30 * DAY, field: 'forecastCategory', from: 'Pipeline', to: 'Commit' }, { oppId: `c${i}`, at: s + 80 * DAY, field: 'forecastCategory', from: 'Commit', to: 'Omitted' }, { oppId: `c${i}`, at: s + 80 * DAY, field: 'stage', from: 'Negotiation/Review', to: 'Closed Lost' })
    if (i === 2) opps.push(opp({ id: `w${i}`, owner: 'Cy', stage: 'Closed Won', forecastCategory: 'Closed', amount: 40, created: s - 40 * DAY, closeDate: s + 85 * DAY }))
  }
  const cy = accuracy({ opps, history, parties: [] }, cfg()).owners.find(o => o.owner === 'Cy')!
  assert.deepEqual(cy.cells.map(c => c.err), [1, 1, 1])
  assert.equal(cy.mape, 1)
  assert.equal(cy.bias, 240 / 40 - 1)
  assert.equal(cy.label, 'Over-forecasting')
  const none = accuracy({ opps: opps.filter(o => !o.id.startsWith('w')), history, parties: [] }, cfg()).owners.find(o => o.owner === 'Cy')!
  assert.equal(none.bias, 1)
  assert.equal(none.label, 'Over-forecasting')
})
