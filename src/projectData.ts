import { useEffect, useMemo, useState } from 'react'
import { emptyDataset } from './engine/csv.ts'
import { findDuplicates } from './engine/dedupe.ts'
import { accuracy, closeModel, conversion, datasetAt, hygiene, indexHistory, snapshot, waterfall } from './engine/pipeline.ts'
import { SAMPLES, generate, sampleConfig } from './engine/sample.ts'
import { DAY, type Config, type Dataset } from './engine/types.ts'
import { blankConfig, getData, getProjects, saveProject, useProjects, uuid, type Project } from './store.ts'

const sampleCache = new Map<string, Dataset>()
export function sampleData(id: string): Dataset | null {
  if (!SAMPLES.some(s => s.id === id)) return null
  if (!sampleCache.has(id)) sampleCache.set(id, generate(id))
  return sampleCache.get(id)!
}

/** Weekly snapshots rebuilt from field history, oldest first. */
export function backfill(ds: Dataset, cfg: Config, weeks: number, dupClusters: number) {
  const idx = indexHistory(ds.history)
  const asOf = hygiene(ds, cfg, idx).asOf
  const out = []
  for (let w = weeks; w >= 0; w--) {
    const t = asOf - w * 7 * DAY
    const past = w ? datasetAt(ds, t, idx) : ds
    out.push(snapshot(past, { ...cfg, asOf: t }, uuid(), dupClusters))
  }
  return out
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const ds = sampleData(sampleId)!
  const config = sampleConfig(sampleId)
  const dups = findDuplicates(ds.parties, config.dupThreshold, config.masterRule).clusters.length
  const snapshots = ds.opps.length ? backfill(ds, config, 6, dups) : [snapshot(ds, config, uuid(), dups)]
  const now = Date.now()
  const kinds = sampleId === 'saas' ? [['opps', ds.opps.length], ['fieldHistory', ds.history.length], ['account', ds.parties.length]] as const : [['account', ds.parties.filter(p => p.kind === 'account').length], ['contact', ds.parties.filter(p => p.kind === 'contact').length], ['lead', ds.parties.filter(p => p.kind === 'lead').length]] as const
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, config, snapshots, sampleId,
    imports: kinds.map(([kind, rows]) => ({ id: uuid(), kind, source: 'generic' as const, fileName: `synthetic ${kind === 'fieldHistory' ? 'field history' : kind} export`, rows, skipped: 0, at: now })),
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, config: blankConfig(), snapshots: [], imports: [] })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleData(project.sampleId) ?? emptyDataset()); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? emptyDataset()) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project && saveProject({ ...project, ...patch })
  const setConfig = (patch: Partial<Config>) => project && saveProject({ ...project, config: { ...project.config, ...patch } })
  return { loading: list === null || (project !== null && ds === null), project, ds, update, setConfig }
}

export type Analysis = ReturnType<typeof analyzeAll>

export function analyzeAll(ds: Dataset, cfg: Config) {
  const idx = indexHistory(ds.history)
  const hasOpps = ds.opps.length > 0
  const h = hygiene(ds, cfg, idx)
  return {
    idx, hasOpps, h,
    wf: hasOpps ? waterfall(ds, cfg, idx) : null,
    acc: hasOpps ? accuracy(ds, cfg, idx) : null,
    conv: hasOpps ? conversion(ds, cfg, idx) : null,
    model: closeModel(ds, idx),
  }
}

/** Everything except dedupe, which is computed only on the Duplicates tab. */
export function useAnalysis(ds: Dataset | null, cfg: Config | undefined) {
  return useMemo(() => ds && cfg ? analyzeAll(ds, cfg) : null, [ds, cfg])
}

export function useDupes(ds: Dataset | null, cfg: Config | undefined) {
  return useMemo(() => ds && cfg ? findDuplicates(ds.parties, cfg.dupThreshold, cfg.masterRule) : null, [ds?.parties, cfg?.dupThreshold, cfg?.masterRule])
}
