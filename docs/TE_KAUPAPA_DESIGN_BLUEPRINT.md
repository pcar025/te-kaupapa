# Te Kaupapa — Product and Technical Design Blueprint

**Status:** Living design reference  
**Version:** 0.1  
**Date:** 9 August 2026  
**Repository:** `te-kaupapa`  
**Current development branch:** `staging`  
**Approved UI baseline tag:** `ui-baseline-2026-08-09`

---

## 1. Purpose of this document

This document describes the intended product, user experience, technical architecture, data boundaries, and future direction for Te Kaupapa.

It is a design reference rather than an implementation specification.

It should help ensure that future engineering work remains aligned with the product intent even as individual milestones, components, integrations, and infrastructure evolve.

`AGENTS.md` defines how coding agents should work within the repository. This document defines what Te Kaupapa is intended to become.

Where this document describes a future capability that has not yet been implemented, it should be treated as product direction rather than current behaviour.

---

## 2. Product vision

Te Kaupapa is a guided frontline workflow that helps kaimahi work through a structured Te Waharoa / Pou-based process with whānau, capture the important outcomes of that engagement, identify risks or contraindications, generate actions and referrals, and create an auditable record that can be reviewed by supervisors.

The experience should feel conversational, supportive, structured, and culturally aligned rather than like a conventional form-filling application.

The application is intended to reduce administrative burden on frontline staff while strengthening:

- consistency of practice
- reflection
- identification of needs and risks
- action planning
- follow-through
- supervisory visibility
- learning across cases and teams
- quality and safety

The application should support the worker rather than replace professional judgement.

---

## 3. Current product context

Te Kaupapa is currently being developed as a standalone application and repository.

The present UI has been designed in Figma and is treated as the approved visual and interaction baseline.

The existing product includes two broad user experiences:

### Kaimahi

A frontline workflow that includes:

- session setup
- Te Waharoa / Pou overview
- guided conversation for each Pou
- review and confirmation
- risks and actions
- referrals
- synthesis
- record/review
- completion

### Supervisor

A supervisory view that includes concepts such as:

- team or worker overview
- matrix views
- case/session review
- visibility of risks, actions, and progress
- review of individual sessions

The current codebase is a prototype. Much of the data and behaviour is simulated and is progressively being replaced with real application functionality.

---

## 4. Long-term relationship with CareFlow

Te Kaupapa is being developed independently during design, prototyping, and early testing.

The longer-term intention is for Te Kaupapa to become a workflow or capability within the broader CareFlow platform.

No CareFlow code or infrastructure dependency should be introduced solely for this future possibility.

However, Te Kaupapa should be designed so that eventual integration does not require a complete rewrite.

Architecture should therefore favour:

- modular domain logic
- explicit APIs
- versioned event contracts
- portable data concepts
- separation of UI and business rules
- provider adapters
- opaque internal identifiers
- minimal global assumptions about organisation or tenancy

Future integration may involve embedding the Te Kaupapa interface, exposing its domain services to CareFlow, migrating its modules into CareFlow, or another architecture that has not yet been determined.

Te Kaupapa should not prematurely build a generalized CareFlow workflow engine.

---

## 5. Core design principles

### 5.1 Frontline first

The kaimahi experience is the primary design constraint.

The application should be easy to use in real-world field conditions rather than optimised only for desktop environments.

### 5.2 Mobile and low-resource by design

Te Kaupapa will often be used on a mobile phone.

Some devices may be older, lower powered, or working on inconsistent mobile connections.

The application should:

- keep the browser client lightweight
- minimize memory growth
- minimise network payloads
- avoid unnecessary eager code loading
- avoid expensive client-side processing
- release microphone, audio, socket, and media resources promptly
- remain recoverable after temporary network loss
- avoid requiring a complete workflow or conversation to remain in browser memory

### 5.3 Backend-authoritative application state

The browser is an interaction client.

The backend is the authoritative source of persisted application state.

The browser should not need its complete previous in-memory state in order to resume acknowledged work.

### 5.4 Persist meaningful work progressively

The workflow should not wait until the very end before saving.

