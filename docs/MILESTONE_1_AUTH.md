# Milestone 1 — authenticated application shell

## What is implemented

Milestone 1 adds a standalone Te Kaupapa authentication and authorization boundary. It does not add workflow persistence, conversation handling, transcripts, ElevenLabs, OpenAI, safety rules, notifications, or deployment infrastructure.

- A TypeScript Fastify server owns protected `/api` routes and cookie sessions.
- The browser uses only same-origin `/api` calls. It holds no Cognito, access, refresh, or application-session token.
- Cognito managed login uses authorization code + PKCE. The server exchanges the code, validates the ID token issuer, audience, signature, and nonce, then creates an opaque server-side application session.
- The client reads the minimum profile from `GET /api/me` and only shows its server-assigned Kaimahi and/or Supervisor entry cards.
- The existing prototype workflow data remains prototype-only; it has not been persisted or represented as real application data.

## Authentication and authorization model

`app_user.id` is Te Kaupapa’s opaque UUID. It is the application identifier used by sessions, roles, and future domain records. Cognito is linked through `external_identity(provider, provider_subject)` and its subject is not used as the application’s primary identity.

`app_user` belongs to one `organisation`. Role assignments are independent, so a person may hold both `KAIMAHI` and `SUPERVISOR` roles. A `supervision` record is explicit many-to-many and database-enforced: both people must be in the record’s organisation, the supervisor must have `SUPERVISOR`, the kaimahi must have `KAIMAHI`, and self-supervision is rejected. Cross-organisation access is therefore denied structurally and must also be checked by future resource policies.

`app_user.status` is `active` or `inactive`. Inactive people cannot establish or use an application session. Future admin tooling is deliberately out of scope.

`GET /api/entry/:role` demonstrates the reusable protected-route policy. It returns 401 without an active server session and 403 when the active user lacks that role. Future application routes must enforce the same server-side session, organisation, and role checks; hiding a client control is not authorization.

## Session and CSRF design

The `application_session` table stores a UUID, SHA-256 hash of a random opaque browser cookie, expiry, invalidation time, and user UUID. The raw session token is never persisted. A successful OIDC callback starts a new session, which is the relevant session rotation point. Logout revokes the stored session before clearing the cookie.

The session cookie is `HttpOnly`, `SameSite=Lax`, path-scoped to `/`, and `Secure` in production. A separate signed, short-lived, HttpOnly OIDC transaction cookie holds state, nonce, and the PKCE verifier. Neither cookie is available to JavaScript or `localStorage`.

State-changing routes currently validate `Origin` or `Referer` against a narrow configured allow-list. This is an explicit CSRF control; CORS is not treated as CSRF protection. A CSRF token is not necessary for the single logout mutation while this strict origin check and `SameSite=Lax` cookie model apply. Reassess this decision before adding cross-origin state-changing operations or embedded clients.

Local development uses Vite’s narrow `/api` proxy to `http://localhost:3011`; normal browser traffic needs no cross-origin CORS permission. Any direct browser origin must be explicitly listed in `CORS_ALLOWED_ORIGINS`.

Application logout ends the Te Kaupapa session only. Cognito managed-login logout is a separate browser redirect endpoint and is intentionally not called automatically because its broader provider-session behaviour requires a product decision.

## PostgreSQL and migrations

Drizzle + the `pg` driver is the one database access boundary selected for this milestone: it provides typed schema definitions and generated, reviewable SQL migrations without introducing a second ORM/query layer. The initial migration is `server/db/migrations/0000_absent_wallow.sql` and contains only the approved Milestone 1 tables:

- `organisation`
- `app_user`
- `external_identity`
- `role_assignment`
- `supervision`
- `application_session`

Run migrations only against the intended environment:

```sh
npm run db:migrate
```

The current workspace has no designated Te Kaupapa PostgreSQL staging database, so migrations have not been applied outside local/test configuration.

## Local configuration and run

