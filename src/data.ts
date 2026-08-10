import type {
  Pou,
  PouStatus,
  ReferralService,
  HistoricalSession,
  WhanauRecord,
  KaimahiRecord,
  SessionAction,
  ActiveSessionData,
} from './types'
import { TE_WAHAROA_POU } from './pou'

// ─── Status configuration ─────────────────────────────────────────────────────

export const STATUS_CONFIG: Record<
  PouStatus,
  { color: string; light: string; label: string; en: string }
> = {
  tōtika: { color: '#74C400', light: '#EDF7D8', label: 'Tōtika', en: 'Safe' },
  āta: { color: '#B57200', light: '#FAF0DC', label: 'Āta', en: 'Caution' },
  mataku: { color: '#C4381A', light: '#FCEAE5', label: 'Mataku', en: 'Concern' },
  kore: { color: '#9A9590', light: '#F0EDEA', label: 'Kore', en: 'Not assessed' },
}

// ─── The seven Te Waharoa Pou ─────────────────────────────────────────────────

const POU_TEMPLATE = TE_WAHAROA_POU.map(({ id, reo, en, domain }) => ({
  id,
  reo,
  english: en,
  description: domain,
}))

const STABLE_NOTES: Record<string, string> = {
  whakapapa:     'Whakapapa information documented appropriately. Cultural identity discussed and whānau strengths identified alongside distress.',
  manaakitanga:  'Respectful communication evident throughout. Whānau felt heard and follow-up was completed appropriately.',
  tikanga:       'Consent completed properly. Ethical decision-making documented with clear rationale. Tikanga considerations included in planning.',
  kaitiakitanga: 'Risk assessment completed. Safety plan documented and up to date. No escalation required at this time.',
  puukenga:      'Supervision attended. Reflective notes completed. Practice remained within scope and demonstrated appropriate capability.',
  haepapa:       'Notes completed on time. Reporting obligations met. Follow-through on previous actions evidenced.',
  oranga:        'Protective factors identified and documented. Whānau strengths noted. Connection to supports maintained.',
}

const CONCERN_NOTES: Record<string, string> = {
  whakapapa:     'Notes focused on deficits with minimal cultural information recorded. Whānau strengths absent. Identity and cultural distress not fully explored.',
  manaakitanga:  'Missed follow-up noted. Response to distress was delayed. Practitioner communication appeared abrupt — mana enhancement needs attention.',
  tikanga:       'Consent documentation incomplete. Ethical decision-making poorly justified. Consultation was not sought during a complex situation.',
  kaitiakitanga: 'Risk assessment incomplete. High distress noted with low intervention response. No safety plan updated. Escalation processes may have been avoided.',
  puukenga:      'Signs of reactive language in notes. Repeated high-risk cases without seeking consultation. Supervision attendance inconsistent.',
  haepapa:       'Late or missing documentation noted. Repeated incomplete tasks. Lack of review updates and accountability follow-through.',
  oranga:        'No strengths documented. Intervention focused solely on crisis. Whānau becoming increasingly isolated. Goals not reviewed or updated.',
}

export function makePou(statuses: Partial<Record<string, PouStatus>>): Pou[] {
  return POU_TEMPLATE.map((p) => {
    const status: PouStatus = statuses[p.id] ?? 'kore'
    return {
      ...p,
      status,
      aiNote: status === 'mataku' || status === 'āta' ? CONCERN_NOTES[p.id] : STABLE_NOTES[p.id],
      kaimahiNote: '',
      discussed: status !== 'kore',
    }
  })
}

export function getInitialSessionData(): ActiveSessionData {
  const num = Math.floor(2845 + Math.random() * 10)
  return {
    ref: `W-${num}`,
    whanauCode: '',
    engagementType: 'home-visit',
    sessionFocus: '',
    koreroText: '',
    pou: makePou({}),
    selectedReferralIds: [],
    selectedActions: [],
    notes: '',
  }
}

// ─── Referral services ────────────────────────────────────────────────────────

export const REFERRAL_CATEGORIES = [
  { id: 'clinical',   reo: 'Hauora',    en: 'Clinical Review' },
  { id: 'cultural',   reo: 'Ahurea',    en: 'Cultural Support' },
  { id: 'supervisor', reo: 'Mātāmua',   en: 'Supervisor Consultation' },
  { id: 'aod',        reo: 'Waipuke',   en: 'AOD Pathway' },
  { id: 'crisis',     reo: 'Ohotata',   en: 'Crisis Response' },
  { id: 'whanau',     reo: 'Whānau',    en: 'Whānau Support' },
  { id: 'practical',  reo: 'Āwhina',    en: 'Practical Support' },
]

