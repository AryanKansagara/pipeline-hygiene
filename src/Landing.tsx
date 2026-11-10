import { useEffect, useMemo, useRef, useState } from 'react'
import { findDuplicates, survivorship } from './engine/dedupe.ts'
import { accuracy, indexHistory, waterfall } from './engine/pipeline.ts'
import type { Party } from './engine/types.ts'
import { Dial, short, WaterfallChart, WaterLegend } from './charts.tsx'
import { sampleData } from './projectData.ts'
import { sampleConfig } from './engine/sample.ts'
import { Link } from './ui.tsx'

function useHero() {
  return useMemo(() => {
    const ds = sampleData('saas')!
    const cfg = sampleConfig('saas')
    const idx = indexHistory(ds.history)
    const wf = waterfall(ds, cfg, idx)
    const acc = accuracy(ds, cfg, idx)
    return { wf, acc }
  }, [])
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const DEMO_ACCOUNTS: Party[] = [
  { id: '001A', kind: 'account', name: 'Acme Inc', website: 'https://www.acme.com', phone: '(415) 555-0100', created: Date.UTC(2019, 2, 4), fields: { 'Account Name': 'Acme Inc', Website: 'https://www.acme.com', Phone: '(415) 555-0100', Industry: 'Manufacturing' } },
  { id: '001B', kind: 'account', name: 'ACME, Inc.', website: 'acme.com', street: '1 Market St', postal: '94105', fields: { 'Account Name': 'ACME, Inc.', Website: 'acme.com', 'Billing Street': '1 Market St', 'Billing Zip': '94105' } },
  { id: '001C', kind: 'account', name: 'acme.com', phone: '415.555.0100', fields: { 'Account Name': 'acme.com', Phone: '415.555.0100', Employees: '1200' } },
  { id: '001D', kind: 'account', name: 'Acme Logistics LLC', website: 'acmelogistics.com', fields: { 'Account Name': 'Acme Logistics LLC', Website: 'acmelogistics.com' } },
]

export function Landing() {
  const { wf, acc } = useHero()
  const [reveal, setReveal] = useState(() => reduced() ? Infinity : 0)
  const [real, setReal] = useState(false)
  const touched = useRef(false)
  useEffect(() => {
    if (reduced()) { setReal(true); return }
    let i = 0
    const t = setInterval(() => {
      i++
      setReveal(i)
      if (i > wf.steps.length) { clearInterval(t); setTimeout(() => { if (!touched.current) setReal(true) }, 900) }
    }, 650)
    return () => clearInterval(t)
  }, [wf.steps.length])
  const current = wf.steps[Math.min(reveal, wf.steps.length) - 1]
  const mover = current?.movers.find(m => m.why === 'pushed') ?? current?.movers[0]
  const dup = useMemo(() => { const r = findDuplicates(DEMO_ACCOUNTS); return r.clusters[0] }, [])
  const surv = useMemo(() => dup ? survivorship(dup).filter(s => s.value) : [], [dup])
  const sandbag = acc.owners.filter(o => o.label === 'Sandbagging').length
  const over = acc.owners.filter(o => o.label === 'Over-forecasting').length

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow">For RevOps and Sales Ops on Salesforce</div>
            <h1>Defend the forecast. <span className="serif">Clean the CRM.</span></h1>
            <p className="lede">Drop in your Salesforce opportunity and history exports. See where this quarter&rsquo;s commit leaks week by week, how accurate each rep&rsquo;s call really is, which deals will slip based on their own push history, and which accounts, contacts and leads are duplicates, with a merge plan you can run safely.</p>
            <div className="hero-ctas">
              <Link href="/app?sample=saas" className="btn primary lg">Open the sample org</Link>
              <Link href="/app" className="btn outline lg">Import your exports</Link>
            </div>
            <p className="hero-note">Runs in your browser. No account needed. Sample orgs are synthetic.</p>
          </div>
          <div className="demo" aria-label="Live demo on a synthetic 40-rep SaaS org">
            <div className="demo-bar"><span className="dot" /><strong>Northbeam Cloud</strong><span>· synthetic · {wf.q.label} commit · 40 reps</span></div>
            <div className="demo-body">
              <div className="demo-kpis">
                <div className="kpi-mini"><small>Commit at week 1</small><b>{short(wf.start)}</b></div>
                <div className="kpi-mini"><small>Commit today</small><b>{reveal > wf.steps.length ? short(wf.end) : current ? short(current.end) : short(wf.start)}</b></div>
                <div className={`kpi-mini${real ? ' hot' : ''}`}><small>Realistic</small><b>{real ? short(wf.realisticEnd) : '—'}</b></div>
              </div>
              <div className="demo-chart">
                <div className="grow">
                  <WaterfallChart wf={wf} realistic={real} reveal={reveal} />
                  <div className="ticker" aria-live="polite">{mover ? <><span className={`why ${mover.why}`}>{mover.why}</span> {current!.label}: {mover.name} <b>{mover.amount < 0 ? '−' : '+'}{short(Math.abs(mover.amount))}</b></> : <span className="muted">Rebuilding the quarter from field history&hellip;</span>}</div>
                </div>
                <Dial mape={acc.team.mape} bias={acc.team.bias} label={`commit at week ${acc.week}`} size={170} />
              </div>
              <div className="demo-foot">
                <label className="switch-label"><span className="switch"><input type="checkbox" checked={real} onChange={e => { touched.current = true; setReal(e.target.checked) }} /><span /></span> Apply realistic close dates</label>
                <span className="muted small">{real ? `${wf.projected.length} commit deals slip past quarter end on their owners’ push history` : `${sandbag} sandbaggers and ${over} over-forecasters found`}</span>
              </div>
              <WaterLegend realistic={real} />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">What sales ops keeps asking</div>
          <h2>Most pipeline hygiene problems are data integrity problems.</h2>
        </div>
        <div className="quotes">
          <figure className="quote"><blockquote>&ldquo;Does anyone actually track forecast accuracy?&rdquo;</blockquote><p>Most teams compare the call to the result once, in a spreadsheet, after the quarter. Nobody can say which reps sandbag and which are always optimistic.</p><span className="src">Paraphrased from r/SalesOperations</span></figure>
          <figure className="quote"><blockquote>&ldquo;The CRM is outdated by Friday.&rdquo;</blockquote><p>Close dates in the past, no next step, deals sitting in Negotiation for months. Reminders get ignored unless each rep gets their own short list.</p><span className="src">Paraphrased from r/SalesOperations</span></figure>
          <figure className="quote"><blockquote>&ldquo;How do I safely merge duplicates in a live org?&rdquo;</blockquote><p>Three records per merge, no undo, and related records moving to the master. Admins want a reviewed plan, not a one-click tool.</p><span className="src">Paraphrased from r/salesforce</span></figure>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">The workflow</div>
          <h2>From two exports to the Thursday forecast call.</h2>
        </div>
        <div className="features">
          {FEATURES.map(f => <article className="feature" key={f.t}><div className="ico" aria-hidden="true">{f.i}</div><h3>{f.t}</h3><p>{f.b}</p></article>)}
        </div>
      </section>

      {dup && <section className="section">
        <div className="grid-2">
          <div>
            <div className="eyebrow">Not a simple duplicate situation</div>
            <h2>"Acme Inc", "ACME, Inc." and "acme.com" are one company.</h2>
            <p className="muted">Names are normalised (legal suffixes, punctuation, domains typed as names), then matched on Jaro-Winkler and trigram similarity, domain, phone and address. Blocking keeps 10,000 records well under a second. "Acme Logistics" stays separate: different domain.</p>
            <Link href="/app?sample=dupes&tab=duplicates" className="btn outline">Review 300 planted duplicates</Link>
          </div>
          <div className="panel tint">
            <div className="row between"><strong>Cluster · {dup.members.length} accounts</strong><span className="conf hi">{Math.round(dup.confidence * 100)}%</span></div>
            <ul className="members">{dup.members.map(m => <li key={m.id} className={m === dup.master ? 'master' : ''}><span className="mono tiny">{m.id}</span> {m.name}{m === dup.master && <span className="badge low">Master</span>}</li>)}</ul>
            <div className="reasons">{[...new Set(dup.links.flatMap(l => l.reasons))].map(r => <span key={r} className="chip sm">{r}</span>)}</div>
            <hr />
            <div className="small muted" style={{ marginBottom: 6 }}>Survivorship: the master keeps its values and fills blanks</div>
            <ul className="surv">{surv.map(s => <li key={s.field}><span>{s.field}</span><b>{s.value}</b><span className="muted tiny">{s.from === dup.master.id ? 'master' : `from ${s.from}`}</span></li>)}</ul>
          </div>
        </div>
      </section>}

      <div className="cta-band">
        <div className="cta-inner">
          <div><h2>Bring this week&rsquo;s export.</h2><p>Report CSV or XLSX, Data Loader, or HubSpot. Ten minutes to your first forecast-call pack.</p></div>
          <div className="row gap wrap"><Link href="/app" className="btn primary lg">Start</Link><Link href="/docs" className="btn lg" style={{ color: '#fff', background: '#ffffff1f' }}>Export guides</Link></div>
        </div>
      </div>
    </>
  )
}

