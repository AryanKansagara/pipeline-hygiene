import type { MasterRule, Party, PartyKind } from './types.ts'

// ---------- Normalisation ----------

const LEGAL = new Set(['inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'gmbh', 'ag', 'plc', 'sa', 'sas', 'srl', 'bv', 'nv', 'pty', 'pte', 'oy', 'ab', 'as', 'kk', 'the', 'holdings', 'group'])

/** "ACME, Inc." / "Acme Incorporated" / "The Acme Co." all become "acme". Keeps the original if stripping would empty it. */
export function normName(s: string): string {
  const base = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/\.(com|net|org|io|co|ai)\b/g, ' ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const words = base.split(' ').filter(Boolean)
  const kept = words.filter(w => !LEGAL.has(w))
  return (kept.length ? kept : words).join(' ')
}

const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com'])

/** Registrable-ish domain from a URL, bare domain or email. Freemail domains return '' because they identify nobody. */
export function domainOf(s?: string): string {
  if (!s) return ''
  let d = s.trim().toLowerCase()
  if (d.includes('@')) d = d.split('@').pop()!
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\d?\./, '').split(/[/?#:\s]/)[0]
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || FREEMAIL.has(d)) return ''
  return d
}

/** Last 10 digits, so +1 (415) 555-0100 and 415.555.0100 match. */
export function normPhone(s?: string): string {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length >= 7 ? d.slice(-10) : ''
}

const STREET: Record<string, string> = { street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd', boulevard: 'blvd', blvd: 'blvd', suite: 'ste', ste: 'ste', drive: 'dr', dr: 'dr', north: 'n', south: 's', east: 'e', west: 'w', floor: 'fl', fl: 'fl' }
export function normAddress(street?: string, postal?: string): string {
  if (!street?.trim()) return ''
  const s = street.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(w => STREET[w] ?? w).join(' ')
  return `${s}|${(postal ?? '').replace(/\s/g, '').toLowerCase().slice(0, 5)}`
}

// ---------- Similarity ----------

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0
  const la = a.length, lb = b.length
  if (!la || !lb) return 0
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const ma = new Array<boolean>(la).fill(false), mb = new Array<boolean>(lb).fill(false)
  let m = 0
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(lb, i + win + 1); j++) {
      if (mb[j] || a[i] !== b[j]) continue
      ma[i] = mb[j] = true; m++; break
    }
  }
  if (!m) return 0
  let t = 0, k = 0
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue
    while (!mb[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3
  let p = 0
  while (p < 4 && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

const grams = (s: string) => { const p = `  ${s} `; const g = new Set<string>(); for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3)); return g }
export function trigram(a: string, b: string): number {
  if (!a || !b) return 0
  const A = grams(a), B = grams(b)
  let i = 0
  for (const g of A) if (B.has(g)) i++
  return i / (A.size + B.size - i)
}

export const nameSim = (a: string, b: string) => Math.max(jaroWinkler(a, b), trigram(a, b), jaroWinkler(a.replace(/ /g, ''), b.replace(/ /g, '')))

// ---------- Matching ----------

interface Prepared { p: Party; name: string; domain: string; phone: string; addr: string; email: string; person: string; org: string }

function prepare(p: Party): Prepared {
  const looksDomain = !p.website && /^[\w-]+(\.[\w-]+)+$/.test(p.name.trim())
  return {
    p,
    name: normName(p.kind === 'account' ? p.name : p.name),
    domain: domainOf(p.website) || (looksDomain ? domainOf(p.name) : '') || domainOf(p.email),
    phone: normPhone(p.phone),
    addr: normAddress(p.street, p.postal),
    email: (p.email ?? '').trim().toLowerCase(),
    person: p.kind === 'account' ? '' : normPerson(p.name),
    org: p.company ? normName(p.company) : '',
  }
}

const normPerson = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(mr|mrs|ms|dr|jr|sr|ii|iii)\b\.?/g, '').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).join(' ')

export interface PairScore { a: string; b: string; confidence: number; reasons: string[] }

/** Evidence combined as 1 - prod(1 - p). Conflicting company domains halve it. */
export function scorePair(x: Prepared, y: Prepared): PairScore {
  const ev: [number, string][] = []
  if (x.p.kind === 'account') {
    const s = x.name && y.name ? nameSim(x.name, y.name) : 0
    if (x.name && x.name === y.name) ev.push([0.85, 'Same normalised name'])
    else if (s >= 0.93) ev.push([0.6, `Names ${Math.round(s * 100)}% similar`])
    else if (s >= 0.86) ev.push([0.3, `Names ${Math.round(s * 100)}% similar`])
    if (x.domain && x.domain === y.domain) ev.push([0.8, `Same domain (${x.domain})`])
  } else {
    if (x.email && x.email === y.email) ev.push([0.9, 'Same email'])
    const s = x.person && y.person ? nameSim(x.person, y.person) : 0
    if (x.person && x.person === y.person) ev.push([0.55, 'Same name'])
    else if (s >= 0.92) ev.push([0.35, `Names ${Math.round(s * 100)}% similar`])
    if (x.domain && x.domain === y.domain && s >= 0.85) ev.push([0.3, 'Same email domain'])
    if (x.org && x.org === y.org && s >= 0.85) ev.push([0.3, 'Same company'])
  }
  if (x.phone && x.phone === y.phone) ev.push([0.55, 'Same phone'])
  if (x.addr && x.addr === y.addr) ev.push([0.45, 'Same street address'])
  let c = 1 - ev.reduce((m, [p]) => m * (1 - p), 1)
  if (x.p.kind === 'account' && x.domain && y.domain && x.domain !== y.domain) c *= 0.5
  if (x.p.kind !== 'account' && x.email && y.email && x.email !== y.email && x.domain !== y.domain) c *= 0.6
  return { a: x.p.id, b: y.p.id, confidence: Math.round(c * 1000) / 1000, reasons: ev.map(e => e[1]) }
}