Meaningful completed interactions or posts should be persisted independently.

The application should persist user intent and completed workflow steps rather than every keystroke.

### 5.5 Conversational AI is a separate layer

The application should not recreate the conversational intelligence that is configured in ElevenLabs.

The ElevenLabs conversational layer and the Te Kaupapa workflow layer should remain conceptually distinct.

### 5.6 AI signals are not autonomous safety decisions

AI can observe, extract, classify, or flag.

Application consequences should be determined by explicit rules, approved workflows, and where necessary human judgement.

### 5.7 Data minimisation with useful traceability

Retain the information required to support continuity, supervision, action, safety, audit, and learning.

Do not retain information merely because it was technically available.

---

## 6. Conversational AI architecture

Te Kaupapa will use ElevenLabs Conversational AI.

The conversational agent will be configured in the ElevenLabs environment.

The primary agent prompt will also be maintained in ElevenLabs.

The underlying conversational LLM is selected and configured inside the versioned ElevenLabs agent. Te Kaupapa does not depend directly on, select, or persist the runtime LLM. A staging agent may use Gemini 3.5 Flash as operational context without making Gemini an application dependency.

### ElevenLabs is responsible for

- conversational interaction
- voice input and output
- conversational agent behaviour
- the primary conversational prompt
- selection and orchestration of the underlying LLM
- conversational analysis configured in the provider

### Te Kaupapa is responsible for

- workflow state
- persistent application data
- authenticated user and session context
- permissions
- structured conversation-derived events
- deterministic safety and business rules
- actions
- referrals
- escalations
- acknowledgements
- audit
- supervisor review

The Te Kaupapa frontend should not independently analyse raw transcript text to determine contraindications, risks, or workflow consequences.

### Provider authorization and lifecycle

Voice sessions must begin only after Te Kaupapa has authenticated and authorized the Kaimahi, workflow, organisation, and authoritative Pou. The backend selects the provider agent configuration and issues only temporary provider authorization to the browser. Provider API keys, signed material, raw transcript, audio, and raw provider payloads must not be persisted or logged.

Conversation provenance may associate an internal conversation ID, workflow, Pou, actor, provider reference, selected non-secret agent configuration reference, and approved conversation-specification version. This provenance does not make provider output canonical. It must not advance a workflow, create a safety observation, action, referral, summary, or deterministic consequence without the separately approved validation and human-confirmation path.

Live caption display, where enabled, is ephemeral and bounded. It is released with media resources on normal end, error, navigation, unmount, logout, and session expiry. Transcript and audio retention remain separate product/privacy decisions.

---

## 7. Conversation lifecycle

A typical conversational interaction should follow this broad pattern:

1. A kaimahi enters a defined Te Kaupapa workflow stage.
2. The required application/session context already exists on the backend.
3. The application securely establishes an ElevenLabs conversation.
4. The kaimahi and conversational agent interact.
5. The conversation may produce structured findings during or after the interaction.
6. Relevant structured findings are delivered to the Te Kaupapa backend.
7. The backend validates and associates those findings with the correct workflow/session.
8. Deterministic application rules determine any application consequences.
9. The resulting state is persisted.
10. The client receives only the information required to render the current or next state.
11. The conversation is summarized for the workflow record.
12. Where permitted, the underlying transcript may remain available for controlled review.

---

## 8. Structured conversation-derived events

Important information discovered during a conversation should be communicated to the Te Kaupapa backend through a structured, versioned event boundary rather than by asking the React client to interpret the transcript.

Possible event categories include:

- contraindication identified
- potential escalation
- immediate safety concern
- emerging risk
- referral requirement
- follow-up requirement
- action identified
- barrier identified
- important need identified
- workflow decision
- Pou/stage completion
- confirmation or retraction of a previous finding

A future normalized event may contain concepts such as:

- schema version
- source
- provider event reference
- event type
- workflow session ID
- interaction ID
- conversation ID
- category
- severity, where relevant
- timestamp
- structured attributes
- processing status
- rule version

The exact event schema will evolve as the product rules become clearer.

