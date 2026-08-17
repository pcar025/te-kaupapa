# Milestone 3 — End-to-end workflow slice

Milestone 3 completes the Kaimahi-owned workflow from the seven acknowledged
Pou reviews through manual actions, manual referral drafts, structured review,
and durable workflow completion.

## Authoritative progression

`pou-summary` → `action-planning` → `referral-planning` →
`structured-review` → `record-review` → `complete`

The post-seven-Pou `pou-summary` is a synthesis of the Kaimahi-confirmed Pou reviews, confirmed safety observations, and human carry-forward markers. It is not another AI or safety decision. Action Planning always follows it, including when no item was carried forward.

Each progression command is an authenticated Kaimahi-only, organisation- and
owner-scoped interaction. It uses the same idempotency key, canonical request
fingerprint, expected workflow version, row lock, transaction, and replay
response as Milestone 2. The browser advances only after the transaction has
committed and returned the authoritative workflow.

## Persisted state

- `workflow_pou_checkpoint` records the confirmed progression, actor and
  timestamp for each of the seven Pou. The canonical human-visible Pou content
  is the immutable `workflow_pou_review`, created only from the explicitly
  confirmed generated or Kaimahi-edited narrative revision. Ordinary narrative
  confirmation cannot select a safety concern, referral or supervisor-review
  state; formal safety uses the separate human-confirmed safety-observation
  command.
- `workflow_action` stores manually entered `follow-up`, `support`, or `other`
  actions. The authenticated Kaimahi is both creator and owner. Actions are
  `open`, `completed`, or `withdrawn`; removing an acknowledged action records
  withdrawal rather than hard deletion.
- `workflow_referral` stores manually entered referral drafts. It supports an
  optional destination code, required destination name and reason, optional Pou
  linkage and notes, and `draft`, `prepared`, `declined`, or `withdrawn` state.
  Prepared means prepared within Te Kaupapa only.
- `workflow_carry_forward` stores a human-owned, non-action reference to a
  current scoped review criterion, area for attention, or confirmed safety
  observation. It records the source Pou, actor, and timestamp but is not an
  action, referral, escalation, or supervisor request. Detailed action fields
  are completed only in post-seven-Pou Action Planning.
- `workflow_session.completed_by_user_id` and `completed_at` record completion.

The deterministic structured review is returned from the server aggregate. It
contains acknowledged setup, canonical confirmed Pou reviews, formal
human-confirmed safety observations, human carry-forward markers,
non-withdrawn actions, non-withdrawn referrals, the workflow reference, and
timestamps. It makes no new generated prose or safety decision.

## Completion and retrieval

Completion is available only from `record-review`. It atomically sets
`status=completed`, `current_stage=complete`, `completed_at`, and
`completed_by_user_id`. Completed workflows are no longer resumable, release
the one-active-workflow constraint, and cannot be reopened or mutated.

`GET /api/workflows?status=completed` returns a bounded list of the current
Kaimahi's own completed records. Full records remain available only through the
owner-scoped workflow detail endpoint.

## Explicit exclusions

Milestone 3 does not implement AI, ElevenLabs, OpenAI, voice, transcripts,
audio, automated risk interpretation, safety consequences, escalation,
Supervisor access, notifications, email, external referral delivery, CareFlow
integration, or browser-persistent workflow storage.

No concern selection, suggestion flag, action, or referral creates an automatic
consequence. The real workflow must not claim that anything was sent,
delivered, notified, initiated externally, or actioned by a Supervisor.

## Migration and test safety

Migration `0003_simple_grandmaster` is additive. Its composite unique index on
the checkpoint parent is created before the child composite foreign keys that
reference it. Migrations `0000` through `0002` remain immutable.

PostgreSQL integration tests require `TEST_DATABASE_URL`, reject the normal
development database and `DATABASE_URL`, use the actual Drizzle journal at
`drizzle.__drizzle_migrations`, and hold an advisory lock while migrating. The
upgrade test applies the genuine 0000/0001/0002 chain before applying 0003 and
verifies all four ordered journal entries. Application code never creates or
drops a database.

`npm test` runs with one Vitest worker so the integration files share the one
explicit disposable database without competing migration or cleanup work.
