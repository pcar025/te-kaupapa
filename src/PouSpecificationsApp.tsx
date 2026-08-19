import { cloneElement, isValidElement, useEffect, useMemo, useState, type ReactNode } from 'react'

import type { AuthProfile } from './auth'

type Scope = 'current_conversation' | 'application_state' | 'longitudinal'
type ExplorationMode = 'core' | 'conditional' | 'evidence_to_notice'
type Area = { code: string; label: string; intent: string; explorationMode?: ExplorationMode; conditionalTrigger?: string | null; followUpGuidance: string[]; evidenceScope: Scope; sourceItemReferences: string[] }
type Criterion = { criterionCode: string; label: string; description: string; evidenceScope: Scope; sourceItemReferences: string[]; strengthsOrProtective: boolean; areasForAttention: boolean; followUpGuidance: string[]; missingInformationCodes: string[]; applicabilityRule: string | null }
type Draft = {
  id: string; pouId: string; draftVersion: string; revision: number; activeVersion?: string; approvedAt: string | null; activatedAt: string | null
  specification: { purpose: string; openingReflectionQuestion: string | null; openingReflectionQuestionProvenance: 'sme_authored' | null; conversationExplorationAreas: Area[]; evidenceCriteria: Criterion[]; reviewSynthesisGuidance: string[]; safetyRuleReferences: unknown[] }
  proposedSafetyRuleNotes: string[]
  preview: { opening: string | null; openingStatus: 'ready' | 'sme_input_required'; conversationStart: string; conversationGuidance: { purpose: string; explorationAreas: Array<Pick<Area, 'code' | 'label' | 'intent' | 'followUpGuidance'>>; constraints: string[] }; review: { criteria: Array<Pick<Criterion, 'criterionCode' | 'label' | 'description' | 'evidenceScope' | 'strengthsOrProtective' | 'areasForAttention' | 'missingInformationCodes'>>; synthesisGuidance: string[] }; safetyRuleReferences: unknown[] }
  canApproveAndActivate: boolean
}
type Summary = { pouId: string; activeVersion: string; activeStatus: string; activeSpecification: Draft['specification']; draft: Draft | null }
type SafetyScope = Scope
type SafetyLevel = 'low' | 'watch' | 'action'
type SafetyRule = { id: string; safetyIndicator: string; whyThisMatters: string; evidenceRequired: string[]; possibleConcernIndicators: string[]; noCandidateEvidence: string[]; missingInformation: string[]; appliesWhen: string[]; doesNotApplyWhen: string[]; candidateOutcomes: Array<'possible_concern' | 'no_candidate_concern' | 'insufficient_information' | 'not_applicable'>; humanJudgement: { reportOnly: boolean; permittedLevels: SafetyLevel[]; broadClass: 'whanau_safety' | 'practice_quality' | 'practitioner_wellbeing' | null }; evidenceScope: SafetyScope; sourceNotes: string[] }
type SafetyPolicyDraft = { id: string; pouId: string; draftVersion: string; revision: number; activatedAt: string | null; policy: { rules: SafetyRule[] }; canApproveAndActivate: boolean }
type ActiveSafetyPolicy = { pouId: string; version: string; ruleCount: number }

const labels: Record<string, string> = {
  whakapapa: 'Whakapapa & Identity Safety', manaakitanga: 'Manaakitanga & Duty of Care', tikanga: 'Tikanga & Ethical Practice',
  kaitiakitanga: 'Kaitiakitanga & Risk Management', puukenga: 'Pūkenga & Practitioner Capability', haepapa: 'Haepapa & Accountability', oranga: 'Oranga & Protective Factors',
}
const scopeLabel: Record<Scope, string> = { current_conversation: 'This conversation', application_state: 'Application records', longitudinal: 'Across time' }
const modeLabel: Record<ExplorationMode, string> = { core: 'Core exploration', conditional: 'Conditional exploration', evidence_to_notice: 'Evidence to notice' }
// Every authored field carries a visible resting border.  The editor is used in
// workshops, so editability must be apparent before a field receives focus.
const AUTHORING_FIELD_CLASS = 'w-full rounded border border-solid border-[color:var(--color-border-strong)] bg-transparent px-3 py-2'
const AUTHORING_TEXTAREA_CLASS = `${AUTHORING_FIELD_CLASS} min-h-28 resize-y`
const AUTHORING_SELECT_CLASS = 'mt-1 block w-full sm:w-auto'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) } })
  const body = await response.json().catch(() => ({})) as { error?: string; currentRevision?: number }
  if (!response.ok) throw Object.assign(new Error(body.error ?? 'request_failed'), body)
  return body as T
}

/** Preserve blank lines while an SME is actively composing a multiline field. */
function editingLineList(value: string) { return value.split('\n') }
/** Persist only meaningful one-item-per-line values once the SME saves. */
function persistedLineList(values: string[]) { return values.map((item) => item.trim()).filter(Boolean) }