export const REFERRAL_SERVICES: ReferralService[] = [
  { id: 'r1',  name: 'Te Whatu Ora',           categoryId: 'clinical',   categoryReo: 'Hauora',  categoryEn: 'Clinical Review',          description: 'Primary health referrals, GP enrolment support, specialist services navigation', phone: '0800 855 066', area: 'National' },
  { id: 'r2',  name: 'Māori Health Navigators', categoryId: 'clinical',   categoryReo: 'Hauora',  categoryEn: 'Clinical Review',          description: 'Culturally responsive health navigation for Māori whānau across health services', phone: '0800 924 678', area: 'Regional' },
  { id: 'r3',  name: 'Te Ara Oranga',           categoryId: 'clinical',   categoryReo: 'Hauora',  categoryEn: 'Clinical Review',          description: 'Community mental health support, counselling, and crisis intervention services', phone: '0800 800 717', area: 'Regional' },
  { id: 'r4',  name: 'Alcohol & Drug Helpline', categoryId: 'aod',        categoryReo: 'Waipuke', categoryEn: 'AOD Pathway',              description: 'Free, confidential support for substance use concerns — kaimahi and whānau', phone: '0800 787 797', area: 'National' },
  { id: 'r5',  name: 'Te Ara Oranga — Crisis',  categoryId: 'crisis',     categoryReo: 'Ohotata', categoryEn: 'Crisis Response',          description: '24/7 crisis response and community mental health crisis support', phone: '0800 543 354', area: 'Regional' },
  { id: 'r6',  name: 'Lifeline Aotearoa',        categoryId: 'crisis',     categoryReo: 'Ohotata', categoryEn: 'Crisis Response',          description: '24/7 crisis counselling and emotional support — available any time', phone: '0800 543 354', area: 'National' },
  { id: 'r7',  name: 'Oranga Tamariki — FGC',   categoryId: 'whanau',     categoryReo: 'Whānau',  categoryEn: 'Whānau Support',           description: 'Family group conferencing, advocacy and coordination across family members', phone: '0508 326 459', area: 'National' },
  { id: 'r8',  name: 'Barnardos NZ',             categoryId: 'whanau',     categoryReo: 'Whānau',  categoryEn: 'Whānau Support',           description: 'Home-based family support, parenting programmes and early intervention services', phone: '04 384 5396', area: 'National' },
  { id: 'r9',  name: 'Kāinga Ora',               categoryId: 'practical',  categoryReo: 'Āwhina',  categoryEn: 'Practical Support',        description: 'Public housing applications, emergency housing, transitional housing support', phone: '0800 801 601', area: 'National' },
  { id: 'r10', name: 'Tūāhu Emergency Housing',  categoryId: 'practical',  categoryReo: 'Āwhina',  categoryEn: 'Practical Support',        description: 'Immediate emergency accommodation placement for whānau in acute housing crisis', phone: '0800 559 009', area: 'Regional' },
  { id: 'r11', name: 'MSD Work & Income',        categoryId: 'practical',  categoryReo: 'Āwhina',  categoryEn: 'Practical Support',        description: 'Benefit entitlements, employment services, financial assistance and budgeting', phone: '0800 559 009', area: 'National' },
  { id: 'r12', name: 'Te Hāpai Hauora',          categoryId: 'cultural',   categoryReo: 'Ahurea',  categoryEn: 'Cultural Support',         description: 'Kaupapa Māori cultural support, wairua wellbeing, and connection to cultural practices', phone: '0800 924 678', area: 'Regional' },
]

// ─── Mock historical data ─────────────────────────────────────────────────────

