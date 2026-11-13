import { useMemo, useRef, useState, type ReactNode } from 'react'
import { exportCsvs } from './engine/actions.ts'
import { autoMap, detect, FIELDS, findHeaderRow, KIND_LABEL, mergeInto, parseCsv, SOURCE_LABEL, validate, type Kind, type Mapping, type Parsed, type Source, type Table } from './engine/csv.ts'
import { isoDate, stageOrder } from './engine/pipeline.ts'
import { readWorkbook } from './engine/xlsx.ts'
import { RULE_LABEL, RULES, type Config, type Dataset } from './engine/types.ts'
import { createBlankProject } from './projectData.ts'
import { putData, saveProject, uuid, type Project } from './store.ts'
import { RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, fmtDate, go, Link, toast } from './ui.tsx'

interface Pending { id: string; name: string; kind: Kind; source: Source; table: Table; map: Mapping }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

async function readTable(f: File): Promise<Table> {
  if (/\.xlsx?$/i.test(f.name)) return readWorkbook(await f.arrayBuffer())
  return parseCsv(await f.text())
}

export default function DataTab({ project, ds, cfg, update, setConfig }: { project: Project; ds: Dataset; cfg: Config; update(p: Partial<Project>): void; setConfig(p: Partial<Config>): void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sync = useSync()
  const hasData = ds.opps.length + ds.parties.length > 0
  const rawSize = useMemo(() => project.sampleId ? 0 : JSON.stringify(ds).length, [ds, project.sampleId])

  const readFiles = async (files: FileList | File[]) => {
    setBusy(true)
    const next: Pending[] = []
    for (const f of [...files]) {
      if (f.size > 150_000_000) { toast(`${f.name} is over 150 MB. Export fewer rows or columns.`, { tone: 'error' }); continue }
      try {
        const table = findHeaderRow(await readTable(f))
        if (table.rows.length < 2) { toast(`${f.name} has no data rows.`, { tone: 'error' }); continue }
        const d = detect(table.rows[0])
        next.push({ id: uuid(), name: f.name, kind: d.kind, source: d.source, table, map: autoMap(table.rows[0], d.kind) })
      } catch (e) { toast(`${f.name}: ${e instanceof Error ? e.message : 'could not be read'}`, { tone: 'error' }) }
    }
    // Opportunities first, so history and contact roles have deals to attach to.
    const order: Kind[] = ['opps', 'history', 'fieldHistory', 'roles', 'account', 'contact', 'lead']
    setPending(p => [...p, ...next].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)))
    setBusy(false)
  }

  const commit = async (p: Pending, parsed: Parsed) => {
    // Samples are read-only: importing into one starts a new org.
    const t = project.sampleId ? await createBlankProject('My org') : project
    const base = project.sampleId ? { opps: [], history: [], parties: [] } : ds
    const merged = mergeInto(base, parsed)
    await putData(t.id, merged)
    const rows = parsed.opps.length + parsed.history.length + parsed.parties.length + parsed.roles.size
    const meta = { id: uuid(), kind: p.kind, source: p.source, fileName: p.name, rows, skipped: parsed.skipped, at: Date.now() }
    await saveProject({ ...t, imports: [...(project.sampleId ? [] : project.imports), meta], dataMissing: false })
    setPending(x => x.filter(y => y.id !== p.id))
    toast(`Imported ${rows.toLocaleString()} rows from ${p.name}${parsed.skipped ? `, skipped ${parsed.skipped}` : ''}`, { tone: 'ok' })
    if (project.sampleId) go(`/app/p/${t.id}/data`)
  }

  return (
    <>
      {project.dataMissing && <div className="banner warn"><span><strong>This org&rsquo;s raw exports are on another device.</strong> Rules, approvals and snapshots synced; exports over {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB stay where they were imported. Re-import here to recompute.</span></div>}
      {!hasData && !pending.length && (
        <div className="banner"><span><strong>Start here.</strong> Export an Opportunities report and Opportunity Field History from Salesforce (<Link href="/docs">exact steps and SOQL</Link>), then drop the files below. Accounts, Contacts and Leads power duplicate detection.</span></div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Import</h2><span className="muted small">Salesforce report CSV/XLSX · Data Loader CSV · HubSpot deals export · any CSV</span></div>
        {project.sampleId && <p className="muted small">This is a synthetic sample, so its data is read-only. Importing here starts a new org. Want to rehearse? Download the sample as CSV files {exportCsvs(ds).map(([n, c]) => <button key={n} type="button" className="linkish small" onClick={() => download(n, c)}>{n}</button>).reduce<ReactNode[]>((acc, el, i) => i ? [...acc, ', ', el] : [el], [])} and drop them back in.</p>}
        <div className={`drop${drag ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Choose CSV or XLSX files to import"
          onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void readFiles(e.dataTransfer.files) }}>
          <h3>{busy ? 'Reading files' : 'Drop exports here, or click to choose'}</h3>
          <p className="muted small" style={{ margin: 0 }}>Several files at once is fine. Parsed in your browser. Re-importing updates records by ID instead of duplicating them.</p>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" multiple hidden onChange={e => { if (e.target.files) void readFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {pending.map(p => <PendingFile key={p.id} p={p} onChange={n => setPending(x => x.map(y => y.id === p.id ? n : y))} onCancel={() => setPending(x => x.filter(y => y.id !== p.id))} onCommit={commit} />)}

      {hasData && <Rules ds={ds} cfg={cfg} setConfig={setConfig} />}

      {(project.imports.length > 0 || hasData) && (
        <div className="panel">
          <div className="panel-head"><h2>Imported data</h2><span className="muted small">{ds.opps.length.toLocaleString()} opportunities · {ds.history.length.toLocaleString()} history changes · {ds.parties.length.toLocaleString()} accounts, contacts and leads{rawSize ? ` · ${(rawSize / 1e6).toFixed(2)} MB` : ''}</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Object</th><th>Format</th><th className="num">Rows</th><th className="num">Skipped</th><th>When</th></tr></thead>
              <tbody>{[...project.imports].reverse().map(i => <tr key={i.id}><th scope="row" className="break">{i.fileName}</th><td>{KIND_LABEL[i.kind]}</td><td className="small">{SOURCE_LABEL[i.source]}</td><td className="num">{i.rows.toLocaleString()}</td><td className="num">{i.skipped}</td><td className="small">{new Date(i.at).toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted small">{sync.user
            ? rawSize > RAW_SYNC_LIMIT ? `The raw exports are over ${(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB, so they stay on this device. Rules, approvals, review decisions and snapshots still sync.` : 'Synced to your account with rules, approvals and snapshots.'
            : 'Stored in this browser only. Sign in to sync across devices.'}</p>
          {!project.sampleId && <button type="button" className="btn sm danger-ghost" onClick={async () => {
            if (!(await ask('Clear imported data?', 'Removes every imported record from this org on this device. Rules, approvals and snapshots stay. You can undo for a few seconds.', 'Clear data'))) return
            const before = ds, imports = project.imports
            await putData(project.id, { opps: [], history: [], parties: [] })
            update({ imports: [] })
            toast('Cleared imported data', { undo: async () => { await putData(project.id, before); update({ imports }) } })
          }}>Clear imported data</button>}
        </div>
      )}
    </>
  )
}

function PendingFile({ p, onChange, onCancel, onCommit }: { p: Pending; onChange(p: Pending): void; onCancel(): void; onCommit(p: Pending, v: Parsed): Promise<void> }) {
  const v = useMemo(() => validate(p.table, p.map, p.kind), [p])
  const [busy, setBusy] = useState(false)
  const headers = p.table.rows[0] ?? []
  const errors = v.issues.filter(i => i.level === 'error')
  const ok = v.opps.length + v.history.length + v.parties.length + v.roles.size
  return (
    <div className="panel">
      <div className="panel-head">
        <div><h2 className="break" style={{ marginBottom: 2 }}>{p.name}</h2><span className="muted small">Detected: {SOURCE_LABEL[p.source]} · header on line {p.table.lines[0]}</span></div>
        <label className="row gap-sm small">Object
          <select value={p.kind} style={{ width: 'auto' }} onChange={e => { const kind = e.target.value as Kind; onChange({ ...p, kind, map: autoMap(headers, kind) }) }}>
            {(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      <h3 className="small strong">Column mapping</h3>
      <div className="map-grid">
        {FIELDS[p.kind].map(f => (
          <label key={f.key} className="field"><span>{f.label}{f.required ? ' *' : ''}</span>
            <select value={p.map[f.key] ?? ''} onChange={e => { const map = { ...p.map }; if (e.target.value === '') delete map[f.key]; else map[f.key] = Number(e.target.value); onChange({ ...p, map }) }}>
              <option value="">Not mapped</option>
              {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
            </select>
          </label>
        ))}
      </div>
      <h3 className="small strong" style={{ marginTop: 8 }}>Validation</h3>
      <p className="small">
        <strong className="good-text">{ok.toLocaleString()} {p.kind === 'history' || p.kind === 'fieldHistory' ? 'changes' : 'records'} ready</strong> from {v.total.toLocaleString()} rows
        {v.skipped > 0 && <>, <strong className="error">{v.skipped} skipped</strong></>}
        {v.issues.length > errors.length && <>, {v.issues.length - errors.length} warnings</>}.
        {v.opps.length > 0 && <> Owners: {new Set(v.opps.map(o => o.owner)).size}. Close dates {fmtDate(Math.min(...v.opps.map(o => o.closeDate)))} to {fmtDate(Math.max(...v.opps.map(o => o.closeDate)))}.</>}
      </p>
      {v.issues.length > 0 && (
        <div className="issues" role="log" aria-label="Validation issues">
          {v.issues.slice(0, 200).map((i, k) => <div key={k} className={i.level === 'error' ? 'error-row' : ''}><span className="ln">line {i.line}</span><span>{i.message}</span></div>)}
          {v.issues.length > 200 && <div><span className="ln" /><span className="muted">and {v.issues.length - 200} more</span></div>}
        </div>
      )}
      <div className="row gap" style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={!ok || busy} onClick={async () => { setBusy(true); await onCommit(p, v); setBusy(false) }}>Import {ok.toLocaleString()}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Rules({ ds, cfg, setConfig }: { ds: Dataset; cfg: Config; setConfig(p: Partial<Config>): void }) {
  const order = useMemo(() => stageOrder(cfg, ds.opps, ds.history), [cfg, ds])
  const n = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || lo))
  return (
    <div className="panel">
      <div className="panel-head"><h2>Hygiene rules</h2><span className="muted small">Each deal starts at 100 and loses the weight of every rule it breaks</span></div>
      <div className="inline-fields">
        <label className="field"><span>No activity after (days)</span><input type="number" min="1" max="365" value={cfg.staleDays} onChange={e => setConfig({ staleDays: n(e.target.value, 1, 365) })} /></label>
        <label className="field"><span>Flag after N close-date pushes</span><input type="number" min="1" max="20" value={cfg.pushLimit} onChange={e => setConfig({ pushLimit: n(e.target.value, 1, 20) })} /></label>
        <label className="field"><span>Default stage benchmark (days)</span><input type="number" min="1" max="365" value={cfg.defaultStageDays} onChange={e => setConfig({ defaultStageDays: n(e.target.value, 1, 365) })} /></label>
        <label className="field"><span>Fiscal year starts</span><select value={cfg.fiscalStartMonth} onChange={e => setConfig({ fiscalStartMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="field"><span>Measure forecast at week</span><input type="number" min="1" max="13" value={cfg.forecastWeek} onChange={e => setConfig({ forecastWeek: n(e.target.value, 1, 13) })} /></label>
        <label className="field"><span>Data as of</span><input type="date" value={cfg.asOf ? isoDate(cfg.asOf) : ''} onChange={e => setConfig({ asOf: e.target.value ? Date.parse(e.target.value) : undefined })} /></label>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Rule</th><th>On</th><th className="num">Weight</th></tr></thead>
        <tbody>{RULES.map(r => (
          <tr key={r}>
            <th scope="row">{RULE_LABEL[r]}</th>
            <td><span className="switch"><input type="checkbox" checked={cfg.enabled[r]} aria-label={`Enable ${RULE_LABEL[r]}`} onChange={e => setConfig({ enabled: { ...cfg.enabled, [r]: e.target.checked } })} /><span /></span></td>
            <td className="num"><input className="table-input" type="number" min="0" max="100" value={cfg.weights[r]} aria-label={`Weight for ${RULE_LABEL[r]}`} onChange={e => setConfig({ weights: { ...cfg.weights, [r]: n(e.target.value, 0, 100) } })} style={{ width: 70 }} /></td>
          </tr>
        ))}</tbody>
      </table></div>
      <h3 className="small strong" style={{ marginTop: 16 }}>Stages and benchmarks</h3>
      <p className="muted small">Open stages in order (used for skipped and backwards moves) and the days a deal may sit in each before it is flagged. Unknown stages are slotted in by probability.</p>
      <div className="stage-grid">{order.map((s, i) => (
        <label key={s} className="field"><span>{i + 1}. {s}</span><input type="number" min="1" max="365" placeholder={String(cfg.defaultStageDays)} value={cfg.stageDays[s] ?? ''} onChange={e => { const { [s]: _, ...rest } = cfg.stageDays; setConfig({ stageDays: e.target.value ? { ...rest, [s]: n(e.target.value, 1, 365) } : rest }) }} /></label>
      ))}</div>
      <label className="field" style={{ marginTop: 12 }}><span>Stage order (one per line)</span>
        <textarea rows={4} defaultValue={cfg.stages.join('\n')} onBlur={e => setConfig({ stages: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} />
      </label>
    </div>
  )
}
