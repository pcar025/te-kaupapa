# Shared staging deployment

This document describes the repository-side preparation for a minimal shared
staging deployment. It does not deploy infrastructure, configure an external
provider, or create real user identities.

## Deployment shape

- Vercel serves the React/Vite frontend.
- Render Singapore serves the Fastify application and PostgreSQL 16.
- Browser API requests remain same-origin relative requests under `/api/*`.
- After the Render public URL is known, Vercel must rewrite `/api/:path*` to
  that backend while preserving cookies and redirect headers. No placeholder
  hostname is committed here.

The Render health check is `GET /api/health`, which returns `200` with
`{"status":"ok"}` without authentication.

## Production commands

Render runs environment variables directly; it does not load a repository
`.env` file.

```sh
npm ci --include=dev
npm run build:server
npm run start:server
```

`build:server` emits the server-only TypeScript graph to `dist-server/`.
`start:server` executes `dist-server/server/index.js`. Set Render's `PORT` as
provided by Render and `HOST=0.0.0.0`.

Vercel uses:

```sh
npm ci
npm run build
```

with output directory `dist`.

## Order of operations

1. Set the Render backend's environment variables, including its production
   `DATABASE_URL`, but do not point any value at a local development database.
2. Apply source migrations through `0021_useful_anita_blake` with:

   ```sh
   npm run db:migrate
   ```

3. Run the explicit configuration bootstrap once (safe to rerun):

   ```sh
   npm run db:bootstrap:staging
   ```

   It requires `DATABASE_URL`, `ELEVENLABS_AGENT_ID`,
   `ELEVENLABS_AGENT_BRANCH_ID`, and `ELEVENLABS_AGENT_ENVIRONMENT`.
   The command rejects `localhost`, `te_kaupapa_dev`, and
   `te_kaupapa_m2_test`; it is never called from application startup.
4. Confirm Render health before configuring Vercel's `/api/*` rewrite.
5. Set `APP_ORIGIN` and `FRONTEND_ORIGIN` to the final Vercel HTTPS origin
   before configuring Cognito's matching callback/logout URLs. `APP_ORIGIN`
   is intentionally the browser-facing origin because authentication cookies
   and callbacks travel through the Vercel same-origin `/api/*` rewrite.
6. Create the real staging user only after the organisation is bootstrapped,
   using the existing separately operated `provision:cognito-user` command
   with human-supplied identity details and explicit roles. Do not put a
   person's name, email, Cognito subject, or credentials in this repository.

## Configuration-only client-demo baseline

`db:bootstrap:staging` is deterministic and idempotent. It creates one
synthetic organisation, `te-kaupapa-client-demo-staging`, and a non-login
technical bootstrap actor used only as immutable approval provenance. It
creates no external identity, role assignment, application session, workflow,
conversation, transcript, provider delivery, assessment run, review, action,
referral, carry-forward, or final record.

The active ordinary baseline is exactly seven approved v0.2 Pou
specifications. It derives every v0.2 record from the repository's v0.1
template and changes only the SME-authored opening reflection question. The
seven exact opening questions are source-controlled in
`server/staging-bootstrap/configuration.ts`.

The active executable formal-safety baseline is deliberately narrower:

- Whakapapa v0.1 has its existing three approved rules.
- Manaakitanga, Tikanga, Kaitiakitanga, Pūkenga, Haepapa, and Oranga each
  have an explicit approved v0.1 zero-rule manifest.

The synthetic local Manaakitanga formal-safety v0.2 policy is not part of this
bootstrap and cannot be transferred by it.

If the target organisation already has a different active specification,
projection, provider reference, or safety policy, the command fails closed
rather than replacing it. A successful rerun reports all seven policies and
ordinary specifications as existing.

## Environment-variable ownership

The Fastify process requires `DATABASE_URL`, `APP_ORIGIN`, `FRONTEND_ORIGIN`,
and `SESSION_COOKIE_SECRET`. `NODE_ENV`, `PORT`, `HOST`,
`SESSION_COOKIE_NAME`, and `CORS_ALLOWED_ORIGINS` configure process and cookie
behaviour. Cognito, ElevenLabs, webhook, and OpenAI settings remain
server-only; use `.env.example` as the variable-name inventory, never as a
source of real values.

`VITE_` variables are not used for API routing. Do not put server credentials,
backend URLs, webhook secrets, local tunnel origins, or local relay settings
in Vercel browser variables.

## Local-only boundaries that do not carry to hosted staging

The loopback webhook relay, Cloudflare Quick Tunnel, `localhost` callback
origins, and local listener topology are development controls. They are not a
hosted staging ingress design. A hosted post-call ingress path and any provider
webhook binding need a separate approved configuration gate after Render is
healthy.
