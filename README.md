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

## Production activation

The committed `database_id` is deliberately a placeholder. Activate production in
this order:

1. Authenticate the deployment machine with `npx wrangler login`.
2. Create the production database with `npx wrangler d1 create wardlight`, then
   replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.
3. In the Cloudflare dashboard, attach the deployed Worker to the custom domain
   `api.wardlight.app`. The existing static asset binding continues to serve the
   landing page; only `/api/*` and `/healthz` run Worker code.
4. Apply the schema with
   `npx wrangler d1 migrations apply wardlight --remote --config wrangler.jsonc`.
5. Generate a high-entropy shared secret, then set it in Cloudflare with
   `npx wrangler secret put WARDLIGHT_INGEST_SIGNING_SECRET`.
6. Deploy with `npm ci` followed by
   `npx wrangler deploy --config wrangler.jsonc`.
7. In `EsraTDemir/GHOSTWATCH` Actions secrets, set
   `WARDLIGHT_INGEST_URL=https://api.wardlight.app/api/v1/ingestions/ghostwatch`
   and set `WARDLIGHT_INGEST_SIGNING_SECRET` to the exact same generated secret.
8. Use the GhostWatch workflow's manual dispatch, then confirm its delivery step
   receives `202` and inspect D1's `ingestion_events`, `postings`, and
   `posting_score_snapshots` tables.

Do not commit the production database ID if it is considered infrastructure
metadata in your organization, and never commit or print the signing secret.