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

A lost second factor is reset only by the `auth.resetSecondFactor` command: a tenant admin with a fresh step-up names a user of their own tenant who belongs to no other tenant (not themselves; a user of several tenants would keep their staff sessions in the others, so the reset is refused with `pl.error.forbidden.notPermitted`); the API ends the user's staff sessions (`second_factor_reset`) and, in the same transaction, appends an audit entry whose actor is the admin and whose payload holds only ids and counts, and enqueues the `auth.resetSecondFactor` job (KTD16). Once the command has committed, the job removes the user's `otp` credentials and ends their Keycloak sessions through the admin API, retrying every 30 seconds while Keycloak is unreachable, and appends its own `auth.secondFactorRemoved` entry. Until the job has run, the user has no staff session but could still sign in again with the old factor; a failed job shows in the job runner's failed jobs (`docs/runbooks/jobs.md`). The user enrols a new factor at their next step-up. The role directory reads the tenant's `role_assignments` (U8).

### The API's service account

The client `partledger-api-admin` is confidential, has only the service-account grant, and its scope holds exactly one role, `realm-management` `manage-users` (`fullScopeAllowed` is off; the role reaches the token through the client's scope mapping). The API uses it for the second-factor reset: it reads a user's organizations and credentials, deletes `otp` credentials and ends the user's Keycloak sessions. Regenerate its secret after an import, like the API client's, and put it in `KEYCLOAK_ADMIN_CLIENT_SECRET`.

**Residual scope (owner decision, 2026-09-27).** KTD20 has the service account manage membership only; Keycloak 26.4 cannot narrow it that far. The owner accepted the residual scope below and chose two accounts: this one keeps `manage-users` for the second-factor reset only, and a separate organizations account (U8, below) holds `manage-realm` and `manage-users` for provisioning and membership only.

Why the scope cannot be narrower:

- Deleting a credential and ending a user's sessions need `manage` on that user, and Keycloak grants `manage` on users only whole: with `manage-users` the account can also set any user's password, change their e-mail, add federated identity links, send required-action e-mails, and create or delete users, in every tenant of the realm. `view-users` is not needed and is not granted.
- Fine-grained admin permissions v2 (probed on 26.4 with `adminPermissionsEnabled`) give the same `manage` scope on users: a permission on all users allowed the same calls, a `manage`-only permission without `view` allowed none of them, and a negative permission on the `reset-password` scope denied the users entirely rather than that one call. Its target is a fixed list of users or group members, not an organization, so it cannot confine the account to one tenant either.
- Adding organization members needs `manage-realm` (probed: no narrower role allows it; with `manage-users` the call answers 403). This account never holds it, since `manage-realm` can change the realm's flows, identity providers and settings; U8's separate organizations account does.

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
| `KEYCLOAK_ORGANIZATIONS_CLIENT_ID`, `KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET` | The organizations account (`partledger-api-organizations`, U8). |
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
| Client `partledger-api-organizations` | service account, `manage-realm` and `manage-users` | Organizations and their members (U8); its residual scope is described under Tenants, members and roles. |
| `redirectUris` | the local staff app only | Each environment sets its own origin; nothing else may receive codes. |

Keycloak itself runs with `--features-disabled=impersonation`, and the API refuses any token with an `impersonator` claim as a second line.

The client secret is not in `realm.json`. After an import, regenerate it (Clients > `partledger-api` > Credentials, or the command below) and put it in the API's environment.

## Tenants, members and roles (U8)

- **Membership lives in two places, with different jobs.** Keycloak knows who belongs to a tenant: one organization per tenant, whose `tenant_id` attribute names the tenant. The platform knows what each person may do: `memberships` and `role_assignments` rows in the tenant, changed only by the audited commands `members.invite`, `members.remove`, `members.grantRole` and `members.revokeRole`, and read on every request. A sign-in is refused to anyone without a current membership row, even if Keycloak lists them in the organization.
- **The organizations account** is the confidential client `partledger-api-organizations` (service accounts only, `fullScopeAllowed` off), separate from `partledger-api-admin`, which keeps `manage-users` for the second-factor reset only. The API uses it only in the organizations adapter (`apps/api/src/tenants/keycloak-organizations.ts`): to create a tenant's organization, create an invited person's account, give it the `password-account` realm role and add it to that one organization, and to remove a member from the organization and end their Keycloak sessions. `password-account` is the only role it ever assigns. Its secret is regenerated after import, like `partledger-api`'s, and goes in `KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET` (client id `KEYCLOAK_ORGANIZATIONS_CLIENT_ID`, default `partledger-api-organizations`).
- **Decision (owner, 2026-09-27): two service accounts, and the organizations account holds `manage-realm` and `manage-users`.** Keycloak 26.4 requires `manage-realm` to create an organization and to add or remove its members, and organizations have no fine-grained admin permission type; creating, looking up and deleting the invited person's account needs `manage-users` (probed: with `manage-realm` alone those calls answer 403). The owner accepted the residual scope:
  - With `manage-realm` the account can change the realm's settings, flows and identity providers, and every organization in the realm, not only its own tenant's.
  - With `manage-users` it can create, change and delete any user of the realm, including setting a user's password (probed: `reset-password` answers 204), in every tenant of the realm.
  - Keycloak does refuse it some things, checked by `tenants.integration.spec.ts`: it cannot create clients (403), and impersonation is switched off in the server (`--features-disabled=impersonation`; 501). Nothing else is refused to it; the API only ever assigns `password-account`.
  - Mitigations: the secret lives only in the API's environment, the adapter is the only caller, and Keycloak's admin events record every call the account makes.
- **Inviting** creates the account with the email as username and the required action `UPDATE_PASSWORD`, and adds it to the tenant's organization only. The invitation email follows with the email port (U34); until then an administrator sends Keycloak's "execute actions" email from the admin console.
- **An existing account is adopted or refused.** If an account with that email already exists, the API looks it up. When it belongs to no organization (a member removed earlier, from this tenant or another) or already to this tenant's organization (an invitation retried after a failure that followed the account's creation), it joins this organization and gets a new membership with no roles: roles are always granted afresh. When it belongs to another organization, the invitation answers `alreadyExists`, because an account in two organizations could never sign in. A person therefore cannot be invited while they are a member of another tenant anywhere in the realm; they must be removed there first.
- **Removing a member** is a KTD20 high-impact command (`stepUp: true`, impact `role_change`): without a recent step-up it answers `StepUpRequired` and changes nothing, and the staff app offers "Confirm your identity", which runs U29's step-up and then makes the removal once with the same idempotency key. It revokes every role, records the removal and ends every API session of the person (`membership_removed`) in the command's transaction, which commits whether Keycloak answers or not: the person has lost access at once. The same transaction enqueues `members.leaveOrganization`, a job that removes them from the organization and ends their Keycloak sessions, retried every minute (20 attempts) until Keycloak answers; a member already gone counts as done, and a member invited again meanwhile is left in. A job that runs out of retries shows in `job_item_outcomes` as failed; an operator then removes the person from the organization by hand.
- **Role grants and revocations** are KTD20 high-impact commands and demand a recent step-up; a refused change offers "Confirm your identity" in the same way. The first tenant administrator is created by provisioning.

