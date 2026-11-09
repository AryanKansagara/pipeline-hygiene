export const DAY = 86_400_000

export interface Opp {
  id: string
  name: string
  account: string
  owner: string
  /** Owner role or team; "All reps" when the export has none. */
  team: string
  stage: string
  amount: number
  /** UTC midnight, ms */
  closeDate: number
  created: number
  lastActivity?: number
  nextStep: string
  forecastCategory: string
  probability?: number
  /** Number of contact roles, when known. */
  contactRoles?: number
}

export type HistField = 'stage' | 'amount' | 'closeDate' | 'forecastCategory'

/** One field change on one opportunity. Values are strings for stage / category, numbers for amount and close date. */
export interface HistEvent {
  oppId: string
  at: number
  field: HistField
  from: string | number | null
  to: string | number | null
}

export type PartyKind = 'account' | 'contact' | 'lead'

/** An Account, Contact or Lead row, normalised enough for duplicate detection. */
export interface Party {
  id: string
  kind: PartyKind
  name: string
  company?: string
  email?: string
  website?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  postal?: string
  country?: string
  owner?: string
  created?: number
  lastActivity?: number
  /** Every mapped field as exported, for completeness scoring and survivorship. */
  fields: Record<string, string>
}

export interface Dataset {
  opps: Opp[]
  history: HistEvent[]
  parties: Party[]
}

export const RULES = ['pastDue', 'stale', 'noNextStep', 'stageAge', 'zeroAmount', 'singleThreaded', 'pushed', 'stageRegressed', 'stageSkipped'] as const
export type RuleId = (typeof RULES)[number]

export const RULE_LABEL: Record<RuleId, string> = {
  pastDue: 'Close date in the past',
  stale: 'No recent activity',
  noNextStep: 'Missing next step',
  stageAge: 'Stuck in stage',
  zeroAmount: 'Amount is 0 or blank',
  singleThreaded: 'Single-threaded',
  pushed: 'Close date pushed repeatedly',
  stageRegressed: 'Stage went backwards',
  stageSkipped: 'Stage skipped',
}

export type MasterRule = 'complete' | 'activity' | 'oldest'

export interface Config {
  /** Ordered open stages; won and lost stages are recognised by name. */
  stages: string[]
  /** Days a deal may sit in a stage before it is flagged. */
  stageDays: Record<string, number>
  defaultStageDays: number
  staleDays: number
  pushLimit: number
  weights: Record<RuleId, number>
  enabled: Record<RuleId, boolean>
  /** 1 = January. Quarters start on this month. */
  fiscalStartMonth: number
  /** Week of the quarter the forecast is measured at (1-based). */
  forecastWeek: number
  /** Data "as of" date. Undefined means the latest date in the data. */
  asOf?: number
  masterRule: MasterRule
  dupThreshold: number
  /** Close-date fixes a manager approved: opp id -> new close date. */
  approved: Record<string, number>
}

export const DEFAULT_STAGES = ['Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Id. Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review']

export function defaultConfig(): Config {
  return {
    stages: [...DEFAULT_STAGES],
    stageDays: {},
    defaultStageDays: 30,
    staleDays: 14,
    pushLimit: 2,
    weights: { pastDue: 25, stale: 20, noNextStep: 10, stageAge: 15, zeroAmount: 15, singleThreaded: 10, pushed: 15, stageRegressed: 10, stageSkipped: 5 },
    enabled: { pastDue: true, stale: true, noNextStep: true, stageAge: true, zeroAmount: true, singleThreaded: true, pushed: true, stageRegressed: true, stageSkipped: true },
    fiscalStartMonth: 1,
    forecastWeek: 3,
    masterRule: 'complete',
    dupThreshold: 0.75,
    approved: {},
  }
}