AI-proposed required actions should not automatically become canonical application actions.

The Te Kaupapa rules layer decides the application consequence.

---

## 9. Safety, contraindication, and escalation model

Safety-related functionality should be separated into three layers.

### Layer 1 — Observation

An observation may originate from:

- a direct user selection
- a structured answer
- a conversation-derived AI signal
- a post-conversation analysis
- a supervisor or kaimahi update

### Layer 2 — Validation

The system determines:

- whether the source is authentic
- whether the payload is valid
- which session it belongs to
- whether it is a duplicate
- whether human confirmation is required

### Layer 3 — Deterministic consequence

Approved application rules may result in:

- a visible alert
- an acknowledgement requirement
- an action
- a referral
- a supervisor review requirement
- a notification
- a workflow block
- a workflow state change
- another explicitly approved consequence

The AI should not invent the clinical, safety, or organisational policy governing these consequences.

The following remain explicit product/safety decisions:

- categories
- severity definitions
- required actions
- blocking behaviour
- notification recipients
- expected response time
- human review requirements
- emergency/crisis wording
- retraction and false-positive handling

---

## 10. Transcript, summary, and conversation record

### 10.1 Product direction

The AI-generated summary should remain the primary working representation of a completed conversation within the Te Kaupapa workflow.

However, it may also be valuable for the full transcript of an individual conversation to remain available for controlled supervisory review.

This is now a design direction to support, subject to privacy, consent, retention, and provider configuration decisions.

### 10.2 Intended distinction

The application should distinguish between:

**Structured workflow record**
- confirmed Pou state
- actions
- referrals
- risks
- alerts
- acknowledgements
- approved summary
- workflow status

**Conversation transcript**
- supporting source material
- not itself the canonical workflow state
- not automatically loaded into every session response
- not used by the frontend as the rules engine

### 10.3 Supervisor transcript review

A future supervisor experience may provide:

- an AI-generated conversation summary by default
- an explicit option to open the full transcript
- clear identification of which conversation/Pou the transcript relates to
- timestamps or speaker turns where available
- access only for supervisors authorized to review that worker/session
- an audit record when sensitive transcript material is accessed, if required

The transcript should be fetched on demand rather than included in standard supervisor dashboard payloads.

This protects mobile/browser performance and reduces unnecessary exposure.

### 10.4 Kaimahi transcript access

Whether the kaimahi should be able to reopen the complete transcript is not yet decided.

Possible models include:

- full kaimahi and supervisor access
- supervisor-only full transcript access
- kaimahi access only during a limited review period
- transcript accessible only when an escalation or quality review requires it

This should be decided before the transcript feature is implemented.

### 10.5 Transcript retention

Full transcript retention must be treated separately from summary and workflow retention.

Before implementation, define:

- whether transcripts are retained at all
- whether retention is opt-in, default, or organisation-configurable
- retention duration
- whether particular conversation categories require different retention
- whether transcripts may contain identifiable whānau information
- whether users must be informed that transcription is occurring
- deletion behaviour
- export behaviour
- whether transcripts are required for formal audit
- whether supervisors can download/export transcripts
- whether transcripts should be redacted or minimised before storage

### 10.6 Technical principles for transcripts

If Te Kaupapa retains transcripts:

- store them server-side, not as long-lived browser state
- do not place transcripts in operational logs
- do not place transcript text in URLs
- do not include the full transcript in normal session read models
- retrieve it only when explicitly requested by an authorized user
- apply strict server-side authorization
- keep transcript access auditable where appropriate
- define deletion/retention independently of the main workflow record
- do not retain audio automatically merely because transcript retention is enabled

Initially, a PostgreSQL-backed transcript record may be sufficient if conversation sizes and pilot volumes remain modest.

If transcript size, scale, cost, or lifecycle requirements later justify it, transcript content can be moved behind a dedicated storage adapter without changing the workflow domain model.

### 10.7 Transcript provenance

Any retained transcript should remain associated with:

- provider conversation reference
- workflow session
- relevant Pou/stage or interaction
- creation/completion timestamp
- transcript status
- summary version
- retention/deletion status

