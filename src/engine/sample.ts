// Synthetic sample orgs. Every name, deal and number here is generated; none of it is real customer data.
import { DAY, DEFAULT_STAGES, defaultConfig, type Config, type Dataset, type HistEvent, type Opp, type Party } from './types.ts'

export interface SampleDef { id: string; name: string; blurb: string }
export const SAMPLES: SampleDef[] = [
  { id: 'saas', name: 'Northbeam Cloud (synthetic)', blurb: '40 reps, 6 quarters of history, a few sandbaggers and some chronic close-date pushers' },
  { id: 'dupes', name: 'Acme account base (synthetic)', blurb: '1,500 accounts with 300 planted duplicates, plus contacts and leads' },
]

export const SAMPLE_AS_OF = Date.UTC(2026, 10, 6)

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Maya', 'Liam', 'Priya', 'Noah', 'Sofia', 'Ethan', 'Aisha', 'Lucas', 'Chloe', 'Mateo', 'Hannah', 'Omar', 'Grace', 'Daniel', 'Yuki', 'Caleb', 'Elena', 'Marcus', 'Zoe', 'Ravi', 'Isla', 'Theo', 'Nadia', 'Felix', 'Leah', 'Jonah', 'Amara', 'Owen', 'Sara', 'Diego', 'Ingrid', 'Kofi', 'Mei', 'Rafael', 'Tessa', 'Arjun', 'Lena', 'Victor', 'Paige', 'Samir', 'Jade', 'Hugo', 'Erin', 'Tariq', 'Clara', 'Andre', 'Fiona', 'Kenji']
const LAST = ['Okafor', 'Lindqvist', 'Raman', 'Castillo', 'Brennan', 'Haddad', 'Novak', 'Whitaker', 'Ferreira', 'Kowalski', 'Ito', 'Mensah', 'Delgado', 'Fischer', 'Osei', 'Park', 'Moreau', 'Quinn', 'Sato', 'Varga', 'Abbott', 'Chen', 'Duarte', 'Ellison', 'Gupta', 'Hale', 'Ivanova', 'Jensen', 'Kaur', 'Larsen', 'Mbeki', 'Nakamura', 'Ortiz', 'Patel', 'Rossi', 'Schmidt', 'Tanaka', 'Usman', 'Vance', 'Wright']
const WORD_A = ['Blue', 'North', 'Cobalt', 'Silver', 'Granite', 'Harbor', 'Summit', 'Pine', 'Iron', 'Bright', 'Cedar', 'Atlas', 'Copper', 'Maple', 'River', 'Echo', 'Lumen', 'Orbit', 'Prairie', 'Vista', 'Quarry', 'Falcon', 'Meridian', 'Oak', 'Polar', 'Redwood', 'Sterling', 'Tidal', 'Upland', 'Willow']
const WORD_B = ['field', 'stone', 'line', 'point', 'gate', 'works', 'bridge', 'crest', 'wave', 'path', 'light', 'forge', 'hill', 'bay', 'peak']
const INDUSTRY = ['Analytics', 'Logistics', 'Health', 'Robotics', 'Foods', 'Energy', 'Software', 'Capital', 'Labs', 'Systems', 'Retail', 'Media', 'Biotech', 'Freight', 'Insurance']
const SUFFIX = ['Inc.', 'LLC', 'Corp.', 'Ltd', 'Inc', 'Co.', 'Group', '']
const NEXT = ['Send MSA redlines', 'Security review call Tue', 'Pricing sign-off from CFO', 'Demo for ops team', 'Champion intro to VP', 'POC readout Friday', 'Procurement kickoff', 'Send mutual action plan', 'Legal review of DPA', 'Exec sponsor dinner']
const TEAMS = [['Enterprise East', 90000, 120], ['Enterprise West', 85000, 115], ['Mid-Market', 32000, 75], ['Commercial', 12000, 45]] as const

const pick = <T>(r: () => number, l: readonly T[]) => l[Math.floor(r() * l.length)]
const fcFor = (stageIdx: number) => stageIdx >= 4 ? 'Commit' : stageIdx >= 3 ? 'Best Case' : 'Pipeline'