export const MY_ACTIONS: SessionAction[] = [
  { id: 'a1', type: 'referral',          description: 'Referral preparation recorded for Kāinga Ora housing navigation',   pouId: 'kaitiakitanga', completed: false, sessionRef: 'W-2831', whanauCode: 'TW-04', date: '24 Jul 2026' },
  { id: 'a2', type: 'supervisor-review', description: 'Supervisor review consideration — session W-2831',                   pouId: 'kaitiakitanga', completed: true,  sessionRef: 'W-2831', whanauCode: 'TW-04', date: '24 Jul 2026' },
  { id: 'a3', type: 'carry-forward',     description: 'Clarify whānau voice in notes from TW-04 contact',                pouId: 'whakapapa',     completed: false, sessionRef: 'W-2835', whanauCode: 'TW-04', date: '1 Aug 2026' },
  { id: 'a4', type: 'carry-forward',     description: 'Raise uncertainty in supervision — MH-07 engagement pattern',     pouId: 'puukenga',      completed: false, sessionRef: 'W-2832', whanauCode: 'MH-07', date: '25 Jul 2026' },
  { id: 'a5', type: 'escalation',        description: 'Immediate safety concern — demonstration record',                  pouId: 'kaitiakitanga', completed: true,  sessionRef: 'W-2820', whanauCode: 'RK-02', date: '18 Jul 2026' },
  { id: 'a6', type: 'referral',          description: 'Clinical referral to Te Ara Oranga — pending confirmation',        pouId: 'oranga',        completed: false, sessionRef: 'W-2838', whanauCode: 'NG-11', date: '3 Aug 2026' },
]

