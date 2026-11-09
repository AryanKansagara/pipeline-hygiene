import { DAY, RULES, type Config, type Dataset, type HistEvent, type Opp, type RuleId } from './types.ts'

// ---------- Stages, categories, dates ----------

export const isWon = (stage: string) => /won/i.test(stage)
export const isLost = (stage: string) => !isWon(stage) && /lost|closed|dead|disqualified/i.test(stage)
export const isClosed = (stage: string) => isWon(stage) || isLost(stage)

export function normFc(s: string): string {
  if (/commit/i.test(s)) return 'Commit'
  if (/best/i.test(s)) return 'Best Case'
  if (/closed|won/i.test(s)) return 'Closed'
  if (/omit|not forecast|lost/i.test(s)) return 'Omitted'
  return 'Pipeline'
}

/** Open stages in order: the configured list, then any stage seen in the data, by average probability. */
export function stageOrder(cfg: Config, opps: Opp[], history: HistEvent[] = []): string[] {
  const seen = new Map<string, number[]>()
  const add = (s: string, p?: number) => { if (!s || isClosed(s)) return; const l = seen.get(s) ?? []; if (p !== undefined) l.push(p); seen.set(s, l) }
  for (const o of opps) add(o.stage, o.probability)
  for (const e of history) if (e.field === 'stage') { add(String(e.from ?? '')); add(String(e.to ?? '')) }
  const known = cfg.stages.filter(s => seen.has(s))
  const extra = [...seen.keys()].filter(s => !cfg.stages.includes(s))
  const avg = (s: string) => { const l = seen.get(s)!; return l.length ? l.reduce((a, b) => a + b, 0) / l.length : 50 }
  const order = known.length ? known : []
  for (const s of extra.sort((a, b) => avg(a) - avg(b))) {
    // Slot unknown stages next to configured stages with a similar probability.
    const i = order.findIndex(k => seen.get(k)!.length && avg(k) > avg(s))
    if (i < 0) order.push(s); else order.splice(i, 0, s)
  }
  return order
}

export const utcDay = (t: number) => Math.floor(t / DAY) * DAY
export const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10)

export interface Quarter { key: string; label: string; start: number; end: number }

/** Fiscal quarter containing t. `end` is exclusive. Fiscal years are named by the calendar year they start in. */
export function quarterOf(t: number, fiscalStartMonth = 1): Quarter {
  const d = new Date(t)
  const m0 = fiscalStartMonth - 1
  const monthsIn = ((d.getUTCMonth() - m0) % 12 + 12) % 12
  const q = Math.floor(monthsIn / 3)
  const fy = d.getUTCMonth() >= m0 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
  const start = Date.UTC(fy, m0 + q * 3, 1)
  const end = Date.UTC(fy, m0 + q * 3 + 3, 1)
  const label = fiscalStartMonth === 1 ? `Q${q + 1} ${fy}` : `FY${fy} Q${q + 1}`
  return { key: `${fy}-Q${q + 1}`, label, start, end }
}

export const prevQuarter = (q: Quarter, fsm: number) => quarterOf(q.start - DAY, fsm)
export const inQuarter = (t: number, q: Quarter) => t >= q.start && t < q.end

/** The export date: configured, else the latest timestamp in the data that is not in the future of activity. */
export function asOfDate(ds: Dataset, cfg: Config): number {
  if (cfg.asOf) return utcDay(cfg.asOf)
  let m = 0
  for (const o of ds.opps) m = Math.max(m, o.created, o.lastActivity ?? 0)
  for (const e of ds.history) m = Math.max(m, e.at)
  return m ? utcDay(m) : utcDay(Date.now())
}

// ---------- History ----------

export type HistIndex = Map<string, HistEvent[]>

export function indexHistory(history: HistEvent[]): HistIndex {
  const m: HistIndex = new Map()
  for (const e of history) { const l = m.get(e.oppId); if (l) l.push(e); else m.set(e.oppId, [e]) }
  for (const l of m.values()) l.sort((a, b) => a.at - b.at)
  return m
}

export interface OppState { stage: string; amount: number; closeDate: number; forecastCategory: string }