type Kind = 'normal' | 'sandbagger' | 'pusher' | 'optimist'

/** 40 reps over six closed quarters plus the current one. Archetypes are deliberately planted so the analytics have something to find. */
export function saasOrg(): Dataset {
  const r = rng(42)
  const asOf = SAMPLE_AS_OF
  const reps: { name: string; team: (typeof TEAMS)[number]; kind: Kind }[] = []
  const kinds: Kind[] = ['sandbagger', 'pusher', 'optimist', 'normal', 'normal', 'pusher', 'normal', 'normal', 'sandbagger', 'normal']
  for (let i = 0; i < 40; i++) reps.push({ name: `${FIRST[i]} ${LAST[i]}`, team: TEAMS[i % 4], kind: kinds[i % 10] })
  const accounts = Array.from({ length: 260 }, (_, i) => `${WORD_A[i % 30]}${WORD_B[Math.floor(i / 30) % 15]} ${INDUSTRY[(i * 7) % 15]}`)
  const opps: Opp[] = []
  const history: HistEvent[] = []
  const start = Date.UTC(2024, 7, 1)
  let n = 0
  for (const rep of reps) {
    const count = 120 + Math.floor(r() * 40)
    for (let k = 0; k < count; k++) {
      const id = `006Hs00001${String(++n).padStart(5, '0')}AAA`
      const [team, size, cycle] = rep.team
      const created = Math.floor((start + r() * (asOf - 12 * DAY - start)) / DAY) * DAY
      let amount = Math.round(size * Math.exp((r() - 0.5) * 1.2) / 500) * 500
      const planned = created + Math.round(cycle * (0.7 + r() * 0.6)) * DAY
      const winP = rep.kind === 'sandbagger' ? 0.5 : rep.kind === 'optimist' ? 0.24 : 0.36
      const won = r() < winP
      const lostAt = won ? 8 : 1 + Math.floor(r() ** 2 * 4)
      // Close-date pushes.
      const pushN = rep.kind === 'pusher' ? 2 + Math.floor(r() * 4) : rep.kind === 'optimist' ? Math.floor(r() * 3) : r() < 0.55 ? 0 : 1 + Math.floor(r() * 2)
      const closes = [planned]
      const pushAt: number[] = []
      for (let p = 0; p < pushN; p++) {
        const prev = closes[closes.length - 1]
        const at = Math.max(created + DAY, prev - Math.floor(r() * 40) * DAY, (pushAt.at(-1) ?? created) + DAY)
        pushAt.push(at)
        closes.push(prev + (14 + Math.floor(r() * (rep.kind === 'pusher' ? 35 : 25))) * DAY)
      }
      const final = closes[closes.length - 1]
      const closed = final <= asOf
      const ev: HistEvent[] = []
      pushAt.forEach((at, p) => { if (at <= asOf) ev.push({ oppId: id, at, field: 'closeDate', from: closes[p], to: closes[p + 1] }) })
      const curClose = closes[ev.length]
      // Stage path: Prospecting through the stage reached, evenly spaced, with the odd skip or step back.
      const lastStage = won || !closed ? 7 : lostAt - 1
      let stage = 0
      // Stages track the original plan; pushes then happen while the deal sits in late stages.
      const span = Math.max(DAY * 8, planned - created)
      let fc = 'Pipeline'
      for (let s = 1; s <= lastStage; s++) {
        if (s < lastStage && r() < 0.08) continue
        const at = created + Math.floor((span * s) / 8 / DAY) * DAY
        if (at > asOf) break
        if (r() < 0.04 && stage > 0) {
          // A step back before moving on.
          ev.push({ oppId: id, at: at - DAY, field: 'stage', from: DEFAULT_STAGES[stage], to: DEFAULT_STAGES[stage - 1] })
          stage--
        }
        ev.push({ oppId: id, at, field: 'stage', from: DEFAULT_STAGES[stage], to: DEFAULT_STAGES[s] })
        stage = s
        const want = rep.kind === 'sandbagger' ? (s >= 6 ? 'Best Case' : 'Pipeline') : rep.kind === 'optimist' ? (s >= 3 ? 'Commit' : 'Pipeline') : fcFor(s)
        if (want !== fc) { ev.push({ oppId: id, at, field: 'forecastCategory', from: fc, to: want }); fc = want }
      }
      // Sandbaggers only call it the week it closes.
      if (rep.kind === 'sandbagger' && won && final - 5 * DAY <= asOf && fc !== 'Commit') { ev.push({ oppId: id, at: final - 5 * DAY, field: 'forecastCategory', from: fc, to: 'Commit' }); fc = 'Commit' }
      if (r() < 0.3) {
        const at = created + Math.floor(r() * Math.max(1, (Math.min(asOf, final) - created) / DAY)) * DAY
        const next = Math.round(amount * (rep.kind === 'optimist' ? 0.7 + r() * 0.2 : 0.85 + r() * 0.35) / 500) * 500
        ev.push({ oppId: id, at, field: 'amount', from: amount, to: next })
        amount = next
      }
      let finalStage = DEFAULT_STAGES[stage]
      if (closed) {
        finalStage = won ? 'Closed Won' : 'Closed Lost'
        ev.push({ oppId: id, at: final, field: 'stage', from: DEFAULT_STAGES[stage], to: finalStage })
        const to = won ? 'Closed' : 'Omitted'
        ev.push({ oppId: id, at: final, field: 'forecastCategory', from: fc, to })
        fc = to
      }
      const staleP = rep.kind === 'pusher' ? 0.45 : 0.2
      const lastActivity = closed ? final : asOf - Math.floor(r() < staleP ? 15 + r() * 50 : r() * 12) * DAY
      opps.push({
        id, name: `${accounts[Math.floor(r() * accounts.length)].split(' ')[0]} ${pick(r, ['Platform', 'Expansion', 'Renewal', 'New Logo', 'Add-on', 'Pilot'])} ${new Date(created).getUTCFullYear()}`,
        account: accounts[Math.floor(r() * accounts.length)], owner: rep.name, team, stage: finalStage, amount: r() < 0.03 && !closed ? 0 : amount,
        closeDate: curClose, created, lastActivity: Math.max(created, lastActivity), nextStep: closed || r() < (rep.kind === 'pusher' ? 0.5 : 0.82) ? pick(r, NEXT) : '',
        forecastCategory: fc, probability: closed ? (won ? 100 : 0) : [10, 20, 30, 40, 50, 60, 75, 90][stage], contactRoles: r() < 0.3 ? 1 : 2 + Math.floor(r() * 4),
      })
      history.push(...ev)
    }
  }
  // Fix names to use the account they belong to.
  for (const o of opps) o.name = `${o.account.split(' ')[0]} ${o.name.split(' ').slice(1).join(' ')}`
  const parties = dupedAccounts(rng(7), 220, 18, 'saas')
  return { opps, history, parties }
}