export const WHANAU_RECORDS: WhanauRecord[] = [
  {
    id: 'w1',
    code: 'TW-04',
    kaimahiId: 'k1',
    kaimahiName: 'Aroha Ngāti',
    sessions: [
      {
        id: 's1', ref: 'W-2831', date: '24 Jul 2026', engagementType: 'home-visit',
        sessionFocus: 'Housing stability and benefit review',
        synthesis: 'Demonstration record — practical pressure and safety concerns were recorded for reflection. Cultural identity, protective factors, and possible referral follow-up are illustrative only; no delivery or review outcome is represented.',
        pou: makePou({ whakapapa: 'āta', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'mataku', puukenga: 'tōtika', haepapa: 'āta', oranga: 'āta' }),
        actions: [
          { id: 'a1b', type: 'referral', description: 'Referral to Kāinga Ora housing navigator', pouId: 'kaitiakitanga', completed: false, sessionRef: 'W-2831', whanauCode: 'TW-04', date: '24 Jul 2026' },
          { id: 'a2b', type: 'supervisor-review', description: 'Supervisor review consideration — demonstration record', pouId: 'kaitiakitanga', completed: true, sessionRef: 'W-2831', whanauCode: 'TW-04', date: '24 Jul 2026' },
        ],
        referralNames: ['Kāinga Ora'],
        flagged: true, supervisorReviewed: false,
        supervisorNotes: 'Demonstration note only. No referral delivery or supervisor review outcome is represented.',
        kaimahiId: 'k1', kaimahiName: 'Aroha Ngāti',
      },
      {
        id: 's2', ref: 'W-2835', date: '1 Aug 2026', engagementType: 'phone',
        sessionFocus: 'Follow-up on housing referral progress',
        synthesis: 'Improvement since previous session. Housing referral is progressing. Reflective notes completed and documentation updated. Protective factors strengthened. Safety situation more stable. Whānau feel supported and hopeful. Continue monitoring accountability and oranga indicators.',
        pou: makePou({ whakapapa: 'tōtika', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'āta', puukenga: 'tōtika', haepapa: 'āta', oranga: 'tōtika' }),
        actions: [
          { id: 'a3b', type: 'carry-forward', description: 'Clarify whānau voice in notes from TW-04 contact', pouId: 'whakapapa', completed: false, sessionRef: 'W-2835', whanauCode: 'TW-04', date: '1 Aug 2026' },
        ],
        referralNames: [],
        flagged: false, supervisorReviewed: false, supervisorNotes: '',
        kaimahiId: 'k1', kaimahiName: 'Aroha Ngāti',
      },
    ],
  },
  {
    id: 'w2',
    code: 'MH-07',
    kaimahiId: 'k1',
    kaimahiName: 'Aroha Ngāti',
    sessions: [
      {
        id: 's3', ref: 'W-2832', date: '25 Jul 2026', engagementType: 'office',
        sessionFocus: 'Community reengagement following period of isolation',
        synthesis: 'A positive and encouraging session. All Te Waharoa Pou showing stable or improving status. Cultural identity and strengths documented. Duty of care maintained throughout. Protective factors strengthened and pathway clear. Continue monthly check-ins to sustain momentum.',
        pou: makePou({ whakapapa: 'tōtika', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'āta', puukenga: 'tōtika', haepapa: 'tōtika', oranga: 'tōtika' }),
        actions: [
          { id: 'a4b', type: 'carry-forward', description: 'Raise uncertainty in supervision — engagement pattern', pouId: 'puukenga', completed: false, sessionRef: 'W-2832', whanauCode: 'MH-07', date: '25 Jul 2026' },
        ],
        referralNames: [],
        flagged: false, supervisorReviewed: false, supervisorNotes: '',
        kaimahiId: 'k1', kaimahiName: 'Aroha Ngāti',
      },
    ],
  },
  {
    id: 'w3',
    code: 'RK-02',
    kaimahiId: 'k2',
    kaimahiName: 'Tama Whānau',
    sessions: [
      {
        id: 's4', ref: 'W-2820', date: '18 Jul 2026', engagementType: 'home-visit',
        sessionFocus: 'Crisis response — safety concern',
        synthesis: 'Escalating risk identified. Disclosure required immediate response. Safety plan established in collaboration with supervisor. Emergency housing secured. Risk assessment updated across multiple Pou — kaitiakitanga, whakapapa and oranga are all under acute pressure. Follow-up within 48 hours essential.',
        pou: makePou({ whakapapa: 'mataku', manaakitanga: 'āta', tikanga: 'āta', kaitiakitanga: 'mataku', puukenga: 'āta', haepapa: 'āta', oranga: 'mataku' }),
        actions: [
          { id: 'a5b', type: 'escalation', description: 'Immediate escalation — safety risk identified', pouId: 'kaitiakitanga', completed: true, sessionRef: 'W-2820', whanauCode: 'RK-02', date: '18 Jul 2026' },
        ],
        referralNames: ['Te Ara Oranga', 'Tūāhu Emergency Housing'],
        flagged: true, supervisorReviewed: true,
        supervisorNotes: 'Safety plan in place. Weekly supervisor oversight required. Emergency housing secured. Continue monitoring.',
        kaimahiId: 'k2', kaimahiName: 'Tama Whānau',
      },
      {
        id: 's5', ref: 'W-2828', date: '27 Jul 2026', engagementType: 'phone',
        sessionFocus: 'Safety plan check-in',
        synthesis: 'Improved safety situation following emergency response. Emergency housing is stable. Engagement with clinical support has commenced. Situation still developing — continued monitoring and supervisor oversight required. Progress on kaitiakitanga. Accountability and protective factor documentation updated.',
        pou: makePou({ whakapapa: 'āta', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'āta', puukenga: 'āta', haepapa: 'āta', oranga: 'āta' }),
        actions: [
          { id: 'a7', type: 'supervisor-review', description: 'Continue supervisor oversight — situation still developing', completed: false, sessionRef: 'W-2828', whanauCode: 'RK-02', date: '27 Jul 2026' },
        ],
        referralNames: [],
        flagged: false, supervisorReviewed: false, supervisorNotes: '',
        kaimahiId: 'k2', kaimahiName: 'Tama Whānau',
      },
    ],
  },
  {
    id: 'w4',
    code: 'NG-11',
    kaimahiId: 'k3',
    kaimahiName: 'Mere Tūhoe',
    sessions: [
      {
        id: 's6', ref: 'W-2838', date: '3 Aug 2026', engagementType: 'hui',
        sessionFocus: 'Mental health and whānau support planning',
        synthesis: 'Disclosure of escalating anxiety and increasing whānau conflict in this session. Clinical referral initiated. Duty of care maintained throughout. Cultural identity and protective factors discussed — some reconnection occurred. Accountability documentation completed. Carry-forward items noted.',
        pou: makePou({ whakapapa: 'āta', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'āta', puukenga: 'tōtika', haepapa: 'āta', oranga: 'āta' }),
        actions: [
          { id: 'a6b', type: 'referral', description: 'Mental health referral to Te Ara Oranga', completed: false, sessionRef: 'W-2838', whanauCode: 'NG-11', date: '3 Aug 2026' },
        ],
        referralNames: ['Te Ara Oranga'],
        flagged: false, supervisorReviewed: false, supervisorNotes: '',
        kaimahiId: 'k3', kaimahiName: 'Mere Tūhoe',
      },
    ],
  },
  {
    id: 'w5',
    code: 'PP-15',
    kaimahiId: 'k4',
    kaimahiName: 'Rāngi Pārata',
    sessions: [
      {
        id: 's7', ref: 'W-2841', date: '6 Aug 2026', engagementType: 'office',
        sessionFocus: 'Recovery pathway review — employment programme update',
        synthesis: 'Strong and sustained progress since last session. All seven Te Waharoa Pou are stable or improving. Protective factors strengthened and identity affirmed. Practitioner capability and accountability both evidenced. No immediate actions required. Continue fortnightly contact.',
        pou: makePou({ whakapapa: 'tōtika', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'tōtika', puukenga: 'tōtika', haepapa: 'tōtika', oranga: 'tōtika' }),
        actions: [
          { id: 'a8', type: 'carry-forward', description: 'Review employment programme progress at next session', completed: false, sessionRef: 'W-2841', whanauCode: 'PP-15', date: '6 Aug 2026' },
        ],
        referralNames: [],
        flagged: false, supervisorReviewed: false, supervisorNotes: '',
        kaimahiId: 'k4', kaimahiName: 'Rāngi Pārata',
      },
    ],
  },
  {
    id: 'w6',
    code: 'HW-09',
    kaimahiId: 'k2',
    kaimahiName: 'Tama Whānau',
    sessions: [
      {
        id: 's8', ref: 'W-2836', date: '2 Aug 2026', engagementType: 'home-visit',
        sessionFocus: 'Ongoing support — addiction recovery',
        synthesis: 'Session focused on recovery milestones and relationship repair within the whānau. Protective factors and cultural connection strengthened. Duty of care maintained. Some instability in support network remains — oranga needs ongoing monitoring. Positive engagement throughout.',
        pou: makePou({ whakapapa: 'tōtika', manaakitanga: 'tōtika', tikanga: 'tōtika', kaitiakitanga: 'tōtika', puukenga: 'tōtika', haepapa: 'tōtika', oranga: 'āta' }),
        actions: [
          { id: 'a9', type: 'carry-forward', description: 'Continue monitoring whānau network reintegration', completed: false, sessionRef: 'W-2836', whanauCode: 'HW-09', date: '2 Aug 2026' },
        ],
        referralNames: [],
        flagged: false, supervisorReviewed: false, supervisorNotes: '',
        kaimahiId: 'k2', kaimahiName: 'Tama Whānau',
      },
    ],
  },
]