const ico = (d: string) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const FEATURES = [
  { t: 'Import what Salesforce gives you', b: 'Report exports (CSV or XLSX, formatted or details-only), Data Loader SOQL extracts, or a HubSpot deals export. Format detection, column mapping and a validation report with line numbers.', i: ico('M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2') },
  { t: 'Hygiene score per deal, rep and team', b: 'Past-due close dates, stale deals, missing next steps, stage age over benchmark, zero amounts, single-threaded deals, chronic pushes, skipped or backwards stages. Weights are yours.', i: ico('M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z') },
  { t: 'Slippage and forecast accuracy', b: 'Weekly snapshots rebuilt from field history: the commit waterfall, push counts, days pushed, amount drift, and each rep’s MAPE and bias at week N of the quarter.', i: ico('M3 21h18M6 17V9m6 8V5m6 12v-5') },
  { t: 'Realistic close dates', b: 'Each open deal is moved by how far its owner’s deals kept slipping after the same number of pushes. Approve the fixes and download a Data Loader update file.', i: ico('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z') },
  { t: 'Duplicates with a safe merge plan', b: 'Accounts, contacts and leads clustered with a confidence score, master chosen by completeness, activity or age, field survivorship preview, and a plan that respects the 3-records-per-merge limit.', i: ico('M8 8h8v8H8zM4 4h8v4M20 20h-8v-4') },
  { t: 'Actions and history', b: 'Per-rep to-do emails, a printable weekly forecast-call pack, and dated snapshots with a compare view to show the trend quarter over quarter.', i: ico('M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6') },
]
