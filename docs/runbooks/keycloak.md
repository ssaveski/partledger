# Keycloak: staff sign-in

Staff sign in through Keycloak 26, one instance per region (plan KTD20). This runbook covers local development, the realm's settings and why they are set, and how the API's sessions work. Everything here uses synthetic users only.

## How sign-in works

1. The staff app sends the browser to `GET /api/v1/auth/sign-in?returnTo=/path` on its own origin (the app proxies `/api` to the API's staff listener).
2. The API creates a one-time `state`, `nonce` and PKCE verifier, seals them in an encrypted `__Host-pl_sign_in` cookie (HttpOnly, Secure, SameSite=Lax, ten minutes; Lax because Keycloak's redirect back is a cross-site navigation) and redirects to Keycloak's authorization endpoint with `scope=openid organization` and an S256 code challenge.
3. Keycloak redirects to `GET /api/v1/auth/callback`. The API checks the state against the cookie, exchanges the code as a confidential client, and validates the access and id tokens against the realm's JWKS: issuer, audience (`partledger-api`), expiry, token type, authorized party, nonce, a uuid subject, no `impersonator` or `act` claim, and exactly one organization carrying one `tenant_id`. The tenant must exist in this region.
4. The API issues a `staff_session` credential (resolved later through `resolve_credential`), stores a `staff_sessions` row in the tenant with the refresh token encrypted, and sets `__Host-pl_session=pls_<id>_<secret>` (HttpOnly, Secure, SameSite=Strict, `Path=/`, no `Domain`).
5. Every request on the staff listener presents that cookie. The API verifies the credential, then checks the session row: ended sessions and sessions idle for longer than the idle timeout are refused; once the refresh interval has passed, the API refreshes against Keycloak and ends the session if Keycloak refuses (a disabled user, an ended Keycloak session) or returns a token for another user or tenant. If Keycloak cannot be reached, the request is refused and the session is kept.
6. `POST /api/v1/auth/sign-out` ends the session row, ends the Keycloak session through its logout endpoint and clears the cookie. `GET /api/v1/auth/session` returns the user id, tenant id and both expiries, or the uniform 401.

The browser never receives a token. The staff listener reads only the session cookie and ignores `Authorization` headers, so a session cannot be replayed as a bearer token; the other listeners keep their bearer credentials. Every state-changing request on the staff listener must carry `x-partledger-request: staff-app` (see `staffRequestHeader` in `libs/contracts/src/auth.ts`); without it the API answers 403 `pl.error.forbidden.crossSiteRequest`.

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
| `resetPasswordAllowed`, `registrationAllowed` | `false` | Accounts are invited (U8); lost second factors are reset by an audited tenant-admin command (U29). |
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

Put the printed secret in `.env` as `KEYCLOAK_CLIENT_SECRET`, generate `SESSION_TOKEN_KEY`, start the API and the staff app (`apps/web`, port 5173, which proxies `/api` to `127.0.0.1:3000`), and open `http://127.0.0.1:5173/api/v1/auth/sign-in`. Keycloak asks for the username first and the password on the next page, because organizations are enabled.

Browsers accept `Secure` and `__Host-` cookies over plain HTTP only on `localhost` and `127.0.0.1`; every other environment serves the staff app over HTTPS.

## Tests

- `apps/api/test/auth.integration.spec.ts` starts Keycloak with this realm (plus a synthetic customer realm for brokering) and drives sign-in, sign-out, organizations, the disabled-user refresh, key rotation, brute-force lockout, the no-auto-link rule and the realm settings.
- `apps/api/test/staff-sessions.integration.spec.ts` covers idle and absolute timeouts and refresh outcomes with a stand-in identity provider.
- `apps/web/e2e/login.spec.ts` signs in and out in Chromium through the staff app's proxy. Playwright starts the stack with `apps/api/test/e2e/staff-stack.ts` (PostgreSQL and Keycloak containers, the built API on port 3000), which generates the synthetic user's password per run.

## Operations

- Upgrade Keycloak quarterly: read the release notes for changes to organizations, the organization membership mapper and the first broker login flow, update the image digest here and in the tests, and run the auth integration tests.
- Signing keys can be rotated at any time: add a new RS256 provider with a higher priority, then remove the old one after the access token lifespan. The API picks up the new key on the first token that names it.
- Disabling a user in Keycloak ends their API sessions within one refresh interval. Ending a Keycloak session (Users > Sessions > Sign out) does the same.
