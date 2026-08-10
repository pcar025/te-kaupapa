# Milestone 4 — Deterministic safety workflow foundation

## Scope

Milestone 4 adds a backend-only, organisation-scoped foundation for recording human-confirmed safety observations. It does not change the approved Figma UI or introduce any safety controls in the browser.

The browser may submit a discrete Kaimahi command, but PostgreSQL remains the authoritative record. The command is authenticated, Kaimahi-authorized, origin checked, schema validated, idempotent, transactionally persisted, and acknowledged only after commit.

## Human-confirmation boundary

Existing setup `immediateConcern` and Pou `userSelectedConcern` fields remain workflow inputs. They do not automatically create a safety observation, evaluation, consequence, notification requirement, action, referral, or supervisor request.

Every safety observation in this milestone is an explicit Kaimahi confirmation with a client-generated UUID, bounded context, broad class, concern level, and optional bounded note.

## Observation, evaluation, and consequence

The model intentionally keeps three concepts separate:

1. `workflow_safety_observation` is the current canonical snapshot.
2. `workflow_safety_observation_revision` is the append-only, complete resulting-snapshot history.
3. `workflow_safety_rule_evaluation` is an immutable record of applying the server-owned deterministic policy to a revision.
4. `workflow_safety_consequence` records a canonical required or ceased consequence episode.

The only approved policy is `te-kaupapa.safety.urgent-supervisor-attention`, version `1`. An active urgent observation requires `supervisor_review_required` and `supervisor_notification_required`. Active `unsure`, `low`, `watch`, and `action` observations, and any retracted observation, have no approved automatic consequence.

`notification_required` is not notification delivered. This milestone has no email, SES, outbox, recipient resolution, delivery record, supervisor acknowledgement, or supervisor response.

## Correction and retraction

Correction uses a complete replacement snapshot and a required reason. Retraction requires a reason and cannot be reversed in this milestone. Both require the expected workflow version and expected observation revision, append one revision, evaluate the resulting snapshot, and increment the workflow version.

Urgent-to-urgent correction records a new evaluation but keeps active consequence episodes and their original required time. Urgent-to-nonurgent correction and retraction cease active safety-derived episodes. A later nonurgent-to-urgent correction creates new episodes rather than reopening ceased ones. Independent Kaimahi supervisor-review requests are not changed by a safety correction or retraction.

Normal completed-workflow mutations remain forbidden. Only correction and retraction of an existing safety observation are permitted after completion; they preserve workflow status, stage, `completed_at`, and `completed_by_user_id` while advancing version and `updated_at`.

## Read model and history

Workflow detail includes current observations, active required consequences, independent manual supervisor-review requests, and bounded indicators. List responses expose only indicators/counts, not free-text notes. Owner-scoped Kaimahi history retrieval returns the observation's revisions, evaluations, and consequence episodes. Supervisor history access is intentionally not implemented.

## Deferred work and decisions

This foundation does not implement AI or conversational candidates, ElevenLabs/OpenAI ingestion, voice, transcript storage or interpretation, category/risk-domain catalogues, per-Pou policy outcomes, low-severity consequences, workflow blocking, acknowledgement, Supervisor actions, or notifications.

Future work must obtain explicit SME/product/privacy decisions for safety categories, severity/policy definitions, consequence rules, escalation recipients and timeframes, notification delivery, acknowledgement/review lifecycle, transcript treatment, and any per-Pou policy. This document records those as deferred decisions, not implemented facts.