Copy `.env.example` into a local, untracked environment file and provide a local PostgreSQL URL plus a unique 32+ character `SESSION_COOKIE_SECRET`.

```sh
npm run db:migrate
npm run dev:server
npm run dev
```

The app starts with a truthful sign-in state if no session exists. It will return a generic unavailable state for sign-in until all Cognito values are configured. Do not put `COGNITO_CLIENT_SECRET`, session secrets, AWS credentials, or database credentials in `VITE_*` variables.

## Cognito staging activation required

`infra/cognito-user-pool.yml` is a reproducible **template only**. It has not been deployed and no AWS resource was created by this milestone.

Before a designated Te Kaupapa staging deployment, an authorized AWS operator must provide and verify:

1. A dedicated Te Kaupapa AWS account/environment and approved region; it must not reuse a CareFlow user pool.
2. A unique Cognito domain prefix, exact HTTPS callback URL, and exact logout URL.
3. An Amazon SES identity verified for the intended sender and the account’s production-access status if recipients extend beyond the SES sandbox. Cognito email OTP requires the Essentials plan and SES email configuration.
4. Permission to deploy the CloudFormation stack and obtain the confidential app-client secret through approved server secret storage. Configure the server with the stack outputs for client ID, issuer, and managed-login domain; keep the client secret server-only.
5. A staging PostgreSQL database, migration execution, and a server runtime identity with the least privilege needed for `cognito-idp:AdminCreateUser` and `cognito-idp:AdminGetUser` against this user pool.
6. An approved initial organization and authorised people/roles, then a live email OTP, managed-login passkey enrollment, unprovisioned-user denial, inactive-user denial, and logout test.

The template selects the Cognito Essentials tier, managed login version 2, email OTP and WebAuthn as first authentication factors, admin-only creation, no public sign-up, no password sign-in factor, no SMS factor, and MFA off. Email remains available as the universal passwordless/recovery path; passkey registration and sign-in are intentionally managed by Cognito’s managed-login experience.

## Provisioning people

There is intentionally no admin UI. The repeatable operator command is:

```sh
npm run provision:cognito-user -- \
  --email person@example.org \
  --display-name 'Person Name' \
  --organisation-slug example-org \
  --organisation-name 'Example organisation' \
  --roles KAIMAHI,SUPERVISOR \
  --supervises-user-ids 11111111-1111-1111-1111-111111111111 \
  --dry-run
```

Remove `--dry-run` only in the approved staging environment after setting `DATABASE_URL`, `AWS_REGION`, and `COGNITO_USER_POOL_ID`. The real command creates or finds the Cognito user by email without `TemporaryPassword`, then creates/updates the internal organization/user/role records and links the Cognito `sub`. `--supervises-user-ids` is optional and accepts already-provisioned Kaimahi UUIDs in the same organisation; the database rejects invalid role, cross-organisation, and self-supervision assignments. It does not set a permanent password, send custom email, expose an administrative screen, or log the user’s email in its success output. A retry is safe when Cognito already has that email. An existing Cognito subject must never be silently reassigned to a different Te Kaupapa person.

## Cognito behavioural verification

This implementation was based on AWS’s current documentation: Essentials or Plus is required for managed login/passwordless/passkeys; managed login version 2 is required for the current passkey experience; email OTP requires Cognito email delivery through SES; and admin-created passwordless users are created by omitting `TemporaryPassword`. Cognito’s managed login owns the passkey enrollment and recovery experience. The exact deployed user-pool behaviour, sender verification, and passkey relying-party domain must still be tested in the approved staging account.

## Validation

```sh
npm run typecheck
npm test
npm run test:server
npm run build
```

The suite includes UI shell tests, server policy/session/CSRF tests, fake OIDC integration tests, and existing approved UI smoke paths. A PostgreSQL integration test is available but intentionally runs only when `TEST_DATABASE_URL` is supplied, to avoid mutating an unspecified database.
