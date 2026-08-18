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

const labels: Record<string, string> = {
  whakapapa: 'Whakapapa & Identity Safety', manaakitanga: 'Manaakitanga & Duty of Care', tikanga: 'Tikanga & Ethical Practice',
  kaitiakitanga: 'Kaitiakitanga & Risk Management', puukenga: 'Pūkenga & Practitioner Capability', haepapa: 'Haepapa & Accountability', oranga: 'Oranga & Protective Factors',
}
const scopeLabel: Record<Scope, string> = { current_conversation: 'This conversation', application_state: 'Application records', longitudinal: 'Across time' }
const modeLabel: Record<ExplorationMode, string> = { core: 'Core exploration', conditional: 'Conditional exploration', evidence_to_notice: 'Evidence to notice' }
const AUTHORING_TEXTAREA_CLASS = 'w-full min-h-28 resize-y'
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
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)

  async function refresh(selectId?: string) {
    setLoading(true)
    try {
      const result = await request<{ specifications: Summary[] }>('/api/pou-specifications')
      setSummaries(result.specifications)
      const draft = selectId ? result.specifications.flatMap((item) => item.draft ? [item.draft] : []).find((item) => item.id === selectId) : null
      setSelected((current) => draft ?? current)
    } catch { setMessage('The Pou specifications could not be loaded.') } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, []) // authenticated editor route is still enforced server-side.

  const selectedSummary = useMemo(() => selected ? summaries.find((item) => item.pouId === selected.pouId) : undefined, [selected, summaries])
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
        {!selected ? <section className="rounded border p-6" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)' }}><h2 className="text-xl" style={{ fontFamily: 'var(--font-display)' }}>Choose a Pou</h2><p className="mt-2 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Create a new working draft to begin an SME workshop. The current active version stays unchanged.</p></section> : <Editor draft={selected} activeVersion={selectedSummary?.activeVersion} activeSpecification={selectedSummary?.activeSpecification} saving={saving} activating={activating} onChange={setSelected} onSave={() => void save()} onActivate={() => void approveAndActivate()} />}
      </div>}
    </div>
  </main>
}