export default function PouSpecificationsApp({ profile, onBack }: { profile: AuthProfile; onBack: () => void }) {
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [selected, setSelected] = useState<Draft | null>(null)
  const [safetyDrafts, setSafetyDrafts] = useState<SafetyPolicyDraft[]>([])
  const [activeSafetyPolicies, setActiveSafetyPolicies] = useState<ActiveSafetyPolicy[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)

  async function refresh(selectId?: string) {
    setLoading(true)
    try {
      const [result, safety] = await Promise.all([request<{ specifications: Summary[] }>('/api/pou-specifications'), request<{ drafts: SafetyPolicyDraft[]; activePolicies?: ActiveSafetyPolicy[] }>('/api/safety-policy-drafts')])
      setSummaries(result.specifications)
      setSafetyDrafts(safety.drafts ?? [])
      setActiveSafetyPolicies(safety.activePolicies ?? [])
      const draft = selectId ? result.specifications.flatMap((item) => item.draft ? [item.draft] : []).find((item) => item.id === selectId) : null
      setSelected((current) => draft ?? current)
    } catch { setMessage('The Pou specifications could not be loaded.') } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, []) // authenticated editor route is still enforced server-side.

  const selectedSummary = useMemo(() => selected ? summaries.find((item) => item.pouId === selected.pouId) : undefined, [selected, summaries])
  const selectedSafetyDraft = useMemo(() => selected ? safetyDrafts.find((draft) => draft.pouId === selected.pouId) ?? null : null, [selected, safetyDrafts])
  const selectedActiveSafety = useMemo(() => selected ? activeSafetyPolicies.find((policy) => policy.pouId === selected.pouId) ?? null : null, [selected, activeSafetyPolicies])
  const update = <K extends keyof Draft['specification']>(key: K, value: Draft['specification'][K]) => setSelected((current) => current ? { ...current, specification: { ...current.specification, [key]: value } } : current)

  async function createDraft(pouId: string) {
    setMessage('')
    try {
      const result = await request<{ draft: Draft }>(`/api/pou-specifications/${encodeURIComponent(pouId)}/drafts`, { method: 'POST' })
      await refresh(result.draft.id)
      setSelected(result.draft)
    } catch (error) { setMessage(error instanceof Error ? 'A draft could not be created. Refresh to view any existing draft.' : 'A draft could not be created.') }
  }

  async function save() {
    if (!selected) return
    setSaving(true); setMessage('')
    const content = {
      purpose: selected.specification.purpose,
      openingReflectionQuestion: selected.specification.openingReflectionQuestion?.trim() || undefined,
      conversationExplorationAreas: selected.specification.conversationExplorationAreas.map((area) => ({ ...area, followUpGuidance: persistedLineList(area.followUpGuidance) })),
      evidenceCriteria: selected.specification.evidenceCriteria.map((criterion) => ({ ...criterion, followUpGuidance: persistedLineList(criterion.followUpGuidance), missingInformationCodes: persistedLineList(criterion.missingInformationCodes) })),
      reviewSynthesisGuidance: persistedLineList(selected.specification.reviewSynthesisGuidance),
      proposedSafetyRuleNotes: persistedLineList(selected.proposedSafetyRuleNotes),
    }
    try {
      const result = await request<{ draft: Draft }>(`/api/pou-specification-drafts/${selected.id}`, { method: 'PUT', body: JSON.stringify({ expectedRevision: selected.revision, content }) })
      setSelected(result.draft); await refresh(result.draft.id); setMessage('Draft saved. It is not live.')
    } catch (error) {
      setMessage((error as { message?: string }).message === 'stale_draft' ? 'Someone has saved a newer revision. Reload before editing again.' : 'The draft could not be saved.')
    } finally { setSaving(false) }
  }

  async function approveAndActivate() {
    if (!selected || !selected.canApproveAndActivate) return
    if (!window.confirm('Approve and activate this completed draft? This creates a new immutable version and replaces the active version for future conversations.')) return
    setActivating(true); setMessage('')
    try {
      await request(`/api/pou-specification-drafts/${selected.id}/approve-and-activate`, { method: 'POST', body: JSON.stringify({ expectedRevision: selected.revision }) })
      setMessage('The completed draft was approved and activated. Future conversations will use the new immutable version.')
      setSelected(null); await refresh()
    } catch (error) {
      setMessage((error as { message?: string }).message === 'stale_draft' ? 'A newer draft revision exists. Reload and review it before approval.' : 'The draft could not be approved and activated.')
    } finally { setActivating(false) }
  }

  return <main className="min-h-screen px-5 py-6 sm:px-8" style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b pb-5" style={{ borderColor: 'var(--color-border-strong)' }}>
        <div><p className="text-xs uppercase tracking-widest" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ridge)' }}>Te Kaupapa</p><h1 className="mt-2 text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Pou specification workshop</h1><p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Working drafts are private to {profile.organisation.name}. They do not change a live conversation until explicitly approved and activated.</p></div>
        <button onClick={onBack} className="border px-4 py-2 text-sm" style={{ borderColor: 'var(--color-border-strong)' }}>Back to entry</button>
      </header>
      {message && <p role="status" className="mb-4 rounded px-4 py-3 text-sm" style={{ background: 'var(--color-surface-deep)', color: 'var(--color-ink-secondary)' }}>{message}</p>}
      {loading ? <p role="status">Loading Pou specifications…</p> : <div className="grid gap-6 lg:grid-cols-[290px_1fr]">
        <nav aria-label="Pou specifications" className="space-y-2">
          {summaries.map((item) => <section key={item.pouId} className="rounded border p-3" style={{ borderColor: selected?.pouId === item.pouId ? 'var(--color-ridge)' : 'var(--color-border-strong)', background: 'var(--color-surface)' }}>
            <button className="w-full text-left" onClick={() => item.draft && setSelected(item.draft)}><strong>{labels[item.pouId]}</strong><span className="mt-1 block text-xs" style={{ color: 'var(--color-ink-muted)' }}>Active v{item.activeVersion} · source-derived</span></button>
            {item.draft ? <button className="mt-3 text-sm underline" onClick={() => setSelected(item.draft)}>Continue v{item.draft.draftVersion} draft</button> : <button className="mt-3 text-sm underline" onClick={() => void createDraft(item.pouId)}>Create v{Number(item.activeVersion.split('.')[0])}.{Number(item.activeVersion.split('.')[1]) + 1} draft</button>}
          </section>)}
        </nav>
        {!selected ? <section className="rounded border p-6" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)' }}><h2 className="text-xl" style={{ fontFamily: 'var(--font-display)' }}>Choose a Pou</h2><p className="mt-2 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Create a new working draft to begin an SME workshop. The current active version stays unchanged.</p></section> : <Editor draft={selected} activeVersion={selectedSummary?.activeVersion} activeSpecification={selectedSummary?.activeSpecification} activeSafety={selectedActiveSafety} safetyDraft={selectedSafetyDraft} saving={saving} activating={activating} onChange={setSelected} onSafetyDraftChange={(draft) => setSafetyDrafts((current) => [...current.filter((item) => item.pouId !== draft.pouId), draft])} onCreateSafetyDraft={async () => { const result = await request<{ draft: SafetyPolicyDraft }>(`/api/pou-specifications/${selected.pouId}/safety-policy-drafts`, { method: 'POST' }); setSafetyDrafts((current) => [...current.filter((item) => item.pouId !== selected.pouId), result.draft]) }} onSave={() => void save()} onActivate={() => void approveAndActivate()} />}
      </div>}
    </div>
  </main>
}