## Operators (`infra/compose/keycloak/operator-realm.json`)

Operators sign in through their own realm, `partledger-operators`, never through a tenant's realm (KTD20, R4).

| Setting | Value | Why |
|---|---|---|
| `browserFlow` | `operator browser`: the SSO cookie, or the password form followed by a REQUIRED one-time code form | Every operator sign-in needs a second factor; an operator without one enrols at first sign-in. There is no single-factor path. |
| OTP policy | TOTP, HmacSHA1, 6 digits, 30 s, codes not reusable | Works with common authenticator apps. |
| Client `partledger-operator-console` | public, standard flow with PKCE `S256`, loopback redirect `http://127.0.0.1/operator-callback` (any port) | An operator console or CLI on the operator network signs in and keeps the access token. |
| Audience mapper | adds `partledger-operator-api` | The operator listener checks the audience and that the token was issued to the console. |
| Brute-force detection, admin events, no registration, no password reset | on, on, off, off | As in the staff realm. |

The operator listener (`OPERATOR_HOST`, `OPERATOR_PORT`, bound to the operator network only) accepts two credentials: break-glass grants (`platform_operator` credentials, U30) and, for one route only, the operator realm's access token. That route is `POST /api/v1/operator/tenants`, which provisions a tenant:

1. It refuses a region other than `CELL_REGION` and a slug the directory already holds.
2. It creates the tenant's Keycloak organization with `tenant_id` set, and the first administrator's account in that organization.
3. In one transaction whose `app.tenant_id` is the new tenant, it inserts the tenant (region fixed for good), its directory entry, the administrator's membership and `tenant_admin` role, the enrolment in the scheduled jobs (`enqueueTenantEnrolment`, see `docs/runbooks/jobs.md`), and the genesis of the tenant's audit chain, acted by the operator under `operator_sign_in`. Names and emails enter the chain only as commitments.
4. If the transaction does not commit, the organization and the account are removed again.