/** Blocking keys: only records that share one are compared, which keeps 10k records well under a second. */
function keys(r: Prepared): string[] {
  const k: string[] = []
  const nm = r.p.kind === 'account' ? r.name : r.person
  if (nm) {
    const compact = nm.replace(/ /g, '')
    k.push('p:' + compact.slice(0, 4))
    const words = nm.split(' ')
    if (r.p.kind === 'account') k.push('w:' + words[0])
    else k.push('l:' + words[words.length - 1] + ':' + words[0][0])
  }
  if (r.domain && r.p.kind === 'account') k.push('d:' + r.domain)
  if (r.email) k.push('e:' + r.email)
  if (r.phone) k.push('t:' + r.phone)
  if (r.addr) k.push('a:' + r.addr)
  return k
}

export interface Cluster { id: string; kind: PartyKind; members: Party[]; master: Party; confidence: number; links: PairScore[] }
export interface DedupeResult { clusters: Cluster[]; compared: number; records: number; byKind: Record<PartyKind, number> }

const MAX_BLOCK = 300

export function findDuplicates(parties: Party[], threshold = 0.75, rule: MasterRule = 'complete'): DedupeResult {
  const clusters: Cluster[] = []
  let compared = 0
  const byKind: Record<PartyKind, number> = { account: 0, contact: 0, lead: 0 }
  for (const kind of ['account', 'contact', 'lead'] as PartyKind[]) {
    const recs = parties.filter(p => p.kind === kind).map(prepare)
    byKind[kind] = recs.length
    const blocks = new Map<string, number[]>()
    recs.forEach((r, i) => { for (const k of keys(r)) { const l = blocks.get(k); if (l) l.push(i); else blocks.set(k, [i]) } })
    const seen = new Set<number>()
    const links: PairScore[] = []
    for (const l of blocks.values()) {
      if (l.length < 2 || l.length > MAX_BLOCK) continue
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const a = Math.min(l[i], l[j]), b = Math.max(l[i], l[j])
        const key = a * 1_000_003 + b
        if (seen.has(key)) continue
        seen.add(key)
        compared++
        const s = scorePair(recs[a], recs[b])
        if (s.confidence >= threshold) links.push(s)
      }
    }
    // Union-find over confident links.
    const parent = new Map<string, string>()
    const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r }
    for (const r of recs) parent.set(r.p.id, r.p.id)
    for (const s of links) parent.set(find(s.a), find(s.b))
    const groups = new Map<string, Party[]>()
    for (const r of recs) { const k = find(r.p.id); const g = groups.get(k); if (g) g.push(r.p); else groups.set(k, [r.p]) }
    for (const members of groups.values()) {
      if (members.length < 2) continue
      const ids = new Set(members.map(m => m.id))
      const cl = links.filter(s => ids.has(s.a))
      // Weakest member: each record's best link, then the minimum.
      const best = members.map(m => Math.max(...cl.filter(s => s.a === m.id || s.b === m.id).map(s => s.confidence)))
      const master = pickMaster(members, rule)
      clusters.push({ id: `${kind[0].toUpperCase()}${clusters.length + 1}`, kind, members: [master, ...members.filter(m => m !== master)], master, confidence: Math.min(...best), links: cl })
    }
  }
  clusters.sort((a, b) => b.confidence - a.confidence || b.members.length - a.members.length)
  return { clusters, compared, records: parties.length, byKind }
}

// ---------- Master selection and survivorship ----------

export const completeness = (p: Party) => Object.values(p.fields).filter(v => v.trim()).length

const RULE_ORDER: Record<MasterRule, MasterRule[]> = { complete: ['complete', 'activity', 'oldest'], activity: ['activity', 'complete', 'oldest'], oldest: ['oldest', 'complete', 'activity'] }

export function pickMaster(members: Party[], rule: MasterRule): Party {
  const cmp: Record<MasterRule, (a: Party, b: Party) => number> = {
    complete: (a, b) => completeness(b) - completeness(a),
    activity: (a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0),
    oldest: (a, b) => (a.created ?? Infinity) - (b.created ?? Infinity),
  }
  return [...members].sort((a, b) => { for (const r of RULE_ORDER[rule]) { const d = cmp[r](a, b); if (d) return d } return a.id.localeCompare(b.id) })[0]
}

export interface Survivor { field: string; value: string; from: string; conflict: string[] }

/** Master keeps its non-empty values; blanks are filled from the duplicates in order. Conflicts list the losing values. */
export function survivorship(c: Cluster): Survivor[] {
  const fields = [...new Set(c.members.flatMap(m => Object.keys(m.fields)))]
  return fields.map(field => {
    const vals = c.members.map(m => ({ id: m.id, v: (m.fields[field] ?? '').trim() })).filter(x => x.v)
    const win = vals[0] ?? { id: c.master.id, v: '' }
    const conflict = [...new Set(vals.filter(x => x.v.toLowerCase() !== win.v.toLowerCase()).map(x => x.v))]
    return { field, value: win.v, from: win.id, conflict }
  })
}

/** Salesforce merges at most 3 records at a time: the master plus 2. Bigger clusters become several merges into the same master. */
export function mergeBatches(c: Cluster): string[][] {
  const dups = c.members.filter(m => m !== c.master).map(m => m.id)
  const out: string[][] = []
  for (let i = 0; i < dups.length; i += 2) out.push(dups.slice(i, i + 2))
  return out
}
