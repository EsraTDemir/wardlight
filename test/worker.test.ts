import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import worker from "../src/index";
import type { Env } from "../src/types";

const secret = "test-signing-secret";
const securityHeaders = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
const payload = {
  schema_version: 1,
  source: "ghostwatch",
  run: {
    event_id: "c012d939-f1f5-4c6f-a757-0509707c22cc",
    observed_at: "2026-08-09T13:52:00Z",
    workflow_run_id: "123",
    workflow_run_attempt: 1,
    collector_version: "git:8e071c0b",
    summary: { tracked_postings: 1, scored_postings: 1 },
  },
  observations: [
    {
      posting_key: "0123456789abcdef0123",
      title: "Security Analyst",
      company: "Example",
      location: null,
      first_seen_at: "2026-08-07",
      last_seen_at: "2026-08-09",
      times_seen: 3,
      external_ids: ["123"],
      claimed_posted_dates: ["2026-08-08"],
      sources: ["greenhouse"],
      description_hashes: ["abcdef0123456789abcd"],
      last_salary: null,
      description_length: 512,
      canonical_url: "https://boards.example.test/jobs/123",
      score: 35,
      verdict: "watch",
      tags: [],
      reasons: [{ rule: "GH-006", weight: 10, evidence: "Salary missing" }],
      scored_at: "2026-08-09",
    },
  ],
};

function fakeEnvironment(): {
  env: Env;
  statements: D1PreparedStatement[];
} {
  const statements: D1PreparedStatement[] = [];
  const database = {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
      }),
    }),
    batch: async (batch: D1PreparedStatement[]) => {
      statements.push(...batch);
      return [];
    },
  } as unknown as D1Database;

  return {
    env: {
      ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
      WARDLIGHT_DB: database,
      WARDLIGHT_INGEST_SIGNING_SECRET: secret,
    },
    statements,
  };
}

function duplicateEnvironment(bodySha256: string): Env {
  const responseJson = JSON.stringify({
    event_id: payload.run.event_id,
    run_id: "123",
    accepted: 1,
    duplicate: false,
  });
  const database = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ body_sha256: bodySha256, response_json: responseJson }),
      }),
    }),
    batch: async () => [],
  } as unknown as D1Database;

  return {
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    WARDLIGHT_DB: database,
    WARDLIGHT_INGEST_SIGNING_SECRET: secret,
  };
}

function publicSummaryEnvironment(): Env {
  const database = {
    prepare: (statement: string) => ({
      bind: () => ({
        first: async () => {
          if (statement.includes("tracked_postings")) {
            return {
              tracked_postings: 82,
              last_observed_at: "2026-08-09",
            };
          }
          return { latest_score_date: "2026-08-09" };
        },
        all: async () => ({
          results: [
            { verdict: "active", count: 69 },
            { verdict: "watch", count: 12 },
            { verdict: "likely_ghost", count: 1 },
          ],
        }),
      }),
    }),
  } as unknown as D1Database;

  return {
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    WARDLIGHT_DB: database,
    WARDLIGHT_INGEST_SIGNING_SECRET: secret,
  };
}

async function signedRequest(
  body: unknown,
  suppliedSignature?: string,
): Promise<Request> {
  const serialized = JSON.stringify(body);
  const data = new TextEncoder().encode(serialized);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, data)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

  return new Request("https://api.wardlight.app/api/v1/ingestions/ghostwatch", {
    method: "POST",
    headers: {
      authorization: `HMAC-SHA256 ${suppliedSignature ?? signature}`,
      "content-type": "application/json",
      "x-wardlight-event-id": payload.run.event_id,
      "x-wardlight-timestamp": String(Math.floor(Date.now() / 1_000)),
    },
    body: serialized,
  });
}

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(securityHeaders)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

describe("GhostWatch ingestion endpoint", () => {
  it("adds security headers to the health check", async () => {
    const { env } = fakeEnvironment();

    const response = await worker.fetch(
      new Request("https://api.wardlight.app/healthz"),
      env,
    );

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it("accepts a correctly signed valid payload and writes an atomic batch", async () => {
    const { env, statements } = fakeEnvironment();

    const response = await worker.fetch(await signedRequest(payload), env);

    expect(response.status).toBe(202);
    expectSecurityHeaders(response);
    await expect(response.json()).resolves.toEqual({
      event_id: payload.run.event_id,
      run_id: "123",
      accepted: 1,
      duplicate: false,
    });
    expect(statements).toHaveLength(3);
  });

  it("rejects a request with an invalid signature before touching D1", async () => {
    const { env, statements } = fakeEnvironment();

    const response = await worker.fetch(
      await signedRequest(payload, "0".repeat(64)),
      env,
    );

    expect(response.status).toBe(401);
    expectSecurityHeaders(response);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_failed",
        message: "The request signature is invalid.",
      },
    });
    expect(statements).toHaveLength(0);
  });

  it("returns a successful duplicate response for an exact replay", async () => {
    const encodedBody = new TextEncoder().encode(JSON.stringify(payload));
    const environment = duplicateEnvironment(
      await sha256Hex(encodedBody),
    );

    const response = await worker.fetch(await signedRequest(payload), environment);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      event_id: payload.run.event_id,
      run_id: "123",
      accepted: 1,
      duplicate: true,
    });
  });

  describe("public summary endpoint", () => {
    it("returns aggregate live metrics with restricted CORS", async () => {
      const response = await worker.fetch(
        new Request("https://api.wardlight.app/api/v1/public/summary", {
          headers: { origin: "https://wardlight.app" },
        }),
        publicSummaryEnvironment(),
      );

      expect(response.status).toBe(200);
      expectSecurityHeaders(response);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://wardlight.app",
      );
      await expect(response.json()).resolves.toEqual({
        source: "ghostwatch",
        tracked_postings: 82,
        last_observed_at: "2026-08-09",
        latest_score_date: "2026-08-09",
        verdicts: {
          active: 69,
          watch: 12,
          likely_ghost: 1,
          ghost: 0,
        },
      });
    });

    it("handles the browser preflight without enabling arbitrary origins", async () => {
      const response = await worker.fetch(
        new Request("https://api.wardlight.app/api/v1/public/summary", {
          method: "OPTIONS",
          headers: { origin: "https://untrusted.example" },
        }),
        publicSummaryEnvironment(),
      );

      expect(response.status).toBe(204);
      expectSecurityHeaders(response);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET, OPTIONS",
      );
    });
  });
});
