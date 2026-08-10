# Mobile and poor-network performance baseline

This checkpoint records the production-build and interaction-model baseline measured immediately after Milestone 4. It is an engineering baseline, not a performance claim for a particular device, network, or deployment.

## Measured production build

Fresh production build artefacts on the post-Milestone-4 `staging` revision:

| Asset | Raw | gzip |
| --- | ---: | ---: |
| Initial JavaScript | ~200.6 kB | ~62.6 kB |
| Initial CSS | ~23.3 kB | ~5.1 kB |
| Shared role chunk | ~17.1 kB | ~5.0 kB |
| Kaimahi chunk | ~144.7 kB | ~27.0 kB |
| Supervisor chunk | ~36.8 kB | ~6.6 kB |

- Entry first-use JavaScript and CSS: ~67.7 kB gzip.
- Additional Kaimahi chunks: ~32.0 kB gzip.
- Additional Supervisor chunks: ~11.6 kB gzip.
- Kaimahi and Supervisor are lazy-loaded separately.

## Measured interaction architecture

- Normal meaningful workflow mutations generally require one HTTP request.
- Setup or Pou confirmation plus explicit safety confirmation deliberately requires a second acknowledged request.
- Mutations currently return the full authoritative workflow.
- `structuredReview` currently duplicates some top-level workflow data.
- No browser persistence exists for unacknowledged workflow drafts.

## Not yet measured

- Full workflow request and response payload sizes.
- Deployment and API `Content-Encoding`.
- Real-device loading, rendering, and acknowledgement timings.
- Real network behaviour under constrained or poor connectivity.

The simulated conversation state currently holds an in-memory transcript. It must not become an unbounded pattern when real voice is introduced.

## Provisional engineering guardrails

These are proposals for investigation and review, not approved hard requirements. Builds do not fail against them yet.

| Area | Proposed guardrail |
| --- | --- |
| Entry JavaScript and CSS | Target <=80 kB gzip |
| Additional Kaimahi route code | Target <=40 kB gzip |
| Ordinary mutation request | Target <=5 kB JSON for normal operations |
| Ordinary mutation response | Investigate/target <=25 kB compressed |
| Full resume response | Investigate/target <=50 kB compressed |
| Ordinary primary save | Target one network RTT |
| Constrained-network acknowledgement | Investigate target <=1.5 s p95 |
| Severe-network acknowledgement | Investigate target <=4 s p95 |

Automated bundle and payload budget checks should be considered once Milestone 5 materially changes the network profile and representative API response sizes have actually been measured.

## Future voice acceptance

Real voice must later measure:

- upstream audio bitrate and data use
- connection establishment time
- WebSocket/WebRTC stability
- reconnection
- packet-loss and network-handoff behaviour
- conversation startup latency
- streamed-response latency
- bounded captions and transcript state
- microphone, audio, socket, and timer cleanup
- behaviour when the phone is backgrounded
- behaviour when connectivity drops and returns

Use these engineering test profiles. They are not claims about specific cellular technologies:

| Profile | Download | Upload | RTT |
| --- | ---: | ---: | ---: |
| Constrained | ~1.5 Mbps | ~750 kbps | ~150 ms |
| Severe | ~400 kbps | ~200 kbps | ~400 ms |
