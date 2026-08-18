# Milestone 5 — ElevenLabs Conversational AI

## Phase 5A: real Whakapapa voice lifecycle

Phase 5A introduces a real voice lifecycle for Pou 1, Whakapapa only. It does not enable voice for the other six Pou.

The staging provider configuration is operational context, not browser configuration:

- Agent: `Te Kaupapa - Whakapapa - Staging`
- Agent ID: `agent_0301kzpzekqbe8yaagpm4hy0sq1v`
- Branch ID: `agtbrch_7701kzpzemctezt9bgxt2z40wtsz`
- Environment: `staging`
- Voice: Melissa
- Current provider-configured LLM: Gemini 3.5 Flash
- Private agent authentication and Zero Retention Mode: enabled

The underlying LLM remains part of the versioned ElevenLabs conversation-agent configuration. Phase 5B separately introduces a server-only, provider-neutral assessment adapter; its initial OpenAI implementation is described below and is not part of the conversational agent.

## Security and transport

The browser asks Te Kaupapa to start only the authoritative Whakapapa conversation. The server verifies the authenticated Kaimahi, organisation, workflow ownership, active workflow state, first-Pou `pou-overview` checkpoint, and unconfirmed Whakapapa checkpoint. It chooses the agent, branch, and environment server-side.

The server uses the ElevenLabs WebRTC conversation-token endpoint. The browser receives only a short-lived `conversationToken` and starts the SDK with explicit `connectionType: 'webrtc'`. The API key remains server-only. Tokens are not persisted, logged, put in URLs, or exposed through Vite configuration.

## Durable provenance

Migration `0005_living_thena` adds `workflow_conversation`. It records only:

- internal conversation, workflow, organisation, Pou, and actor provenance;
- provider conversation, agent, branch, environment, and application specification references;
- idempotency, lifecycle timestamps, and bounded termination reason.

The application-owned specification is `whakapapa-reflection` version `1`. It is provenance only; the primary prompt remains in ElevenLabs.

Lifecycle constraints make `preparing`, `authorized`, and `active` require their corresponding provider and timestamp state. An `ended` attempt must have reached authorization; a `failed` attempt may legitimately have no provider reference or authorization timestamp when provider authorization itself failed. Every terminal attempt records an end timestamp and bounded termination reason.

No Phase 5A table or API persists transcript text, audio, captions, generated summaries, provider raw payloads, safety observations, actions, referrals, or consequences.

## Lifecycle and manual review

The browser requests microphone permission only after a deliberate Start action. It then requests Te Kaupapa authorization, starts WebRTC, verifies the SDK/provider conversation ID, and acknowledges an active browser connection. A deliberately ended or unexpectedly disconnected media session is reconciled idempotently without changing workflow version or checkpoint.

There is no automatic reconnection claim. A lost connection is displayed truthfully and allows a deliberate fresh attempt or continuation to the existing manual Whakapapa review. Voice is supportive, not a workflow gate.

Live captions, when supplied by the provider SDK, are bounded to 20 finalized items and 16 KiB in browser memory, then cleared on end, navigation, unmount, failure, and application teardown. They are not copied into workflow state.

The existing Kaimahi manual Pou review remains the only Phase 5A route to canonical Pou, safety, action, referral, or consequence state.

## Mobile acceptance

The ElevenLabs SDK is in a dedicated lazy voice chunk. It must not enter the entry bundle, Supervisor chunk, normal Kaimahi navigation, or the other six Pou. See [MOBILE_PERFORMANCE_BASELINE.md](MOBILE_PERFORMANCE_BASELINE.md) for the measured build result and remaining constrained/severe-network device testing.

## Deferred work

Phase 5A does not enable provider-event ingestion, candidate observations, generated summaries, transcript retention, audio retention, WebSocket fallback, text-provider fallback, or seven-Pou voice rollout. Those require separately reviewed Milestone 5 phases.

## Phase 5B: Whakapapa structured assessment candidates

Phase 5B adds a deliberately noncanonical, Whakapapa-only post-call assessment boundary. SME-defined, immutable safety specifications are authoritative. ElevenLabs supplies signed post-call transcript delivery only; Te Kaupapa normalises verified synthetic transcript material into ordered stable turns, retains it through a dedicated noncanonical transcript repository, and passes a transient copy to a separate provider-neutral ConversationAssessmentProvider, initially OpenAI Structured Outputs. Only Te Kaupapa validates and stores the resulting bounded candidate evidence.