/** Rebuilds the opportunity as it looked at time t by undoing every later change. Null if it did not exist yet. */
export function stateAt(o: Opp, evs: HistEvent[] | undefined, t: number): OppState | null {
  if (o.created > t) return null
  const s: OppState = { stage: o.stage, amount: o.amount, closeDate: o.closeDate, forecastCategory: o.forecastCategory }
  if (evs) for (let i = evs.length - 1; i >= 0 && evs[i].at > t; i--) {
    const e = evs[i]
    if (e.from === null || e.from === '') continue
    if (e.field === 'stage') s.stage = String(e.from)
    else if (e.field === 'forecastCategory') s.forecastCategory = String(e.from)
    else if (e.field === 'amount') s.amount = Number(e.from)
    else s.closeDate = Number(e.from)
  }
  return s
}

/** Close dates in the order they were set: original first, current last. */
export function closeSequence(o: Opp, evs: HistEvent[] | undefined): number[] {
  const ch = (evs ?? []).filter(e => e.field === 'closeDate' && e.to !== null)
  if (!ch.length) return [o.closeDate]
  const seq = [ch[0].from !== null ? Number(ch[0].from) : Number(ch[0].to), ...ch.map(e => Number(e.to))]
  if (seq[seq.length - 1] !== o.closeDate) seq.push(o.closeDate)
  return seq
}

export interface Slip { pushes: number; pullIns: number; daysPushed: number; originalClose: number; firstAmount: number; amountDrift: number }

export function slippage(o: Opp, evs: HistEvent[] | undefined): Slip {
  const seq = closeSequence(o, evs)
  let pushes = 0, pullIns = 0, daysPushed = 0
  for (let i = 1; i < seq.length; i++) {
    const d = seq[i] - seq[i - 1]
    if (d > 0) { pushes++; daysPushed += d / DAY } else if (d < 0) pullIns++
  }
  const am = (evs ?? []).find(e => e.field === 'amount' && e.from !== null)
  const firstAmount = am ? Number(am.from) : o.amount
  return { pushes, pullIns, daysPushed: Math.round(daysPushed), originalClose: seq[0], firstAmount, amountDrift: o.amount - firstAmount }
}

/** Stage timeline: [stage, enteredAt][] in order. */
export function stageTimeline(o: Opp, evs: HistEvent[] | undefined): [string, number][] {
  const st = (evs ?? []).filter(e => e.field === 'stage' && e.to)
  const first = st.length && st[0].from ? String(st[0].from) : st.length ? String(st[0].to) : o.stage
  const tl: [string, number][] = [[first, o.created]]
  for (const e of st) if (String(e.to) !== tl[tl.length - 1][0]) tl.push([String(e.to), e.at])
  if (tl[tl.length - 1][0] !== o.stage) tl.push([o.stage, (evs ?? []).at(-1)?.at ?? o.created])
  return tl
}

// ---------- Hygiene ----------

export interface OppRow {
  opp: Opp
  flags: RuleId[]
  score: number
  daysInStage: number
  daysSinceActivity: number | null
  slip: Slip
  stageMoves: { regressed: boolean; skipped: boolean }
}

export function stageMoves(o: Opp, evs: HistEvent[] | undefined, order: string[]) {
  let regressed = false, skipped = false
  const tl = stageTimeline(o, evs)
  for (let i = 1; i < tl.length; i++) {
    const a = order.indexOf(tl[i - 1][0]), b = order.indexOf(tl[i][0])
    if (a < 0 || b < 0) continue
    if (b < a) regressed = true
    if (b > a + 1) skipped = true
  }
  return { regressed, skipped }
}