function Editor({ draft, activeVersion, activeSpecification, activeSafety, safetyDraft, saving, activating, onChange, onSafetyDraftChange, onCreateSafetyDraft, onSave, onActivate }: { draft: Draft; activeVersion?: string; activeSpecification?: Draft['specification']; activeSafety: ActiveSafetyPolicy | null; safetyDraft: SafetyPolicyDraft | null; saving: boolean; activating: boolean; onChange: (draft: Draft) => void; onSafetyDraftChange: (draft: SafetyPolicyDraft) => void; onCreateSafetyDraft: () => Promise<void>; onSave: () => void; onActivate: () => void }) {
  const spec = draft.specification
  const changedExploration = spec.conversationExplorationAreas.filter((area) => {
    const active = activeSpecification?.conversationExplorationAreas.find((item) => item.code === area.code)
    return !active || active.label !== area.label || active.intent !== area.intent || active.explorationMode !== area.explorationMode || active.conditionalTrigger !== area.conditionalTrigger || active.evidenceScope !== area.evidenceScope || active.followUpGuidance.join('\n') !== area.followUpGuidance.join('\n')
  })
  const changedReview = spec.evidenceCriteria.filter((criterion) => {
    const active = activeSpecification?.evidenceCriteria.find((item) => item.criterionCode === criterion.criterionCode)
    return !active || active.label !== criterion.label || active.description !== criterion.description || active.evidenceScope !== criterion.evidenceScope || active.strengthsOrProtective !== criterion.strengthsOrProtective || active.areasForAttention !== criterion.areasForAttention || active.followUpGuidance.join('\n') !== criterion.followUpGuidance.join('\n') || active.missingInformationCodes.join('\n') !== criterion.missingInformationCodes.join('\n') || active.applicabilityRule !== criterion.applicabilityRule
  })
  const updateSpec = <K extends keyof Draft['specification']>(key: K, value: Draft['specification'][K]) => onChange({ ...draft, specification: { ...spec, [key]: value } })
  const updateArea = (index: number, value: Area) => updateSpec('conversationExplorationAreas', spec.conversationExplorationAreas.map((area, itemIndex) => itemIndex === index ? value : area))
  const updateCriterion = (index: number, value: Criterion) => updateSpec('evidenceCriteria', spec.evidenceCriteria.map((criterion, itemIndex) => itemIndex === index ? value : criterion))
  return <section className="space-y-6 rounded border p-5 sm:p-7" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)' }}>
    <div><p className="text-xs uppercase tracking-widest" style={{ color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)' }}>{labels[draft.pouId]}</p><h2 className="mt-1 text-2xl" style={{ fontFamily: 'var(--font-display)' }}>Draft v{draft.draftVersion}</h2><p className="mt-1 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Working-draft revision {draft.revision}. Compared with active v{activeVersion}; this is not live.</p></div>
    {activeSpecification && <details className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }}><summary className="cursor-pointer font-medium">Changes from active v{activeVersion}</summary><div className="mt-3 space-y-2 text-sm"><p><strong>Purpose:</strong> {activeSpecification.purpose === spec.purpose ? 'Unchanged' : 'Updated in this draft'}</p><p><strong>Opening reflection question:</strong> {activeSpecification.openingReflectionQuestion?.trim() || 'Not defined in active version'} → {spec.openingReflectionQuestion?.trim() || 'SME input required'}</p><p><strong>Exploration and follow-up guidance:</strong> {changedExploration.length === 0 ? 'Unchanged' : <span>{changedExploration.map((area) => area.label).join(', ')} {changedExploration.length === 1 ? 'has' : 'have'} been updated.</span>}</p><p><strong>Review guidance:</strong> {changedReview.length === 0 ? 'Unchanged' : <span>{changedReview.map((criterion) => criterion.label).join(', ')} {changedReview.length === 1 ? 'has' : 'have'} been updated.</span>}</p><SafetyPolicyDifference activeRuleCount={activeSafety?.ruleCount ?? draft.specification.safetyRuleReferences.length} draft={safetyDraft} /></div></details>}
    <Field label="Purpose"><textarea value={spec.purpose} onChange={(event) => updateSpec('purpose', event.target.value)} rows={4} /></Field>
    <section className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }}><h3 className="font-medium">Opening reflection question</h3><p className="mt-1 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>What is the best opening question or invitation for this Pou?</p><textarea className={`mt-3 ${AUTHORING_TEXTAREA_CLASS}`} value={spec.openingReflectionQuestion ?? ''} onChange={(event) => updateSpec('openingReflectionQuestion', event.target.value || null)} placeholder="SME input required" rows={3} />{!spec.openingReflectionQuestion && <p className="mt-2 text-sm" role="status" style={{ color: 'var(--color-ridge)' }}>Opening reflection question not yet defined. Saving is allowed; approval and activation are blocked.</p>}{spec.openingReflectionQuestion && <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>This opening is recorded as SME-authored, not source-derived.</p>}</section>
    <section><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Exploration areas</h3><p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Choose whether each area is core, conditional, or evidence to notice. These labels help the workshop; they do not create safety policy.</p><div className="mt-3 space-y-4">{spec.conversationExplorationAreas.map((area, index) => <article className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }} key={area.code}><Field label="Area"><input value={area.label} onChange={(event) => updateArea(index, { ...area, label: event.target.value })} /></Field><Field label="Exploration intent"><textarea rows={2} value={area.intent} onChange={(event) => updateArea(index, { ...area, intent: event.target.value })} /></Field><label className="block text-sm font-medium">Exploration approach<select className={AUTHORING_SELECT_CLASS} value={area.explorationMode ?? 'core'} onChange={(event) => updateArea(index, { ...area, explorationMode: event.target.value as ExplorationMode })}>{(Object.keys(modeLabel) as ExplorationMode[]).map((mode) => <option key={mode} value={mode}>{modeLabel[mode]}</option>)}</select></label>{area.explorationMode === 'conditional' && <Field label="When this is relevant"><input value={area.conditionalTrigger ?? ''} onChange={(event) => updateArea(index, { ...area, conditionalTrigger: event.target.value || null })} /></Field>}<Field label="Follow-up guidance (one item per line)"><textarea rows={2} value={area.followUpGuidance.join('\n')} onChange={(event) => updateArea(index, { ...area, followUpGuidance: editingLineList(event.target.value) })} /></Field></article>)}</div></section>
    <section><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Good evidence and review</h3><div className="mt-3 space-y-4">{spec.evidenceCriteria.map((criterion, index) => <article className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }} key={criterion.criterionCode}><Field label="Review item"><input value={criterion.label} onChange={(event) => updateCriterion(index, { ...criterion, label: event.target.value })} /></Field><Field label="What good evidence looks like"><textarea rows={2} value={criterion.description} onChange={(event) => updateCriterion(index, { ...criterion, description: event.target.value })} /></Field><label className="block text-sm font-medium">Evidence source<select className={AUTHORING_SELECT_CLASS} value={criterion.evidenceScope} onChange={(event) => updateCriterion(index, { ...criterion, evidenceScope: event.target.value as Scope })}>{(Object.keys(scopeLabel) as Scope[]).map((scope) => <option key={scope} value={scope}>{scopeLabel[scope]}</option>)}</select></label><div className="mb-3 flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={criterion.strengthsOrProtective} onChange={(event) => updateCriterion(index, { ...criterion, strengthsOrProtective: event.target.checked })} /> Strength / protective factor</label><label><input type="checkbox" checked={criterion.areasForAttention} onChange={(event) => updateCriterion(index, { ...criterion, areasForAttention: event.target.checked })} /> Area for attention</label></div><Field label="Follow-up guidance (one item per line)"><textarea rows={2} value={criterion.followUpGuidance.join('\n')} onChange={(event) => updateCriterion(index, { ...criterion, followUpGuidance: editingLineList(event.target.value) })} /></Field><Field label="When information is missing (one code per line)"><textarea rows={2} value={criterion.missingInformationCodes.join('\n')} onChange={(event) => updateCriterion(index, { ...criterion, missingInformationCodes: editingLineList(event.target.value) })} /></Field><Field label="When not applicable (optional)"><textarea rows={2} value={criterion.applicabilityRule ?? ''} onChange={(event) => updateCriterion(index, { ...criterion, applicabilityRule: event.target.value || null })} /></Field></article>)}</div></section>
    <Field label="Review guidance (one item per line)"><textarea rows={4} value={spec.reviewSynthesisGuidance.join('\n')} onChange={(event) => updateSpec('reviewSynthesisGuidance', editingLineList(event.target.value))} /></Field>
    <section className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }}><h3 className="font-medium">Ordinary Pou specification</h3><p className="mt-1 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>These actions save or activate only the ordinary Pou specification. They do not change formal safety policy.</p><div className="mt-3 flex flex-wrap gap-3"><button disabled={saving || activating} onClick={onSave} className="px-5 py-3 text-sm text-white disabled:opacity-50" style={{ background: 'var(--color-ridge)' }}>{saving ? 'Saving…' : 'Save Pou draft'}</button><button disabled={!draft.canApproveAndActivate || saving || activating} onClick={onActivate} className="border px-5 py-3 text-sm disabled:opacity-50" style={{ borderColor: 'var(--color-ridge)', color: 'var(--color-ridge)' }}>{activating ? 'Approving…' : 'Approve & activate Pou specification'}</button></div><p className="mt-3 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{draft.canApproveAndActivate ? 'Ready for explicit Pou specification approval and activation.' : 'Complete the SME opening question and resolve any formal safety proposal notes before approval.'}</p></section>
    <SafetyPolicyEditor pouId={draft.pouId} activeRuleCount={activeSafety?.ruleCount ?? draft.specification.safetyRuleReferences.length} draft={safetyDraft} onChange={onSafetyDraftChange} onCreate={onCreateSafetyDraft} />
    <section className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-deep)' }}><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Preview</h3><p className="mt-2 text-sm"><strong>Conversation start:</strong> {draft.preview.conversationStart}</p><p className="mt-2 text-sm"><strong>Opening:</strong> {draft.preview.opening ?? 'Opening reflection question not yet defined.'}</p><section className="mt-4"><h4 className="font-medium">What the conversation will explore</h4><p className="mt-1 text-sm">{draft.preview.conversationGuidance.purpose}</p><div className="mt-3 space-y-3">{draft.preview.conversationGuidance.explorationAreas.map((area) => <article key={area.code} className="rounded border p-3" style={{ borderColor: 'var(--color-border-strong)' }}><p className="font-medium">{area.label}</p><p className="mt-1 text-sm">{area.intent}</p>{area.followUpGuidance.length > 0 && <><p className="mt-2 text-sm font-medium">Follow-up guidance</p><ul className="mt-1 list-disc pl-5 text-sm">{area.followUpGuidance.map((item) => <li key={item}>{item}</li>)}</ul></>}</article>)}</div></section><section className="mt-4"><h4 className="font-medium">What the post-conversation review will look for</h4><div className="mt-3 space-y-3">{draft.preview.review.criteria.map((criterion) => <article key={criterion.criterionCode} className="rounded border p-3" style={{ borderColor: 'var(--color-border-strong)' }}><p className="font-medium">{criterion.label}</p><p className="mt-1 text-sm">{criterion.description}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{criterion.strengthsOrProtective && <span>Strength / protective factor</span>}{criterion.areasForAttention && <span>Area for attention</span>}{criterion.missingInformationCodes.length > 0 && <span>Information that may still need clarification</span>}</div></article>)}</div>{draft.preview.review.synthesisGuidance.length > 0 && <><p className="mt-3 text-sm font-medium">Review guidance</p><ul className="mt-1 list-disc pl-5 text-sm">{draft.preview.review.synthesisGuidance.map((item) => <li key={item}>{item}</li>)}</ul></>}</section><section className="mt-4 rounded border p-3" style={{ borderColor: 'var(--color-border-strong)' }}><h4 className="font-medium">Formal safety rules</h4><p className="mt-1 text-sm">{draft.preview.safetyRuleReferences.length === 0 ? 'No approved formal runtime safety rules are attached to this Pou.' : `${draft.preview.safetyRuleReferences.length} approved formal safety rule${draft.preview.safetyRuleReferences.length === 1 ? '' : 's'} are separate from this draft.`}</p></section><p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>Preview is read-only. It does not contact ElevenLabs or change the active specification.</p></section>
  </section>
}

