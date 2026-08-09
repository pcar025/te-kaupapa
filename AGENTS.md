# Te Kaupapa — Repository Instructions

## Purpose

Te Kaupapa is currently being developed as a standalone application and repository.

It may ultimately become a workflow or capability within CareFlow, but it must remain independent during development and testing.

Do not access, import from, modify, or create dependencies on the CareFlow repository unless explicitly instructed.

Make architectural choices that preserve a clean future integration boundary without over-engineering for an integration that has not yet been defined.

---

## Approved UI baseline

The existing Figma-generated Te Kaupapa UI is the approved visual and interaction baseline.

Do not redesign, restyle, simplify, replace, or materially alter the approved UI unless explicitly instructed.

Preserve:

- visual hierarchy
- colours
- typography
- spacing
- navigation
- page structure
- interaction patterns
- Te Kaupapa / Te Waharoa terminology
- Kaimahi workflow
- Supervisor workflow
- mobile interaction intent

Engineering changes should wrap the existing UI in better architecture rather than redesigning it.

Structural refactoring is allowed when it does not alter the rendered UI or intended behaviour.

If an engineering requirement appears to require a visible UI change, stop and identify the proposed change and reason before implementing it.

Do not silently change product wording, workflow behaviour, safety messaging, or user-facing claims.

The approved UI baseline is preserved in Git and tagged:

`ui-baseline-2026-08-09`

Use that baseline when checking for unintended visual or behavioural change.

---

## Git and branch discipline

`main` represents the stable/releasable application.

`staging` represents the integrated testing version.

Do not perform feature or milestone development directly on `main`.

Do not perform substantial implementation directly on `staging`.

For implementation work:

1. Confirm the working tree is clean.
2. Branch from `staging`.
3. Use a clearly named milestone or feature branch.
4. Implement and test the scoped change there.
5. Do not merge into `staging` or `main` unless explicitly instructed.

Keep milestones small enough to review, test, and revert independently.

Never overwrite or delete the approved UI baseline tag.

---

## Package manager

Use npm as the canonical package manager for Te Kaupapa.

`package-lock.json` is the canonical dependency lockfile.

Do not require pnpm for normal development.

Do not install or introduce pnpm unless there is a demonstrated technical requirement and approval has been given.

If existing Figma-generated tooling assumes pnpm, prefer adapting the relevant development command to npm where this can be done safely.

Do not retain multiple competing lockfiles.

Before adding a dependency:

- check whether the repository already provides the capability
- consider native browser or React functionality
- consider bundle size if client-side
- consider maintenance and security cost

Do not add runtime dependencies merely for convenience.

---

## Architecture principle

The mobile/browser client must remain lightweight.

The backend is the authoritative application state and policy boundary.

The browser should primarily:

- render the UI
- capture current interaction
- connect to the conversational experience
- submit small meaningful operations
- receive authoritative state
- display the next required state

Do not make the browser responsible for:

- authoritative workflow state
- long-term persistence
- large growing session state
- LLM inference
- expensive AI analysis
- transcript safety classification
- deterministic safety decisions
- application secrets
- unnecessary transcript or audio retention

Prefer server-side processing and persistence where practical.

---

## Mobile and field-use requirements

Te Kaupapa will frequently be used on mobile phones by frontline workers in field environments.

Assume:

- lower-powered devices may be used
- mobile connectivity may be intermittent
- connections may drop during submission
- battery and device resources matter
- refreshes or restarts can occur during workflows

Avoid architecture that requires the phone to retain the complete workflow or conversation in memory.

Keep network payloads small.

Avoid unnecessary rerenders and large eager JavaScript bundles.

Lazy-load functionality that is not required for the current user or workflow, particularly role-specific and voice-integration code.

Always clean up:

- microphone tracks
- audio contexts
- WebSockets/WebRTC connections
- timers
- event listeners
- temporary media buffers

when they are no longer required.

---

## Interaction and persistence model

Te Kaupapa uses discrete meaningful interactions/posts.

Persist meaningful user intent or completed workflow operations rather than every keystroke.

Each meaningful operation should eventually be independently persistable.

The intended model is:

1. Client captures a meaningful operation.
2. Client sends the minimum required payload.
3. Backend authenticates and authorizes the request.
4. Backend validates the operation.
5. Backend persists required canonical state transactionally.
6. Backend acknowledges successful persistence.
7. Client receives the minimum authoritative state required to continue.
8. Client releases information it no longer needs.

Do not report an operation as saved until the authoritative backend has acknowledged it.

Design write operations to support safe retry and idempotency.

The browser must not need its previous complete in-memory state in order to resume an acknowledged workflow.

---

## Offline and pending data

