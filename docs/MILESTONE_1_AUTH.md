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

The `application_session` table stores a UUID, SHA-256 hash of a random opaque browser cookie, expiry, last qualifying activity time, invalidation time, and user UUID. The raw session token is never persisted. A successful OIDC callback starts a new session, which is the relevant session rotation point. Logout revokes the stored session before clearing the cookie.

The session cookie is `HttpOnly`, `SameSite=Lax`, path-scoped to `/`, and `Secure` in production. It has a 12-hour absolute lifetime and the server refuses normal access after 60 minutes without qualifying authenticated API activity; activity can refresh the idle deadline but never the absolute expiry. A separate signed, short-lived, HttpOnly OIDC transaction cookie holds state, nonce, and the PKCE verifier. Neither cookie is available to JavaScript or `localStorage`.

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

The template selects the Cognito Essentials tier, managed login version 2, email OTP and WebAuthn as usable first authentication factors, admin-only creation, no public sign-up, no SMS factor, and MFA off. Cognito also requires `PASSWORD` to be configured in this list; Te Kaupapa's pilot provisioning deliberately creates people without a temporary or permanent password, so password sign-in is not an intended or usable pilot flow. Email remains available as the universal passwordless/recovery path; passkey registration and sign-in are intentionally managed by Cognito’s managed-login experience.

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

Remove `--dry-run` only in the approved staging environment after setting `DATABASE_URL`, `AWS_REGION`, and `COGNITO_USER_POOL_ID`. The real command creates or finds the Cognito user by email without `TemporaryPassword`, then creates/updates the internal organization/user/role records and links the Cognito `sub`. It does not administratively mark an arbitrary email address verified: the staging Cognito email-OTP test must confirm the provider’s supported first-sign-in verification behaviour. `--supervises-user-ids` is optional and accepts already-provisioned Kaimahi UUIDs in the same organisation; the database rejects invalid role, cross-organisation, and self-supervision assignments. It does not set a permanent password, send custom email, expose an administrative screen, or log the user’s email in its success output. A retry is safe when Cognito already has that email. An existing Cognito subject must never be silently reassigned to a different Te Kaupapa person.

## Cognito behavioural verification

This implementation was based on AWS’s current documentation: Essentials or Plus is required for managed login/passwordless/passkeys; managed login version 2 is required for the current passkey experience; email OTP requires Cognito email delivery through SES; and admin-created passwordless users are created by omitting `TemporaryPassword`. Cognito’s managed login owns the passkey enrollment and recovery experience. The exact deployed user-pool behaviour, sender verification, and passkey relying-party domain must still be tested in the approved staging account.

## Staging activation record — 9 August 2026

The caller was verified as `arn:aws:iam::905418481310:user/te-kaupapa-dev` in account `905418481310`, region `ap-southeast-2`. SES read-only discovery confirmed `ProductionAccessEnabled=true`, `SendingEnabled=true`, and that `hello@talkscape.com` is verified for sending with DKIM `SUCCESS`. Cognito pool discovery returned no existing pools. The template validated successfully.

The first isolated stack attempt, `te-kaupapa-staging-authentication`, rolled back before it created a pool because Cognito Essentials requires `PASSWORD` to be included in `AllowedFirstAuthFactors`. The template has been corrected: `PASSWORD` is configured as required by Cognito, but Te Kaupapa pilot users are still provisioned without a temporary or permanent password, leaving email OTP and WebAuthn as their usable flows.

The corrected second attempt, `te-kaupapa-staging-authentication-v2`, also rolled back. CloudFormation created the user pool and then failed because the restricted IAM policy did not permit `cognito-idp:TagResource` to apply the four mandatory user-pool tags. Automatic rollback removed the user pool created in each failed attempt; no Cognito pool, domain, app client, pilot user, or application identity remains. The rollback-complete CloudFormation stack records remain because the deliberately least-privilege policy excludes `cloudformation:DeleteStack`.

`infra/iam/te-kaupapa-dev-policy.json` now grants only the missing post-create `cognito-idp:TagResource` call, constrained to the four required tag keys and values, plus the read-only `DescribeUserPoolDomain` availability check that the former policy could not perform. An authorized IAM administrator must attach this corrected policy document to `te-kaupapa-dev` before a new deployment attempt. Re-run read-only domain availability discovery and deploy a new isolated stack name (for example, `te-kaupapa-staging-authentication-v3`) after that update. Do not delete the two rollback-complete records unless separately approved.

On the resumed activation, both rollback records were inspected: each is tagged as Te Kaupapa staging, has only a `TeKaupapaUserPool` resource, and that resource is `DELETE_COMPLETE`. No live Cognito resource is retained. The policy applied for that inspection still had no `cloudformation:DeleteStack`, so the canonical name could not safely be reused. The repository policy now adds that action solely for those two exact tagged stack ARNs. An IAM administrator must apply this final policy version before the records can be removed and the canonical stack recreated.

After the narrowly scoped delete permission was applied, deletion requests for both failed records were accepted. CloudFormation's deletion waiter was then denied `cloudformation:DescribeStacks` because the existing generic inspection statement requires tags that are unavailable during/after deletion. The policy now adds only a read-only `DescribeStacks` statement scoped to those same two stack ARNs so the completed deletion can be verified. An IAM administrator must apply this revision before verification and deployment can continue.

After cleanup was verified and the canonical stack was created, Cognito again denied `cognito-idp:TagResource`. AWS's Cognito CloudFormation guidance explains that CloudFormation propagates stack-level and `aws:cloudformation:*` system tags and requires `TagResource`, `UntagResource`, and `ListTagsForResource`. The former request-tag-key allow-list accepted only the four Te Kaupapa keys and therefore rejected the provider's system-tag request. The policy now allows only those four Te Kaupapa keys plus CloudFormation system keys for tagging, and permits untagging only CloudFormation system keys. An IAM administrator must apply this revision before the canonical deployment is retried.