function SafetyPolicyDifference({ activeRuleCount, draft }: { activeRuleCount: number; draft: SafetyPolicyDraft | null }) {
  if (!draft) return <p><strong>Formal safety policy:</strong> No draft formal safety policy has been prepared. {activeRuleCount === 0 ? 'No formal runtime safety rules are currently approved.' : `${activeRuleCount} formal runtime safety rule${activeRuleCount === 1 ? '' : 's'} currently ${activeRuleCount === 1 ? 'is' : 'are'} approved.`}</p>
  const rules = draft.policy.rules
  const described = [
    rules.some((rule) => rule.safetyIndicator.trim()) && 'safety indicator',
    rules.some((rule) => rule.evidenceRequired.some((item) => item.trim())) && 'evidence requirement',
    rules.some((rule) => rule.possibleConcernIndicators.some((item) => item.trim())) && 'possible-concern indicators',
    rules.some((rule) => rule.noCandidateEvidence.some((item) => item.trim())) && 'no-candidate evidence',
    rules.some((rule) => rule.missingInformation.some((item) => item.trim())) && 'missing-information requirements',
    rules.some((rule) => rule.appliesWhen.some((item) => item.trim()) || rule.doesNotApplyWhen.some((item) => item.trim())) && 'applicability',
    rules.some((rule) => rule.candidateOutcomes.length > 0) && 'candidate outcomes',
    rules.some((rule) => rule.humanJudgement.permittedLevels.length > 0) && 'permitted human levels',
    rules.some((rule) => rule.evidenceScope !== 'current_conversation') && 'evidence scope',
  ].filter(Boolean)
  return <><p><strong>Formal safety policy:</strong> {rules.length === 0 ? `Draft v${draft.draftVersion} has no proposed rules; ${activeRuleCount === 0 ? 'no formal runtime safety rules are currently approved.' : `${activeRuleCount} approved formal rule${activeRuleCount === 1 ? '' : 's'} remain active.`}` : `${rules.length} proposed safety rule${rules.length === 1 ? '' : 's'} ${activeRuleCount === 0 ? 'added' : 'prepared'} — draft only, not active.`}</p>{described.length > 0 && <p><strong>Draft proposal includes:</strong> {described.join(', ')}.</p>}</>
}

