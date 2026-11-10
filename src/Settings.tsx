import { useState } from 'react'
import { deleteProject, getDefaults, getProjects, setDefaults, type Defaults } from './store.ts'
import { exportAll, RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<Defaults>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Defaults for new orgs</h2>
        <p className="muted small">Existing orgs keep their own rules; change those on the org&rsquo;s Data &amp; rules tab. The sign-off and call day are used in rep emails and the forecast-call pack.</p>
        <div className="inline-fields">
          <label className="field"><span>No activity after (days)</span><input type="number" min="1" max="365" value={d.staleDays} onChange={e => save({ staleDays: Math.max(1, Number(e.target.value)) })} /></label>
          <label className="field"><span>Flag after close-date pushes</span><input type="number" min="1" max="20" value={d.pushLimit} onChange={e => save({ pushLimit: Math.max(1, Number(e.target.value)) })} /></label>
          <label className="field"><span>Default stage benchmark (days)</span><input type="number" min="1" max="365" value={d.defaultStageDays} onChange={e => save({ defaultStageDays: Math.max(1, Number(e.target.value)) })} /></label>
          <label className="field"><span>Measure the forecast at week</span><input type="number" min="1" max="13" value={d.forecastWeek} onChange={e => save({ forecastWeek: Math.min(13, Math.max(1, Number(e.target.value))) })} /></label>
          <label className="field"><span>Fiscal year starts</span><select value={d.fiscalStartMonth} onChange={e => save({ fiscalStartMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label className="field"><span>Duplicate threshold</span><input type="number" min="0.5" max="0.99" step="0.01" value={d.dupThreshold} onChange={e => save({ dupThreshold: Math.min(0.99, Math.max(0.5, Number(e.target.value))) })} /></label>
          <label className="field"><span>Email sign-off</span><input value={d.sender} onChange={e => save({ sender: e.target.value })} /></label>
          <label className="field"><span>Forecast call day</span><select value={d.callDay} onChange={e => save({ callDay: e.target.value })}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(x => <option key={x}>{x}</option>)}</select></label>
        </div>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Orgs live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>: rules, approved fixes, snapshots and raw exports under {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB per project sync to your account.</> : 'Sign in from the account menu (top right) to sync across devices. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`pipeline-hygiene-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all local orgs?', `Removes ${list.length} org${list.length > 1 ? 's' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} orgs`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all orgs</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>6</kbd></dt><dd>Switch org sections</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a weekly snapshot</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable forecast-call pack</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show shortcuts on an org page</dd></div>
        </dl>
      </div>
    </section>
  )
}