export function checkOpp(o: Opp, evs: HistEvent[] | undefined, cfg: Config, asOf: number, order: string[]): OppRow {
  const tl = stageTimeline(o, evs)
  const daysInStage = Math.max(0, Math.floor((asOf - tl[tl.length - 1][1]) / DAY))
  const daysSinceActivity = o.lastActivity ? Math.max(0, Math.floor((asOf - o.lastActivity) / DAY)) : null
  const slip = slippage(o, evs)
  const moves = stageMoves(o, evs, order)
  const hit: Record<RuleId, boolean> = {
    pastDue: o.closeDate < asOf,
    stale: daysSinceActivity === null ? asOf - o.created > cfg.staleDays * DAY : daysSinceActivity > cfg.staleDays,
    noNextStep: !o.nextStep.trim(),
    stageAge: daysInStage > (cfg.stageDays[o.stage] ?? cfg.defaultStageDays),
    zeroAmount: !(o.amount > 0),
    singleThreaded: o.contactRoles !== undefined && o.contactRoles <= 1,
    pushed: slip.pushes >= cfg.pushLimit,
    stageRegressed: moves.regressed,
    stageSkipped: moves.skipped,
  }
  const flags = RULES.filter(r => cfg.enabled[r] && hit[r])
  const score = Math.max(0, 100 - flags.reduce((s, r) => s + cfg.weights[r], 0))
  return { opp: o, flags, score, daysInStage, daysSinceActivity, slip, stageMoves: moves }
}

export interface GroupScore { key: string; team: string; open: number; amount: number; score: number; clean: number; flaggedAmount: number; counts: Partial<Record<RuleId, number>> }

function group(rows: OppRow[], key: string, team: string): GroupScore {
  const counts: Partial<Record<RuleId, number>> = {}
  for (const r of rows) for (const f of r.flags) counts[f] = (counts[f] ?? 0) + 1
  return {
    key, team, open: rows.length,
    amount: rows.reduce((s, r) => s + r.opp.amount, 0),
    score: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 100,
    clean: rows.length ? rows.filter(r => !r.flags.length).length / rows.length : 1,
    flaggedAmount: rows.filter(r => r.flags.length).reduce((s, r) => s + r.opp.amount, 0),
    counts,
  }
}

export interface Hygiene { asOf: number; rows: OppRow[]; owners: GroupScore[]; teams: GroupScore[]; total: GroupScore }

/** Scores every open opportunity, then rolls the score up by owner, team and org (mean of deal scores). */
export function hygiene(ds: Dataset, cfg: Config, idx = indexHistory(ds.history)): Hygiene {
  const asOf = asOfDate(ds, cfg)
  const order = stageOrder(cfg, ds.opps, ds.history)
  const rows = ds.opps.filter(o => !isClosed(o.stage)).map(o => checkOpp(o, idx.get(o.id), cfg, asOf, order))
  rows.sort((a, b) => a.score - b.score || b.opp.amount - a.opp.amount)
  const by = (f: (r: OppRow) => string) => { const m = new Map<string, OppRow[]>(); for (const r of rows) { const k = f(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]) } return m }
  const owners = [...by(r => r.opp.owner)].map(([k, l]) => group(l, k, l[0].opp.team)).sort((a, b) => a.score - b.score)
  const teams = [...by(r => r.opp.team)].map(([k, l]) => group(l, k, k)).sort((a, b) => a.score - b.score)
  return { asOf, rows, owners, teams, total: group(rows, 'All', 'All') }
}

// ---------- Realistic close ----------

export interface CloseModel { byOwner: Map<string, number[][]>; team: number[][] }

/**
 * For every closed deal, how much further the close date moved after its k-th change (k = 0..5).
 * An open deal with k changes so far is compared with closed deals that were also changed at least k times.
 */
export function closeModel(ds: Dataset, idx: HistIndex): CloseModel {
  const team: number[][] = Array.from({ length: 6 }, () => [])
  const byOwner = new Map<string, number[][]>()
  for (const o of ds.opps) {
    if (!isClosed(o.stage)) continue
    const seq = closeSequence(o, idx.get(o.id))
    const final = seq[seq.length - 1]
    const own = byOwner.get(o.owner) ?? Array.from({ length: 6 }, () => [])
    byOwner.set(o.owner, own)
    for (let k = 0; k < Math.min(seq.length, 6); k++) {
      const rem = Math.max(0, (final - seq[k]) / DAY)
      team[k].push(rem); own[k].push(rem)
    }
  }
  for (const l of [...team, ...[...byOwner.values()].flat()]) l.sort((a, b) => a - b)
  return { byOwner, team }
}