A provisioning interrupted between steps 2 and 3 (the process stopped) leaves an organization whose tenant does not exist. Provisioning the same slug again finds it by its alias first: if the `tenant_id` it names has no tenant row, the organization is deleted with the accounts that belong to it alone, and provisioning continues; an organization whose tenant exists is a conflict (409).

Configure it with `OPERATOR_KEYCLOAK_ISSUER` (https in production), `OPERATOR_KEYCLOAK_CLIENT_ID` and `OPERATOR_KEYCLOAK_AUDIENCE`.

## The directory

`GET /api/v1/directory/<slug>` on the staff listener answers `{ "regionUrl": … }` for a provisioned tenant, from `DIRECTORY_REGION_URLS`, and 404 otherwise. The `directory_entries` table holds a slug and a region and nothing else; it is the one table the catalog check allows to be global (readable before any tenant is known, with no `tenant_id`), and its insert policy admits only the slug and region of the tenant the provisioning transaction can see.

In Release 1 the directory is cell-local: it lives in each region's database, knows only that region's tenants, and a slug is unique per cell, not across regions. A directory shared by every cell, with slugs unique across regions, is a follow-up that must land before a second region goes live.

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

The API refuses a sign-in without a membership row, so give the synthetic user one, as the database owner with the tenant's context set (or provision the tenant through the operator route above, which does all of this):

```sql
begin;
select set_config('app.tenant_id', '<local tenant uuid>', true);
with membership as (
  insert into memberships (tenant_id, user_id, email, display_name, invited_at)
    values ('<local tenant uuid>', '<the user id kcadm printed>', 'synthetic.buyer@synthetic.test', 'Synthetic Buyer', now())
    returning id
)
insert into role_assignments (tenant_id, membership_id, role, granted_at)
  select '<local tenant uuid>', id, 'buyer', now() from membership;
commit;
```

Put the printed secret in `.env` as `KEYCLOAK_CLIENT_SECRET`; do the same for the clients `partledger-api-admin` and `partledger-api-organizations` and put their secrets in `KEYCLOAK_ADMIN_CLIENT_SECRET` and `KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET`; generate `SESSION_TOKEN_KEY`, start the API and the staff app (`apps/web`, port 5173, which proxies `/api` to `127.0.0.1:3000`), and open `http://127.0.0.1:5173/api/v1/auth/sign-in`. Keycloak asks for the username first and the password on the next page, because organizations are enabled.

Browsers accept `Secure` and `__Host-` cookies over plain HTTP only on `localhost` and `127.0.0.1`; every other environment serves the staff app over HTTPS.

## Tests

- `apps/api/test/step-up.integration.spec.ts` starts Keycloak with this realm, a synthetic customer realm for brokering and a local mail catcher, and drives step-up with enrolment and one-time codes (an authenticator in the test), the freshness window, the retry with the same idempotency key, a brokered user's enrolment, the forgot-password flow and the second-factor reset.
- `apps/api/test/auth.integration.spec.ts` starts Keycloak with this realm (plus a synthetic customer realm for brokering) and drives sign-in, sign-out, organizations, the disabled-user refresh, key rotation, brute-force lockout, the no-auto-link rule and the realm settings.
- `apps/api/test/staff-sessions.integration.spec.ts` covers idle and absolute timeouts and refresh outcomes with a stand-in identity provider.
- `apps/api/test/tenants.integration.spec.ts` starts Keycloak with both realms and drives operator sign-in with a one-time code, provisioning, invitations, role changes, removal and the directory.
- `apps/web/e2e/live/login.spec.ts` signs in and out in Chromium through the staff app's proxy. Playwright starts the stack with `apps/api/test/e2e/staff-stack.ts` (PostgreSQL and Keycloak containers, the built API on port 3000), which generates the synthetic user's password per run.

## Operations

- Upgrade Keycloak quarterly: read the release notes for changes to organizations, the organization membership mapper and the first broker login flow, update the image digest here, in `apps/api/test/support/keycloak.ts` and in `docs/runbooks/cloud-session-setup.md`, and run the auth integration tests.
- Signing keys can be rotated at any time: add a new RS256 provider with a higher priority, then remove the old one after the access token lifespan. The API picks up the new key on the first token that names it.
- Disabling a user in Keycloak ends their API sessions within one refresh interval. Ending a Keycloak session (Users > Sessions > Sign out) does the same.