function SafetyPolicyEditor({ pouId, activeRuleCount, draft, onChange, onCreate }: { pouId: string; activeRuleCount: number; draft: SafetyPolicyDraft | null; onChange: (draft: SafetyPolicyDraft) => void; onCreate: () => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [message, setMessage] = useState('')
  // Policy-bearing choices deliberately begin unset.  An SME must choose the
  // applicable outcomes and, when a rule can raise a concern, the bounded
  // human mapping rather than inheriting a silently invented default.
  const draftRule = (): SafetyRule => ({ id: crypto.randomUUID(), safetyIndicator: '', whyThisMatters: '', evidenceRequired: [''], possibleConcernIndicators: [''], noCandidateEvidence: [''], missingInformation: [''], appliesWhen: [], doesNotApplyWhen: [], candidateOutcomes: [], humanJudgement: { reportOnly: false, permittedLevels: [], broadClass: null }, evidenceScope: 'current_conversation', sourceNotes: [''] })
  const policyChoicesComplete = (rule: SafetyRule) => rule.candidateOutcomes.length > 0
    && (!rule.candidateOutcomes.includes('possible_concern') || rule.humanJudgement.reportOnly || (rule.humanJudgement.broadClass !== null && rule.humanJudgement.permittedLevels.length > 0))
  const canSave = draft?.policy.rules.every(policyChoicesComplete) ?? false
  const persist = async (activate = false) => {
    if (!draft) return
    setSaving(!activate); setActivating(activate); setMessage('')
    const policy = { rules: draft.policy.rules.map((rule) => ({ ...rule, evidenceRequired: persistedLineList(rule.evidenceRequired), possibleConcernIndicators: persistedLineList(rule.possibleConcernIndicators), noCandidateEvidence: persistedLineList(rule.noCandidateEvidence), missingInformation: persistedLineList(rule.missingInformation), appliesWhen: persistedLineList(rule.appliesWhen), doesNotApplyWhen: persistedLineList(rule.doesNotApplyWhen), sourceNotes: persistedLineList(rule.sourceNotes) })) }
    try {
      if (activate) {
        if (!window.confirm('Approve and activate this formal safety policy? Draft rules will become the active policy for future conversations only.')) return
        await request(`/api/safety-policy-drafts/${draft.id}/approve-and-activate`, { method: 'POST', body: JSON.stringify({ expectedRevision: draft.revision }) })
        setMessage('Formal safety policy activated. The previous active policy remains historical.')
      } else {
        const result = await request<{ draft: SafetyPolicyDraft }>(`/api/safety-policy-drafts/${draft.id}`, { method: 'PUT', body: JSON.stringify({ expectedRevision: draft.revision, policy }) })
        onChange(result.draft); setMessage('Saved — still not active.')
      }
    } catch (error) { setMessage((error as { message?: string }).message === 'stale_safety_policy_draft' ? 'A newer safety-policy draft revision exists. Reload before continuing.' : 'The formal safety-policy draft could not be saved.') } finally { setSaving(false); setActivating(false) }
  }
  const update = (index: number, value: SafetyRule) => draft && onChange({ ...draft, policy: { rules: draft.policy.rules.map((rule, current) => current === index ? value : rule) } })
  if (!draft) return <section className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-deep)' }}><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Formal safety concerns</h3><p className="mt-2 text-sm">{activeRuleCount === 0 ? 'No formal runtime safety rules are currently approved for this Pou.' : `${activeRuleCount} approved formal runtime safety rule${activeRuleCount === 1 ? '' : 's'} remains separate from ordinary Pou content.`}</p><button className="mt-3 border px-4 py-2 text-sm" style={{ borderColor: 'var(--color-ridge)', color: 'var(--color-ridge)' }} onClick={() => void onCreate()}>Add proposed safety rule</button></section>
  return <section className="rounded border p-4" style={{ borderColor: 'var(--color-ridge)', background: 'var(--color-surface-deep)' }}><p className="text-xs uppercase tracking-widest" style={{ color: 'var(--color-ridge)', fontFamily: 'var(--font-mono)' }}>Formal safety concerns</p><h3 className="mt-1 text-lg" style={{ fontFamily: 'var(--font-display)' }}>Draft v{draft.draftVersion} · not active</h3><p className="mt-2 text-sm">This governed draft does not affect conversations, review, candidates, actions, referrals, or escalation until you explicitly activate it.</p>{message && <p role="status" className="mt-3 text-sm">{message}</p>}<div className="mt-4 space-y-5">{draft.policy.rules.map((rule, index) => <SafetyRuleFields key={rule.id} rule={rule} onChange={(value) => update(index, value)} onRemove={() => onChange({ ...draft, policy: { rules: draft.policy.rules.filter((_, current) => current !== index) } })} />)}</div><button className="mt-4 border px-4 py-2 text-sm" style={{ borderColor: 'var(--color-border-strong)' }} onClick={() => onChange({ ...draft, policy: { rules: [...draft.policy.rules, draftRule()] } })}>Add proposed safety rule</button><div className="mt-4 flex flex-wrap gap-3"><button disabled={!canSave || saving || activating} onClick={() => void persist()} className="px-5 py-3 text-sm text-white disabled:opacity-50" style={{ background: 'var(--color-ridge)' }}>{saving ? 'Saving…' : 'Save formal safety draft'}</button><button disabled={!draft.canApproveAndActivate || !canSave || saving || activating} onClick={() => void persist(true)} className="border px-5 py-3 text-sm disabled:opacity-50" style={{ borderColor: 'var(--color-ridge)', color: 'var(--color-ridge)' }}>{activating ? 'Activating…' : 'Approve and activate formal safety policy'}</button></div>{!canSave && <p role="status" className="mt-3 text-sm" style={{ color: 'var(--color-ridge)' }}>Choose the applicable candidate outcomes and, for a possible concern, the safety area and permitted human levels before saving.</p>}<p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>Activation records the Pou, organisation, user, timestamp, immutable safety version, and provider projection. Only current-conversation rules can be assessed now; application-record and across-time rules remain non-executable.</p></section>
}