const phoneFmt = (r: () => number, digits: string) => pick(r, [`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`, `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`])

/** Messy variants of a company name the way they show up in a real org. */
function variant(r: () => number, base: string, suffix: string, domain: string): string {
  const v = Math.floor(r() * 7)
  if (v === 0) return `${base.toUpperCase()}, ${suffix || 'Inc.'}`
  if (v === 1) return domain
  if (v === 2) return `${base} ${suffix.replace('.', '') === 'Inc' ? 'Incorporated' : suffix === 'LLC' ? 'L.L.C.' : 'Inc'}`
  if (v === 3) return `The ${base}`
  if (v === 4) { const i = 1 + Math.floor(r() * (base.length - 2)); return base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2) + (suffix ? ' ' + suffix : '') }
  if (v === 5) return `${base.toLowerCase()} ${suffix.toLowerCase()}`.trim()
  return `${base} ${suffix}`.trim() + ' (old)'
}

const STREETS = ['Main Street', 'Market St', 'Mission Street', '2nd Avenue', 'Oak Road', 'Pine Boulevard', 'Harbor Drive', 'Elm St']

function dupedAccounts(r: () => number, unique: number, dupes: number, prefix: string): Party[] {
  const out: Party[] = []
  const bases: { name: string; suffix: string; domain: string; phone: string; street: string; postal: string; city: string }[] = []
  const used = new Set<string>()
  for (let i = 0; bases.length < unique; i++) {
    const name = i === 0 ? 'Acme' : `${pick(r, WORD_A)}${pick(r, WORD_B)}${r() < 0.5 ? ' ' + pick(r, INDUSTRY) : ''}`
    if (used.has(name)) continue
    used.add(name)
    const domain = name.toLowerCase().replace(/[^a-z]/g, '') + pick(r, ['.com', '.com', '.io', '.co'])
    bases.push({ name, suffix: pick(r, SUFFIX), domain, phone: String(2000000000 + Math.floor(r() * 7999999999)).slice(0, 10), street: `${100 + Math.floor(r() * 9000)} ${pick(r, STREETS)}`, postal: String(10000 + Math.floor(r() * 89999)), city: pick(r, ['Austin', 'Denver', 'Chicago', 'Boston', 'Seattle', 'Atlanta', 'Columbus']) })
  }
  let n = 0
  const id = () => `001${prefix === 'saas' ? 'Hs' : 'Ak'}0000${String(++n).padStart(6, '0')}AAA`
  const day = (y: number) => Date.UTC(2019 + Math.floor(r() * y), Math.floor(r() * 12), 1 + Math.floor(r() * 27))
  for (const b of bases) {
    out.push({ id: id(), kind: 'account', name: `${b.name} ${b.suffix}`.trim(), website: `https://www.${b.domain}`, phone: phoneFmt(r, b.phone), street: b.street, city: b.city, postal: b.postal, created: day(5), lastActivity: day(7) + 365 * DAY, owner: `${pick(r, FIRST)} ${pick(r, LAST)}`, fields: {} })
  }
  // Acme gets the full treatment: the classic three-way duplicate.
  const acme = bases[0]
  const extra: [string, Partial<Party>][] = [['ACME, Inc.', { website: '', phone: phoneFmt(r, acme.phone) }], ['acme.com', { website: 'acme.com', street: '' }]]
  for (const [name, p] of extra) out.push({ id: id(), kind: 'account', name, website: p.website ?? `${acme.domain}`, phone: p.phone, street: p.street ?? acme.street.replace('Street', 'St'), city: acme.city, postal: acme.postal, created: day(6), owner: `${pick(r, FIRST)} ${pick(r, LAST)}`, fields: {} })
  for (let d = 0; d < dupes - 2; d++) {
    const b = bases[1 + Math.floor(r() * (bases.length - 1))]
    const keepDomain = r() < 0.6, keepPhone = r() < 0.5, keepAddr = r() < 0.5
    out.push({
      id: id(), kind: 'account', name: variant(r, b.name, b.suffix, b.domain),
      website: keepDomain ? pick(r, [b.domain, `http://${b.domain}/`, `www.${b.domain}`]) : undefined,
      phone: keepPhone ? phoneFmt(r, b.phone) : undefined,
      street: keepAddr ? b.street.replace('Street', 'St').replace('Boulevard', 'Blvd') : undefined, city: b.city, postal: keepAddr ? b.postal : undefined,
      created: day(6), lastActivity: r() < 0.5 ? day(6) + 400 * DAY : undefined, owner: `${pick(r, FIRST)} ${pick(r, LAST)}`, fields: {},
    })
  }
  // Near misses that must not merge: same first word, different companies and domains.
  for (let k = 0; k < Math.min(12, unique / 10); k++) {
    const b = bases[1 + k]
    const other = b.name.split(' ')[0] + ' ' + pick(r, INDUSTRY.filter(x => !b.name.includes(x)))
    out.push({ id: id(), kind: 'account', name: other + ' Inc.', website: other.toLowerCase().replace(/[^a-z]/g, '') + '.com', city: pick(r, ['Miami', 'Portland']), created: day(5), owner: `${pick(r, FIRST)} ${pick(r, LAST)}`, fields: {} })
  }
  for (const p of out) p.fields = accountFields(p)
  return out
}

