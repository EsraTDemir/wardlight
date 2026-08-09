# Wardlight

Wardlight has a version-controlled public site in `public/`, deployed through
Netlify, and an authenticated GhostWatch ingestion API deployed through a
Cloudflare Worker backed by D1.

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

`GET /api/v1/public/summary` returns CORS-restricted aggregate GhostWatch
metrics for `wardlight.app`. It intentionally does not expose individual
postings or ingestion records.

## Public site and pilot form

The Netlify public site is the `public/` directory. It includes a local-only
scam-text analyzer, live aggregate Watchtower data, accessible marketing
content, privacy and terms pages, and a Netlify Forms pilot request form.

Create a preview before publishing:

```sh
npx netlify deploy --dir public --site 631bc631-1307-49f1-9e72-f5346f68a22c
```

Publish a reviewed build:

```sh
npx netlify deploy --dir public --prod --site 631bc631-1307-49f1-9e72-f5346f68a22c
```

The `pilot` form must remain in the generated HTML and Netlify form detection
must remain enabled in the Wardlight project. Submissions are available in the
Netlify Forms dashboard.

## Production activation

Cloudflare production is configured to use the `wardlight` D1 database. If
re-provisioning is necessary:

1. Authenticate the deployment machine with `npx wrangler login`.
2. Retain the existing proxied DNS record and Worker route
   `api.wardlight.app/* -> wardlight-api`. Do not add a Custom Domain binding:
   deploying this configuration updates that existing Worker in place and keeps
   the route attached.
3. Apply the schema with
   `npx wrangler d1 migrations apply wardlight --remote --config wrangler.jsonc`.
4. Generate a high-entropy shared secret, then set it in Cloudflare with
   `npx wrangler secret put WARDLIGHT_INGEST_SIGNING_SECRET`.
5. Deploy with `npm ci` followed by
   `npx wrangler deploy --config wrangler.jsonc`.
6. In `EsraTDemir/GHOSTWATCH` Actions secrets, set
   `WARDLIGHT_INGEST_URL=https://api.wardlight.app/api/v1/ingestions/ghostwatch`
   and set `WARDLIGHT_INGEST_SIGNING_SECRET` to the exact same generated secret.
7. Use the GhostWatch workflow's manual dispatch, then confirm its delivery step
   receives `202` and inspect D1's `ingestion_events`, `postings`, and
   `posting_score_snapshots` tables.

Never commit or print the signing secret.