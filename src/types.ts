export type PouStatus = 'tōtika' | 'āta' | 'mataku' | 'kore'
export type EngagementType = 'home-visit' | 'phone' | 'office' | 'hui' | 'outreach'
export type ActionType = 'referral' | 'supervisor-review' | 'escalation' | 'carry-forward'
export type SessionStage =
  | 'setup'
  | 'guided'
  | 'pou'
  | 'risks'
  | 'referrals'
  | 'synthesis'
  | 'record'
  | 'complete'
export type KaimahiNavTab = 'home' | 'actions' | 'reflections' | 'settings'
export type SupervisorView =
  | 'overview'
  | 'kaimahi-list'
  | 'whanau-list'
  | 'pou-matrix'
  | 'pou-drilldown'
  | 'session-review'

export interface Pou {
  id: string
  reo: string
  english: string
  description: string
  status: PouStatus
  aiNote: string
  kaimahiNote: string
  discussed: boolean
}

export interface ReferralService {
  id: string
  name: string
  categoryId: string
  categoryReo: string
  categoryEn: string
  description: string
  phone: string
  area: string
}

export interface SessionAction {
  id: string
  type: ActionType
  description: string
  pouId?: string
  completed: boolean
  sessionRef: string
  whanauCode: string
  date: string
}

export interface HistoricalSession {
  id: string
  ref: string
  date: string
  engagementType: EngagementType
  sessionFocus: string
  synthesis: string
  pou: Pou[]
  actions: SessionAction[]
  referralNames: string[]
  flagged: boolean
  supervisorReviewed: boolean
  supervisorNotes: string
  kaimahiId: string
  kaimahiName: string
}

export interface WhanauRecord {
  id: string
  code: string
  kaimahiId: string
  kaimahiName: string
  sessions: HistoricalSession[]
}

export interface KaimahiRecord {
  id: string
  name: string
  role: string
  whanau: WhanauRecord[]
  flaggedSessionCount: number
}

export interface ActiveSessionData {
  ref: string
  whanauCode: string
  engagementType: EngagementType
  sessionFocus: string
  koreroText: string
  pou: Pou[]
  selectedReferralIds: string[]
  selectedActions: ActionType[]
  notes: string
}