export const median = (sorted: number[]) => !sorted.length ? 0 : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

export interface Realistic { date: number; slipDays: number; pSlipQuarter: number; basis: 'owner' | 'team' | 'none'; n: number }

/** Median remaining slip from comparable closed deals (same owner if 5+, else the whole team). */
export function realisticClose(o: Opp, evs: HistEvent[] | undefined, model: CloseModel, asOf: number, fsm: number): Realistic {
  const k = Math.min(5, closeSequence(o, evs).length - 1)
  const pick = (l: number[][] | undefined) => { for (let j = k; j >= 0; j--) if (l && l[j].length >= 5) return l[j]; return null }
  const own = pick(model.byOwner.get(o.owner))
  const sample = own ?? pick(model.team)
  const base = Math.max(o.closeDate, asOf)
  if (!sample) return { date: base, slipDays: 0, pSlipQuarter: 0, basis: 'none', n: 0 }
  const slipDays = Math.round(median(sample))
  const qEnd = quarterOf(base, fsm).end
  const gap = (qEnd - base) / DAY
  const pSlipQuarter = sample.filter(d => d >= gap).length / sample.length
  return { date: base + slipDays * DAY, slipDays, pSlipQuarter, basis: own ? 'owner' : 'team', n: sample.length }
}

// ---------- Forecast reconstruction ----------

/** Forecast category at a past moment. When the export has no category history, it is inferred from the stage. */
export function fcResolver(ds: Dataset): (s: OppState) => string {
  const tracked = ds.history.some(e => e.field === 'forecastCategory')
  if (tracked) return s => normFc(s.forecastCategory)
  const votes = new Map<string, Map<string, number>>()
  for (const o of ds.opps) {
    if (isClosed(o.stage)) continue
    const m = votes.get(o.stage) ?? new Map<string, number>()
    const f = normFc(o.forecastCategory)
    m.set(f, (m.get(f) ?? 0) + 1)
    votes.set(o.stage, m)
  }
  const map = new Map([...votes].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1])[0][0]]))
  return s => map.get(s.stage) ?? normFc(s.forecastCategory)
}

export interface Call { won: number; commit: number; best: number; pipeline: number; commitIds: Set<string> }

/** The forecast call for quarter q as it stood at time t: won to date, plus open deals closing in q by category. */
export function callAt(ds: Dataset, idx: HistIndex, q: Quarter, t: number, fc: (s: OppState) => string, owner?: string): Call {
  const c: Call = { won: 0, commit: 0, best: 0, pipeline: 0, commitIds: new Set() }
  for (const o of ds.opps) {
    if (owner && o.owner !== owner) continue
    const s = stateAt(o, idx.get(o.id), t)
    if (!s || !inQuarter(s.closeDate, q)) continue
    if (isWon(s.stage)) { if (s.closeDate <= t) { c.won += s.amount; c.commitIds.add(o.id) } continue }
    if (isLost(s.stage)) continue
    const f = fc(s)
    if (f === 'Commit' || f === 'Closed') { c.commit += s.amount; c.commitIds.add(o.id) }
    else if (f === 'Best Case') c.best += s.amount
    else if (f === 'Pipeline') c.pipeline += s.amount
  }
  return c
}
export const commitTotal = (c: Call) => c.won + c.commit
export const bestTotal = (c: Call) => c.won + c.commit + c.best

export interface WaterStep { label: string; at: number; start: number; pushed: number; lost: number; downgraded: number; added: number; amount: number; end: number; movers: { id: string; name: string; owner: string; amount: number; why: 'pushed' | 'lost' | 'downgraded' | 'added' | 'amount' }[] }
export interface Waterfall { q: Quarter; start: number; steps: WaterStep[]; end: number; projected: { id: string; name: string; owner: string; amount: number; date: number }[]; realisticEnd: number }