This makes clear which source conversation produced a summary or structured finding.

---

## 11. Data and persistence model

The backend should remain the authoritative state.

Likely domain concepts include:

### User and access

- user
- role assignment
- optional team/supervision relationship
- organisation/workspace if later required

### Whānau and workflow

- whānau/case reference
- workflow session
- individual interaction/post
- Pou assessment
- action
- referral
- acknowledgement
- workflow alert

### Conversation

- conversation reference
- conversation summary
- optional retained transcript
- structured conversation event

### Reliability and audit

- integration inbox
- integration outbox
- audit event

The final model should remain as small as possible while still supporting the actual workflow.

---

## 12. Interaction/post persistence

Each meaningful user operation should have a clear persistence boundary.

Conceptual lifecycle:

1. User completes a meaningful operation.
2. Client generates a unique idempotency key.
3. The minimum required command is sent to the API.
4. The backend authenticates and authorizes the user.
5. The backend validates the command and expected workflow state.
6. Canonical state is updated transactionally.
7. The operation is recorded once.
8. The backend returns acknowledgement and the minimum next-state data.
9. The frontend marks the operation as saved only after acknowledgement.

A retry of the same operation must not create duplicate records or notifications.

---

## 13. Intermittent connectivity

Te Kaupapa must behave predictably when network connectivity is poor.

The UI should distinguish between:

- draft
- saving
- saved
- waiting to save
- retrying
- failed
- stale/conflicted

A small temporary queue may eventually preserve unacknowledged operations across refresh or restart.

This should not become a broad offline-first application.

Only the minimum command payload required for retry should be stored.

The exact content and retention period of client-side pending data requires a privacy decision before implementation.

Once the backend acknowledges the operation, temporary pending data should be removed.

---

## 14. Frontend responsibilities

The frontend should:

- render the approved experience
- capture local input for the active stage
- establish and close the voice connection
- submit small commands
- display persistence state truthfully
- retrieve authoritative workflow state
- display structured risks/actions/referrals
- display a bounded live transcript/caption experience if required
- retrieve a full stored transcript only when explicitly requested and authorized
- release media and memory resources promptly
- lazy-load role and voice-specific functionality

The frontend should not:

- hold authoritative business state
- contain API/provider secrets
- determine safety consequences
- infer contraindications by analysing raw transcripts
- retain complete transcripts in memory across the application unnecessarily
- assume an operation succeeded without backend acknowledgement

---

## 15. Backend responsibilities

The backend should own:

- authenticated sessions
- authorization
- workflow/session state
- runtime validation
- interaction/post persistence
- idempotency
- stale-state/concurrency handling
- deterministic workflow rules
- deterministic safety rules
- ElevenLabs secure access mediation
- structured conversation-event ingestion
- event validation and deduplication
- conversation metadata
- approved summaries
- transcript storage/retrieval if enabled
- actions
- referrals
- alerts
- acknowledgements
- audit
- integration delivery/retry
- privacy-safe operational logging

---

## 16. Authentication and authorization

Role selection in the prototype is not authentication.

Future authentication should answer:

> Who is this person?

Authorization should answer:

> What are they permitted to access or do?

All protected access must be enforced server-side.

Likely initial roles are:

- kaimahi
- supervisor

A supervisor should see only data within their approved scope.

Transcript access should be treated as a distinct sensitive permission even if the first pilot maps it directly to the supervisor role.

The following remain product decisions:

- identity provider
- single vs multi-organisation model
- team structure
- supervision relationships
- dual-role users
- transcript access policy

---

## 17. Security and privacy boundaries

Primary trust boundaries are:

- browser/mobile client
- Te Kaupapa backend
- database/storage
- ElevenLabs
- OpenAI through ElevenLabs
- identity provider
- hosting/logging infrastructure

The browser is not a trusted secret store.

Private credentials must never be shipped in client code.

Apply:

- least privilege
- server-side authorization
- HTTPS
- secure secret management
- data minimisation
- explicit retention
- privacy-safe logging
- provider webhook/event verification
- controlled transcript access

