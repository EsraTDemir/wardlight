# Wardlight

Wardlight serves the existing public landing page and an authenticated GhostWatch
ingestion API from a Cloudflare Worker backed by D1.

## Local setup

1. Run `npm install`.
2. Create a local D1 database and replace the placeholder `database_id` in
   `wrangler.jsonc` with its D1 ID.
3. Apply the migration with `npx wrangler d1 migrations apply wardlight --local`.
4. Create `.dev.vars` with `WARDLIGHT_INGEST_SIGNING_SECRET=<local secret>`.
5. Run `npm run dev`.

## Ingestion

`POST /api/v1/ingestions/ghostwatch` accepts schema version 1 GhostWatch batches.
Requests must include an HMAC-SHA-256 signature over the exact JSON bytes:

- `Authorization: HMAC-SHA256 <hex signature>`
- `X-Wardlight-Timestamp: <Unix seconds>`
- `X-Wardlight-Event-Id: <UUID matching run.event_id>`

The Worker permits timestamps within five minutes, validates every observation,
and records each event id transactionally so retrying the same payload is safe.

For production, provision `WARDLIGHT_INGEST_SIGNING_SECRET` with
`npx wrangler secret put WARDLIGHT_INGEST_SIGNING_SECRET`. Configure the same
value as the `WARDLIGHT_INGEST_SIGNING_SECRET` secret in the `GHOSTWATCH`
repository, alongside `WARDLIGHT_INGEST_URL`.