export const KAIMAHI_RECORDS: KaimahiRecord[] = [
  {
    id: 'k1', name: 'Aroha Ngāti', role: 'Kaimahi Tautoko',
    whanau: WHANAU_RECORDS.filter((w) => w.kaimahiId === 'k1'),
    flaggedSessionCount: 1,
  },
  {
    id: 'k2', name: 'Tama Whānau', role: 'Kaiwhakaora',
    whanau: WHANAU_RECORDS.filter((w) => w.kaimahiId === 'k2'),
    flaggedSessionCount: 1,
  },
  {
    id: 'k3', name: 'Mere Tūhoe', role: 'Kaimahi Tautoko',
    whanau: WHANAU_RECORDS.filter((w) => w.kaimahiId === 'k3'),
    flaggedSessionCount: 0,
  },
  {
    id: 'k4', name: 'Rāngi Pārata', role: 'Kaimahi Tautoko',
    whanau: WHANAU_RECORDS.filter((w) => w.kaimahiId === 'k4'),
    flaggedSessionCount: 0,
  },
]

export function getAllSessions(): HistoricalSession[] {
  return WHANAU_RECORDS.flatMap((w) => w.sessions)
}

export function getLatestSession(whanau: WhanauRecord): HistoricalSession | undefined {
  return whanau.sessions.at(-1)
}

export function getLatestPouStatus(whanau: WhanauRecord, pouId: string): PouStatus {
  const latest = getLatestSession(whanau)
  if (!latest) return 'kore'
  return latest.pou.find((p) => p.id === pouId)?.status ?? 'kore'
}

export const DEMO_SYNTHESIS =
  'This session reflects a whānau member navigating a period of transition and uncertainty. ' +
  'The kōrero revealed acute pressure in the area of stability — housing and financial concerns are weighing heavily. ' +
  'Despite this, a strong therapeutic relationship and clear personal resilience offer important protective ground to build from. ' +
  'Safety indicators require attention and supervisor awareness is recommended. ' +
  'A referral to housing support services is the most urgent action arising from this session.'
