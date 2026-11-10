import { normFc } from './pipeline.ts'
import { DAY, type Dataset, type HistEvent, type HistField, type Opp, type Party, type PartyKind } from './types.ts'

// ---------- CSV ----------

export interface Table { rows: string[][]; lines: number[] }

export function parseCsv(text: string): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delim = sniffDelimiter(text)
  const rows: string[][] = []
  const lines: number[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else {
        if (c === '\n') line++
        field += c
      }
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) { rows.push(row); lines.push(rowLine) }
      row = []
      line++
      rowLine = line
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some(f => f !== '')) { rows.push(row); lines.push(rowLine) }
  }
  return { rows, lines }
}

function sniffDelimiter(text: string): string {
  const head = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const counts = [',', '\t', ';', '|'].map(d => [d, head.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map(r => r.map(v => {
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : v
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\r\n') + '\r\n'
}

/**
 * Salesforce report exports put a title block above the header and a "Grand Totals" / copyright block below.
 * Finds the first row that looks like a header (3+ non-empty cells, mostly text) and drops footer rows.
 */
export function findHeaderRow(t: Table): Table {
  let start = 0
  for (let i = 0; i < Math.min(t.rows.length, 25); i++) {
    const cells = t.rows[i].filter(c => c.trim())
    if (cells.length >= 3 && cells.filter(c => /[a-z]/i.test(c) && !/^\d/.test(c)).length >= cells.length * 0.7) { start = i; break }
  }
  let end = t.rows.length
  while (end > start + 1 && (t.rows[end - 1].filter(c => c.trim()).length <= 2 || /grand total|confidential|copyright|salesforce\.com, inc/i.test(t.rows[end - 1].join(' ')))) end--
  return { rows: t.rows.slice(start, end), lines: t.lines.slice(start, end) }
}

// ---------- Values ----------

/** Dates as exported by reports (M/D/YYYY, D/M/YYYY when unambiguous), Data Loader (ISO) and HubSpot. Returns UTC midnight ms or NaN. */
export function parseDate(raw: string, dayFirst = false): number {
  const s = raw.trim()
  if (!s) return NaN
  if (/^\d{13}$/.test(s)) return Math.floor(Number(s) / DAY) * DAY
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i)
  if (m) {
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
    const tz = m[7]
    if (tz && tz.toUpperCase() !== 'Z') { const sign = tz[0] === '-' ? -1 : 1; const d = tz.slice(1).replace(':', ''); t -= sign * (+d.slice(0, 2) * 60 + +d.slice(2)) * 60000 }
    return t
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i)
  if (m) {
    let a = +m[1], b = +m[2]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    if (dayFirst || a > 12) [a, b] = [b, a]
    if (a > 12 || b > 31) return NaN
    let h = +(m[4] ?? 0)
    if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0)
    return Date.UTC(y, a - 1, b, h, +(m[5] ?? 0), +(m[6] ?? 0))
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : NaN
}

export const dayOf = (t: number) => Math.floor(t / DAY) * DAY

export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/^[A-Z]{3}\s*/, '').replace(/[$€£¥\s]/g, '')
  if (!s || s === '-') return NaN
  const neg = /^\(.*\)$/.test(s)
  s = s.replace(/[()]/g, '')
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return neg ? -n : n
}

// ---------- Formats ----------

export type Kind = 'opps' | 'history' | 'fieldHistory' | 'roles' | PartyKind

export const KIND_LABEL: Record<Kind, string> = {
  opps: 'Opportunities',
  history: 'Opportunity History (stage snapshots)',
  fieldHistory: 'Opportunity Field History',
  roles: 'Opportunity Contact Roles',
  account: 'Accounts',
  contact: 'Contacts',
  lead: 'Leads',
}

export type Source = 'report' | 'dataloader' | 'hubspot' | 'generic'
export const SOURCE_LABEL: Record<Source, string> = { report: 'Salesforce report export', dataloader: 'Data Loader / SOQL export', hubspot: 'HubSpot export', generic: 'Generic CSV' }

export interface FieldSpec { key: string; label: string; required?: boolean; type: 'str' | 'date' | 'num'; aliases: string[] }

const F = (key: string, label: string, type: FieldSpec['type'], aliases: string[], required = false): FieldSpec => ({ key, label, type, aliases, required })

/** Aliases are normalised headers: lowercase, letters and digits only. */
export const FIELDS: Record<Kind, FieldSpec[]> = {
  opps: [
    F('id', 'Opportunity ID', 'str', ['opportunityid', 'id', 'oppid', 'recordid', 'opportunity18digitid', 'dealid'], true),
    F('name', 'Opportunity name', 'str', ['opportunityname', 'name', 'dealname', 'opportunity'], true),
    F('account', 'Account name', 'str', ['accountname', 'account', 'associatedcompany', 'company', 'accountaccountname']),
    F('owner', 'Owner', 'str', ['opportunityowner', 'ownername', 'owner', 'ownerfullname', 'dealowner', 'fullname'], true),
    F('team', 'Owner role / team', 'str', ['ownerrole', 'ownerrolename', 'owneruserrolename', 'role', 'team', 'userrolename', 'ownerteam', 'salesteam', 'region']),
    F('stage', 'Stage', 'str', ['stage', 'stagename', 'dealstage'], true),
    F('amount', 'Amount', 'num', ['amount', 'amountconverted', 'opportunityamount', 'dealamount', 'tcv', 'acv', 'arr']),
    F('closeDate', 'Close date', 'date', ['closedate', 'expectedclosedate', 'closedateexpected'], true),
    F('created', 'Created date', 'date', ['createddate', 'created', 'createdate', 'createdon']),
    F('lastActivity', 'Last activity', 'date', ['lastactivity', 'lastactivitydate', 'lastactivity date', 'lastmodifieddate', 'lastengagementdate', 'lastcontacted']),
    F('nextStep', 'Next step', 'str', ['nextstep', 'nextsteps']),
    F('forecastCategory', 'Forecast category', 'str', ['forecastcategory', 'forecastcategoryname', 'forecastcategoryapi']),
    F('probability', 'Probability (%)', 'num', ['probability', 'probabilitypercent', 'dealprobability']),
    F('contactRoles', 'Number of contact roles', 'num', ['contactroles', 'ofcontactroles', 'numberofcontactroles', 'contactrolecount', 'numberofassociatedcontacts', 'numassociatedcontacts']),
  ],
  history: [
    F('oppId', 'Opportunity ID', 'str', ['opportunityid', 'oppid', 'opportunity18digitid', 'opportunityidopportunityid'], true),
    F('at', 'Edit date', 'date', ['editdate', 'lastmodified', 'lastmodifieddate', 'createddate', 'datechanged', 'changedate', 'systemmodstamp'], true),
    F('stage', 'Stage', 'str', ['tostage', 'stage', 'stagename']),
    F('amount', 'Amount', 'num', ['amount']),
    F('closeDate', 'Close date', 'date', ['closedate', 'expectedclosedate']),
    F('forecastCategory', 'Forecast category', 'str', ['forecastcategory', 'forecastcategoryname']),
  ],
  fieldHistory: [
    F('oppId', 'Opportunity ID', 'str', ['opportunityid', 'oppid', 'opportunity18digitid', 'parentid'], true),
    F('at', 'Edit date', 'date', ['editdate', 'createddate', 'datechanged', 'changedat'], true),
    F('field', 'Field / event', 'str', ['field', 'fieldevent', 'fieldname'], true),
    F('from', 'Old value', 'str', ['oldvalue', 'from', 'previousvalue'], true),
    F('to', 'New value', 'str', ['newvalue', 'to', 'value'], true),
  ],
  roles: [
    F('oppId', 'Opportunity ID', 'str', ['opportunityid', 'oppid'], true),
    F('contactId', 'Contact ID', 'str', ['contactid', 'contact', 'contactname'], true),
    F('role', 'Role', 'str', ['role', 'contactrole']),
  ],
  account: [
    F('id', 'Account ID', 'str', ['accountid', 'id', 'recordid', 'companyid'], true),
    F('name', 'Account name', 'str', ['accountname', 'name', 'companyname'], true),
    F('website', 'Website', 'str', ['website', 'companydomainname', 'domain', 'url']),
    F('phone', 'Phone', 'str', ['phone', 'accountphone', 'phonenumber']),
    F('street', 'Billing street', 'str', ['billingstreet', 'billingaddressline1', 'street', 'streetaddress', 'address']),
    F('city', 'Billing city', 'str', ['billingcity', 'city']),
    F('state', 'Billing state', 'str', ['billingstate', 'billingstateprovince', 'state', 'stateregion']),
    F('postal', 'Billing postal code', 'str', ['billingpostalcode', 'billingzippostalcode', 'postalcode', 'zip', 'zipcode']),
    F('country', 'Billing country', 'str', ['billingcountry', 'country']),
    F('industry', 'Industry', 'str', ['industry']),
    F('employees', 'Employees', 'str', ['employees', 'numberofemployees']),
    F('owner', 'Owner', 'str', ['accountowner', 'ownername', 'owner', 'companyowner']),
    F('created', 'Created date', 'date', ['createddate', 'created', 'createdate']),
    F('lastActivity', 'Last activity', 'date', ['lastactivity', 'lastactivitydate', 'lastmodifieddate']),
  ],
  contact: [
    F('id', 'Contact ID', 'str', ['contactid', 'id', 'recordid'], true),
    F('first', 'First name', 'str', ['firstname', 'first']),
    F('last', 'Last name', 'str', ['lastname', 'last']),
    F('name', 'Full name', 'str', ['fullname', 'name', 'contactname', 'contact']),
    F('company', 'Account name', 'str', ['accountname', 'account', 'company']),
    F('email', 'Email', 'str', ['email', 'emailaddress']),
    F('phone', 'Phone', 'str', ['phone', 'mobile', 'mobilephone', 'businessphone']),
    F('title', 'Title', 'str', ['title', 'jobtitle']),
    F('street', 'Mailing street', 'str', ['mailingstreet', 'street']),
    F('postal', 'Mailing postal code', 'str', ['mailingpostalcode', 'mailingzippostalcode', 'postalcode', 'zip']),
    F('owner', 'Owner', 'str', ['contactowner', 'ownername', 'owner']),
    F('created', 'Created date', 'date', ['createddate', 'created']),
    F('lastActivity', 'Last activity', 'date', ['lastactivity', 'lastactivitydate']),
  ],
  lead: [
    F('id', 'Lead ID', 'str', ['leadid', 'id', 'recordid'], true),
    F('first', 'First name', 'str', ['firstname', 'first']),
    F('last', 'Last name', 'str', ['lastname', 'last']),
    F('name', 'Full name', 'str', ['fullname', 'name', 'leadname']),
    F('company', 'Company', 'str', ['company', 'companyaccount', 'companyname']),
    F('email', 'Email', 'str', ['email', 'emailaddress']),
    F('phone', 'Phone', 'str', ['phone', 'mobile', 'mobilephone']),
    F('title', 'Title', 'str', ['title']),
    F('status', 'Lead status', 'str', ['leadstatus', 'status']),
    F('source', 'Lead source', 'str', ['leadsource', 'source']),
    F('street', 'Street', 'str', ['street', 'address']),
    F('postal', 'Postal code', 'str', ['postalcode', 'zippostalcode', 'zip']),
    F('owner', 'Owner', 'str', ['leadowner', 'ownername', 'owner']),
    F('created', 'Created date', 'date', ['createddate', 'created']),
    F('lastActivity', 'Last activity', 'date', ['lastactivity', 'lastactivitydate']),
  ],
}

export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface Detected { kind: Kind; source: Source }

export function detect(headers: string[]): Detected {
  const h = new Set(headers.map(normHeader))
  const has = (...k: string[]) => k.some(x => h.has(x))
  const upper = headers.filter(x => x.trim()).every(x => x === x.toUpperCase())
  const apiNames = has('stagename', 'closedate', 'forecastcategoryname', 'ownerid', 'accountid', 'opportunityid') && headers.some(x => /^[A-Za-z]+(\.[A-Za-z]+)?$/.test(x.trim()) && /[a-z][A-Z]|\./.test(x.trim()))
  const source: Source = has('dealname', 'dealstage', 'recordid', 'associatedcompany') ? 'hubspot' : upper || apiNames ? 'dataloader' : headers.some(x => / /.test(x)) ? 'report' : 'generic'
  if (has('field', 'fieldevent', 'fieldname') && has('oldvalue', 'newvalue')) return { kind: 'fieldHistory', source }
  if (has('contactid') && has('opportunityid') && has('role', 'isprimary', 'contactrole')) return { kind: 'roles', source }
  if (has('stage', 'stagename', 'tostage') && (has('editdate', 'lastmodified', 'fromstage', 'tostage', 'stageduration') || (has('opportunityid') && has('id') && !has('name')))) return { kind: 'history', source }
  if (has('dealname', 'dealstage') || (has('stage', 'stagename') && has('closedate'))) return { kind: 'opps', source }
  if (has('leadid', 'leadstatus', 'leadsource') || (has('company') && has('lastname') && has('status'))) return { kind: 'lead', source }
  if (has('contactid', 'mailingstreet') || (has('firstname', 'lastname') && has('email'))) return { kind: 'contact', source }
  if (has('accountid', 'accountname', 'billingstreet', 'billingcity', 'website', 'companydomainname')) return { kind: 'account', source }
  return { kind: 'opps', source: 'generic' }
}

export type Mapping = Record<string, number>

export function autoMap(headers: string[], kind: Kind): Mapping {
  const norm = headers.map(normHeader)
  const map: Mapping = {}
  const used = new Set<number>()
  for (const f of FIELDS[kind]) {
    for (const a of f.aliases) {
      const i = norm.findIndex((n, j) => n === a && !used.has(j))
      if (i >= 0) { map[f.key] = i; used.add(i); break }
    }
  }
  return map
}

// ---------- Validation ----------

export interface Issue { line: number; level: 'error' | 'warn'; message: string }

export interface Parsed {
  kind: Kind
  opps: Opp[]
  history: HistEvent[]
  parties: Party[]
  roles: Map<string, Set<string>>
  total: number
  skipped: number
  issues: Issue[]
}

const MAX_ISSUES = 500

/** Day-first if any date-like cell has a first part over 12 and none has a second part over 12. */
function guessDayFirst(t: Table, cols: number[]): boolean {
  let first = false, second = false
  for (const r of t.rows.slice(1, 500)) for (const c of cols) {
    const m = (r[c] ?? '').trim().match(/^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}/)
    if (!m) continue
    if (+m[1] > 12) first = true
    if (+m[2] > 12) second = true
  }
  return first && !second
}

const HIST_FIELD: Record<string, HistField> = { stagename: 'stage', stage: 'stage', amount: 'amount', closedate: 'closeDate', forecastcategoryname: 'forecastCategory', forecastcategory: 'forecastCategory' }

export function validate(t: Table, map: Mapping, kind: Kind): Parsed {
  const out: Parsed = { kind, opps: [], history: [], parties: [], roles: new Map(), total: Math.max(0, t.rows.length - 1), skipped: 0, issues: [] }
  const issue = (line: number, level: Issue['level'], message: string) => { if (out.issues.length < MAX_ISSUES) out.issues.push({ line, level, message }) }
  const specs = FIELDS[kind]
  for (const f of specs) if (f.required && map[f.key] === undefined && !(kind === 'contact' || kind === 'lead') ) issue(1, 'error', `Required column "${f.label}" is not mapped.`)
  if ((kind === 'contact' || kind === 'lead') && map.name === undefined && map.last === undefined) issue(1, 'error', 'Map either "Full name" or "Last name".')
  if ((kind === 'contact' || kind === 'lead') && map.id === undefined) issue(1, 'error', `Required column "${specs[0].label}" is not mapped.`)
  if (out.issues.some(i => i.level === 'error')) { out.skipped = out.total; return out }
  const dateCols = specs.filter(f => f.type === 'date' && map[f.key] !== undefined).map(f => map[f.key])
  const dayFirst = guessDayFirst(t, dateCols)
  const ids = new Map<string, number>()
  const headers = t.rows[0]
  // Opportunity History rows are full states; diff consecutive rows per opportunity into field changes.
  const states = new Map<string, { at: number; line: number; v: Partial<Record<HistField, string | number>> }[]>()

  for (let r = 1; r < t.rows.length; r++) {
    const row = t.rows[r], line = t.lines[r]
    const get = (k: string) => map[k] === undefined ? '' : (row[map[k]] ?? '').trim()
    const date = (k: string, req = false): number | undefined => {
      const v = get(k)
      if (!v) { if (req) throw new Error(`${specs.find(f => f.key === k)!.label} is empty`); return undefined }
      const d = parseDate(v, dayFirst)
      if (!Number.isFinite(d)) throw new Error(`"${v}" in ${specs.find(f => f.key === k)!.label} is not a date`)
      return d
    }
    const num = (k: string): number | undefined => {
      const v = get(k)
      if (!v) return undefined
      const n = parseAmount(v.replace('%', ''))
      if (!Number.isFinite(n)) throw new Error(`"${v}" in ${specs.find(f => f.key === k)!.label} is not a number`)
      return n
    }
    try {
      if (kind === 'opps') {
        const id = get('id'), stage = get('stage')
        if (!id) throw new Error('Opportunity ID is empty')
        if (!stage) throw new Error('Stage is empty')
        const closeDate = dayOf(date('closeDate', true)!)
        const created = date('created')
        let amount = num('amount')
        if (amount === undefined) { amount = 0; issue(line, 'warn', 'Amount is blank, treated as 0.') }
        if (created === undefined) issue(line, 'warn', 'No created date; stage age uses the close date window.')
        if (ids.has(id)) issue(line, 'warn', `Duplicate Opportunity ID ${id} (also on line ${ids.get(id)}); this row wins.`)
        ids.set(id, line)
        const opp: Opp = {
          id, name: get('name') || id, account: get('account'), owner: get('owner') || 'Unassigned', team: get('team') || 'All reps',
          stage, amount, closeDate, created: created ?? closeDate - 90 * DAY, lastActivity: date('lastActivity'), nextStep: get('nextStep'),
          forecastCategory: get('forecastCategory') ? normFc(get('forecastCategory')) : '', probability: num('probability'), contactRoles: num('contactRoles'),
        }
        if (opp.created > opp.closeDate + 365 * DAY) issue(line, 'warn', 'Created after the close date.')
        out.opps.push(opp)
      } else if (kind === 'history') {
        const oppId = get('oppId')
        if (!oppId) throw new Error('Opportunity ID is empty')
        const at = date('at', true)!
        const v: Partial<Record<HistField, string | number>> = {}
        if (get('stage')) v.stage = get('stage')
        const a = num('amount'); if (a !== undefined) v.amount = a
        const c = date('closeDate'); if (c !== undefined) v.closeDate = dayOf(c)
        if (get('forecastCategory')) v.forecastCategory = normFc(get('forecastCategory'))
        const l = states.get(oppId) ?? []
        l.push({ at, line, v })
        states.set(oppId, l)
      } else if (kind === 'fieldHistory') {
        const oppId = get('oppId')
        if (!oppId) throw new Error('Opportunity ID is empty')
        const at = date('at', true)!
        const raw = normHeader(get('field'))
        const field = HIST_FIELD[raw] ?? HIST_FIELD[raw.replace(/^opportunity/, '')]
        if (!field) { out.skipped++; continue } // Other tracked fields are not needed.
        const conv = (s: string): string | number | null => {
          if (!s) return null
          if (field === 'amount') { const n = parseAmount(s); if (!Number.isFinite(n)) throw new Error(`"${s}" is not an amount`); return n }
          if (field === 'closeDate') { const d = parseDate(s, dayFirst); if (!Number.isFinite(d)) throw new Error(`"${s}" is not a date`); return dayOf(d) }
          if (field === 'forecastCategory') return normFc(s)
          return s
        }
        out.history.push({ oppId, at, field, from: conv(get('from')), to: conv(get('to')) })
      } else if (kind === 'roles') {
        const oppId = get('oppId'), c = get('contactId')
        if (!oppId || !c) throw new Error('Opportunity ID or Contact ID is empty')
        const s = out.roles.get(oppId) ?? new Set<string>()
        s.add(c)
        out.roles.set(oppId, s)
      } else {
        const id = get('id')
        if (!id) throw new Error('ID is empty')
        const name = get('name') || [get('first'), get('last')].filter(Boolean).join(' ')
        if (!name) throw new Error('Name is empty')
        if (ids.has(id)) issue(line, 'warn', `Duplicate ID ${id} (also on line ${ids.get(id)}); this row wins.`)
        ids.set(id, line)
        const fields: Record<string, string> = {}
        for (const f of specs) if (map[f.key] !== undefined && f.key !== 'id') fields[f.label] = get(f.key)
        // Keep unmapped columns too, so survivorship can show everything the export had.
        headers.forEach((h, i) => { if (!Object.values(map).includes(i) && h.trim() && (row[i] ?? '').trim()) fields[h.trim()] = row[i].trim() })
        out.parties.push({
          id, kind, name, company: get('company') || undefined, email: get('email') || undefined, website: get('website') || undefined,
          phone: get('phone') || undefined, street: get('street') || undefined, city: get('city') || undefined, state: get('state') || undefined,
          postal: get('postal') || undefined, country: get('country') || undefined, owner: get('owner') || undefined,
          created: date('created'), lastActivity: date('lastActivity'), fields,
        })
      }
    } catch (e) {
      out.skipped++
      issue(line, 'error', e instanceof Error ? e.message : String(e))
    }
  }

  for (const [oppId, l] of states) {
    l.sort((a, b) => a.at - b.at)
    for (let i = 1; i < l.length; i++) {
      for (const f of ['stage', 'amount', 'closeDate', 'forecastCategory'] as HistField[]) {
        const a = l[i - 1].v[f], b = l[i].v[f]
        if (b !== undefined && a !== undefined && a !== b) out.history.push({ oppId, at: l[i].at, field: f, from: a, to: b })
      }
    }
    if (l.length === 1) issue(l[0].line, 'warn', `Only one history row for ${oppId}; no changes to learn from.`)
  }
  if (kind === 'opps' && out.opps.length && !out.opps.some(o => o.lastActivity)) issue(1, 'warn', 'No Last Activity column mapped; the stale rule falls back to the created date.')
  if (kind === 'opps' && out.opps.length && !out.opps.some(o => o.forecastCategory)) issue(1, 'warn', 'No Forecast Category column; every open deal is treated as Pipeline unless history says otherwise.')
  return out
}

// ---------- Merge into a dataset ----------

export function mergeInto(ds: Dataset, p: Parsed): Dataset {
  const opps = new Map(ds.opps.map(o => [o.id, o]))
  for (const o of p.opps) opps.set(o.id, { ...o, contactRoles: o.contactRoles ?? opps.get(o.id)?.contactRoles })
  if (p.roles.size) for (const [id, s] of p.roles) { const o = opps.get(id); if (o) opps.set(id, { ...o, contactRoles: s.size }) }
  // Opportunities with no roles in a full Contact Roles export have zero roles.
  if (p.kind === 'roles') for (const [id, o] of opps) if (!p.roles.has(id)) opps.set(id, { ...o, contactRoles: 0 })
  const key = (e: HistEvent) => `${e.oppId}|${e.at}|${e.field}|${e.to}`
  const hist = new Map(ds.history.map(e => [key(e), e]))
  for (const e of p.history) hist.set(key(e), e)
  const parties = new Map(ds.parties.map(x => [x.kind + x.id, x]))
  for (const x of p.parties) parties.set(x.kind + x.id, x)
  const fill = (o: Opp): Opp => o.forecastCategory ? o : { ...o, forecastCategory: /won/i.test(o.stage) ? 'Closed' : /lost|closed/i.test(o.stage) ? 'Omitted' : 'Pipeline' }
  return { opps: [...opps.values()].map(fill), history: [...hist.values()], parties: [...parties.values()] }
}

export const emptyDataset = (): Dataset => ({ opps: [], history: [], parties: [] })
