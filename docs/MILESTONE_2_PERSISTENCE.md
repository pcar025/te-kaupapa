# Milestone 2 — reliable workflow persistence

## What is implemented

Milestone 2 makes the first Kaimahi workflow slice durable without changing the approved Te Kaupapa UI structure. PostgreSQL is authoritative for a workflow draft, setup confirmation, raw human-confirmed review data for each of the seven Pou, and the last acknowledged resume checkpoint.

The browser keeps unconfirmed field edits only in memory. It sends a small command only when the existing setup or Pou-confirmation control is used. A workflow is not presented as saved until PostgreSQL has committed the matching transaction.

## Persisted workflow boundary

`workflow_session` is distinct from Milestone 1's `application_session`. It stores the Te Kaupapa workflow UUID, owning organisation and Kaimahi UUIDs, a server-issued display reference such as `TK-7K4M2P9Q`, setup data, lifecycle/status, resume checkpoint, version, and timestamps.

At creation, the backend inserts exactly seven `workflow_pou_checkpoint` rows using the approved Te Waharoa identifiers. Each row may hold the latest raw human-confirmed concern selection, note, and two suggestion flags. These values are not canonical Pou assessments and cause no action, referral, escalation, notification, or supervisor effect.

`workflow_interaction` records the accepted operation, actor, idempotency key, request fingerprint, expected/resulting versions, relevant Pou, and timestamp. It deliberately does not duplicate free-text workflow content.

The authoritative Milestone 2 resume points are:

- `setup` for a draft;
- `pou-overview` after setup confirmation;
- the next Pou conversation after an acknowledged Pou confirmation; and
- `pou-summary` after all seven Pou confirmations.

The application does not mark the workflow completed in Milestone 2. The prototype's later risks, referrals, synthesis, record, delivery, and completion screens are not authoritative workflow data.

## One active workflow

Milestone 2 permits one `draft` or `in_progress` workflow per Kaimahi. A PostgreSQL partial unique index enforces this rule, and returning with Hoki preserves the durable draft for resume.

The existing Hoki path may return from Pou overview to setup. In that case, setup confirmation is revised in place with a new acknowledged interaction; it does not create a second workflow or reset the Pou checkpoint.

This is a provisional product rule. Reassess it before pilot use if a frontline Kaimahi must hold multiple unfinished whānau sessions concurrently. Milestone 2 intentionally has no workflow picker, abandon action, cancel action, expiry, or hard-delete endpoint.

## API and authorization

The authenticated Kaimahi API is:

- `POST /api/workflows` — start or replay a durable draft;
- `GET /api/workflows?status=resumable` — list the signed-in Kaimahi's resumable workflows;
- `GET /api/workflows/:workflowSessionId` — retrieve the signed-in Kaimahi's workflow; and
- `POST /api/workflows/:workflowSessionId/interactions` — submit setup or Pou-review confirmation.

Every route uses the existing server-side application session, requires the `KAIMAHI` role, derives organisation and actor IDs from that session, and scopes the workflow query by workflow ID, organisation, and owner. Inaccessible workflow IDs return `404`. State-changing routes use Milestone 1's trusted Origin/Referer CSRF policy.

Supervisor workflow access remains out of scope.

## Reliability model

The browser generates a UUID idempotency key when a meaningful submission begins and retains it in memory while the result is unknown. A retry uses the same key. The backend records a canonical request fingerprint:

- same key and payload: replay without another mutation;
- same key and different payload: `409 idempotency_key_reused`;
- stale expected version: `409 stale_workflow` without partial state.

Accepted mutations use a PostgreSQL transaction and workflow row lock. The workflow/checkpoint update and interaction insert commit together, and the version increases once. Only then does the API acknowledge the operation.

On refresh, the browser retrieves authoritative acknowledged state. Unconfirmed typing and unknown-outcome commands do not survive refresh; there is no `localStorage`, `sessionStorage`, IndexedDB, service worker, or offline queue.

The minimal UI feedback states are: `Saving…`, `Saved`, `Couldn’t save. Try again.`, `Retrying…`, and the approved stale-version message.

## Privacy boundary

Milestone 2 stores only the coded organisation-scoped whānau reference, setup data, human-confirmed Pou checkpoint data, workflow metadata, and minimum operation provenance. It stores no Cognito subject as a domain key, password/session token, transcript, audio, AI output, action, referral, notification, supervisor outcome, synthesis, or record-delivery data.

Operational logs must not contain whānau reference, focus, notes, concern content, request bodies, tokens, or idempotency payloads.

Formal retention, deletion, abandonment, and historical-value audit policy are deferred pre-production decisions.

## Migrations and validation

`server/db/migrations/0002_glossy_ronan.sql` is additive and creates the workflow enums, tables, constraints, and indexes. It does not import prototype fixtures. Apply it only to an explicitly designated Te Kaupapa PostgreSQL environment:

```sh
npm run db:migrate
```

The database integration tests run only with an explicit disposable `TEST_DATABASE_URL`; normal test runs never mutate an unspecified database. Their shared harness rejects the normal `te_kaupapa` and `te_kaupapa_dev` targets, rejects a target matching `DATABASE_URL`, serializes migration through a PostgreSQL advisory lock, and verifies the Drizzle migration journal before fixtures run. Fixture cleanup runs only after a successful migration and cannot hide an earlier migration or test failure.

Validate with:

```sh
npm run typecheck
npm test
npm run test:server
npm run build
git diff --check
```

Milestone 3 is responsible for turning confirmed source material into real Pou state, actions, referrals, and record completion.
