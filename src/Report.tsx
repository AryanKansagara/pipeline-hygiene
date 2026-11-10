import { useEffect, useMemo } from 'react'
import { ruleSummary } from './engine/actions.ts'
import { toCsv } from './engine/csv.ts'
import { isoDate } from './engine/pipeline.ts'
import { DAY } from './engine/types.ts'
import { Dial, ScoreBadge, short, WaterfallChart, WaterLegend } from './charts.tsx'
import { useAnalysis, useProject } from './projectData.ts'
import { getDefaults } from './store.ts'
import { labelTone } from './Tabs.tsx'
import { download, fmtDate, fmtMoney, fmtPct, Link, signed, SyntheticBadge } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const a = useAnalysis(ds, project?.config)
  const defs = getDefaults()
  useEffect(() => { if (project) document.title = `Forecast-call pack · ${project.name}` }, [project?.name])
  const commitDeals = useMemo(() => {
    if (!a?.wf || !ds) return []
    const q = a.wf.q, risk = new Set(a.wf.projected.map(p => p.id))
    const rowById = new Map(a.h.rows.map(r => [r.opp.id, r]))
    return ds.opps.filter(o => rowById.has(o.id) && o.closeDate >= q.start && o.closeDate < q.end && /commit/i.test(o.forecastCategory))
      .map(o => ({ o, r: rowById.get(o.id)!, risk: risk.has(o.id), real: a.wf!.projected.find(p => p.id === o.id)?.date }))
      .sort((x, y) => Number(y.risk) - Number(x.risk) || y.o.amount - x.o.amount)
  }, [a, ds])

  if (loading) return <div className="boot"><span className="spinner" /> Building the pack</div>
  if (!project || !a || !a.wf || !a.acc) return <section className="page narrow center"><h1>Nothing to report</h1><p className="muted">This org has no opportunities yet.</p><Link href="/app" className="btn primary">All orgs</Link></section>
  const { h, wf, acc } = a
  const lastStep = wf.steps.at(-1)
  const accBy = new Map(acc.owners.map(o => [o.owner, o]))
  const csv = () => toCsv([['Opportunity ID', 'Name', 'Owner', 'Stage', 'Amount', 'Close date', 'Realistic close', 'At risk', 'Hygiene score', 'Flags'],
    ...commitDeals.map(d => [d.o.id, d.o.name, d.o.owner, d.o.stage, d.o.amount, isoDate(d.o.closeDate), d.real ? isoDate(d.real) : '', d.risk ? 'yes' : '', d.r.score, d.r.flags.join(' ')])])

  return (
    <article className="report">
      <div className="report-actions">
        <Link href={`/app/p/${id}`} className="btn ghost">Back to the org</Link>
        <button type="button" className="btn outline" onClick={() => download(`commit-deals-${isoDate(h.asOf)}.csv`, csv())}>Download commit deals CSV</button>
        <button type="button" className="btn primary" onClick={() => print()}>Print or save as PDF</button>
      </div>
      <div className="eyebrow">Weekly forecast call · {defs.callDay}</div>
      <h1>{project.name}, {wf.q.label} {project.sampleId && <SyntheticBadge />}</h1>
      <p className="muted">Data as of {fmtDate(h.asOf)} · {h.total.open} open deals · {fmtDate(wf.q.end - DAY)} quarter end ({Math.max(0, Math.round((wf.q.end - h.asOf) / DAY))} days left) · prepared by {defs.sender}</p>
      <div className="kpis">
        <div className="kpi"><small>Commit called</small><b>{short(wf.end)}</b><p>{signed(wf.end - wf.start, short)} since week 1</p></div>
        <div className="kpi"><small>Realistic commit</small><b>{short(wf.realisticEnd)}</b><p>{wf.projected.length} deals likely to slip</p></div>
        <div className="kpi"><small>Hygiene</small><b>{h.total.score}/100</b><p>{fmtPct(h.total.clean)} of deals clean</p></div>
        <div className="kpi"><small>Accuracy at week {acc.week}</small><b>{acc.team.mape === null ? '—' : fmtPct(Math.max(0, 1 - acc.team.mape))}</b><p>{acc.team.label}</p></div>
      </div>

      <h2>Commit movement this quarter</h2>
      <WaterLegend realistic />
      <WaterfallChart wf={wf} realistic />
      {lastStep && lastStep.movers.length > 0 && <>
        <h3>Moves in the last week ({lastStep.label})</h3>
        <ul className="small">{lastStep.movers.slice(0, 8).map(m => <li key={m.id + m.why}><b>{m.why}</b>: {m.name} ({m.owner}) {m.amount < 0 ? '−' : '+'}{fmtMoney(Math.abs(m.amount))}</li>)}</ul>
      </>}

      <h2>Commit deals to inspect</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Deal</th><th>Owner</th><th>Stage</th><th className="num">Amount</th><th>Close</th><th>Realistic</th><th className="num">Hygiene</th><th>Question for the rep</th></tr></thead>
        <tbody>{commitDeals.slice(0, 30).map(({ o, r, risk, real }) => (
          <tr key={o.id} className={risk ? 'risk-row' : ''}>
            <th scope="row" className="break">{o.name}<div className="muted tiny">{o.account}</div></th><td className="small">{o.owner}</td><td className="small">{o.stage}</td><td className="num">{fmtMoney(o.amount)}</td>
            <td className="small">{fmtDate(o.closeDate)}{r.slip.pushes ? <div className="muted tiny">pushed {r.slip.pushes}×</div> : null}</td>
            <td className="small">{real ? <span className="error">{fmtDate(real)}</span> : '—'}</td>
            <td className="num"><ScoreBadge score={r.score} /></td>
            <td className="small">{risk ? 'History says this slips. What is different this time?' : r.flags.includes('singleThreaded') ? 'Who else is involved in the decision?' : r.flags.includes('noNextStep') ? 'What is the next dated step?' : r.flags.includes('stale') ? 'When did you last speak to them?' : 'Confirm paper process and signer.'}</td>
          </tr>
        ))}</tbody>
      </table></div>

      <h2>Reps</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Owner</th><th className="num">Open</th><th className="num">Amount</th><th className="num">Hygiene</th><th>Forecast pattern</th><th className="num">MAPE</th><th>Top issues</th></tr></thead>
        <tbody>{h.owners.map(o => { const x = accBy.get(o.key); return <tr key={o.key}><th scope="row">{o.key}</th><td className="num">{o.open}</td><td className="num">{short(o.amount)}</td><td className="num">{o.score}</td><td>{x && <span className={`badge ${labelTone(x.label)}`}>{x.label}</span>}</td><td className="num">{x?.mape == null ? '—' : fmtPct(x.mape)}</td><td className="small">{ruleSummary(o.counts).split(', ').slice(0, 2).join(', ')}</td></tr> })}</tbody>
      </table></div>

      <div className="report-foot">
        <Dial mape={acc.team.mape} bias={acc.team.bias} label={`commit at week ${acc.week}`} size={180} />
        <p className="muted small">Method: the commit is won plus open deals in the Commit category closing this quarter, rebuilt for each past week from Opportunity Field History. Realistic close dates move each deal by the median further slip of comparable closed deals (same owner when there are 5 or more, else the team) after the same number of close-date pushes. Accuracy compares the week-{acc.week} commit with closed-won over the last {acc.quarters.length} quarters. {project.sampleId ? 'This org is synthetic.' : ''}</p>
      </div>
    </article>
  )
}