function SafetyRuleFields({ rule, onChange, onRemove }: { rule: SafetyRule; onChange: (rule: SafetyRule) => void; onRemove: () => void }) {
  const text = (key: keyof Pick<SafetyRule, 'evidenceRequired' | 'possibleConcernIndicators' | 'noCandidateEvidence' | 'missingInformation' | 'appliesWhen' | 'doesNotApplyWhen' | 'sourceNotes'>, label: string) => <Field label={label}><textarea rows={2} value={rule[key].join('\n')} onChange={(event) => onChange({ ...rule, [key]: editingLineList(event.target.value) })} /></Field>
  const toggleOutcome = (value: SafetyRule['candidateOutcomes'][number]) => onChange({ ...rule, candidateOutcomes: rule.candidateOutcomes.includes(value) ? rule.candidateOutcomes.filter((item) => item !== value) : [...rule.candidateOutcomes, value] })
  return <article className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }}><div className="flex justify-between gap-3"><h4 className="font-medium">Proposed safety rule</h4><button className="text-sm underline" onClick={onRemove}>Remove</button></div><Field label="Safety indicator — what would make you concerned?"><input value={rule.safetyIndicator} onChange={(event) => onChange({ ...rule, safetyIndicator: event.target.value })} /></Field><Field label="Why this matters"><textarea rows={2} value={rule.whyThisMatters} onChange={(event) => onChange({ ...rule, whyThisMatters: event.target.value })} /></Field>{text('evidenceRequired', 'Evidence required — what needs to be heard or established?')}{text('possibleConcernIndicators', 'Possible-concern indicators (one item per line)')}{text('noCandidateEvidence', 'No-candidate evidence where appropriate (one item per line)')}{text('missingInformation', 'What still needs to be explored (one item per line)')}{text('appliesWhen', 'When this rule applies (one item per line)')}{text('doesNotApplyWhen', 'When this rule does not apply (one item per line)')}<label className="block text-sm font-medium">Evidence scope<select className={AUTHORING_SELECT_CLASS} value={rule.evidenceScope} onChange={(event) => onChange({ ...rule, evidenceScope: event.target.value as SafetyScope })}><option value="current_conversation">This conversation — executable now</option><option value="application_state">Application records — future policy intent</option><option value="longitudinal">Across time — future policy intent</option></select></label><fieldset className="mt-3 text-sm"><legend className="font-medium">Candidate outcomes</legend>{(['possible_concern', 'no_candidate_concern', 'insufficient_information', 'not_applicable'] as const).map((item) => <label className="mr-4 inline-flex gap-1" key={item}><input type="checkbox" checked={rule.candidateOutcomes.includes(item)} onChange={() => toggleOutcome(item)} />{item.replace(/_/g, ' ')}</label>)}</fieldset><label className="mt-3 block text-sm"><input type="checkbox" checked={rule.humanJudgement.reportOnly} onChange={(event) => onChange({ ...rule, humanJudgement: { ...rule.humanJudgement, reportOnly: event.target.checked, permittedLevels: event.target.checked ? [] : rule.humanJudgement.permittedLevels, broadClass: event.target.checked ? null : rule.humanJudgement.broadClass } })} /> Report only / protective behaviour — never confirm as a safety observation</label>{!rule.humanJudgement.reportOnly && <><label className="mt-3 block text-sm font-medium">Safety area<select className={AUTHORING_SELECT_CLASS} value={rule.humanJudgement.broadClass ?? ''} onChange={(event) => onChange({ ...rule, humanJudgement: { ...rule.humanJudgement, broadClass: (event.target.value || null) as SafetyRule['humanJudgement']['broadClass'] } })}><option value="">Select safety area</option><option value="whanau_safety">Whānau safety</option><option value="practice_quality">Practice quality</option><option value="practitioner_wellbeing">Practitioner wellbeing</option></select></label><fieldset className="mt-3 text-sm"><legend className="font-medium">Human judgement allowed</legend>{(['low', 'watch', 'action'] as const).map((item) => <label className="mr-4 inline-flex gap-1" key={item}><input type="checkbox" checked={rule.humanJudgement.permittedLevels.includes(item)} onChange={() => onChange({ ...rule, humanJudgement: { ...rule.humanJudgement, permittedLevels: rule.humanJudgement.permittedLevels.includes(item) ? rule.humanJudgement.permittedLevels.filter((level) => level !== item) : [...rule.humanJudgement.permittedLevels, item] } })} />{item[0].toUpperCase() + item.slice(1)}</label>)}</fieldset></>}{text('sourceNotes', 'Source / provenance notes (one item per line)')}</article>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const control = isValidElement<{ className?: string }>(children) && typeof children.type === 'string'
    ? cloneElement(children, { className: [children.props.className, children.type === 'textarea' ? AUTHORING_TEXTAREA_CLASS : AUTHORING_FIELD_CLASS].filter(Boolean).join(' ') })
    : children
  return <label className="mb-3 block text-sm font-medium">{label}<span className="mt-1 block">{control}</span></label>
}