/** Week-by-week movement of the quarter's commit (won + open commit), with each change explained by deal. */
export function waterfall(ds: Dataset, cfg: Config, idx = indexHistory(ds.history), qIn?: Quarter): Waterfall {
  const asOf = asOfDate(ds, cfg)
  const q = qIn ?? quarterOf(asOf, cfg.fiscalStartMonth)
  const fc = fcResolver(ds)
  const last = Math.min(asOf, q.end - DAY)
  const points: number[] = []
  for (let t = q.start; t < last; t += 7 * DAY) points.push(t)
  points.push(last)
  const byId = new Map(ds.opps.map(o => [o.id, o]))
  const calls = points.map(t => callAt(ds, idx, q, t, fc))
  const steps: WaterStep[] = []
  for (let i = 1; i < points.length; i++) {
    const a = calls[i - 1], b = calls[i], t = points[i]
    const st: WaterStep = { label: `Wk ${Math.ceil((t - q.start) / (7 * DAY))}`, at: t, start: commitTotal(a), pushed: 0, lost: 0, downgraded: 0, added: 0, amount: 0, end: commitTotal(b), movers: [] }
    const amt = (id: string, at: number) => stateAt(byId.get(id)!, idx.get(id), at)?.amount ?? 0
    for (const id of a.commitIds) {
      const o = byId.get(id)!
      const prev = amt(id, points[i - 1])
      if (!b.commitIds.has(id)) {
        const s = stateAt(o, idx.get(id), t)!
        const why = s.closeDate >= q.end ? 'pushed' : isLost(s.stage) ? 'lost' : 'downgraded'
        st[why] -= prev
        st.movers.push({ id, name: o.name, owner: o.owner, amount: -prev, why })
      } else {
        const d = amt(id, t) - prev
        if (d) { st.amount += d; st.movers.push({ id, name: o.name, owner: o.owner, amount: d, why: 'amount' }) }
      }
    }
    for (const id of b.commitIds) if (!a.commitIds.has(id)) {
      const o = byId.get(id)!, v = amt(id, t)
      st.added += v
      st.movers.push({ id, name: o.name, owner: o.owner, amount: v, why: 'added' })
    }
    st.movers.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
    steps.push(st)
  }
  const end = commitTotal(calls[calls.length - 1])
  const model = closeModel(ds, idx)
  const projected: Waterfall['projected'] = []
  for (const id of calls[calls.length - 1].commitIds) {
    const o = byId.get(id)!
    if (isClosed(o.stage) || !inQuarter(o.closeDate, q) || asOf >= q.end) continue
    const r = realisticClose(o, idx.get(id), model, asOf, cfg.fiscalStartMonth)
    if (r.date >= q.end) projected.push({ id, name: o.name, owner: o.owner, amount: o.amount, date: r.date })
  }
  projected.sort((a, b) => b.amount - a.amount)
  return { q, start: commitTotal(calls[0]), steps, end, projected, realisticEnd: end - projected.reduce((s, p) => s + p.amount, 0) }
}

/** Weekly snapshots of the current quarter: what the call looked like each week. */
export function weeklyCalls(ds: Dataset, cfg: Config, idx = indexHistory(ds.history)) {
  const asOf = asOfDate(ds, cfg)
  const q = quarterOf(asOf, cfg.fiscalStartMonth)
  const fc = fcResolver(ds)
  const out: { at: number; won: number; commit: number; best: number; pipeline: number }[] = []
  for (let t = q.start; t <= asOf && t < q.end; t += 7 * DAY) {
    const c = callAt(ds, idx, q, t, fc)
    out.push({ at: t, won: c.won, commit: commitTotal(c), best: bestTotal(c), pipeline: bestTotal(c) + c.pipeline })
  }
  return { q, weeks: out }
}

// ---------- Forecast accuracy ----------

export interface AccCell { q: string; forecast: number; best: number; actual: number; err: number | null }
export interface OwnerAcc { owner: string; team: string; cells: AccCell[]; mape: number | null; bias: number | null; label: string }
export interface Accuracy { quarters: Quarter[]; week: number; team: OwnerAcc; owners: OwnerAcc[] }

