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

ElevenLabs keeps a single stable human-maintained base prompt containing `{{pou_name}}` and `{{pou_guidance}}`. Te Kaupapa returns only these two server-authorized dynamic values through the authenticated private-WebRTC start flow. The controlled-pilot transport proof is the installed SDK's executable serializer and private WebRTC implementation: it serializes the values into `conversation_initiation_client_data.dynamic_variables` and sends the initiation event over the LiveKit data channel after token-authenticated connection. This proof is separate from behavioural consistency and does not make the browser or provider authoritative policy state.

The controlled Zero Retention Mode provider record exposed an empty dynamic-variable object at read-back. This is an unresolved provider observability limitation, not evidence that the server or SDK omitted the values. Dynamic values are verified against the pin when provider initiation metadata includes them; their absence cannot substitute policy, safety rules, review criteria, or canonical workflow state because review and safety processing independently resolve the same pinned approved specification. The deferred provider-integration refinement is to confirm with ElevenLabs whether ZRM intentionally suppresses dynamic-variable receipt/read-back. ZRM must not be weakened, and no additional provider retention may be enabled for that investigation.

This enhancement remains Whakapapa-only. It does not add Pou 2–7 configuration, a general SME configuration UI, a full provider prompt override, a WebSocket transport path, or Supervisor transcript UI.
