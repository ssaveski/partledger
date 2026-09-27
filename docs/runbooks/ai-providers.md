# AI providers and the suggestion store

The AI layer lives in `apps/api/src/ai/`, and the key service in `apps/api/src/keys/` (plan U11, KTD25, KTD36). AI only suggests: its output is stored as a pending suggestion, and a person accepts or rejects it.

## How a call is made

- A configuration is a closed union: `anthropic`, `openai` (with `us` or `eu` residency), `azure_openai` (with a resource name and its Azure region) or `mistral`, plus `local` for development. Names are checked against patterns, and no field takes a URL.
- Each provider has one fixed endpoint in `provider-factory.ts`. The model is built for each call, and always gets an explicit key and base URL. So the SDK's environment fallbacks, such as `ANTHROPIC_BASE_URL` or `OPENAI_API_KEY`, are never read. A bare model-id string is refused, because the AI SDK would route it through Vercel's gateway.
- Every request goes through the egress allowlist (`egress-allowlist.ts`). It allows HTTPS on port 443 to that provider's host only, with no redirects. Every address the host resolves to must be public, so private, loopback, link-local and metadata addresses are all refused.
- Documents are sent as data between `<document>` delimiters, and the call offers no tools. The answer is parsed with the caller's zod schema. The schema uses `.nullable()`, never `.optional()`, and `assertStrictOutputSchema` enforces this. An answer that fails the schema fails the job item, and nothing is stored.

## Which configuration a tenant uses

- `tenants.ai_provider = platform_default` means the tenant uses the platform configuration (`AI_PLATFORM_*`). `AI_PLATFORM_PROVIDER=none` switches AI off.
- A tenant admin sets the tenant's own key with `ai.configureProvider`. This needs a recent step-up. The key is envelope-encrypted through the key service into `tenant_ai_keys`, under a new reference. It is never returned, logged or put in the audit chain.
- The tenant's own configuration is used only when it is complete. That means a stored key exists under the tenant's reference, for the tenant's provider, it decrypts, and the whole configuration passes the closed union. Otherwise the platform default is used in full. The two are never mixed field by field.
- If the key service is unreachable, the call fails as unavailable. It does not fall back to the platform, so an outage never sends the tenant's documents to another provider.
- With `ai_region_restricted`, the call must be processed in the tenant's region, or it is refused with `Unprocessable.aiRegionNotAllowed`. Where each provider processes calls:
  - Anthropic: `us`.
  - Mistral: `eu`.
  - OpenAI: its residency endpoint.
  - Azure OpenAI: the resource's region, as the tenant admin declared it. `canadacentral` and `canadaeast` map to `ca`; the EU regions map to `eu`.

## Roles

- Suggestions are stored through `AI_WORKER_DATABASE_URL`, which connects as `pl_ai_worker`. That role can insert suggestions, commitments and audit entries, and read the chain head, and nothing else. It cannot read suggestions or change any row. The boot check refuses any other role.
- Each suggestion's audit entry has actor type `ai_agent` and acts under the job that asked for it. Its value is a commitment.
- `ai.acceptSuggestion` and `ai.rejectSuggestion` are a person's commands. Accepting re-checks the target's version and applies the value through the module's target in `ai/targets/<module>.ts`.
- A job that asks for suggestions must call `AiSuggestions.suggest` before it appends anything to the audit chain in its own transaction. Both appends take the tenant's chain lock.

## Key service

- `KEY_SERVICE_ADAPTER=local` is for development and tests only, and production refuses it.
- Regions use `ovh_kms`. The OVHcloud KMS wraps each data key with the symmetric service key `OVH_KMS_ENCRYPTION_KEY_ID`, and signs with the ECDSA P-256 service key `OVH_KMS_SIGNING_KEY_ID`, which U21 uses. Calls use the KMS domain's mutual-TLS client certificate.
- Before the first region goes live (U24), check the adapter's REST paths and bodies against the OVHcloud KMS API documentation. The adapter uses `servicekey/{id}/datakey`, `datakey/decrypt`, `sign` and `?format=jwk`.

## Live smoke call, once per configured provider

Tests never call a real provider. Every test uses the local model or a stand-in network. Before a provider is offered in a region, make one live call from the region's network with a synthetic document. Use a key from the secret store, set only in the shell. The request below has the same shape as the one the adapter sends. A pass is HTTP 200 with a JSON answer that matches the schema. Record the date, the provider, the model and the result in the region's residency checklist (U33).

Set these in the shell first:

```sh
SCHEMA='{"type":"object","properties":{"certificateNumber":{"type":["string","null"]}},"required":["certificateNumber"],"additionalProperties":false}'
DOC='<document>\nSynthetic certificate SYN-0001, valid until 2030-01-31.\n</document>'
```

Anthropic (`api.anthropic.com`):

```sh
curl -sS https://api.anthropic.com/v1/messages \
  -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":256,\"output_config\":{\"format\":{\"type\":\"json_schema\",\"schema\":$SCHEMA}},\"messages\":[{\"role\":\"user\",\"content\":\"$DOC\"}]}"
```

OpenAI (`api.openai.com`, or `eu.api.openai.com` for EU residency):

```sh
curl -sS https://eu.api.openai.com/v1/responses -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"input\":\"$DOC\",\"text\":{\"format\":{\"type\":\"json_schema\",\"strict\":true,\"name\":\"response\",\"schema\":$SCHEMA}}}"
```

Azure OpenAI (`<resource>.openai.azure.com`):

```sh
curl -sS "https://$RESOURCE.openai.azure.com/openai/v1/chat/completions" -H "api-key: $KEY" -H 'content-type: application/json' \
  -d "{\"model\":\"$DEPLOYMENT\",\"messages\":[{\"role\":\"user\",\"content\":\"$DOC\"}],\"response_format\":{\"type\":\"json_schema\",\"json_schema\":{\"name\":\"response\",\"strict\":true,\"schema\":$SCHEMA}}}"
```

Mistral (`api.mistral.ai`):

```sh
curl -sS https://api.mistral.ai/v1/chat/completions -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"$DOC\"}],\"response_format\":{\"type\":\"json_schema\",\"json_schema\":{\"name\":\"response\",\"schema\":$SCHEMA}}}"
```

After the first feature job exists (U12's column mapping), repeat the check through the platform. Set `AI_PLATFORM_*` to the provider, then import a synthetic spreadsheet. Confirm that a pending suggestion appears, with the provider, model and region you expect.