Do not introduce broad offline storage or a full offline-first/PWA architecture without explicit approval.

A minimal queue for unacknowledged operations may be introduced when approved.

If client-side pending persistence is used:

- store only the minimum information required to retry
- never store API secrets or authentication tokens there
- distinguish clearly between acknowledged and unacknowledged work
- delete pending data after authoritative acknowledgement
- define expiry behaviour
- re-authenticate before replaying after session expiry
- assess privacy implications before storing sensitive payloads across browser restart

Do not use `localStorage` for authentication tokens or sensitive workflow state.

The exact permitted payload and retention period for temporary offline storage is a product/privacy decision and must not be invented.

---

## Conversational AI boundary

ElevenLabs provides the conversational AI experience.

The conversational agent and its primary conversational/system prompt are configured and maintained inside ElevenLabs.

OpenAI is the LLM used by the ElevenLabs conversational agent.

Do not duplicate or recreate the main conversational prompt inside Te Kaupapa.

ElevenLabs owns:

- conversational agent behaviour
- voice interaction
- primary conversational prompt
- conversational orchestration
- interaction with the underlying OpenAI LLM

Te Kaupapa owns:

- application workflow
- persistent application state
- users and permissions
- business rules
- safety-related application behaviour
- structured application events
- actions
- referrals
- escalations
- auditability
- database state

Keep this boundary explicit.

Any direct OpenAI integration added to Te Kaupapa in the future must have a separate approved purpose and must be server-side.

---

## Conversation-derived events

Te Kaupapa must be able to respond to important information discovered during an ElevenLabs conversation.

Examples include:

- contraindications
- escalations
- safety or risk concerns
- referral requirements
- actions
- required follow-up
- workflow decisions
- completion states

Prefer structured, versioned events from the conversational layer rather than having the React frontend interpret free-form transcript text.

Do not implement transcript classification in the frontend.

Inbound conversation-derived data is untrusted input and must be:

- authenticated where possible
- schema validated
- associated with the correct workflow/session
- deduplicated
- normalized
- processed by application rules

Malformed, unknown, or unsupported events must not silently trigger application consequences.

---

## Safety architecture

AI output is an observation or candidate signal, not an autonomous safety decision.

Keep three layers separate:

1. Observation or candidate finding.
2. Validation and association with application state.
3. Deterministic application consequence.

Safety-related application consequences must be implemented using explicit, testable, versioned backend rules.

Examples of potential consequences may include alerts, acknowledgements, workflow blocks, referrals, supervisor review, or required actions.

Do not invent the rules that determine those consequences.

Do not invent:

- safety categories
- severity levels
- contraindication definitions
- emergency wording
- escalation recipients
- notification timeframes
- workflow blocking rules
- human-review requirements

These are product/privacy/safety decisions requiring explicit approval.

Where a rule exists, make it deterministic and testable.

---

## Data minimisation

Do not assume Te Kaupapa needs to retain conversational data simply because ElevenLabs processes it.

Retain only information with an approved purpose supporting:

- workflow continuity
- actions
- referrals
- alerts
- approved summaries
- supervision
- audit
- reporting
- approved transcript review

Treat the following as separate data classes with separate retention decisions:

- raw audio
- full transcript
- conversation summary
- structured conversation-derived events
- workflow/application data
- audit data

Do not assume raw audio needs to be retained merely because a transcript or summary is retained.

Do not assume full transcript retention is either prohibited or automatically enabled.

The architecture must support optional, controlled transcript retention and retrieval according to the approved product/privacy policy.

Do not include raw transcript, audio, secrets, or unnecessary conversational content in operational logs.

Do not place transcript or audio content in URLs, analytics events, generic error telemetry, or client-side diagnostic logging.

Provider-side retention settings, including ElevenLabs retention, are external configuration decisions and must be verified rather than assumed.

Where structured application state is sufficient for normal workflow operation, prefer using that structured state rather than repeatedly transferring or loading the underlying transcript.

---
## Transcript and conversation record

The AI-generated summary should normally be the primary working representation of a completed conversation within the Te Kaupapa workflow.

However, Te Kaupapa must be architected to support retaining and recalling the full transcript of an individual conversation where this is approved.

A likely use case is controlled supervisor review of the underlying conversation when the summary, structured findings, risks, actions, or escalation state require additional context.

Transcript retention is a product/privacy capability, not yet an automatic requirement.

Do not design the application in a way that makes future controlled transcript recall unnecessarily difficult.

### Transcript is supporting source material

A retained transcript is supporting source material.

It is not automatically the canonical workflow state.

Canonical application state should continue to be represented through structured records such as:

- Pou status
- workflow state
- confirmed findings
- actions
- referrals
- alerts
- acknowledgements
- approved summaries
- supervisor review outcomes

