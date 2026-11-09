import { toCsv } from './csv.ts'
import { mergeBatches, survivorship, type Cluster } from './dedupe.ts'
import { isoDate, type OppRow } from './pipeline.ts'
import { RULE_LABEL, type RuleId } from './types.ts'

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

const FIX: Record<RuleId, (r: OppRow) => string> = {
  pastDue: r => `close date ${isoDate(r.opp.closeDate)} has passed: set a real date or close it out`,
  stale: r => r.daysSinceActivity === null ? 'no logged activity: log the last touch' : `no activity in ${r.daysSinceActivity} days: log the last touch or book the next meeting`,
  noNextStep: () => 'add a dated next step',
  stageAge: r => `${r.daysInStage} days in ${r.opp.stage}: confirm the stage or move it`,
  zeroAmount: () => 'amount is 0: add your best estimate',
  singleThreaded: () => 'only one contact role: add the economic buyer or a second champion',
  pushed: r => `close date pushed ${r.slip.pushes} times (${r.slip.daysPushed} days): what changed?`,
  stageRegressed: () => 'stage moved backwards: note why in the next step',
  stageSkipped: () => 'stages were skipped: confirm the exit criteria were met',
}

/** A plain-text email to one rep listing their flagged deals, worst first. */
export function ownerEmail(owner: string, rows: OppRow[], from = 'Sales Ops', due = 'Thursday'): { subject: string; body: string } {
  const flagged = rows.filter(r => r.flags.length).sort((a, b) => a.score - b.score || b.opp.amount - a.opp.amount)
  const first = owner.split(/\s+/)[0]
  const total = flagged.reduce((s, r) => s + r.opp.amount, 0)
  const lines = flagged.map((r, i) => `${i + 1}. ${r.opp.name} (${r.opp.account || 'no account'}, ${money(r.opp.amount)}, ${r.opp.stage})\n${r.flags.map(f => `   - ${FIX[f](r)}`).join('\n')}`)
  return {
    subject: `Pipeline hygiene: ${flagged.length} deal${flagged.length === 1 ? '' : 's'} to update before ${due}'s forecast call`,
    body: `Hi ${first},\n\nAhead of ${due}'s forecast call, ${flagged.length} of your open deals (${money(total)}) need a quick update in Salesforce:\n\n${lines.join('\n\n')}\n\nMost of these take a minute each. Reply here if a deal should be closed out instead.\n\nThanks,\n${from}`,
  }
}

export const mailto = (to: string, e: { subject: string; body: string }) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`

/** Data Loader "Update" file: Id plus the fields to change. Close dates as YYYY-MM-DD. */
export function closeDateUpdateCsv(approved: Record<string, number>, names: Map<string, { name: string; old: number }>): string {
  const rows: (string | number)[][] = [['Id', 'CloseDate', 'Name (reference only, do not map)', 'Previous CloseDate (reference only)']]
  for (const [id, d] of Object.entries(approved)) {
    const n = names.get(id)
    if (!n) continue
    rows.push([id, isoDate(d), n.name, isoDate(n.old)])
  }
  return toCsv(rows)
}

/** One row per merge call: master plus up to two duplicates (the Salesforce merge limit). */
export function mergePlanCsv(clusters: Cluster[]): string {
  const rows: (string | number)[][] = [['Object', 'Cluster', 'Step', 'MasterId', 'MasterName', 'DuplicateId1', 'DuplicateName1', 'DuplicateId2', 'DuplicateName2', 'Confidence', 'Reasons']]
  for (const c of clusters) {
    const name = (id: string) => c.members.find(m => m.id === id)?.name ?? ''
    const reasons = [...new Set(c.links.flatMap(l => l.reasons))].join('; ')
    const obj = c.kind === 'account' ? 'Account' : c.kind === 'contact' ? 'Contact' : 'Lead'
    mergeBatches(c).forEach((b, i) => rows.push([obj, c.id, i + 1, c.master.id, c.master.name, b[0], name(b[0]), b[1] ?? '', b[1] ? name(b[1]) : '', Math.round(c.confidence * 100) + '%', reasons]))
  }
  return toCsv(rows)
}

/** Field values the master should take before merging, so nothing useful is lost. */
export function survivorshipCsv(clusters: Cluster[]): string {
  const rows: (string | number)[][] = [['Cluster', 'MasterId', 'Field', 'KeepValue', 'TakenFromId', 'OtherValues']]
  for (const c of clusters) for (const s of survivorship(c)) {
    if (!s.value) continue
    if (s.from === c.master.id && !s.conflict.length) continue
    rows.push([c.id, c.master.id, s.field, s.value, s.from, s.conflict.join(' | ')])
  }
  return toCsv(rows)
}

export const ruleSummary = (counts: Partial<Record<RuleId, number>>) => Object.entries(counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => `${RULE_LABEL[k as RuleId]}: ${v}`).join(', ')