const summarize = (owner: string, team: string, cells: AccCell[]): OwnerAcc => {
  const e = cells.map(c => c.err).filter((x): x is number => x !== null)
  const mape = e.length ? e.reduce((s, x) => s + Math.abs(x), 0) / e.length : null
  // Bias is pooled across quarters (total called / total won - 1), which is steadier than averaging small quarters.
  const counted = cells.filter(c => c.err !== null)
  const sumA = counted.reduce((s, c) => s + c.actual, 0)
  const bias = sumA ? counted.reduce((s, c) => s + c.forecast, 0) / sumA - 1 : null
  const label = bias === null || mape === null ? 'Not enough data' : bias <= -0.3 ? 'Sandbagging' : bias >= 0.3 ? 'Over-forecasting' : mape <= 0.25 ? 'Accurate' : 'Noisy'
  return { owner, team, cells, mape, bias, label }
}

/**
 * Commit called at week N of each completed quarter vs closed-won in that quarter.
 * err = (forecast - actual) / actual: negative means sandbagging, positive means over-forecasting.
 */
export function accuracy(ds: Dataset, cfg: Config, idx = indexHistory(ds.history), maxQuarters = 6): Accuracy {
  const asOf = asOfDate(ds, cfg)
  const fc = fcResolver(ds)
  const firstData = ds.opps.reduce((m, o) => Math.min(m, o.created), Infinity)
  const quarters: Quarter[] = []
  let q = prevQuarter(quarterOf(asOf, cfg.fiscalStartMonth), cfg.fiscalStartMonth)
  while (quarters.length < maxQuarters && q.start > firstData) { quarters.unshift(q); q = prevQuarter(q, cfg.fiscalStartMonth) }
  const owners = [...new Set(ds.opps.map(o => o.owner))].sort()
  const teamOf = new Map(ds.opps.map(o => [o.owner, o.team]))
  const per = new Map(owners.map(o => [o, [] as AccCell[]]))
  const team: AccCell[] = []
  for (const qq of quarters) {
    const t = qq.start + (cfg.forecastWeek - 1) * 7 * DAY
    const tot = { forecast: 0, best: 0, actual: 0 }
    const acc = new Map(owners.map(o => [o, { forecast: 0, best: 0, actual: 0 }]))
    for (const o of ds.opps) {
      const a = acc.get(o.owner)!
      if (isWon(o.stage) && inQuarter(o.closeDate, qq)) { a.actual += o.amount; tot.actual += o.amount }
    }
    // One pass per quarter, attributing to owners.
    for (const o of ds.opps) {
      const s = stateAt(o, idx.get(o.id), t)
      if (!s || !inQuarter(s.closeDate, qq) || isLost(s.stage)) continue
      const a = acc.get(o.owner)!
      const won = isWon(s.stage) && s.closeDate <= t
      const f = fc(s)
      const commit = won || (!isWon(s.stage) && (f === 'Commit' || f === 'Closed'))
      const best = commit || (!isWon(s.stage) && f === 'Best Case')
      if (commit) { a.forecast += s.amount; tot.forecast += s.amount }
      if (best) { a.best += s.amount; tot.best += s.amount }
    }
    const cell = (x: { forecast: number; best: number; actual: number }): AccCell => ({ q: qq.key, ...x, err: x.actual > 0 ? (x.forecast - x.actual) / x.actual : null })
    for (const o of owners) per.get(o)!.push(cell(acc.get(o)!))
    team.push(cell(tot))
  }
  return {
    quarters, week: cfg.forecastWeek,
    team: summarize('Whole team', 'All', team),
    owners: owners.map(o => summarize(o, teamOf.get(o) ?? '', per.get(o)!)).sort((a, b) => (b.mape ?? -1) - (a.mape ?? -1)),
  }
}

// ---------- Stage conversion and velocity ----------

export interface StageStat { stage: string; entered: number; advanced: number; lost: number; open: number; conversion: number | null; avgDays: number | null }
export interface Velocity { stages: StageStat[]; winRate: number | null; avgWon: number; cycleDays: number | null; openCount: number; perDay: number | null }