### Architecture decision — separate conversation from assessment

ElevenLabs is the conversation provider, not the Safety Pou assessment provider. The pipeline is: Kaimahi → ElevenLabs conversation → signed transcript webhook → Te Kaupapa HMAC/provenance validation → stable ordered transcript turns retained as noncanonical supporting source material → transient provider input → ConversationAssessmentProvider → strict application-owned structured assessment with bounded evidence-turn identifiers → deterministic validation → noncanonical candidate → Kaimahi review → human-confirmed canonical state.

Transcript turns are noncanonical supporting source material, kept outside ordinary workflow/dashboard serializers and never duplicated into candidate or canonical safety tables. They may be retained only through the transcript repository and only under separately governed access, retention, audit, and deletion policy; this POC foundation is authorised for synthetic material, not real whānau retention. Audio, raw webhook payloads, raw model requests/responses, model rationale, and hidden reasoning are never persisted or logged. Assessment runs pin the immutable specification, rule manifest, and projection plus separate conversation- and assessment-provider provenance. Kaimahi retains Low/Watch/Action authority. OpenAI is the initial provider; AWS Bedrock/Claude is a future provider-neutral alternative subject to model-level regional and governance verification. No claim is made that all Bedrock/Claude models process in Sydney.

End-to-review latency is measured from bounded timestamps: conversation ended, transcript received, assessment started, assessment completed, and review available. Pilot use with real whānau data requires an explicit selected-provider processing/retention governance decision; `store: false` is used for OpenAI but is not a Zero Data Retention claim.

The supplied Te Waharoa Model of Care is the draft-derived source for the approved controlled-pilot `TE_WAHAROA_WHAKAPAPA_SAFETY` v0.1 template. It contains exactly three current-conversation rules:

- `WHAKAPAPA_IDENTITY_CONTEXT_001` — `practice_quality`; human-selectable `low`, `watch`, or `action`.
- `WHAKAPAPA_STRENGTHS_PROTECTIVE_002` — `practice_quality`; human-selectable `low`, `watch`, or `action`.
- `WHAKAPAPA_CULTURAL_DISTRESS_003` — `whanau_safety`; human-selectable `low`, `watch`, or `action`.

All three are human-only for severity: provider `candidateConcernLevel` is always null, and `urgent` is not permitted. Protective indicators are report-only and never automatically cancel, downgrade, or offset a separately supported concern. The cultural-distress rule is not applicable when no explicit cultural/identity distress or disconnection is present; ambiguity is insufficient information; an explicitly present issue is either adequately explored with no candidate concern or insufficiently explored with a possible concern. It must never infer distress from demographics, identity assumptions, or silence.

The template remains inactive until an authorised product approver is supplied at provisioning time. Provisioning records the real approver identity and current timestamp with immutable `approved_for_pilot` provenance; it does not change the draft-derived source status. Documentation-quality concepts remain application-state/deferred material and are not inferred from conversational silence. Later refinement must create a new immutable version rather than alter v0.1.

Provider output cannot confirm a Pou, advance a workflow, create a canonical observation, or create any deterministic consequence, action, referral, review request, notification, or summary. A Kaimahi may explicitly dismiss/acknowledge a candidate, or explicitly select an approved level and confirm it through the existing canonical safety-observation command. The deterministic safety evaluation then remains the existing application rule path.

No audio, raw webhook envelope, raw assessment response, numeric confidence, or unbounded rationale is persisted in Phase 5B. Ordered transcript turns are noncanonical source material, excluded from ordinary response DTOs and retained only by the dedicated transcript repository. A future Supervisor source-access capability may retrieve referenced turns plus narrow surrounding context only when authorised and audited; Supervisor UI, search, access history, retention controls, and deletion UI are explicitly deferred beyond this SME POC. The webhook is server-to-server, uses a raw-body HMAC verifier with freshness and replay protection, and remains disabled until separate server-only configuration and controlled provider acceptance.

Application-state and longitudinal evidence are deliberately deferred. Future longitudinal/pattern assessment requires historical Te Kaupapa state and separately approved SME rules; it is not inferred from a single voice reflection.

### Accepted Phase 5B deferred refinements

The completed controlled synthetic proof returned three `no_candidate_concern` results. The existing empty-candidate state keeps manual Pou review available and does not invent a concern. A future UI refinement may make the completed-with-no-reviewable-candidate state explicit; it is not a Phase 5B safety or acceptance blocker.

