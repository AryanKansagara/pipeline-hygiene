import type { Waterfall } from './engine/pipeline.ts'
import { fmtDate, fmtMoney } from './ui.tsx'

export const short = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? '−' : ''
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`
}

const WHY = [['pushed', 'Pushed out', 'var(--c-push)'], ['lost', 'Lost', 'var(--c-lost)'], ['downgraded', 'Downgraded', 'var(--c-down)']] as const

export function WaterLegend({ realistic }: { realistic?: boolean }) {
  return (
    <div className="legend" aria-hidden="true">
      <span><i style={{ background: 'var(--accent)' }} />Commit</span>
      {WHY.map(([k, l, c]) => <span key={k}><i style={{ background: c }} />{l}</span>)}
      <span><i style={{ background: 'var(--c-add)' }} />Added / won</span>
      {realistic && <span><i className="hatch" />Realistic slip</span>}
    </div>
  )
}

/**
 * Commit waterfall: the quarter's commit (won + open commit) at week 1, every week's movement, and today's call.
 * With `realistic`, a last pair of bars removes deals whose historical push pattern says they will slip out.
 */
export function WaterfallChart({ wf, realistic, reveal = Infinity, selected, onSelect }: { wf: Waterfall; realistic: boolean; reveal?: number; selected?: number; onSelect?(i: number): void }) {
  const steps = wf.steps
  const slip = wf.end - wf.realisticEnd
  const levels = [wf.start, wf.end, wf.realisticEnd, ...steps.flatMap(s => {
    const neg = s.pushed + s.lost + s.downgraded + Math.min(0, s.amount)
    return [s.start, s.start + neg, s.end]
  })]
  const hiRaw = Math.max(...levels), loRaw = Math.min(...levels)
  const span = Math.max(1, hiRaw - loRaw)
  const lo = Math.max(0, loRaw - span * 0.6), hi = hiRaw + span * 0.12
  const W = 760, H = 300, padL = 52, padB = 34, padT = 14
  const cols = steps.length + 2 + (realistic ? 2 : 0)
  const cw = (W - padL - 8) / cols
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo))
  const bw = Math.min(46, cw * 0.62)
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4)
  const shown = (i: number) => i < reveal
  const rect = (x: number, a: number, b: number, fill: string, key: string, extra = '') =>
    <rect key={key} className={`wf-bar ${extra}`} x={x} width={bw} y={Math.min(y(a), y(b))} height={Math.max(1.5, Math.abs(y(a) - y(b)))} fill={fill} rx={2} />
  const total = (i: number, v: number, label: string, fill: string, cls = '') => {
    const x = padL + i * cw + (cw - bw) / 2
    return (
      <g key={'t' + i} className={cls}>
        {rect(x, lo, v, fill, 'r', 'total')}
        <text x={x + bw / 2} y={y(v) - 6} className="wf-val" textAnchor="middle">{short(v)}</text>
        <text x={x + bw / 2} y={H - 12} className="wf-lab" textAnchor="middle">{label}</text>
      </g>
    )
  }
  const lastShown = Math.min(steps.length, reveal)
  return (
    <svg className="wf" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Commit waterfall for ${wf.q.label}: ${short(wf.start)} at week 1, ${short(wf.end)} today${realistic ? `, ${short(wf.realisticEnd)} after realistic close dates` : ''}`}>
      {ticks.map(t => <g key={t}><line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} className="wf-grid" /><text x={padL - 8} y={y(t) + 4} textAnchor="end" className="wf-axis">{short(t)}</text></g>)}
      <line x1={padL} x2={W - 4} y1={y(lo)} y2={y(lo)} className="wf-base" />
      {total(0, wf.start, 'Start', 'var(--accent)')}
      {steps.map((s, i) => {
        if (!shown(i)) return null
        const x0 = padL + (i + 1) * cw
        const half = bw / 2 - 1
        let lvl = s.start
        const segs = WHY.map(([k, , c]) => {
          const v = s[k]
          if (!v) return null
          const a = lvl; lvl += v
          return <rect key={k} className="wf-bar" x={x0 + (cw - bw) / 2} width={half} y={y(a)} height={Math.max(1.5, y(lvl) - y(a))} fill={c} rx={2} />
        })
        if (s.amount < 0) { const a = lvl; lvl += s.amount; segs.push(<rect key="amt" className="wf-bar" x={x0 + (cw - bw) / 2} width={half} y={y(a)} height={Math.max(1.5, y(lvl) - y(a))} fill="var(--c-down)" opacity={0.6} rx={2} />) }
        const pos = s.added + Math.max(0, s.amount)
        return (
          <g key={i} className={`wf-step${selected === i ? ' sel' : ''}`} tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'button' : undefined}
            aria-label={`${s.label}: ${short(s.pushed)} pushed, ${short(s.lost)} lost, ${short(s.downgraded)} downgraded, ${short(pos)} added`}
            onClick={() => onSelect?.(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(i) } }}>
            <rect x={x0} y={padT} width={cw} height={H - padT - padB} className="wf-hit" />
            <line x1={x0 - cw + (cw + bw) / 2} x2={x0 + (cw - bw) / 2} y1={y(s.start)} y2={y(s.start)} className="wf-link" />
            {segs}
            {pos > 0 && <rect className="wf-bar" x={x0 + cw / 2 + 1} width={half} y={y(lvl + pos)} height={Math.max(1.5, y(lvl) - y(lvl + pos))} fill="var(--c-add)" rx={2} />}
            <text x={x0 + cw / 2} y={H - 12} className="wf-lab" textAnchor="middle">{s.label}</text>
          </g>
        )
      })}
      {lastShown === steps.length && total(steps.length + 1, wf.end, 'Today', 'var(--accent)', 'wf-pop')}
      {realistic && lastShown === steps.length && (() => {
        const i = steps.length + 2, x = padL + i * cw + (cw - bw) / 2
        return (
          <g className="wf-pop">
            <line x1={x - cw + bw} x2={x} y1={y(wf.end)} y2={y(wf.end)} className="wf-link" />
            <rect className="wf-bar hatch-fill" x={x} width={bw} y={y(wf.end)} height={Math.max(1.5, y(wf.realisticEnd) - y(wf.end))} rx={2} />
            <text x={x + bw / 2} y={y(wf.realisticEnd) + 14} className="wf-val neg" textAnchor="middle">{short(-slip)}</text>
            <text x={x + bw / 2} y={H - 12} className="wf-lab" textAnchor="middle">Will slip</text>
          </g>
        )
      })()}
      {realistic && lastShown === steps.length && total(steps.length + 3, wf.realisticEnd, 'Realistic', 'var(--c-real)', 'wf-pop real')}
    </svg>
  )
}

