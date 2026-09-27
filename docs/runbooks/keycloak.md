# Keycloak: staff sign-in and step-up

Staff sign in through Keycloak 26, one instance per region (plan KTD20). This runbook covers local development, the realm's settings and why they are set, how the API's sessions work, and step-up authentication with its second factor (U29). Everything here uses synthetic users only.

## How sign-in works

1. The staff app sends the browser to `GET /api/v1/auth/sign-in?returnTo=/path` on its own origin (the app proxies `/api` to the API's staff listener).
2. The API creates a one-time `state`, `nonce` and PKCE verifier, seals them in an encrypted `__Host-pl_sign_in` cookie (HttpOnly, Secure, SameSite=Lax, ten minutes; Lax because Keycloak's redirect back is a cross-site navigation) and redirects to Keycloak's authorization endpoint with `scope=openid organization` and an S256 code challenge.
3. Keycloak redirects to `GET /api/v1/auth/callback`. The API checks the state against the cookie, exchanges the code as a confidential client, and validates the access and id tokens against the realm's JWKS: issuer, audience (`partledger-api`), expiry, token type, authorized party, nonce, a uuid subject, no `impersonator` or `act` claim, and exactly one organization carrying one `tenant_id`. The tenant must exist in this region.
4. The API issues a `staff_session` credential (resolved later through `resolve_credential`), stores a `staff_sessions` row in the tenant with the refresh token encrypted, and sets `__Host-pl_session=pls_<id>_<secret>` (HttpOnly, Secure, SameSite=Strict, `Path=/`, no `Domain`).
5. Every request on the staff listener presents that cookie. The API verifies the credential, then checks the session row: ended sessions and sessions idle for longer than the idle timeout are refused; once the refresh interval has passed, the API refreshes against Keycloak and ends the session if Keycloak refuses (a disabled user, an ended Keycloak session) or returns a token for another user or tenant. If Keycloak or its signing keys cannot be reached, the request is answered with 503 `pl.error.unavailable.dependencyUnavailable` and the session is kept; the staff app shows it as unavailable, not as signed out. An ended session row is frozen by a trigger, so it can never be reopened.
6. `POST /api/v1/auth/sign-out` ends the session row, ends the Keycloak session through its logout endpoint and clears the cookie. `GET /api/v1/auth/session` returns the user id, tenant id and both expiries, or the uniform 401.

The session row also keeps the latest `acr` and `auth_time` of the tokens it received (`authentication_level`, `authenticated_at`), from the sign-in, every refresh and every step-up.

The browser never receives a token. The staff listener reads only the session cookie and ignores `Authorization` headers, so a session cannot be replayed as a bearer token; the other listeners keep their bearer credentials. Every state-changing request on the staff listener must carry `x-partledger-request: staff-app` (see `staffRequestHeader` in `libs/contracts/src/auth.ts`); without it the API answers 403 `pl.error.forbidden.crossSiteRequest`.

## Step-up

Approvals and KTD20's other high-impact commands (void, role grants and revocations, auditor grants, break-glass approvals, tenant AI-key changes, drop-credential issuance, and the second-factor reset) are declared with `stepUp: true`. The API runs them only when the session's latest `acr` is `STEP_UP_ACR` (default `step-up`) and its `auth_time` is at most `STEP_UP_FRESHNESS_SECONDS` old (default 300, five seconds of clock skew tolerated). Otherwise it answers 401 with `{ "error": "StepUpRequired", "message": "pl.error.stepUpRequired.recentAuthentication" }`, which the staff app tells apart from the uniform 401 of a refused session.

1. The staff app (`apps/web/src/auth/step-up.ts`) keeps the refused command, with its idempotency key, in the tab's session storage and navigates to `GET /api/v1/auth/step-up?returnTo=/path`.
2. The API resumes the session from its cookie (a top-level navigation from the app carries the SameSite=Strict cookie), seals the session's tenant and credential id into the `__Host-pl_sign_in` state cookie with a new state, nonce and PKCE verifier, and redirects to Keycloak with `acr_values=step-up`. Without an active session it sends the person back to `returnTo` with `?stepUp=failed`.
3. Keycloak's browser flow reuses the SSO session for the sign-in level and asks for a one-time code at the step-up level; a user without a second factor enrols one first (the `CONFIGURE_TOTP` required action).
4. The callback exchanges the code and records the new refresh token, `acr` and `auth_time` on the sealed session, but only if that session is still open, not idle, and the tokens name the same person and tenant; otherwise the new Keycloak session is ended and nothing changes. It redirects to `returnTo`, with `?stepUp=failed` when the tokens do not carry the step-up level.
5. The app retries the kept command once with the same idempotency key, so the action happens once. A step-up that failed, a kept command older than ten minutes, or a second step-up error ends the attempt with `pl.auth.stepUpFailed` instead of another redirect.

Refreshing keeps the `acr` and `auth_time` of the step-up, so the freshness window, not the refresh, decides how long a step-up lasts.

### Levels of authentication in the realm

The realm maps its levels with `acr.loa.map` (`{"sign-in":1,"step-up":2}`) and binds its own browser flow, `partledger browser`:

| Execution | Requirement | Why |
|---|---|---|
| Cookie | alternative | SSO; for a step-up the cookie alone is not enough and the levels below run. |
| Identity Provider Redirector | alternative | `kc_idp_hint`. |
| `partledger organization` (conditional identity-first login) | alternative | Organization members are identified first, as in the built-in flow. |
| `partledger level 1`: Condition - Level of Authentication (1, max age 36000 s), Username Password Form | conditional | Sign-in; skipped at step-up while the SSO session holds level 1. |
| `partledger level 2`: Condition - Level of Authentication (2, max age 0), OTP Form | conditional | Step-up: a code every time it is asked for; enrolment at the first step-up. |

Users brokered from a customer's identity provider never see the password form. Every identity provider must set **Post login flow** to `partledger post broker login`, which records level 1 after a brokered login (`Allow access` under a level-1 condition) and asks for the one-time code when a brokered login itself asks for level 2. Without it a brokered user's step-up asks for a Keycloak password they do not have, so it fails closed. The second factor is always held by Keycloak, never by the customer's identity provider.

### Forgot-password and lost second factors

Forgot-password is off (`resetPasswordAllowed: false`): the sign-in pages offer no reset link and the reset endpoint refuses. Were it switched on, a user of a customer's identity provider could otherwise give themselves a Keycloak password by e-mail, sign in without the customer's identity provider (after the customer had disabled them), enrol their own second factor at the first step-up, and approve.

The realm still binds its own reset-credentials flow, `partledger reset credentials`, so switching forgot-password on later cannot reopen that hole or touch a second factor:

| Execution | Requirement | Why |
|---|---|---|
| Choose User, Send Reset Email | required | As built in; an unknown user gets the same page and no e-mail. |
| `partledger refuse reset without password account`: Condition - user role (`password-account`, negated), Deny access | conditional | After the e-mailed link, an account without the realm role `password-account` ends on Keycloak's access-denied page and gets no password. |
| Reset Password | required | The new password. |

The built-in flow's `Reset - Conditional OTP` (Reset OTP) is left out, so the flow never removes or replaces a second factor, and a reset password counts for no level: the next step-up asks for the password and then a code from the existing factor. `password-account` is an allow-list rather than a check for a federated link, which Keycloak 26.4 has no flow condition for: accounts created by a customer's identity provider never hold it, so an account nobody marked is refused. U8 gives it to the local accounts a tenant admin invites; never give it to an account linked to an identity provider. Switching forgot-password on also needs SMTP settings per environment (Realm settings > Email).

A lost second factor is reset only by the `auth.resetSecondFactor` command: a tenant admin with a fresh step-up names a user of their own tenant who belongs to no other tenant (not themselves; a user of several tenants would keep their staff sessions in the others, so the reset is refused with `pl.error.forbidden.notPermitted`); the API ends the user's staff sessions (`second_factor_reset`) and, in the same transaction, appends an audit entry whose actor is the admin and whose payload holds only ids and counts, and enqueues the `auth.resetSecondFactor` job (KTD16). Once the command has committed, the job removes the user's `otp` credentials and ends their Keycloak sessions through the admin API, retrying every 30 seconds while Keycloak is unreachable, and appends its own `auth.secondFactorRemoved` entry. Until the job has run, the user has no staff session but could still sign in again with the old factor; a failed job shows in the job runner's failed jobs (`docs/runbooks/jobs.md`). The user enrols a new factor at their next step-up. Until U8 stores tenant roles, the role directory grants nobody `tenant_admin`, so the command is refused in production; U8 replaces the placeholder with membership rows.

### The API's service account

The client `partledger-api-admin` is confidential, has only the service-account grant, and its scope holds exactly one role, `realm-management` `manage-users` (`fullScopeAllowed` is off; the role reaches the token through the client's scope mapping). The API uses it for the second-factor reset: it reads a user's organizations and credentials, deletes `otp` credentials and ends the user's Keycloak sessions. Regenerate its secret after an import, like the API client's, and put it in `KEYCLOAK_ADMIN_CLIENT_SECRET`.

**Residual scope (a KTD20 decision for the owner).** KTD20 has the service account manage membership only; Keycloak 26.4 cannot narrow it that far:

- Deleting a credential and ending a user's sessions need `manage` on that user, and Keycloak grants `manage` on users only whole: with `manage-users` the account can also set any user's password, change their e-mail, add federated identity links, send required-action e-mails, and create or delete users, in every tenant of the realm. `view-users` is not needed and is not granted.
- Fine-grained admin permissions v2 (probed on 26.4 with `adminPermissionsEnabled`) give the same `manage` scope on users: a permission on all users allowed the same calls, a `manage`-only permission without `view` allowed none of them, and a negative permission on the `reset-password` scope denied the users entirely rather than that one call. Its target is a fixed list of users or group members, not an organization, so it cannot confine the account to one tenant either.
- Adding organization members needs `manage-realm` (probed: no narrower role allows it; with `manage-users` the call answers 403). U8 must not grant it to this account without the owner's decision, since `manage-realm` can change the realm's flows, identity providers and settings.

What the account cannot do, checked by `step-up.integration.spec.ts`: change the realm or read its flows, clients or identity providers, create roles, create organizations or add their members, or impersonate anyone. The API calls only the endpoints above, and the admin events Keycloak records show every call the account makes.

### Why the refresh token is stored

Refreshing at a short interval is how a disabled user or a removed membership loses access quickly, and it needs the refresh token between requests. It is kept only in `staff_sessions.refresh_token_ciphertext`, encrypted with AES-256-GCM under `SESSION_TOKEN_KEY` and bound to its credential id, so a ciphertext copied to another row does not decrypt. It is never logged, never returned by an endpoint and never sent to the browser. Access and id tokens are validated and discarded. When `KeyService` exists (KTD36), the key moves to envelope encryption under the regional KMS.

## Configuration

`apps/api/src/config/env.schema.ts` holds the settings; `.env.example` has placeholders.

| Variable | Meaning |
|---|---|
| `STAFF_APP_ORIGIN` | The staff app's origin; the callback is `${STAFF_APP_ORIGIN}/api/v1/auth/callback`. Must be `https` in production. |
| `KEYCLOAK_ISSUER` | The realm URL, such as `https://id.ca.example/realms/partledger`. Must be `https` in production. |
| `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | The confidential client. The secret comes from the secret store, never a file. |
| `KEYCLOAK_JWKS_COOLDOWN_SECONDS` | Shortest time between two JWKS fetches when a token names an unknown key (default 30). |
| `SESSION_TOKEN_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Rotating it ends every session. |
| `STAFF_SESSION_IDLE_TIMEOUT_MINUTES` | Default 30. |
| `STAFF_SESSION_ABSOLUTE_TIMEOUT_HOURS` | Default 10; the session credential's expiry and the cookie's `Max-Age`. |
| `STAFF_SESSION_REFRESH_INTERVAL_SECONDS` | Default 60; also the longest a disabled user keeps access. |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | The service account for the admin API (`partledger-api-admin`). |
| `STEP_UP_ACR` | The `acr` step-up commands require; default `step-up`, as the realm's `acr.loa.map` names level 2. |
| `STEP_UP_FRESHNESS_SECONDS` | How old a step-up may be, 10 to 900; default 300. |

## Realm settings (`infra/compose/keycloak/realm.json`)

| Setting | Value | Why |
|---|---|---|
| `organizationsEnabled` | `true` | A tenant is a Keycloak organization; its `tenant_id` attribute names the tenant (set when U8 provisions it). |
| Client `partledger-api` | confidential, standard flow only, PKCE `S256` required, no direct grants, no implicit flow | The API is the only OpenID Connect client. |
| Client mapper `partledger_organization` | organization membership, with id and attributes, in access and id tokens | The API reads the tenant from it and refuses zero or several organizations. It is filled only when the `organization` scope is requested, which the sign-in does. |
| Client mapper audience | adds `partledger-api` to `aud` | The API checks the audience. |
| `fullScopeAllowed` | `false` | No realm roles in tokens; roles are tenant rows (R3). |
| `bruteForceProtected` | `true`, 5 failures, 60 s wait rising to 15 min | Repeated failed sign-ins lock the account temporarily. |
| `firstBrokerLoginFlow` | built-in `first broker login`, no `idp-auto-link` | A brokered login whose email matches an existing account is never linked automatically; the person must confirm and re-authenticate. Keep `trustEmail` off on every identity provider. |
| `adminEventsEnabled`, `adminEventsDetailsEnabled`, `eventsEnabled` | `true` | Admin and login events are recorded (KTD41); production ships them to the in-region log store. |
| `registrationAllowed` | `false` | Accounts are invited (U8). |
| `resetPasswordAllowed`, `resetCredentialsFlow` | `false`, `partledger reset credentials` | No forgot-password; the bound flow has no OTP reset and refuses accounts without `password-account` (see Step-up). |
| Realm role `password-account` | given by U8 to invited local accounts only | The only accounts the reset flow would serve. |
| `browserFlow`, `acr.loa.map` | `partledger browser`, `{"sign-in":1,"step-up":2}` | Levels of authentication for step-up (see Step-up). |
| `partledger post broker login` | set as every identity provider's post login flow | Brokered logins count as sign-in and can step up. |
| Client `partledger-api-admin` | service account, `manage-users` only | Second-factor resets (U29); its residual scope is described under Step-up. |
| `redirectUris` | the local staff app only | Each environment sets its own origin; nothing else may receive codes. |

Keycloak itself runs with `--features-disabled=impersonation`, and the API refuses any token with an `impersonator` claim as a second line.

The client secret is not in `realm.json`. After an import, regenerate it (Clients > `partledger-api` > Credentials, or the command below) and put it in the API's environment.

## Local development

Start Keycloak with the realm imported (the image digest is the pinned `26.4` build):

```bash
docker run --rm --name partledger-keycloak -p 127.0.0.1:8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=local-admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$(openssl rand -base64 18)" \
  -v "$PWD/infra/compose/keycloak/realm.json:/opt/keycloak/data/import/realm.json:ro" \
  quay.io/keycloak/keycloak:26.4@sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007 \
  start-dev --import-realm --features-disabled=impersonation
```

Create a synthetic organization for a local tenant, a synthetic user and the client secret with `kcadm.sh` inside the container (replace the tenant id with a row from your local `tenants` table):

```bash
docker exec -it partledger-keycloak bash -c '
  kc=/opt/keycloak/bin/kcadm.sh
  $kc config credentials --server http://localhost:8080 --realm master --user local-admin
  org=$($kc create organizations -r partledger -i -s name="Synthetic Tenant" -s alias=synthetic-tenant \
    -s "domains=[{\"name\":\"synthetic.test\"}]" -s "attributes={\"tenant_id\":[\"<local tenant uuid>\"]}")
  user=$($kc create users -r partledger -i -s username=synthetic.buyer -s email=synthetic.buyer@synthetic.test \
    -s firstName=Synthetic -s lastName=Buyer -s enabled=true -s emailVerified=true)
  $kc set-password -r partledger --username synthetic.buyer --new-password "<a local password>"
  $kc create organizations/$org/members -r partledger -b "\"$user\""
  client=$($kc get clients -r partledger -q clientId=partledger-api --fields id --format csv --noquotes)
  $kc create clients/$client/client-secret -r partledger
  $kc get clients/$client/client-secret -r partledger'
```

Put the printed secret in `.env` as `KEYCLOAK_CLIENT_SECRET`; do the same for the client `partledger-api-admin` and put its secret in `KEYCLOAK_ADMIN_CLIENT_SECRET`; generate `SESSION_TOKEN_KEY`, start the API and the staff app (`apps/web`, port 5173, which proxies `/api` to `127.0.0.1:3000`), and open `http://127.0.0.1:5173/api/v1/auth/sign-in`. Keycloak asks for the username first and the password on the next page, because organizations are enabled.

Browsers accept `Secure` and `__Host-` cookies over plain HTTP only on `localhost` and `127.0.0.1`; every other environment serves the staff app over HTTPS.

## Tests

- `apps/api/test/step-up.integration.spec.ts` starts Keycloak with this realm, a synthetic customer realm for brokering and a local mail catcher, and drives step-up with enrolment and one-time codes (an authenticator in the test), the freshness window, the retry with the same idempotency key, a brokered user's enrolment, the forgot-password flow and the second-factor reset.
- `apps/api/test/auth.integration.spec.ts` starts Keycloak with this realm (plus a synthetic customer realm for brokering) and drives sign-in, sign-out, organizations, the disabled-user refresh, key rotation, brute-force lockout, the no-auto-link rule and the realm settings.
- `apps/api/test/staff-sessions.integration.spec.ts` covers idle and absolute timeouts and refresh outcomes with a stand-in identity provider.
- `apps/web/e2e/login.spec.ts` signs in and out in Chromium through the staff app's proxy. Playwright starts the stack with `apps/api/test/e2e/staff-stack.ts` (PostgreSQL and Keycloak containers, the built API on port 3000), which generates the synthetic user's password per run.

## Operations

- Upgrade Keycloak quarterly: read the release notes for changes to organizations, the organization membership mapper and the first broker login flow, update the image digest here, in `apps/api/test/support/keycloak.ts` and in `docs/runbooks/cloud-session-setup.md`, and run the auth integration tests.
- Signing keys can be rotated at any time: add a new RS256 provider with a higher priority, then remove the old one after the access token lifespan. The API picks up the new key on the first token that names it.
- Disabling a user in Keycloak ends their API sessions within one refresh interval. Ending a Keycloak session (Users > Sessions > Sign out) does the same.