Conversation content should not leak into analytics, generic error tracking, URLs, or infrastructure logs.

---

## 18. Logging and audit

Operational logging should support system reliability without unnecessarily exposing sensitive content.

Operational logs may include:

- request/correlation ID
- endpoint
- status
- duration
- provider reference
- retry count
- error category

Business audit may include:

- actor
- role
- workflow/session
- action or transition
- resulting state/version
- event/action reference
- rule version
- acknowledgement
- timestamp

Raw transcript and audio should not be placed into ordinary application logs.

If transcript review is enabled, access to a transcript may itself become an auditable event.

---

## 19. Supervisor experience direction

The supervisor application should evolve from a prototype dashboard into a real supervisory workflow.

Likely future capabilities include:

- view team/kaimahi activity
- identify open or overdue actions
- view risks and escalation states
- review individual sessions
- inspect AI-generated summaries
- open the underlying full transcript where permitted
- see which Pou or stage generated a concern
- acknowledge or resolve assigned review tasks
- add supervisor review outcomes
- monitor follow-through
- identify recurring themes across work

The supervisor interface should remain an application for review and support rather than a raw data dump.

Transcript review should be contextual and deliberate.

---

## 20. Kaimahi experience direction

The kaimahi application should progressively replace simulated prototype behaviour with real state while preserving the approved interaction design.

The worker should be able to:

- start or resume a session
- work through the required Pou
- engage with the conversational agent
- review and confirm key outputs
- identify or respond to risks
- create/confirm actions
- prepare referrals
- review the final synthesis
- complete the session
- return later to acknowledged work

The application should minimise re-entry and unnecessary administrative work.

---

## 21. Summary and synthesis

AI may assist in producing:

- conversation summaries
- Pou summaries
- session synthesis
- proposed action descriptions
- structured extraction

Generated material should be clearly distinguishable from user-confirmed application state where that distinction matters.

The design should support future provenance such as:

- generated by conversation X
- reviewed by user Y
- edited at time Z
- confirmed as final

A retained transcript, where enabled, provides supporting source material but should not make every AI output automatically authoritative.

---

## 22. Mobile performance expectations

The application should remain usable on lower-powered devices.

Engineering should monitor:

- initial JavaScript size
- role-specific lazy loading
- voice integration bundle cost
- main-thread work
- rerenders
- memory growth
- live caption/transcript growth
- media cleanup
- request payload size
- reconnect behaviour

Full transcripts should not be preloaded into mobile workflows.

If a transcript is opened, only that transcript should be fetched and rendered, ideally using bounded/virtualised rendering if transcript sizes later require it.

### 22.1 Mobile and poor-network performance acceptance

For every milestone that materially changes frontend bundles, network requests, workflow response shapes, retries, or media use:

1. record the production bundle baseline, including role-specific chunks;
2. record representative request counts and payload sizes for affected user paths;
3. distinguish measured results from estimates clearly;
4. test constrained and poor-network behaviour appropriate to the change;
5. confirm acknowledged server-authoritative work can be recovered after refresh;
6. confirm pending or unacknowledged work is handled truthfully; and
7. verify media, socket, transcript, and temporary-buffer cleanup where applicable.

This is an engineering acceptance requirement. It does not make provisional numeric budgets permanent product requirements, and it does not authorize broad offline storage or retention of transcripts, audio, secrets, or sensitive workflow data in the browser.

---

## 23. Deployment direction

The preferred conceptual deployment shape is:

- static frontend/CDN
- one TypeScript API/backend
- managed PostgreSQL
- optional worker process from the same backend codebase
- secure webhook/event endpoints
- managed secrets
- separate staging and production environments

Staging and production should ultimately have separate:

- databases
- credentials
- ElevenLabs agents/configuration where appropriate
- callback/webhook settings
- signing secrets

The current Figma deployment mechanism is suitable for prototype previewing but is not the final production architecture.

---

## 24. Testing direction

Testing should protect real user behaviour rather than implementation details.

Important future test areas include:

- approved UI regression
- Kaimahi workflow
- Supervisor workflow
- authentication
- authorization
- persistence
- idempotency
- stale-state handling
- offline/retry behaviour
- safety rule matrices
- structured conversation events
- ElevenLabs integration
- transcript authorization
- transcript deletion/retention behaviour
- summary/transcript provenance
- mobile performance
- media teardown
- backup/recovery

Use synthetic and sanitized test fixtures.

---

## 25. Roadmap

### Milestone 0 — Baseline hardening

- protect the approved UI with tests
- refactor large generated files safely
- lazy-load role-specific code
- standardize npm
- fix Vite configuration warnings
- establish maintainable project structure

### Milestone 1 — Authenticated application shell

- authentication
- roles
- authorized application entry
- server-provided user/profile state

### Milestone 2 — Reliable workflow persistence

- backend/database
- session creation
- independent interaction persistence
- retry/idempotency
- refresh/resume
- minimal pending-operation handling

### Milestone 3 — End-to-end workflow slice

- real Pou state
- actions
- referrals
- record completion
- extend pattern across all Pou

### Milestone 4 — Deterministic safety workflow

- approved safety categories
- structured safety events
- deterministic consequences
- supervisor review/acknowledgement

### Milestone 5 — ElevenLabs integration

- secure conversation startup
- voice lifecycle
- in-conversation structured events
- post-conversation reconciliation
- summaries
- transcript capture/availability design if approved

### Milestone 6 — Synthesis, record, supervisor workflow

- real synthesis
- approved record
- delivery
- supervisor server data
- transcript review where enabled
- auditable review

### Milestone 7 — Pilot hardening

- mobile performance
- accessibility
- privacy/security review
- provider retention verification
- monitoring
- backup/recovery
- operational readiness

---

## 26. Explicit non-goals for the current build

Unless requirements later justify them, Te Kaupapa should not become:

- a microservice architecture
- a generalized event-sourcing platform
- a full offline-first PWA
- a client-side AI application
- a transcript analytics platform
- a duplicate copy of the ElevenLabs agent prompt
- a generalized workflow engine for all CareFlow modules
- a system that stores conversation data without a defined purpose

---

## 27. Key product decisions still to be made

### Identity and access

- identity provider
- pilot users
- team/supervisor assignments
- multi-organisation requirements
- dual-role behaviour

### Workflow

- exact meaning of each independently persisted post
- acknowledgement requirements
- workflow block/override semantics
- authoritative summary/record fields

### Safety

- contraindication categories
- risk categories
- severity levels
- deterministic actions
- notification recipients
- human review requirements
- emergency wording
- response expectations

### Conversation/transcript

- whether full transcripts are retained by default
- who can access them
- whether kaimahi can access them
- transcript retention period
- transcript deletion rules
- consent/information requirements
- transcript export/download
- transcript audit requirements
- whether raw transcript is ever required as formal evidence
- whether audio is ever retained
- provider-side retention configuration

### Offline/pending data

- what unacknowledged data may remain on the device
- retention/expiry period
- behaviour on logout
- lost/shared-device assumptions

### Supervisor

- required mobile support
- review responsibilities
- escalation workflow
- transcript review behaviour
- action ownership

### Deployment and operations

- hosting region
- environment model
- backup/recovery targets
- support/monitoring
- formal privacy/security review

---

## 28. Architectural decision rule

When a future implementation choice is unclear, prefer the option that:

1. protects the approved user experience
2. keeps the mobile client lightweight
3. keeps authoritative state server-side
4. minimizes sensitive data exposure
5. supports reliable retry and recovery
6. keeps AI and deterministic business rules separate
7. maintains a clean future CareFlow integration boundary
8. is simpler to test and operate
9. avoids adding infrastructure before it is needed

---

## 29. Living-document expectation

This blueprint should evolve as major product and architectural decisions are approved.

Update it when decisions change the intended system, including:

- transcript policy
- safety rules
- identity/tenancy model
- database/domain model
- ElevenLabs integration contract
- CareFlow integration direction
- deployment architecture

Do not use this document as a substitute for detailed implementation specifications or migration plans.

It is the durable statement of product and architectural intent.
