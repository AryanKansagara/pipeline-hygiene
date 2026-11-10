import { lazy, Suspense, useEffect, useState } from 'react'
import { findDuplicates } from './engine/dedupe.ts'
import { snapshot } from './engine/pipeline.ts'
import type { Config, Dataset } from './engine/types.ts'
import { useAnalysis, useProject, type Analysis } from './projectData.ts'
import { uuid, type Project } from './store.ts'
import { Empty, fmtDate, fmtMoney, go, isTyping, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

const Tabs = lazy(() => import('./Tabs.tsx'))
const DataTab = lazy(() => import('./Import.tsx'))

export const TABS = [['overview', 'Overview'], ['hygiene', 'Hygiene'], ['forecast', 'Forecast & slippage'], ['duplicates', 'Duplicates'], ['history', 'History'], ['data', 'Data & rules']] as const
export type Tab = (typeof TABS)[number][0]

export interface TabProps {
  project: Project
  ds: Dataset
  cfg: Config
  a: Analysis
  setConfig(p: Partial<Config>): void
  update(p: Partial<Project>): void
}

export default function ProjectView({ id, tab: rawTab }: { id: string; tab: string }) {
  const { loading, project, ds, setConfig, update } = useProject(id)
  const tab = (TABS.some(t => t[0] === rawTab) ? rawTab : 'overview') as Tab
  const cfg = project?.config
  const a = useAnalysis(ds, cfg)
  const [help, setHelp] = useState(false)

  useEffect(() => { if (project) document.title = `${project.name} · Pipeline Hygiene` }, [project?.name])

  const setTab = (t: Tab) => go(`/app/p/${id}${t === 'overview' ? '' : '/' + t}`, { keepScroll: true })

  const saveSnapshot = () => {
    if (!project || !ds || !cfg || !a) return
    const dups = findDuplicates(ds.parties, cfg.dupThreshold, cfg.masterRule).clusters.length
    const snap = snapshot(ds, cfg, uuid(), dups)
    const prev = project.snapshots.find(s => s.asOf === snap.asOf)
    const snapshots = [...project.snapshots.filter(s => s.asOf !== snap.asOf), snap].sort((x, y) => x.asOf - y.asOf)
    void update({ snapshots })
    toast(prev ? `Replaced the ${snap.label} snapshot` : `Saved a snapshot: ${snap.label}`, { tone: 'ok', undo: () => void update({ snapshots: project.snapshots }) })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]) }
      else if (e.key === '?') setHelp(true)
      else if (e.key === 's') saveSnapshot()
      else if (e.key === 'p') go(`/app/p/${id}/report`)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Scoring the pipeline</div>
  if (!project) return (
    <section className="page narrow center">
      <Empty title="Org not found"><p className="muted">It may have been deleted, or it lives on another device.</p><Link href="/app" className="btn primary">All orgs</Link></Empty>
    </section>
  )
  const empty = !ds || (!ds.opps.length && !ds.parties.length)

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><Link href="/app">Orgs</Link></div>
          <h1 className="row gap wrap">{project.name} {project.sampleId && <SyntheticBadge />}</h1>
          {a && !empty && <p className="muted small" style={{ margin: 0 }}>
            {a.hasOpps ? <>{a.h.total.open.toLocaleString()} open deals · {fmtMoney(a.h.total.amount)} · </> : null}
            {ds!.parties.length ? <>{ds!.parties.length.toLocaleString()} accounts, contacts and leads · </> : null}
            data as of {fmtDate(a.h.asOf)}
          </p>}
        </div>
        {!empty && (
          <div className="toolbar">
            <button type="button" className="btn outline" onClick={saveSnapshot} title="Save a weekly snapshot (S)">Save snapshot</button>
            {a?.hasOpps && <Link href={`/app/p/${id}/report`} className="btn primary" title="Forecast-call pack (P)">Forecast-call pack</Link>}
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Org sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${id}${t === 'overview' ? '' : '/' + t}`} aria-current={t === tab ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}</Link>)}
      </nav>
      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {tab === 'data' || empty
          ? <DataTab project={project} ds={ds!} cfg={cfg!} update={update} setConfig={setConfig} />
          : a && <Tabs tab={tab} project={project} ds={ds!} cfg={cfg!} a={a} setConfig={setConfig} update={update} />}
      </Suspense>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>6</kbd></dt><dd>Switch sections</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a weekly snapshot</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Open the printable forecast-call pack</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete or approval</dd></div>
        </dl>
      </Modal>
    </section>
  )
}
