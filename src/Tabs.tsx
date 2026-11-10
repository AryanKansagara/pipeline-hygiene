import { useMemo, useState } from 'react'
import { closeDateUpdateCsv, mailto, mergePlanCsv, ownerEmail, ruleSummary, survivorshipCsv } from './engine/actions.ts'
import { clusterKey, findDuplicates, reviewed, survivorship, mergeBatches, type Cluster } from './engine/dedupe.ts'
import { isoDate, realisticClose, weeklyCalls, type OppRow, type Snapshot } from './engine/pipeline.ts'
import { DAY, RULE_LABEL, RULES, type PartyKind, type RuleId } from './engine/types.ts'
import { Dial, ScoreBadge, short, Spark, StepDetail, WaterfallChart, WaterLegend } from './charts.tsx'
import type { Tab, TabProps } from './Project.tsx'
import { backfill } from './projectData.ts'
import { getDefaults } from './store.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { ask, CopyButton, download, Empty, fmtDate, fmtMoney, fmtN, fmtPct, Link, signed, toast } from './ui.tsx'

export default function Tabs(p: TabProps & { tab: Tab }) {
  const needsOpps = p.tab === 'overview' || p.tab === 'hygiene' || p.tab === 'forecast'
  if (needsOpps && !p.a.hasOpps) return (
    <Empty title="No opportunities in this org yet">
      <p className="muted">This org only has accounts, contacts or leads, so there is no pipeline to score. Review the duplicates, or import an Opportunities report.</p>
      <div className="row gap center-x"><Link href={`/app/p/${p.project.id}/duplicates`} className="btn primary">Review duplicates</Link><Link href={`/app/p/${p.project.id}/data`} className="btn outline">Import opportunities</Link></div>
    </Empty>
  )
  if (p.tab === 'hygiene') return <Hygiene {...p} />
  if (p.tab === 'forecast') return <Forecast {...p} />
  if (p.tab === 'duplicates') return <Duplicates {...p} />
  if (p.tab === 'history') return <History {...p} />
  return <Overview {...p} />
}

const slug = (s: string) => s.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()

// ---------- Overview ----------