function accountFields(p: Party): Record<string, string> {
  const f: Record<string, string> = { 'Account name': p.name }
  if (p.website) f.Website = p.website
  if (p.phone) f.Phone = p.phone
  if (p.street) f['Billing street'] = p.street
  if (p.city) f['Billing city'] = p.city
  if (p.postal) f['Billing postal code'] = p.postal
  if (p.owner) f.Owner = p.owner
  return f
}

/** An account base with 300 duplicates, plus contacts and leads with their own duplicates. */
export function dupesOrg(): Dataset {
  const r = rng(99)
  const accounts = dupedAccounts(r, 1200, 300, 'dupes').slice(0, 1500)
  const parties: Party[] = [...accounts]
  const people: Party[] = []
  let n = 0
  const mk = (kind: 'contact' | 'lead') => {
    const first = pick(r, FIRST), last = pick(r, LAST)
    const acct = accounts[Math.floor(r() * 1200)]
    const dom = (acct.website ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || 'example.com'
    const p: Party = { id: `${kind === 'contact' ? '003' : '00Q'}Ak0000${String(++n).padStart(6, '0')}AAA`, kind, name: `${first} ${last}`, company: acct.name, email: `${first}.${last}@${dom}`.toLowerCase(), phone: r() < 0.6 ? phoneFmt(r, String(3000000000 + Math.floor(r() * 6000000000))) : undefined, created: Date.UTC(2021 + Math.floor(r() * 5), Math.floor(r() * 12), 2), lastActivity: r() < 0.5 ? Date.UTC(2026, Math.floor(r() * 10), 3) : undefined, fields: {} }
    return p
  }
  for (let i = 0; i < 420; i++) people.push(mk('contact'))
  for (let i = 0; i < 320; i++) people.push(mk('lead'))
  // Contact and lead duplicates: same person, re-entered with a nickname, a typo or a personal email.
  const dupOf = (src: Party, k: number): Party => {
    const [first, last] = src.name.split(' ')
    const name = k === 0 ? `${first} ${last}`.toUpperCase() : k === 1 ? `${first[0]}. ${last}` : k === 2 ? `${first} ${last.slice(0, -1)}${last.at(-1) === 'a' ? 'e' : 'a'}` : `${first} ${last}`
    const email = k === 1 || k === 2 ? src.email : k === 3 ? `${first}${last}@gmail.com`.toLowerCase() : src.email!.toUpperCase()
    return { ...src, id: `${src.id.slice(0, 3)}Ak1000${String(++n).padStart(6, '0')}AAA`, name, email, phone: k === 3 ? src.phone : undefined, lastActivity: undefined, fields: {} }
  }
  const contacts = people.filter(p => p.kind === 'contact'), leads = people.filter(p => p.kind === 'lead')
  for (let i = 0; i < 60; i++) people.push(dupOf(contacts[i * 7 % contacts.length], i % 4))
  for (let i = 0; i < 40; i++) people.push(dupOf(leads[i * 7 % leads.length], i % 4))
  for (const p of people) {
    const [first, ...rest] = p.name.split(' ')
    p.fields = { 'First name': first, 'Last name': rest.join(' '), [p.kind === 'lead' ? 'Company' : 'Account name']: p.company ?? '', Email: p.email ?? '', ...(p.phone ? { Phone: p.phone } : {}) }
  }
  parties.push(...people)
  return { opps: [], history: [], parties }
}

export function sampleConfig(id: string): Config {
  return { ...defaultConfig(), asOf: SAMPLE_AS_OF, stageDays: id === 'saas' ? { Prospecting: 21, Qualification: 21, 'Needs Analysis': 25, 'Negotiation/Review': 30 } : {} }
}

export function generate(id: string): Dataset {
  return id === 'saas' ? saasOrg() : dupesOrg()
}