The genuine controlled result measured 14.946 seconds from conversation end to transcript receipt, 8.129 seconds for the OpenAI assessment, and 23.528 seconds from end to assessment completion. Reducing end-to-Pou-review latency is deferred. A future investigation may determine whether final transcript turns can be captured during the live ElevenLabs session so assessment can begin at end rather than waiting for the post-call webhook. It must not weaken Zero Retention Mode or the approved privacy boundary.

## Phase 5C: Whakapapa Pou review reconciliation

Phase 5C keeps four separate domains: retained transcript source material; the Phase 5B structured safety assessment; a provider-neutral `ConversationReviewDraftProvider` narrative synthesis; and the human-confirmed canonical Whakapapa Pou review. The initial narrative adapter uses server-only OpenAI Structured Outputs with `store: false`; it does not share an output contract with `ConversationAssessmentProvider`, and another provider can replace it without changing workflow/UI persistence.

The generated draft contains only bounded `overallSummary`, `strengthsSummary`, `areasForAttentionSummary`, and validated `evidenceTurnIds`. It has no diagnosis, concern level, action, referral, escalation, supervisor decision, quotation, provider rationale, or hidden reasoning. Its original generated revision is immutable; opening is recorded, human changes append a new revision, and the explicit ordinary Pou-confirmation path inserts the canonical final review with the confirming Kaimahi and timestamp. It never silently confirms a Phase 5B candidate.

Whakapapa only replaces the former static/demo narrative panels. After voice ends, the Kaimahi sees a bounded analysing state, then either the editable review draft, a truthful manual-review fallback, or a distinct completed-with-no-reviewable-safety-candidate notice. The notice says that no additional safety concern was suggested; it never claims that the Pou is safe or cleared. Safety-candidate review stays visually and semantically separate.

Phase 5C does not alter the other six Pou, introduce Supervisor transcript UI, or decide real whānau transcript retention governance. Phase 5D may extend this proven pattern to Pou 2–7 only after a separate approval.

### Accepted Phase 5C deferred refinements

The genuine controlled reconciliation measured 14.379 seconds from conversation end to transcript receipt, 8.649 seconds from transcript receipt to narrative review readiness, and 23.028 seconds end to review readiness. Reducing this latency is deferred. A future investigation may determine whether final ElevenLabs transcript turns can be made available during the live session so the assessment and narrative-review work can begin immediately at end rather than waiting for the post-call webhook; it must not weaken Zero Retention Mode or the approved privacy boundary. For no-candidate assessment runs, `review_available_at` is currently unset while the narrative draft has its own `generated_at`; aligning those audit timings is also deferred.

## Pre-Phase 5D: SME-driven Whakapapa guidance and review criteria

The controlled pilot adds one immutable, organisation-owned Whakapapa specification that is explicitly `draft_derived` from the Te Waharoa source and separately approved for pilot use by an identified operator. It deterministically derives three distinct, pinned artifacts: `ConversationGuidanceProjection` for the live reflection, `PouReviewProjection` for criterion-by-criterion noncanonical narrative review, and a link to the existing immutable Phase 5B safety projection. Only `CURRENT_CONVERSATION` material can enter runtime conversation guidance; application-state and longitudinal material remain out of the live provider context. The first controlled template contains exactly three review criteria: identity/wider context, strengths/protection, and cultural connection/disconnection. Each generated review revision receives exactly one bounded status/evidence record per criterion; an unmentioned topic is `not_explored` or `insufficient_information`, not evidence of absence or safety.

ElevenLabs keeps a single stable human-maintained base prompt containing `{{pou_name}}` and `{{pou_guidance}}`; its stable First Message also consumes `{{pou_name}}` and `{{pou_opening}}`. Te Kaupapa returns exactly these three server-authorized dynamic values through the authenticated private-WebRTC start flow. Historic active v0.1 versions deliberately send `pou_opening` as an empty string, so the First Message remains the generic orientation without invented SME policy. The controlled-pilot transport proof is the installed SDK's executable serializer and private WebRTC implementation: it serializes the values into `conversation_initiation_client_data.dynamic_variables` and sends the initiation event over the LiveKit data channel after token-authenticated connection. This proof is separate from behavioural consistency and does not make the browser or provider authoritative policy state.

