import { sha256Hex, verifyHmacSignature } from "./auth";
import { error, json } from "./http";
import { ghostWatchIngestionSchema, type GhostWatchIngestion } from "./ingestion-schema";
import type { Env } from "./types";

const MAX_BODY_BYTES = 1_048_576;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (
      url.pathname === "/api/v1/ingestions/ghostwatch" &&
      request.method === "POST"
    ) {
      return ingestGhostWatch(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function ingestGhostWatch(request: Request, env: Env): Promise<Response> {
  if (!env.WARDLIGHT_INGEST_SIGNING_SECRET) {
    return error(503, {
      code: "ingestion_unavailable",
      message: "The ingestion service is not configured.",
    });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error(422, {
      code: "invalid_content_type",
      message: "Content-Type must be application/json.",
    });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return error(413, {
      code: "payload_too_large",
      message: "Request body exceeds the 1 MiB limit.",
    });
  }

  const authorization = request.headers.get("authorization");
  const signature = authorization?.match(/^HMAC-SHA256 ([a-fA-F0-9]{64})$/)?.[1];
  const timestamp = Number(request.headers.get("x-wardlight-timestamp"));
  const headerEventId = request.headers.get("x-wardlight-event-id");
  if (!signature || !Number.isSafeInteger(timestamp) || !headerEventId) {
    return error(401, {
      code: "authentication_failed",
      message: "A valid HMAC signature, timestamp, and event ID are required.",
    });
  }
  if (Math.abs(Date.now() - timestamp * 1_000) > MAX_CLOCK_SKEW_MS) {
    return error(401, {
      code: "stale_request",
      message: "The request timestamp is outside the allowed five-minute window.",
    });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return error(413, {
      code: "payload_too_large",
      message: "Request body exceeds the 1 MiB limit.",
    });
  }
  if (!await verifyHmacSignature(body, env.WARDLIGHT_INGEST_SIGNING_SECRET, signature)) {
    return error(401, {
      code: "authentication_failed",
      message: "The request signature is invalid.",
    });
  }

  let unknownPayload: unknown;
  try {
    unknownPayload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return error(422, {
      code: "invalid_json",
      message: "Request body must be valid JSON.",
    });
  }

  const parsed = ghostWatchIngestionSchema.safeParse(unknownPayload);
  if (!parsed.success) {
    return error(422, {
      code: "validation_failed",
      message: "Request body does not match ingestion schema version 1.",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  if (parsed.data.run.event_id !== headerEventId) {
    return error(409, {
      code: "event_id_mismatch",
      message: "X-Wardlight-Event-Id must equal run.event_id.",
    });
  }

  const bodySha256 = await sha256Hex(body);
  const existing = await env.WARDLIGHT_DB
    .prepare(
      "SELECT body_sha256, response_json FROM ingestion_events WHERE event_id = ?",
    )
    .bind(parsed.data.run.event_id)
    .first<{ body_sha256: string; response_json: string }>();

  if (existing) {
    if (existing.body_sha256 !== bodySha256) {
      return error(409, {
        code: "event_id_conflict",
        message: "The event ID was previously used with a different payload.",
      });
    }
    return json({ ...JSON.parse(existing.response_json), duplicate: true });
  }

  const responseBody = {
    event_id: parsed.data.run.event_id,
    run_id: parsed.data.run.workflow_run_id,
    accepted: parsed.data.observations.length,
    duplicate: false,
  };

  try {
    await persistIngestion(
      env.WARDLIGHT_DB,
      parsed.data,
      bodySha256,
      JSON.stringify(responseBody),
    );
  } catch (caught) {
    if (isUniqueConstraintViolation(caught)) {
      const racedEvent = await env.WARDLIGHT_DB
        .prepare(
          "SELECT body_sha256, response_json FROM ingestion_events WHERE event_id = ?",
        )
        .bind(parsed.data.run.event_id)
        .first<{ body_sha256: string; response_json: string }>();
      if (racedEvent?.body_sha256 === bodySha256) {
        return json({ ...JSON.parse(racedEvent.response_json), duplicate: true });
      }
    }
    throw caught;
  }

  return json(responseBody, 202);
}

async function persistIngestion(
  database: D1Database,
  payload: GhostWatchIngestion,
  bodySha256: string,
  responseJson: string,
): Promise<void> {
  const receivedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO ingestion_events (
          event_id, source, run_id, body_sha256, workflow_run_id,
          workflow_run_attempt, collector_version, accepted_count, response_json,
          received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        payload.run.event_id,
        payload.source,
        payload.run.workflow_run_id,
        bodySha256,
        payload.run.workflow_run_id,
        payload.run.workflow_run_attempt,
        payload.run.collector_version,
        payload.observations.length,
        responseJson,
        receivedAt,
      ),
  ];

  for (const observation of payload.observations) {
    statements.push(
      database
        .prepare(
          `INSERT INTO postings (
            source, source_posting_key, title, company, location, first_seen_at,
            last_seen_at, times_seen, external_ids_json,
            claimed_posted_dates_json, sources_json, description_hashes_json,
            last_salary, description_length, canonical_url, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_posting_key) DO UPDATE SET
            title = excluded.title,
            company = excluded.company,
            location = excluded.location,
            first_seen_at = excluded.first_seen_at,
            last_seen_at = excluded.last_seen_at,
            times_seen = excluded.times_seen,
            external_ids_json = excluded.external_ids_json,
            claimed_posted_dates_json = excluded.claimed_posted_dates_json,
            sources_json = excluded.sources_json,
            description_hashes_json = excluded.description_hashes_json,
            last_salary = excluded.last_salary,
            description_length = excluded.description_length,
            canonical_url = excluded.canonical_url,
            updated_at = excluded.updated_at`,
        )
        .bind(
          payload.source,
          observation.posting_key,
          observation.title,
          observation.company,
          observation.location,
          observation.first_seen_at,
          observation.last_seen_at,
          observation.times_seen,
          JSON.stringify(observation.external_ids),
          JSON.stringify(observation.claimed_posted_dates),
          JSON.stringify(observation.sources),
          JSON.stringify(observation.description_hashes),
          observation.last_salary,
          observation.description_length,
          observation.canonical_url,
          receivedAt,
        ),
      database
        .prepare(
          `INSERT INTO posting_score_snapshots (
            source, source_posting_key, scored_at, score, verdict, tags_json,
            reasons_json, event_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_posting_key, scored_at) DO UPDATE SET
            score = excluded.score,
            verdict = excluded.verdict,
            tags_json = excluded.tags_json,
            reasons_json = excluded.reasons_json,
            event_id = excluded.event_id,
            created_at = excluded.created_at`,
        )
        .bind(
          payload.source,
          observation.posting_key,
          observation.scored_at,
          observation.score,
          observation.verdict,
          JSON.stringify(observation.tags),
          JSON.stringify(observation.reasons),
          payload.run.event_id,
          receivedAt,
        ),
    );
  }

  await database.batch(statements);
}

function isUniqueConstraintViolation(errorValue: unknown): boolean {
  return errorValue instanceof Error && /unique constraint/i.test(errorValue.message);
}