function Overview({ project, a }: TabProps) {
  const { h, wf, acc } = a
  const [real, setReal] = useState(true)
  const [sel, setSel] = useState<number>(() => wf ? wf.steps.reduce((bi, s, i, l) => (s.end - s.start) < (l[bi].end - l[bi].start) ? i : bi, 0) : 0)
  if (!wf || !acc) return null
  const accByOwner = new Map(acc.owners.map(o => [o.owner, o]))
  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Pipeline hygiene</small><b>{h.total.score}<span className="unit">/100</span></b><p>{fmtPct(h.total.clean)} of open deals are clean</p></div>
        <div className="kpi"><small>Open pipeline</small><b>{short(h.total.amount)}</b><p>{short(h.total.flaggedAmount)} sits on flagged deals</p></div>
        <div className="kpi"><small>{wf.q.label} commit today</small><b>{short(wf.end)}</b><p>Realistic: <strong>{short(wf.realisticEnd)}</strong> ({wf.projected.length} deals likely to slip)</p></div>
        <div className="kpi"><small>Forecast accuracy (week {acc.week})</small><b>{acc.team.mape === null ? '—' : fmtPct(Math.max(0, 1 - acc.team.mape))}</b><p>{acc.team.bias === null ? 'Needs a closed quarter' : `MAPE ${fmtPct(acc.team.mape ?? 0)}, bias ${signed(acc.team.bias, v => fmtPct(v))}`}</p></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h2>Where the {wf.q.label} commit went</h2><p className="muted small" style={{ margin: 0 }}>Won plus open Commit deals closing this quarter, rebuilt week by week from field history. Click a week to see the deals behind it.</p></div>
          <label className="switch-label"><span className="switch"><input type="checkbox" checked={real} onChange={e => setReal(e.target.checked)} /><span /></span> Apply realistic close dates</label>
        </div>
        <WaterLegend realistic={real} />
        <WaterfallChart wf={wf} realistic={real} selected={sel} onSelect={setSel} />
        <StepDetail wf={wf} i={sel} />
        {real && wf.projected.length > 0 && (
          <details className="disclose">
            <summary>{wf.projected.length} commit deals whose owner&rsquo;s push history says they land after {fmtDate(wf.q.end - DAY)} ({short(wf.end - wf.realisticEnd)})</summary>
            <div className="table-wrap"><table>
              <thead><tr><th>Deal</th><th>Owner</th><th className="num">Amount</th><th>Realistic close</th></tr></thead>
              <tbody>{wf.projected.slice(0, 25).map(d => <tr key={d.id}><th scope="row" className="break">{d.name}</th><td>{d.owner}</td><td className="num">{fmtMoney(d.amount)}</td><td>{fmtDate(d.date)}</td></tr>)}</tbody>
            </table></div>
          </details>
        )}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Reps</h2><span className="muted small">Worst hygiene first · score is the mean of open-deal scores</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Owner</th><th>Team</th><th className="num">Open</th><th className="num">Amount</th><th className="num">Hygiene</th><th>Top issues</th><th>Forecast pattern</th></tr></thead>
          <tbody>{h.owners.map(o => {
            const ac = accByOwner.get(o.key)
            return (
              <tr key={o.key}>
                <th scope="row"><Link href={`/app/p/${project.id}/hygiene?owner=${encodeURIComponent(o.key)}`}>{o.key}</Link></th>
                <td className="small">{o.team}</td><td className="num">{o.open}</td><td className="num">{short(o.amount)}</td>
                <td className="num"><ScoreBadge score={o.score} /></td>
                <td className="small muted">{ruleSummary(o.counts).split(', ').slice(0, 2).join(', ') || 'Clean'}</td>
                <td>{ac && <span className={`badge ${labelTone(ac.label)}`}>{ac.label}</span>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </div>
    </>
  )
}

export const labelTone = (l: string) => l === 'Accurate' ? 'low' : l === 'Sandbagging' ? 'moderate' : l === 'Over-forecasting' ? 'severe' : l === 'Noisy' ? 'high' : ''

// ---------- Hygiene ----------

function Hygiene({ project, ds, cfg, a, setConfig }: TabProps) {
  const q = new URLSearchParams(location.search)
  const [owner, setOwner] = useState(q.get('owner') ?? '')
  const [rule, setRule] = useState<RuleId | ''>('')
  const [find, setFind] = useState('')
  const [limit, setLimit] = useState(50)
  const defs = getDefaults()
  const approved = cfg.approved
  const fsm = cfg.fiscalStartMonth

  const rows = useMemo(() => a.h.rows.filter(r => r.flags.length && (!owner || r.opp.owner === owner) && (!rule || r.flags.includes(rule)) && (!find || `${r.opp.name} ${r.opp.account}`.toLowerCase().includes(find.toLowerCase()))), [a.h.rows, owner, rule, find])
  const suggest = (r: OppRow) => {
    const rc = realisticClose(r.opp, a.idx.get(r.opp.id), a.model, a.h.asOf, fsm)
    // A past-due date with no history pattern still needs a future date: default to two weeks out.
    return rc.basis === 'none' && r.opp.closeDate < a.h.asOf ? { ...rc, date: a.h.asOf + 14 * DAY } : rc
  }
  const approve = (id: string, d: number) => {
    const before = approved
    setConfig({ approved: { ...approved, [id]: d } })
    toast(`Approved close date ${isoDate(d)}`, { tone: 'ok', undo: () => setConfig({ approved: before }) })
  }
  const unapprove = (id: string) => { const { [id]: _, ...rest } = approved; setConfig({ approved: rest }) }
  const approveAll = () => {
    const before = approved, next = { ...approved }
    let n = 0
    for (const r of rows) if ((r.flags.includes('pastDue') || r.flags.includes('pushed')) && !next[r.opp.id]) { const s = suggest(r); if (s.date !== r.opp.closeDate) { next[r.opp.id] = s.date; n++ } }
    setConfig({ approved: next })
    toast(`Approved ${n} close-date fixes`, { tone: 'ok', undo: () => setConfig({ approved: before }) })
  }
  const names = useMemo(() => new Map(ds.opps.map(o => [o.id, { name: o.name, old: o.closeDate }])), [ds.opps])
  const nApproved = Object.keys(approved).filter(id => names.has(id)).length
  const ownerRows = a.h.rows.filter(r => r.opp.owner === (owner || a.h.owners[0]?.key))
  const mailOwner = owner || a.h.owners[0]?.key || ''
  const email = ownerEmail(mailOwner, ownerRows, defs.sender, defs.callDay)
  const allEmails = () => a.h.owners.filter(o => Object.keys(o.counts).length).map(o => { const e = ownerEmail(o.key, a.h.rows.filter(r => r.opp.owner === o.key), defs.sender, defs.callDay); return `To: ${o.key}\nSubject: ${e.subject}\n\n${e.body}` }).join('\n\n' + '-'.repeat(60) + '\n\n')

  return (
    <>
      <div className="rule-chips" role="group" aria-label="Filter by rule">
        <button type="button" className={`chip${rule === '' ? ' on' : ''}`} onClick={() => setRule('')}>All flags <b>{a.h.rows.filter(r => r.flags.length).length}</b></button>
        {RULES.filter(r => cfg.enabled[r] && a.h.total.counts[r]).map(r => <button key={r} type="button" className={`chip${rule === r ? ' on' : ''}`} onClick={() => setRule(rule === r ? '' : r)}>{RULE_LABEL[r]} <b>{a.h.total.counts[r]}</b></button>)}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Deals to fix <span className="muted small">({rows.length.toLocaleString()})</span></h2>
          <div className="row gap-sm wrap">
            <label className="sr-only" htmlFor="own">Owner</label>
            <select id="own" value={owner} onChange={e => { setOwner(e.target.value); setLimit(50) }}><option value="">All owners</option>{a.h.owners.map(o => <option key={o.key} value={o.key}>{o.key} ({o.score})</option>)}</select>
            <input type="search" placeholder="Search deals" value={find} onChange={e => setFind(e.target.value)} aria-label="Search deals" style={{ width: 180 }} />
          </div>
        </div>
        {rows.length === 0 ? <p className="muted">Nothing flagged for this filter. Clean pipeline.</p> : (
          <div className="table-wrap"><table className="deals">
            <thead><tr><th>Deal</th><th>Owner</th><th>Stage</th><th className="num">Amount</th><th>Close date</th><th>Flags</th><th className="num">Score</th><th>Close-date fix</th></tr></thead>
            <tbody>{rows.slice(0, limit).map(r => {
              const s = r.flags.includes('pastDue') || r.flags.includes('pushed') ? suggest(r) : null
              const ap = approved[r.opp.id]
              return (
                <tr key={r.opp.id}>
                  <th scope="row" className="break"><span>{r.opp.name}</span><div className="muted tiny">{r.opp.account} · {r.opp.id}</div></th>
                  <td className="small">{r.opp.owner}</td>
                  <td className="small">{r.opp.stage}<div className="muted tiny">{r.daysInStage}d in stage</div></td>
                  <td className="num">{fmtMoney(r.opp.amount)}</td>
                  <td className="small">{fmtDate(r.opp.closeDate)}{r.slip.pushes > 0 && <div className="muted tiny">pushed {r.slip.pushes}× · {r.slip.daysPushed}d</div>}</td>
                  <td><div className="flags">{r.flags.map(f => <span key={f} className={`flag ${f}`} title={RULE_LABEL[f]}>{RULE_LABEL[f]}</span>)}</div></td>
                  <td className="num"><ScoreBadge score={r.score} /></td>
                  <td className="small">{ap ? <span className="row gap-sm"><span className="good-text">{isoDate(ap)}</span><button type="button" className="linkish tiny" onClick={() => unapprove(r.opp.id)}>Undo</button></span>
                    : s && s.date !== r.opp.closeDate ? <button type="button" className="btn outline sm" title={s.basis === 'none' ? 'No push history to learn from: two weeks out' : `Median further slip of ${s.n} comparable ${s.basis === 'owner' ? `${r.opp.owner} ` : ''}deals: ${s.slipDays} days`} onClick={() => approve(r.opp.id, s.date)}>Approve {isoDate(s.date)}</button> : <span className="muted">—</span>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
        {rows.length > limit && <button type="button" className="btn ghost sm" onClick={() => setLimit(l => l + 100)}>Show more ({rows.length - limit} left)</button>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Data Loader update file</h2><span className="badge">{nApproved} approved</span></div>
          <p className="small">Close dates a manager approved, as a Data Loader <b>Update</b> CSV: map <code>Id</code> and <code>CloseDate</code>, leave the reference columns unmapped. Suggested dates come from how much comparable deals by the same owner kept slipping after the same number of pushes.</p>
          <div className="row gap wrap">
            <button type="button" className="btn primary" disabled={!nApproved} onClick={() => download(`close-date-updates-${isoDate(a.h.asOf)}.csv`, closeDateUpdateCsv(approved, names))}>Download update CSV</button>
            <button type="button" className="btn outline" onClick={approveAll}>Approve all suggestions in view</button>
            {nApproved > 0 && <button type="button" className="btn danger-ghost" onClick={async () => { if (await ask('Clear all approvals?', `Removes ${nApproved} approved close-date fixes. You can undo for a few seconds.`, 'Clear approvals')) { const before = approved; setConfig({ approved: {} }); toast('Cleared approvals', { undo: () => setConfig({ approved: before }) }) } }}>Clear</button>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Rep to-do email</h2>
            <select value={mailOwner} onChange={e => setOwner(e.target.value)} aria-label="Rep">{a.h.owners.map(o => <option key={o.key}>{o.key}</option>)}</select>
          </div>
          <p className="small strong" style={{ marginBottom: 6 }}>{email.subject}</p>
          <pre className="email">{email.body}</pre>
          <div className="row gap-sm wrap">
            <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy email" />
            <a className="btn ghost sm" href={mailto('', email)}>Open in mail app</a>
            <button type="button" className="btn ghost sm" onClick={() => download(`hygiene-emails-${isoDate(a.h.asOf)}.txt`, allEmails(), 'text/plain')}>All reps (.txt)</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Teams</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Team</th><th className="num">Open</th><th className="num">Amount</th><th className="num">Clean</th><th className="num">Hygiene</th><th>Top issues</th></tr></thead>
          <tbody>{a.h.teams.map(t => <tr key={t.key}><th scope="row">{t.key}</th><td className="num">{t.open}</td><td className="num">{short(t.amount)}</td><td className="num">{fmtPct(t.clean)}</td><td className="num"><ScoreBadge score={t.score} /></td><td className="small muted">{ruleSummary(t.counts).split(', ').slice(0, 3).join(', ')}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">Rules, thresholds and weights live on <Link href={`/app/p/${project.id}/data`}>Data &amp; rules</Link>.</p>
      </div>
    </>
  )
}

// ---------- Forecast & slippage ----------

function Forecast({ ds, cfg, a }: TabProps) {
  const acc = a.acc!, conv = a.conv!
  const wk = useMemo(() => weeklyCalls(ds, cfg, a.idx), [ds, cfg, a.idx])
  const open = a.h.rows
  const pushers = useMemo(() => {
    const m = new Map<string, { owner: string; deals: number; pushed: number; pushes: number; days: number; drift: number }>()
    for (const r of open) {
      const x = m.get(r.opp.owner) ?? { owner: r.opp.owner, deals: 0, pushed: 0, pushes: 0, days: 0, drift: 0 }
      x.deals++; if (r.slip.pushes) x.pushed++; x.pushes += r.slip.pushes; x.days += r.slip.daysPushed; x.drift += r.slip.amountDrift
      m.set(r.opp.owner, x)
    }
    return [...m.values()].sort((x, y) => y.pushes / y.deals - x.pushes / x.deals)
  }, [open])
  const topPushed = useMemo(() => [...open].filter(r => r.slip.pushes).sort((x, y) => y.slip.pushes - x.slip.pushes || y.slip.daysPushed - x.slip.daysPushed).slice(0, 15), [open])
  const maxStage = Math.max(1, ...conv.stages.map(s => s.entered))

  return (
    <>
      <div className="grid-2">
        <div className="panel center-panel">
          <h2>Forecast accuracy</h2>
          <Dial mape={acc.team.mape} bias={acc.team.bias} label={`commit at week ${acc.week}`} />
          <p className="muted small">Commit (won + open Commit closing in the quarter) as it stood at week {acc.week}, against closed-won at quarter end, over the last {acc.quarters.length} quarters. MAPE is the mean absolute error; bias is total called vs total won.</p>
        </div>
        <div className="panel">
          <h2>{wk.q.label} week by week</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Week of</th><th className="num">Won</th><th className="num">Commit</th><th className="num">Best case</th><th className="num">Pipeline</th></tr></thead>
            <tbody>{wk.weeks.map(w => <tr key={w.at}><td>{fmtDate(w.at)}</td><td className="num">{short(w.won)}</td><td className="num">{short(w.commit)}</td><td className="num">{short(w.best)}</td><td className="num">{short(w.pipeline)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Accuracy by rep</h2><span className="muted small">Worst first · negative error = called low (sandbagging)</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Owner</th><th className="num">MAPE</th><th className="num">Bias</th><th>Pattern</th>{acc.quarters.map(q => <th key={q.key} className="num">{q.label}</th>)}</tr></thead>
          <tbody>
            <tr className="total-row"><th scope="row">{acc.team.owner}</th><td className="num">{acc.team.mape === null ? '—' : fmtPct(acc.team.mape)}</td><td className="num">{acc.team.bias === null ? '—' : signed(acc.team.bias, v => fmtPct(v))}</td><td><span className={`badge ${labelTone(acc.team.label)}`}>{acc.team.label}</span></td>{acc.team.cells.map(c => <AccTd key={c.q} c={c} />)}</tr>
            {acc.owners.map(o => <tr key={o.owner}><th scope="row">{o.owner}<div className="muted tiny">{o.team}</div></th><td className="num">{o.mape === null ? '—' : fmtPct(o.mape)}</td><td className="num">{o.bias === null ? '—' : signed(o.bias, v => fmtPct(v))}</td><td><span className={`badge ${labelTone(o.label)}`}>{o.label}</span></td>{o.cells.map(c => <AccTd key={c.q} c={c} />)}</tr>)}
          </tbody>
        </table></div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Chronic pushers</h2><span className="muted small">Open deals only</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Owner</th><th className="num">Deals pushed</th><th className="num">Pushes / deal</th><th className="num">Avg days pushed</th><th className="num">Amount drift</th></tr></thead>
            <tbody>{pushers.slice(0, 12).map(p => <tr key={p.owner}><th scope="row">{p.owner}</th><td className="num">{p.pushed}/{p.deals}</td><td className="num">{fmtN(p.pushes / p.deals, 1)}</td><td className="num">{fmtN(p.days / Math.max(1, p.pushed))}</td><td className="num">{signed(p.drift, short)}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Most-pushed open deals</h2></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Deal</th><th className="num">Pushes</th><th className="num">Days</th><th>Original → now</th></tr></thead>
            <tbody>{topPushed.map(r => <tr key={r.opp.id}><th scope="row" className="break">{r.opp.name}<div className="muted tiny">{r.opp.owner} · {short(r.opp.amount)}</div></th><td className="num">{r.slip.pushes}</td><td className="num">{r.slip.daysPushed}</td><td className="small">{fmtDate(r.slip.originalClose)} → {fmtDate(r.opp.closeDate)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Stage conversion and velocity</h2>
          <span className="muted small">Win rate {conv.winRate === null ? '—' : fmtPct(conv.winRate)} · cycle {conv.cycleDays === null ? '—' : `${Math.round(conv.cycleDays)} days`} · avg won {short(conv.avgWon)} · velocity {conv.perDay === null ? '—' : `${short(conv.perDay)}/day`}</span></div>
        <div className="funnel">
          {conv.stages.map(s => (
            <div key={s.stage} className="funnel-row">
              <span className="funnel-name">{s.stage}</span>
              <span className="funnel-bar"><i style={{ width: `${(s.entered / maxStage) * 100}%` }} /></span>
              <span className="num small">{s.entered.toLocaleString()} in</span>
              <span className="num small">{s.conversion === null ? '—' : fmtPct(s.conversion)} advance</span>
              <span className="num small muted">{s.avgDays === null ? '—' : `${Math.round(s.avgDays)}d avg`}</span>
            </div>
          ))}
        </div>
        <p className="muted small">Velocity = open deals × win rate × average won amount ÷ cycle length.</p>
      </div>
    </>
  )
}

function AccTd({ c }: { c: { forecast: number; actual: number; err: number | null } }) {
  return <td className="num small" title={`Called ${fmtMoney(c.forecast)}, won ${fmtMoney(c.actual)}`}>{c.err === null ? <span className="muted">—</span> : <span className={Math.abs(c.err) <= 0.15 ? 'good-text' : c.err < 0 ? 'accent-text' : 'error'}>{signed(c.err, v => fmtPct(v))}</span>}</td>
}

// ---------- Duplicates ----------

const KIND_NAME: Record<PartyKind, string> = { account: 'Accounts', contact: 'Contacts', lead: 'Leads' }

function Duplicates({ project, ds, cfg, setConfig }: TabProps) {
  const [thr, setThr] = useState(cfg.dupThreshold)
  const res = useMemo(() => findDuplicates(ds.parties, cfg.dupThreshold, cfg.masterRule), [ds.parties, cfg.dupThreshold, cfg.masterRule])
  const [kind, setKind] = useState<PartyKind | ''>('')
  const [limit, setLimit] = useState(25)
  const [open, setOpen] = useState<string | null>(null)
  const notDup = cfg.notDup ?? []
  const kept = reviewed(res.clusters, notDup)
  const shown = kept.filter(c => !kind || c.kind === kind)
  const dupRecords = kept.reduce((s, c) => s + c.members.length - 1, 0)
  const merges = kept.reduce((s, c) => s + mergeBatches(c).length, 0)
  const reject = (c: Cluster) => { const before = notDup; setConfig({ notDup: [...notDup, clusterKey(c)] }); toast(`Marked ${c.master.name} cluster as not duplicates`, { undo: () => setConfig({ notDup: before }) }) }

  if (!ds.parties.length) return (
    <Empty title="No accounts, contacts or leads yet">
      <p className="muted">Export Accounts, Contacts or Leads (<Link href="/docs#dedupe">how</Link>) and import them on Data &amp; rules.</p>
      <Link href={`/app/p/${project.id}/data`} className="btn primary">Import records</Link>
    </Empty>
  )
  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Records checked</small><b>{fmtN(res.records)}</b><p>{fmtN(res.compared)} pairs compared after blocking</p></div>
        <div className="kpi"><small>Duplicate clusters</small><b>{fmtN(kept.length)}</b><p>{(['account', 'contact', 'lead'] as PartyKind[]).map(k => `${kept.filter(c => c.kind === k).length} ${KIND_NAME[k].toLowerCase()}`).join(' · ')}</p></div>
        <div className="kpi"><small>Records to merge away</small><b>{fmtN(dupRecords)}</b><p>{fmtPct(dupRecords / Math.max(1, res.records), 1)} of the base</p></div>
        <div className="kpi"><small>Merge operations</small><b>{fmtN(merges)}</b><p>At most 3 records per merge</p></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Clusters</h2>
          <div className="row gap-sm wrap">
            <select value={kind} onChange={e => { setKind(e.target.value as PartyKind | ''); setLimit(25) }} aria-label="Object"><option value="">All objects</option>{(['account', 'contact', 'lead'] as PartyKind[]).map(k => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select>
            <select value={cfg.masterRule} onChange={e => setConfig({ masterRule: e.target.value as typeof cfg.masterRule })} aria-label="Master record rule">
              <option value="complete">Master: most complete</option><option value="activity">Master: most recent activity</option><option value="oldest">Master: oldest</option>
            </select>
            <label className="row gap-sm small">Confidence ≥ <input type="range" min="0.6" max="0.95" step="0.01" value={thr} onChange={e => setThr(Number(e.target.value))} onPointerUp={() => setConfig({ dupThreshold: thr })} onKeyUp={() => setConfig({ dupThreshold: thr })} aria-label="Confidence threshold" /> <b className="num">{Math.round(thr * 100)}%</b></label>
          </div>
        </div>
        <div className="clusters">
          {shown.slice(0, limit).map(c => {
            const k = clusterKey(c), isOpen = open === k
            const surv = isOpen ? survivorship(c).filter(s => s.value) : []
            return (
              <article key={k} className="cluster">
                <div className="cluster-head">
                  <span className={`conf ${c.confidence >= 0.9 ? 'hi' : c.confidence >= 0.8 ? 'mid' : 'lo'}`}>{Math.round(c.confidence * 100)}%</span>
                  <div className="grow">
                    <strong className="break">{c.master.name}</strong> <span className="muted small">{KIND_NAME[c.kind].slice(0, -1)} · {c.members.length} records · {mergeBatches(c).length} merge{mergeBatches(c).length > 1 ? 's' : ''}</span>
                    <div className="reasons">{[...new Set(c.links.flatMap(l => l.reasons))].map(r => <span key={r} className="chip sm">{r}</span>)}</div>
                  </div>
                  <button type="button" className="btn ghost sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)}>{isOpen ? 'Hide' : 'Survivorship'}</button>
                  <button type="button" className="btn danger-ghost sm" onClick={() => reject(c)}>Not duplicates</button>
                </div>
                <ul className="members">{c.members.map(m => <li key={m.id} className={m === c.master ? 'master' : ''}><span className="mono tiny">{m.id}</span> <span className="break">{m.name}</span>{m.website && <span className="muted small"> · {m.website}</span>}{m.email && <span className="muted small"> · {m.email}</span>}{m.phone && <span className="muted small"> · {m.phone}</span>}{m === c.master && <span className="badge low">Master</span>}</li>)}</ul>
                {isOpen && (
                  <div className="table-wrap"><table>
                    <thead><tr><th>Field</th><th>Master keeps</th><th>From</th><th>Other values</th></tr></thead>
                    <tbody>{surv.map(s => <tr key={s.field}><th scope="row">{s.field}</th><td className="break">{s.value}</td><td className="mono tiny">{s.from === c.master.id ? 'master' : s.from}</td><td className="small muted break">{s.conflict.join(' | ') || '—'}</td></tr>)}</tbody>
                  </table></div>
                )}
              </article>
            )
          })}
          {!shown.length && <p className="muted">No clusters at this threshold.</p>}
        </div>
        {shown.length > limit && <button type="button" className="btn ghost sm" onClick={() => setLimit(l => l + 50)}>Show more ({shown.length - limit} left)</button>}
        {notDup.length > 0 && <p className="muted small">{notDup.length} cluster{notDup.length > 1 ? 's' : ''} marked as not duplicates. <button type="button" className="linkish small" onClick={() => setConfig({ notDup: [] })}>Reset</button></p>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Merge plan</h2>
          <p className="small">One row per merge call: the master Id plus up to two duplicate Ids, because Salesforce merges at most three records at a time. Clusters of four or more become several merges into the same master. The survivorship file lists the field values to copy onto the master <em>before</em> merging, so blanks are filled and nothing useful is lost.</p>
          <div className="row gap wrap">
            <button type="button" className="btn primary" disabled={!kept.length} onClick={() => download(`merge-plan-${slug(project.name)}.csv`, mergePlanCsv(kept))}>Download merge plan CSV</button>
            <button type="button" className="btn outline" disabled={!kept.length} onClick={() => download(`survivorship-${slug(project.name)}.csv`, survivorshipCsv(kept))}>Survivorship preview CSV</button>
          </div>
        </div>
        <div className="panel">
          <h2>Running it safely in a live org</h2>
          <ol className="small steps">
            <li>Back up first: a Data Loader <b>Export All</b> of the objects, plus Opportunities, Cases and Contacts that look up to them.</li>
            <li>Rehearse the plan in a full or partial sandbox. Merges cannot be undone; merged-away records go to the Recycle Bin for 15 days.</li>
            <li>Apply survivorship values to masters with a Data Loader update, then merge, highest confidence first.</li>
            <li>Merge through the UI, <code>Database.merge()</code> in Apex (master + up to 2), or the SOAP <code>merge()</code> call. Data Loader cannot merge.</li>
            <li>Check owners and sharing: related records move to the master and inherit its owner&rsquo;s sharing. Pause duplicate rules, validation rules or flows that block the merge, and turn them back on.</li>
            <li>Contacts linked to different accounts and person accounts need extra care; review those clusters by hand.</li>
          </ol>
        </div>
      </div>
    </>
  )
}

// ---------- History ----------

const METRICS: [string, (s: Snapshot) => number, (n: number) => string, boolean?][] = [
  ['Hygiene score', s => s.score, n => fmtN(n)],
  ['Clean deals', s => s.clean, n => fmtPct(n)],
  ['Open deals', s => s.open, n => fmtN(n), true],
  ['Open pipeline', s => s.openAmount, short],
  ['Amount on flagged deals', s => s.flaggedAmount, short, true],
  ['Commit (this quarter)', s => s.commit, short],
  ['Realistic commit', s => s.realisticCommit, short],
  ['Best case', s => s.best, short],
  ['Closed won', s => s.won, short],
  ['Duplicate clusters', s => s.dupClusters, n => fmtN(n), true],
]

function History({ project, ds, cfg, a, update }: TabProps) {
  const snaps = project.snapshots
  const [ai, setAi] = useState(() => Math.max(0, snaps.length - 2))
  const [bi, setBi] = useState(() => snaps.length - 1)
  const s0 = snaps[Math.min(ai, snaps.length - 1)], s1 = snaps[Math.min(bi, snaps.length - 1)]

  const rebuild = () => {
    const dups = findDuplicates(ds.parties, cfg.dupThreshold, cfg.masterRule).clusters.length
    const built = backfill(ds, cfg, 8, dups)
    const have = new Set(snaps.map(s => s.asOf))
    const add = built.filter(s => !have.has(s.asOf))
    const before = snaps
    void update({ snapshots: [...snaps, ...add].sort((x, y) => x.asOf - y.asOf) })
    toast(`Added ${add.length} weekly snapshots rebuilt from field history`, { tone: 'ok', undo: () => void update({ snapshots: before }) })
  }
  const remove = (s: Snapshot) => {
    const before = snaps
    void update({ snapshots: snaps.filter(x => x.id !== s.id) })
    void deleteSnapshotCloud(s.id)
    toast(`Deleted ${s.label}`, { undo: () => void update({ snapshots: before }) })
  }

  if (!snaps.length) return (
    <Empty title="No snapshots yet">
      <p className="muted">Save one each week before the forecast call (press <kbd>S</kbd>), or rebuild the last eight weeks from field history now.</p>
      {a.hasOpps && <button type="button" className="btn primary" onClick={rebuild}>Rebuild 8 weeks from history</button>}
    </Empty>
  )
  const acc = snaps[snaps.length - 1].accuracy
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Trend</h2>{a.hasOpps && <button type="button" className="btn outline sm" onClick={rebuild}>Rebuild 8 weeks from history</button>}</div>
        <div className="trend-grid">
          {METRICS.slice(0, 8).map(([l, f, fmt, inv]) => {
            const v = snaps.map(f)
            return <div key={l} className="trend"><small>{l}</small><b>{fmt(v[v.length - 1])}</b><Spark values={v} invert={inv} /></div>
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Compare</h2>
          <div className="row gap-sm wrap">
            <select value={ai} onChange={e => setAi(Number(e.target.value))} aria-label="From snapshot">{snaps.map((s, i) => <option key={s.id} value={i}>{s.label}</option>)}</select>
            <span aria-hidden="true">→</span>
            <select value={bi} onChange={e => setBi(Number(e.target.value))} aria-label="To snapshot">{snaps.map((s, i) => <option key={s.id} value={i}>{s.label}</option>)}</select>
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Metric</th><th className="num">{s0.label}</th><th className="num">{s1.label}</th><th className="num">Change</th></tr></thead>
          <tbody>
            {METRICS.map(([l, f, fmt, inv]) => { const d = f(s1) - f(s0); const good = inv ? d < 0 : d > 0; return <tr key={l}><th scope="row">{l}</th><td className="num">{fmt(f(s0))}</td><td className="num">{fmt(f(s1))}</td><td className={`num ${d === 0 ? 'muted' : good ? 'good-text' : 'error'}`}>{d === 0 ? '—' : signed(d, fmt)}</td></tr> })}
            {RULES.filter(r => s0.counts[r] || s1.counts[r]).map(r => { const d = (s1.counts[r] ?? 0) - (s0.counts[r] ?? 0); return <tr key={r}><th scope="row" className="muted">{RULE_LABEL[r]}</th><td className="num">{s0.counts[r] ?? 0}</td><td className="num">{s1.counts[r] ?? 0}</td><td className={`num ${d === 0 ? 'muted' : d < 0 ? 'good-text' : 'error'}`}>{d === 0 ? '—' : signed(d, n => fmtN(n))}</td></tr> })}
          </tbody>
        </table></div>
        <OwnerMoves s0={s0} s1={s1} />
      </div>

      <div className="grid-2">
        {acc.length > 0 && <div className="panel">
          <h2>Forecast accuracy over quarters</h2>
          <div className="qbars">{acc.map(q => <div key={q.q} className="qbar"><span className="qbar-track"><i style={{ height: `${Math.min(100, (q.mape ?? 0) * 200)}%` }} className={(q.bias ?? 0) < 0 ? 'under' : 'over'} /></span><b>{q.mape === null ? '—' : fmtPct(q.mape)}</b><small>{q.q.replace('-', ' ')}</small></div>)}</div>
          <p className="muted small">Absolute error of the week-{cfg.forecastWeek} commit per quarter. Blue = called low, red = called high.</p>
        </div>}
        <div className="panel">
          <h2>Snapshots</h2>
          <ul className="snap-list">{[...snaps].reverse().map(s => <li key={s.id}><span><b>{s.label}</b> <span className="muted small">score {s.score} · commit {short(s.commit)}</span></span><button type="button" className="btn danger-ghost sm" onClick={async () => { if (await ask(`Delete ${s.label}?`, 'Removes this snapshot. You can undo for a few seconds.', 'Delete')) remove(s) }}>Delete</button></li>)}</ul>
        </div>
      </div>
    </>
  )
}

function OwnerMoves({ s0, s1 }: { s0: Snapshot; s1: Snapshot }) {
  const before = new Map(s0.owners.map(o => [o.owner, o.score]))
  const moves = s1.owners.filter(o => before.has(o.owner)).map(o => ({ owner: o.owner, d: o.score - before.get(o.owner)! , now: o.score })).filter(m => m.d).sort((x, y) => x.d - y.d)
  if (!moves.length) return null
  const show = [...moves.slice(0, 4), ...moves.slice(-4).filter(m => m.d > 0 && !moves.slice(0, 4).includes(m))]
  return <p className="small" style={{ marginTop: 12 }}><b>Biggest rep moves:</b> {show.map(m => <span key={m.owner} className={`move ${m.d < 0 ? 'down' : 'up'}`}>{m.owner} {signed(m.d, n => fmtN(n))} → {m.now}</span>)}</p>
}