export function StepDetail({ wf, i }: { wf: Waterfall; i: number }) {
  const s = wf.steps[i]
  if (!s) return null
  const net = s.end - s.start
  return (
    <div className="step-detail">
      <div className="row between wrap gap-sm"><strong>{s.label} · week ending {fmtDate(s.at)}</strong><span className={net < 0 ? 'error' : 'good-text'}>{net < 0 ? '−' : '+'}{fmtMoney(Math.abs(net))} net</span></div>
      <ul>{s.movers.slice(0, 5).map(m => <li key={m.id + m.why}><span className={`why ${m.why}`}>{m.why}</span> <span className="break">{m.name}</span> <span className="muted">· {m.owner}</span> <b className="num">{m.amount < 0 ? '−' : '+'}{short(Math.abs(m.amount))}</b></li>)}</ul>
      {s.movers.length > 5 && <p className="muted tiny">and {s.movers.length - 5} more deals</p>}
    </div>
  )
}

/** Semicircle gauge: forecast accuracy = 1 - MAPE, with bias underneath. */
export function Dial({ mape, bias, label, size = 220 }: { mape: number | null; bias: number | null; label: string; size?: number }) {
  const acc = mape === null ? 0 : Math.max(0, Math.min(1, 1 - mape))
  const r = 80, c = Math.PI * r
  const tone = acc >= 0.85 ? 'var(--c-add)' : acc >= 0.7 ? 'var(--c-down)' : 'var(--c-push)'
  return (
    <figure className="dial" style={{ width: size }}>
      <svg viewBox="0 0 200 118" role="img" aria-label={`Forecast accuracy ${mape === null ? 'unknown' : Math.round(acc * 100) + '%'}`}>
        <path d="M20 100 A80 80 0 0 1 180 100" className="dial-track" />
        <path d="M20 100 A80 80 0 0 1 180 100" className="dial-val" style={{ stroke: tone, strokeDasharray: `${c * acc} ${c}` }} />
        {[0.25, 0.5, 0.75].map(t => { const a = Math.PI * (1 - t); return <line key={t} x1={100 + 68 * Math.cos(a)} y1={100 - 68 * Math.sin(a)} x2={100 + 74 * Math.cos(a)} y2={100 - 74 * Math.sin(a)} className="dial-tick" /> })}
        <text x="100" y="86" textAnchor="middle" className="dial-num">{mape === null ? '—' : `${Math.round(acc * 100)}%`}</text>
        <text x="100" y="108" textAnchor="middle" className="dial-sub">{label}</text>
      </svg>
      <figcaption>{bias === null ? 'Not enough closed quarters' : `${bias < 0 ? 'Under-called' : 'Over-called'} by ${Math.abs(Math.round(bias * 100))}% on average`}</figcaption>
    </figure>
  )
}

export function Spark({ values, w = 160, h = 40, invert }: { values: (number | null)[]; w?: number; h?: number; invert?: boolean }) {
  const v = values.filter((x): x is number => x !== null)
  if (v.length < 2) return <span className="muted tiny">—</span>
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const pts = values.map((x, i) => x === null ? null : `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((x - lo) / span) * (h - 6)}`).filter(Boolean).join(' ')
  const up = v[v.length - 1] >= v[0]
  return <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={(up !== !!invert) ? 'var(--c-add)' : 'var(--c-push)'} strokeWidth="2" strokeLinejoin="round" /></svg>
}

export function ScoreBadge({ score }: { score: number }) {
  return <span className={`badge ${score >= 80 ? 'low' : score >= 60 ? 'moderate' : score >= 40 ? 'high' : 'severe'}`}>{score}</span>
}