function Editor({ draft, activeVersion, activeSpecification, saving, activating, onChange, onSave, onActivate }: { draft: Draft; activeVersion?: string; activeSpecification?: Draft['specification']; saving: boolean; activating: boolean; onChange: (draft: Draft) => void; onSave: () => void; onActivate: () => void }) {
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
    {activeSpecification && <details className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }}><summary className="cursor-pointer font-medium">Changes from active v{activeVersion}</summary><div className="mt-3 space-y-2 text-sm"><p><strong>Purpose:</strong> {activeSpecification.purpose === spec.purpose ? 'Unchanged' : 'Updated in this draft'}</p><p><strong>Opening reflection question:</strong> {activeSpecification.openingReflectionQuestion?.trim() || 'Not defined in active version'} → {spec.openingReflectionQuestion?.trim() || 'SME input required'}</p><p><strong>Exploration and follow-up guidance:</strong> {changedExploration.length === 0 ? 'Unchanged' : <span>{changedExploration.map((area) => area.label).join(', ')} {changedExploration.length === 1 ? 'has' : 'have'} been updated.</span>}</p><p><strong>Review guidance:</strong> {changedReview.length === 0 ? 'Unchanged' : <span>{changedReview.map((criterion) => criterion.label).join(', ')} {changedReview.length === 1 ? 'has' : 'have'} been updated.</span>}</p><p><strong>Formal safety policy:</strong> unchanged here; any proposal notes require separate governance.</p></div></details>}
    <Field label="Purpose"><textarea value={spec.purpose} onChange={(event) => updateSpec('purpose', event.target.value)} rows={4} /></Field>
    <section className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }}><h3 className="font-medium">Opening reflection question</h3><p className="mt-1 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>What is the best opening question or invitation for this Pou?</p><textarea className={`mt-3 ${AUTHORING_TEXTAREA_CLASS}`} value={spec.openingReflectionQuestion ?? ''} onChange={(event) => updateSpec('openingReflectionQuestion', event.target.value || null)} placeholder="SME input required" rows={3} />{!spec.openingReflectionQuestion && <p className="mt-2 text-sm" role="status" style={{ color: 'var(--color-ridge)' }}>Opening reflection question not yet defined. Saving is allowed; approval and activation are blocked.</p>}{spec.openingReflectionQuestion && <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>This opening is recorded as SME-authored, not source-derived.</p>}</section>
    <section><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Exploration areas</h3><p className="text-sm" style={{ color: 'var(--color-ink-secondary)' }}>Choose whether each area is core, conditional, or evidence to notice. These labels help the workshop; they do not create safety policy.</p><div className="mt-3 space-y-4">{spec.conversationExplorationAreas.map((area, index) => <article className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }} key={area.code}><Field label="Area"><input value={area.label} onChange={(event) => updateArea(index, { ...area, label: event.target.value })} /></Field><Field label="Exploration intent"><textarea rows={2} value={area.intent} onChange={(event) => updateArea(index, { ...area, intent: event.target.value })} /></Field><label className="block text-sm font-medium">Exploration approach<select className={AUTHORING_SELECT_CLASS} value={area.explorationMode ?? 'core'} onChange={(event) => updateArea(index, { ...area, explorationMode: event.target.value as ExplorationMode })}>{(Object.keys(modeLabel) as ExplorationMode[]).map((mode) => <option key={mode} value={mode}>{modeLabel[mode]}</option>)}</select></label>{area.explorationMode === 'conditional' && <Field label="When this is relevant"><input value={area.conditionalTrigger ?? ''} onChange={(event) => updateArea(index, { ...area, conditionalTrigger: event.target.value || null })} /></Field>}<Field label="Follow-up guidance (one item per line)"><textarea rows={2} value={area.followUpGuidance.join('\n')} onChange={(event) => updateArea(index, { ...area, followUpGuidance: editingLineList(event.target.value) })} /></Field></article>)}</div></section>
    <section><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Good evidence and review</h3><div className="mt-3 space-y-4">{spec.evidenceCriteria.map((criterion, index) => <article className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)' }} key={criterion.criterionCode}><Field label="Review item"><input value={criterion.label} onChange={(event) => updateCriterion(index, { ...criterion, label: event.target.value })} /></Field><Field label="What good evidence looks like"><textarea rows={2} value={criterion.description} onChange={(event) => updateCriterion(index, { ...criterion, description: event.target.value })} /></Field><label className="block text-sm font-medium">Evidence source<select className={AUTHORING_SELECT_CLASS} value={criterion.evidenceScope} onChange={(event) => updateCriterion(index, { ...criterion, evidenceScope: event.target.value as Scope })}>{(Object.keys(scopeLabel) as Scope[]).map((scope) => <option key={scope} value={scope}>{scopeLabel[scope]}</option>)}</select></label><div className="mb-3 flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={criterion.strengthsOrProtective} onChange={(event) => updateCriterion(index, { ...criterion, strengthsOrProtective: event.target.checked })} /> Strength / protective factor</label><label><input type="checkbox" checked={criterion.areasForAttention} onChange={(event) => updateCriterion(index, { ...criterion, areasForAttention: event.target.checked })} /> Area for attention</label></div><Field label="Follow-up guidance (one item per line)"><textarea rows={2} value={criterion.followUpGuidance.join('\n')} onChange={(event) => updateCriterion(index, { ...criterion, followUpGuidance: editingLineList(event.target.value) })} /></Field><Field label="When information is missing (one code per line)"><textarea rows={2} value={criterion.missingInformationCodes.join('\n')} onChange={(event) => updateCriterion(index, { ...criterion, missingInformationCodes: editingLineList(event.target.value) })} /></Field><Field label="When not applicable (optional)"><textarea rows={2} value={criterion.applicabilityRule ?? ''} onChange={(event) => updateCriterion(index, { ...criterion, applicabilityRule: event.target.value || null })} /></Field></article>)}</div></section>
    <Field label="Review guidance (one item per line)"><textarea rows={4} value={spec.reviewSynthesisGuidance.join('\n')} onChange={(event) => updateSpec('reviewSynthesisGuidance', editingLineList(event.target.value))} /></Field>
    <Field label="Formal safety-rule proposal notes (separate governance; not activated here)"><textarea rows={3} value={draft.proposedSafetyRuleNotes.join('\n')} onChange={(event) => onChange({ ...draft, proposedSafetyRuleNotes: editingLineList(event.target.value) })} placeholder="Optional workshop notes for separate safety-policy approval" /></Field>
    <section className="rounded border p-4" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface-deep)' }}><h3 className="text-lg" style={{ fontFamily: 'var(--font-display)' }}>Preview</h3><p className="mt-2 text-sm"><strong>Conversation start:</strong> {draft.preview.conversationStart}</p><p className="mt-2 text-sm"><strong>Opening:</strong> {draft.preview.opening ?? 'Opening reflection question not yet defined.'}</p><section className="mt-4"><h4 className="font-medium">What the conversation will explore</h4><p className="mt-1 text-sm">{draft.preview.conversationGuidance.purpose}</p><div className="mt-3 space-y-3">{draft.preview.conversationGuidance.explorationAreas.map((area) => <article key={area.code} className="rounded border p-3" style={{ borderColor: 'var(--color-border-strong)' }}><p className="font-medium">{area.label}</p><p className="mt-1 text-sm">{area.intent}</p>{area.followUpGuidance.length > 0 && <><p className="mt-2 text-sm font-medium">Follow-up guidance</p><ul className="mt-1 list-disc pl-5 text-sm">{area.followUpGuidance.map((item) => <li key={item}>{item}</li>)}</ul></>}</article>)}</div></section><section className="mt-4"><h4 className="font-medium">What the post-conversation review will look for</h4><div className="mt-3 space-y-3">{draft.preview.review.criteria.map((criterion) => <article key={criterion.criterionCode} className="rounded border p-3" style={{ borderColor: 'var(--color-border-strong)' }}><p className="font-medium">{criterion.label}</p><p className="mt-1 text-sm">{criterion.description}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{criterion.strengthsOrProtective && <span>Strength / protective factor</span>}{criterion.areasForAttention && <span>Area for attention</span>}{criterion.missingInformationCodes.length > 0 && <span>Information that may still need clarification</span>}</div></article>)}</div>{draft.preview.review.synthesisGuidance.length > 0 && <><p className="mt-3 text-sm font-medium">Review guidance</p><ul className="mt-1 list-disc pl-5 text-sm">{draft.preview.review.synthesisGuidance.map((item) => <li key={item}>{item}</li>)}</ul></>}</section><section className="mt-4 rounded border p-3" style={{ borderColor: 'var(--color-border-strong)' }}><h4 className="font-medium">Formal safety rules</h4><p className="mt-1 text-sm">{draft.preview.safetyRuleReferences.length === 0 ? 'No approved formal runtime safety rules are attached to this Pou.' : `${draft.preview.safetyRuleReferences.length} approved formal safety rule${draft.preview.safetyRuleReferences.length === 1 ? '' : 's'} are separate from this draft.`}</p></section><p className="mt-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>Preview is read-only. It does not contact ElevenLabs or change the active specification.</p></section>
    <div className="flex flex-wrap gap-3"><button disabled={saving || activating} onClick={onSave} className="px-5 py-3 text-sm text-white disabled:opacity-50" style={{ background: 'var(--color-ridge)' }}>{saving ? 'Saving…' : 'Save draft'}</button><button disabled={!draft.canApproveAndActivate || saving || activating} onClick={onActivate} className="border px-5 py-3 text-sm disabled:opacity-50" style={{ borderColor: 'var(--color-ridge)', color: 'var(--color-ridge)' }}>{activating ? 'Approving…' : 'Approve and activate'}</button><span className="self-center text-sm" style={{ color: 'var(--color-ink-secondary)' }}>{draft.canApproveAndActivate ? 'Ready for explicit approval and activation.' : 'Complete the SME opening question and resolve any formal safety proposal notes before approval.'}</span></div>
  </section>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const control = isValidElement<{ className?: string }>(children) && typeof children.type === 'string'
    ? cloneElement(children, { className: [children.props.className, children.type === 'textarea' ? AUTHORING_TEXTAREA_CLASS : 'w-full'].filter(Boolean).join(' ') })
    : children
  return <label className="mb-3 block text-sm font-medium">{label}<span className="mt-1 block">{control}</span></label>
}