Do not make application business rules depend on repeatedly parsing a stored transcript.

### Transcript storage

If transcript retention is implemented:

- store transcripts server-side
- do not retain complete historical transcripts as long-lived browser state
- do not include transcripts in ordinary workflow/session API responses
- do not include transcripts in normal supervisor dashboard payloads
- retrieve a transcript only when an authorized user explicitly requests it
- protect retrieval through server-side authorization
- keep transcript content out of operational logs
- do not place transcript content in URLs
- define transcript retention and deletion independently from ordinary workflow records
- retaining a transcript must not automatically imply retaining the audio recording

Transcript storage should remain behind a clear application/storage boundary so the storage implementation can evolve without changing the workflow domain model.

For early pilot volumes, storing transcript records through the normal backend/database architecture may be appropriate.

Do not introduce specialist transcript/object-storage infrastructure until scale, lifecycle, cost, security, or retention requirements demonstrate a need.

### Transcript association and provenance

A retained transcript should remain associated with the relevant:

- workflow session
- interaction or Pou/stage
- ElevenLabs conversation reference
- conversation completion time
- transcript status/version where relevant
- generated summary or summary version
- retention/deletion state

This association should make it possible to determine which source conversation produced a summary or structured finding.

### Supervisor transcript access

The intended future supervisor pattern is:

1. Show the AI-generated summary and structured application state by default.
2. Show risks, actions, referrals, alerts, and other relevant outcomes.
3. Provide an explicit action to open the underlying transcript where the supervisor has permission.
4. Retrieve the transcript on demand.
5. Release transcript data from the client when it is no longer required.

Supervisor transcript access must be limited to sessions within the supervisor's authorized scope.

Transcript access should be treated as sensitive access and may require its own audit event.

Do not assume that general supervisor access automatically grants transcript access if future product/privacy rules define a narrower permission.

### Kaimahi transcript access

Whether kaimahi can reopen historical full transcripts has not yet been decided.

Do not assume either access or prohibition.

Possible future policies could include:

- kaimahi and supervisor access
- supervisor-only access
- time-limited kaimahi review
- transcript access only for quality, escalation, or review purposes

Treat this as a product/privacy decision.

### Mobile performance

A complete transcript must not be automatically downloaded merely because a workflow/session is opened.

On mobile devices:

- fetch transcripts only when requested
- fetch only the requested conversation
- avoid keeping multiple transcripts resident in memory
- release transcript state when leaving the review experience
- consider pagination, chunking, or virtualized rendering only if real transcript size demonstrates a need

The normal kaimahi workflow must remain usable without loading historical transcripts.

### Decisions required before transcript retention is implemented

Before implementing production transcript storage, explicitly determine:

- whether transcripts are retained by default
- which conversations are eligible for retention
- who may access them
- whether kaimahi may access them
- whether transcript access is audited
- retention period
- deletion behaviour
- consent/information requirements
- export/download permissions
- whether transcript content is considered formal evidence
- whether transcripts require redaction or minimisation
- whether audio is retained separately
- ElevenLabs transcript/audio retention configuration
- any organisation-specific transcript retention policy

Do not silently make these decisions during implementation.

## Secrets and security boundaries

Never place private API keys or confidential credentials in browser-delivered code.

The browser must not contain:

- ElevenLabs private API keys
- OpenAI API keys
- database credentials
- confidential OAuth/OIDC client secrets
- webhook signing secrets
- email-provider credentials
- infrastructure credentials

Private credentials belong on trusted server infrastructure or in an approved secret store.

Treat the browser as an untrusted/public environment.

Perform authorization server-side for every protected query and mutation.

Hidden controls or client-side role checks are not authorization.

Use least privilege and data minimisation.

Do not log secrets.

---

## Backend architecture

Prefer one TypeScript modular-monolith backend unless requirements demonstrate a genuine need for additional services.

Do not introduce microservices, Kafka, GraphQL, event sourcing, or a generalized workflow engine without explicit architectural justification and approval.

Keep domain/business logic independent from:

- React
- HTTP transport
- database implementation details
- ElevenLabs-specific implementation details

Use clear adapters at external-system boundaries.

The backend should eventually own:

- authentication session handling
- authorization
- runtime request validation
- workflow state
- persistence
- idempotency
- concurrency control
- deterministic business rules
- integration handling
- structured conversational events
- audit
- operational error handling

---

## Database architecture

PostgreSQL is the current recommended authoritative database unless subsequently changed by an approved architectural decision.

Prefer explicit relational columns for:

- identifiers
- relationships
- authorization
- workflow status
- timestamps
- canonical state

Versioned JSON may be used for genuinely variable event attributes, but do not turn unvalidated JSON into the main domain model.