export function conversion(ds: Dataset, cfg: Config, idx = indexHistory(ds.history)): Velocity {
  const order = stageOrder(cfg, ds.opps, ds.history)
  const stats = order.map(stage => ({ stage, entered: 0, advanced: 0, lost: 0, open: 0, days: [] as number[] }))
  const asOf = asOfDate(ds, cfg)
  for (const o of ds.opps) {
    const tl = stageTimeline(o, idx.get(o.id))
    const visited = new Set(tl.map(x => x[0]))
    const maxIdx = Math.max(...tl.map(x => order.indexOf(x[0])))
    for (let i = 0; i < tl.length; i++) {
      const si = order.indexOf(tl[i][0])
      if (si < 0) continue
      const next = tl[i + 1]
      if (next) stats[si].days.push((next[1] - tl[i][1]) / DAY)
    }
    for (const [si, st] of stats.entries()) {
      if (!visited.has(st.stage)) continue
      st.entered++
      if (isWon(o.stage) || maxIdx > si) st.advanced++
      else if (isLost(o.stage)) st.lost++
      else st.open++
    }
  }
  const won = ds.opps.filter(o => isWon(o.stage)), lost = ds.opps.filter(o => isLost(o.stage))
  const winRate = won.length + lost.length ? won.length / (won.length + lost.length) : null
  const avgWon = won.length ? won.reduce((s, o) => s + o.amount, 0) / won.length : 0
  const cycleDays = won.length ? won.reduce((s, o) => s + Math.max(0, o.closeDate - o.created) / DAY, 0) / won.length : null
  const openCount = ds.opps.filter(o => !isClosed(o.stage) && o.created <= asOf).length
  return {
    stages: stats.map(({ days, ...s }) => ({ ...s, conversion: s.advanced + s.lost ? s.advanced / (s.advanced + s.lost) : null, avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null })),
    winRate, avgWon, cycleDays, openCount,
    perDay: winRate !== null && cycleDays ? (openCount * winRate * avgWon) / cycleDays : null,
  }
}

// ---------- Weekly metrics snapshot (History tab) ----------

export interface Snapshot {
  id: string
  label: string
  /** Data as-of date */
  asOf: number
  at: number
  quarter: string
  score: number
  clean: number
  open: number
  openAmount: number
  flaggedAmount: number
  commit: number
  best: number
  won: number
  realisticCommit: number
  counts: Partial<Record<RuleId, number>>
  owners: { owner: string; score: number; open: number; flags: number }[]
  accuracy: { q: string; mape: number | null; bias: number | null }[]
  dupClusters: number
}

export function snapshot(ds: Dataset, cfg: Config, id: string, dupClusters: number): Snapshot {
  const idx = indexHistory(ds.history)
  const h = hygiene(ds, cfg, idx)
  const w = waterfall(ds, cfg, idx)
  const fc = fcResolver(ds)
  const c = callAt(ds, idx, w.q, h.asOf, fc)
  const acc = accuracy(ds, cfg, idx)
  return {
    id, label: `Week of ${new Date(h.asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
    asOf: h.asOf, at: Date.now(), quarter: w.q.key,
    score: h.total.score, clean: h.total.clean, open: h.total.open, openAmount: h.total.amount, flaggedAmount: h.total.flaggedAmount,
    commit: commitTotal(c), best: bestTotal(c), won: c.won, realisticCommit: w.realisticEnd,
    counts: h.total.counts,
    owners: h.owners.map(o => ({ owner: o.key, score: o.score, open: o.open, flags: Object.values(o.counts).reduce((a, b) => a + (b ?? 0), 0) })),
    accuracy: acc.team.cells.map(x => ({ q: x.q, mape: x.err === null ? null : Math.abs(x.err), bias: x.err })),
    dupClusters,
  }
}

/**
 * The org as it looked at time t, rebuilt from field history: deals created later are dropped and stage, amount,
 * close date and category are rewound. Activity dates and next steps cannot be rewound, so they are capped at t.
 */
export function datasetAt(ds: Dataset, t: number, idx = indexHistory(ds.history)): Dataset {
  const opps: Opp[] = []
  for (const o of ds.opps) {
    const s = stateAt(o, idx.get(o.id), t)
    if (!s) continue
    opps.push({ ...o, ...s, lastActivity: o.lastActivity === undefined ? undefined : Math.min(o.lastActivity, t) })
  }
  return { opps, history: ds.history.filter(e => e.at <= t), parties: ds.parties }
}
