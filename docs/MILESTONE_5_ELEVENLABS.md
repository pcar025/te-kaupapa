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

The underlying LLM remains part of the versioned ElevenLabs agent configuration. Te Kaupapa has no direct Gemini, OpenAI, or other LLM integration.

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