Keep canonical application data separate from:

- temporary integration processing
- provider conversational data
- operational logs
- audit records

Use migrations for schema changes.

---

## Authentication and authorization

Do not confuse role selection in the existing UI with authentication.

Authentication answers who the user is.

Authorization answers what that authenticated user may access or change.

Server-side authorization must protect all protected resources.

Do not choose an identity provider, tenancy model, organization structure, or final role model without explicit approval.

Do not store bearer/access tokens in `localStorage`.

---

## Reliability

Do not fabricate success.

A database or backend failure must not result in the UI claiming information was saved.

Design state-changing requests to support:

- idempotency
- timeout
- retry
- duplicate detection
- stale-state detection
- safe recovery

External side effects such as notifications should not be performed in a way that can create duplicate or inconsistent canonical state.

Prefer transactional persistence plus reliable asynchronous delivery where appropriate.

---

## Logging and audit

Operational logs and business audit records are different.

Operational logs should focus on:

- request/correlation IDs
- route
- status
- duration
- error class
- provider identifiers
- retry/queue information

Business audit records may include:

- actor
- role
- workflow/session
- affected entity
- transition or operation
- resulting state/version
- relevant event/action IDs
- rule version
- acknowledgement/review outcome
- timestamp

Do not log full raw conversations merely for debugging.

---

## Testing and validation

Protect the approved UI before substantial structural refactoring.

When refactoring existing Figma-generated code:

1. Establish a working baseline.
2. Add proportionate smoke/regression protection first.
3. Make changes incrementally.
4. Re-run tests after each meaningful extraction.
5. Compare behaviour and rendering with the approved baseline.

Avoid large rewrites when small extractions can achieve the same result.

For relevant changes, validate:

- TypeScript
- production build
- tests
- user-visible workflow
- mobile viewport behaviour
- bundle impact
- authorization where applicable
- retry/idempotency where applicable
- safety rule behaviour where applicable

Use sanitized/synthetic test data only.

Do not add elaborate test infrastructure where a simpler test provides adequate protection.

---

## Figma-generated code

The current Figma-generated code is a starting implementation, not a reason to preserve poor internal structure indefinitely.

It is acceptable to:

- split large components
- extract clearly bounded workflow stages
- consolidate exact duplicate metadata
- lazy-load role-specific application code
- remove genuinely unused code
- fix build/configuration warnings
- improve maintainability

provided the approved rendered UI and intended behaviour remain unchanged.

Do not perform aggressive abstraction merely to make the generated code look cleaner.

Prefer clear feature/stage boundaries over generic abstractions.

---

## User-facing truthfulness

Some prototype screens may currently simulate:

- saved state
- sent state
- supervisor notification
- security/storage behaviour
- AI behaviour
- referrals
- record delivery

Do not treat simulated prototype behaviour as implemented functionality.

When replacing simulated behaviour with real application behaviour, ensure the UI only claims an operation succeeded after the real system has acknowledged success.

Do not alter existing prototype wording outside the scope of an approved milestone unless instructed.

---

## Accessibility

Do not reduce accessibility while preserving the visual design.

New or refactored components should use appropriate semantic HTML, keyboard behaviour, labels, focus handling, status announcements, and reduced-motion support where these can be introduced without unauthorized redesign.

Do not use visual appearance alone as a reason to remove semantic accessibility.

---

## Future CareFlow integration

Do not integrate with CareFlow now.

To reduce future migration difficulty:

- keep domain rules framework-independent
- keep external providers behind adapters
- use versioned API/event contracts
- separate UI presentation from workflow/business logic
- avoid global assumptions about user, team, or organization
- use explicit external-reference fields when needed
- keep Te Kaupapa identifiers opaque
- maintain clear module boundaries

Do not create a generalized CareFlow abstraction before the actual integration requirements are known.

---

## Decision discipline

Distinguish between:

A. Existing repository fact.
B. Engineering recommendation.
C. Product/privacy/safety decision requiring approval.
D. External integration behaviour requiring verification.

Do not silently turn C or D items into assumptions.

When an unresolved decision blocks safe implementation, stop and state the decision required.

---

## Milestone discipline

Work on one approved milestone at a time.

Do not implement future milestones opportunistically.

Do not add authentication, backend infrastructure, database infrastructure, ElevenLabs integration, OpenAI integration, safety behaviour, notifications, or deployment infrastructure unless they are within the explicitly approved milestone.

At the end of each milestone:

- run the relevant validation
- report files changed
- report dependencies added/removed
- report test/build results
- report bundle impact when frontend code changed materially
- identify unresolved issues
- stop for review

Do not merge into `staging` or `main` without explicit instruction.