The controlled Zero Retention Mode provider record exposed an empty dynamic-variable object at read-back. This is an unresolved provider observability limitation, not evidence that the server or SDK omitted the values. Dynamic values are verified against the pin when provider initiation metadata includes them; their absence cannot substitute policy, safety rules, review criteria, or canonical workflow state because review and safety processing independently resolve the same pinned approved specification. The deferred provider-integration refinement is to confirm with ElevenLabs whether ZRM intentionally suppresses dynamic-variable receipt/read-back. ZRM must not be weakened, and no additional provider retention may be enabled for that investigation.

This enhancement remains Whakapapa-only. It does not add Pou 2–7 configuration, a general SME configuration UI, a full provider prompt override, a WebSocket transport path, or Supervisor transcript UI.

## Phase 5D: seven-Pou SME-driven rollout — draft-derived local POC gate

Phase 5D generalises the already-proven conversation, retained-transcript, noncanonical review draft, human confirmation, and separate safety-candidate architecture across all seven Te Waharoa Pou. It is specification-driven: no Pou has a bespoke conversation, review, or safety workflow. The same immutable organisation-owned specification deterministically derives the server-pinned `ConversationGuidanceProjection`, `PouReviewProjection`, and its link to the separately immutable `SafetyAssessmentProjection`.

The seven source-derived v0.1 templates cite `src/imports/pasted_text/te-waharoa-model-update.md` and its raw SHA-256 `b4c12e532d17b1a4a2e5facd24d0450686672e8124ec03a4162e54f77e9c8baa`:

| Pou | code | source reference | template provenance |
| --- | --- | --- | --- |
| Whakapapa & Identity Safety | `whakapapa` | `#pou-1` | existing approved controlled pilot |
| Manaakitanga & Duty of Care | `manaakitanga` | `#pou-2` | `draft_derived` v0.1 |
| Tikanga & Ethical Practice | `tikanga` | `#pou-3` | `draft_derived` v0.1 |
| Kaitiakitanga & Risk Management | `kaitiakitanga` | `#pou-4` | `draft_derived` v0.1 |
| Pūkenga & Practitioner Capability | `puukenga` | `#pou-5` | `draft_derived` v0.1 |
| Haepapa & Accountability | `haepapa` | `#pou-6` | `draft_derived` v0.1 |
| Oranga & Protective Factors | `oranga` | `#pou-7` | `draft_derived` v0.1 |

`draft_derived` means suitable only for controlled local SME-validation when a named product owner explicitly provisions and approves the exact immutable version. It is not formal client or SME policy. SME feedback creates a new immutable version (for example v0.2); it never edits v0.1.

Only `CURRENT_CONVERSATION` criteria reach dynamic conversation guidance or transcript review. `APPLICATION_STATE` (including documentation/record checks) and `LONGITUDINAL` material remain visible in the source specification for future work but cannot be inferred from one spoken reflection. Every projected current-conversation criterion requires exactly one bounded review status: `evidenced`, `partially_evidenced`, `not_explored`, `insufficient_information`, or source-authorised `not_applicable`. Silence is never reassurance or a safety clearance.

The source lists review attention and safety-flag examples for Pou 2–7, but it does not define bounded current-conversation indicators, canonical mappings, or human concern levels. Accordingly, their v0.1 local-POC safety manifests intentionally contain **zero formal runtime safety rules**. A review attention item never becomes a safety candidate. The existing Whakapapa three-rule safety policy remains unchanged. SME validation must decide, per Pou, which concerns—if any—should become formal safety rules, their bounded indicators, mapping, permitted human levels, and deterministic consequences.

ElevenLabs still has one stable base prompt with `{{pou_name}}` and `{{pou_guidance}}`, and a stable First Message that consumes `{{pou_name}}` and `{{pou_opening}}`; Te Kaupapa resolves and pins all three values server-side for the authorised Pou. The Zero Retention Mode dynamic-variable read-back limitation remains **unverified provider observability**, not a reason to weaken ZRM or to make the provider authoritative. ElevenLabs remains the conversation and signed transcript-delivery provider; `ConversationReviewDraftProvider` and `ConversationAssessmentProvider` remain provider-neutral, server-side structured interpretation adapters. The transcript/evidence-turn boundary is unchanged. Supervisor transcript UI remains deferred; the SME editor is an authorised working-draft foundation, while its activation and provider publication remain separate human gates.

The SME POC should ask: are the exploration areas right; what is good evidence; what is missing; what needs follow-up; what represents strength/protection; what needs attention; what is a formal safety concern; and which judgements always remain with Kaimahi.

### Approved risk-based validation plan

The controlled local POC uses a proportional validation strategy without weakening the normal workflow boundary:

- Whakapapa and Manaakitanga each have a completed genuine controlled live proof.
- Kaitiakitanga & Risk Management is the one remaining contrasting controlled live conversation proof. It is reached only by normal authenticated Pou review confirmations; no workflow stage is skipped and no database state is patched to reach it.
- Tikanga, Pūkenga, Haepapa, and Oranga require complete automated/synthetic proof of approved specification activation, server-pinned guidance and review projections, no-safety-rule absence semantics, cross-Pou isolation, and the normal review/confirmation UI path. They do not require separate live WebRTC conversations unless that evidence exposes a real defect.

This plan does not change retention governance, permit provider-originated canonical state, or turn draft-derived v0.1 material into formal SME policy.

## SME-demo Pou review and action-flow cleanup

The seven-Pou SME demonstration uses the accepted Phase 5D specifications and projections without adding another provider or AI architecture. The active post-conversation Pou review shows only real application data: the editable noncanonical narrative draft, pinned structured criterion assessments, actual formal safety candidates where they exist, and authoritative workflow state. Legacy illustrative reflective prompts, static safety flags, always-visible concern grids, suggested actions, referrals, and supervisor controls are removed from the active review path.

Each Pou follows conversation → evidence review → explicit Kaimahi confirmation → optional human carry-forward marking. The review presents what was established, strengths/protective factors, still-to-explore information, and areas for attention separately. `not_explored` and `insufficient_information` remain gaps, not evidence that a matter is absent or safe. An attention item is not a formal safety concern or an automatic action.

Formal safety remains conditional and separate from narrative review. Low, Watch, and Action are available only for a real reviewable candidate or the existing deliberate human safety-recording path; no provider selects a default and ordinary review no longer displays Urgent. Narrative confirmation never silently confirms a safety candidate.

`workflow_carry_forward` is a forward-only, human-owned pre-action marker. It pins the current scoped review criterion, area for attention, or confirmed safety observation with its organisation, workflow, Pou, actor, and timestamp. It cannot create an action, referral, escalation, or supervisor request. After all seven Pou are confirmed, a server-assembled synthesis shows the confirmed Pou reviews, confirmed safety observations, and carry-forward count before Action Planning. Action Planning is always available, including when there are zero carry-forwards; the Kaimahi decides whether anything becomes an action, referral, future follow-up, or no further action.

Supervisor transcript/source UI and any new formal Pou 2–7 safety rules remain deferred. The SME specification editor is available only for authorised organisation-scoped working drafts; activating a new immutable version or publishing provider configuration remains a separate human gate. SME validation continues to decide core versus conditional exploration, adequate evidence, follow-up for missing information, strengths, attention items, formal safety rules, and decisions that must remain human. The established privacy boundary remains unchanged: provider transcript/audio are not surfaced in normal UI, and ZRM remains enabled.

## Cross-Pou synthesis and immutable final record

After all seven Pou have an explicitly confirmed canonical review, the existing `pou-summary` checkpoint is a Kaimahi review of a separate, noncanonical cross-Pou synthesis draft. `WorkflowSynthesisProvider` receives only bounded Te Kaupapa-controlled confirmed review summaries, approved still-to-explore labels, carry-forward presentation, and human-confirmed safety observations. It never receives transcript text, audio, raw provider payloads, hidden rationale, identifiers, hashes, or unconfirmed safety candidates. The initial server-only OpenAI structured-output adapter uses `store: false`; it is provider-neutral and can be replaced without changing the workflow model.

The generated synthesis revision is immutable. Kaimahi edits append a revision protected by the expected revision number. Only an authenticated explicit `workflow-synthesis-confirmed` command moves the existing `pou-summary` checkpoint to Action Planning. This confirmation is distinct from Pou and safety confirmation, and no provider output can create an action, referral, safety observation, escalation, or workflow transition.

At final record review, explicit completion atomically creates one immutable point-in-time final-record snapshot from the confirmed synthesis plus the current canonical actions, referrals, and human-confirmed safety observations. Later safety correction history does not rewrite that completed snapshot. Owner-scoped Copy and on-demand server-side PDF output read only the final snapshot and exclude transcript content, audio, provider metadata, raw payloads, reasoning, identifiers, hashes, and technical specification detail. PDF output embeds the application-owned Noto Sans font files (SIL Open Font License 1.1) so te reo Māori macrons render portably without depending on host-system fonts. Supervisor final-record access remains a separate future authorisation decision.