The cleanup policy was also tightened to use the two immutable failed stack ARNs rather than a stack-name pattern. This prevents its exceptional delete/read permissions from matching a later canonical stack that reuses the same name.

The later canonical retry also rolled back with its sole user-pool resource `DELETE_COMPLETE`. Its immutable stack ARN is `arn:aws:cloudformation:ap-southeast-2:905418481310:stack/te-kaupapa-staging-authentication/3472bac0-93d4-11f1-b8a1-025969771dbd`. The split CloudFormation policy now adds only this approved, inspected rollback ARN to its delete and post-delete verification statements; no name wildcard or successful-stack delete permission is introduced.

After the split Cognito/SES policy was applied, the next canonical retry passed Cognito tagging and failed because the account has no Cognito SES email service-linked role. Cognito requires the deploying principal to allow `iam:CreateServiceLinkedRole` with `iam:AWSServiceName=email.cognito-idp.amazonaws.com` when it first configures SES email delivery. The split Cognito/SES policy now grants only that action with that exact service-name condition; it grants no general IAM administration, role modification, role deletion, attachment, or `iam:PassRole`.

That failed canonical retry is the immutable `ROLLBACK_COMPLETE` stack ARN `arn:aws:cloudformation:ap-southeast-2:905418481310:stack/te-kaupapa-staging-authentication/1a9d51a0-93d9-11f1-9fa8-0a1000a44c5d`. It was inspected and has the required Te Kaupapa tags and only a `TeKaupapaUserPool` resource with status `DELETE_COMPLETE`. The CloudFormation policy now adds only this ARN to its exceptional `DeleteStack` and post-delete `DescribeStacks` statements; it cannot delete a later successful stack reusing the canonical name.

The following canonical retry created a tagged user pool but failed while CloudFormation applied the template's explicit `MfaConfiguration: OFF`: Cognito denied `cognito-idp:SetUserPoolMfaConfig`. The split Cognito/SES policy now grants only that action through the existing four-tag user-pool resource condition. Rollback then could not delete the newly created pool because its configured deletion protection is active, leaving that stack in `ROLLBACK_FAILED`; no recovery action is taken until the narrowly scoped policy correction is applied and the live protected resource is separately reviewed.

Before the separately approved destructive recovery of that exact failed pool, its stack resource, Cognito configuration, tags, client list, and domain were re-inspected and matched the failed-deployment state. The mandatory bounded `cognito-idp:ListUsers` check was denied, so the Cognito/SES policy now adds only that read-only action through the existing four-tag user-pool condition. This prevents deletion unless the pool's actual user inventory is confirmed empty.

After that inventory permission was applied, `ListUsers` returned no users. The pool retained only the required Te Kaupapa and CloudFormation tags, had no app client or managed-login domain, and belonged to the approved `ROLLBACK_FAILED` stack. Its deletion protection was inactivated only for this approved empty pool. CloudFormation then denied `cloudformation:DeleteStack` for the stack's immutable ARN, so the split CloudFormation policy now adds only `arn:aws:cloudformation:ap-southeast-2:905418481310:stack/te-kaupapa-staging-authentication/dbc97550-93db-11f1-b5bb-02a79eb87fcf` to its temporary delete and post-delete verification statements. No deletion retry occurs until an IAM administrator applies that narrow correction.

After the canonical stack-name cleanup policy was applied, the approved failed stack and its pool were deleted successfully. The next canonical retry created a new tagged pool but Cognito rejected `WebAuthnUserVerification: PREFERRED`; the provider accepts the lowercase enum values `preferred` and `required`. The template now uses `preferred`, preserving the approved user-verification intent. That newly created pool is protected and its stack is `ROLLBACK_FAILED`, so no destructive recovery is performed without separate approval for its exact pool and stack.

RDS instance and cluster discovery was denied as expected because the current policy intentionally has no RDS permissions. No clearly Te Kaupapa-specific PostgreSQL service could therefore be confirmed, and no database, secret, pilot user, application identity, or live authentication test was created or performed.

The CloudFormation template applies `Application=te-kaupapa`, `Environment=staging`, `ManagedBy=te-kaupapa-repository`, and `Purpose=authentication-pilot` to the Cognito user pool. Apply the same tags to the CloudFormation stack at deployment time; Cognito user-pool domains and app clients do not expose equivalent tag properties in this template.

Once an IAM administrator has applied the corrected policy, deploy [the isolated template](../infra/cognito-user-pool.yml) with only these local development endpoints:

- callback: `http://localhost:3011/api/auth/callback`
- managed-login logout destination: `http://localhost:8443`

The template must use a dedicated available `te-kaupapa-staging` Cognito-domain prefix (or the smallest isolated suffix), the verified `hello@talkscape.com` SES sender identity, and a separately approved Te Kaupapa PostgreSQL database. No database, secret, runtime IAM role, pilot user, or application identity has been created. After the policy is updated, perform the required read-only discovery before deployment; do not reuse any CareFlow or ambiguous resource.

For teardown after an approved pilot, first disable/delete pilot users and revoke their application sessions, then delete only the CloudFormation stack created for this task. Do not delete a protected user pool until deletion protection has been deliberately disabled by an authorized operator, and do not delete any shared or CareFlow resource.

## Validation

```sh
npm run typecheck
npm test
npm run test:server
npm run build
```

The suite includes UI shell tests, server policy/session/CSRF tests, fake OIDC integration tests, and existing approved UI smoke paths. A PostgreSQL integration test is available but intentionally runs only when `TEST_DATABASE_URL` is supplied, to avoid mutating an unspecified database.
