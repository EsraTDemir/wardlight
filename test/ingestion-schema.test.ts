import { describe, expect, it } from "vitest";
import { ghostWatchIngestionSchema } from "../src/ingestion-schema";

const validPayload = {
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

describe("GhostWatch ingestion schema", () => {
  it("accepts a normalized scored observation without raw job text", () => {
    expect(ghostWatchIngestionSchema.parse(validPayload)).toEqual(validPayload);
  });

  it("rejects a duplicate posting within an event", () => {
    const payload = structuredClone(validPayload);
    payload.run.summary.scored_postings = 2;
    payload.observations.push(structuredClone(payload.observations[0]));

    expect(ghostWatchIngestionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a score outside GhostWatch's documented range", () => {
    const payload = structuredClone(validPayload);
    payload.observations[0].score = 101;

    expect(ghostWatchIngestionSchema.safeParse(payload).success).toBe(false);
  });
});
