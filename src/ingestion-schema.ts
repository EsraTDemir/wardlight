import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date");
const dateTime = z
  .string()
  .datetime({ offset: true, message: "Expected ISO 8601 UTC date-time" });
const hashPrefix = z.string().regex(/^[a-f0-9]{20}$/, "Expected a 20-character lowercase hash");
const boundedString = (max: number) => z.string().trim().min(1).max(max);
const nullableBoundedString = (max: number) =>
  z.string().trim().min(1).max(max).nullable();

const reasonSchema = z
  .object({
    rule: boundedString(32),
    weight: z.number().int().min(0).max(100),
    evidence: boundedString(1_000),
  })
  .strict();

const observationSchema = z
  .object({
    posting_key: hashPrefix,
    title: boundedString(500),
    company: boundedString(500),
    location: nullableBoundedString(500),
    first_seen_at: date,
    last_seen_at: date,
    times_seen: z.number().int().min(1).max(1_000_000),
    external_ids: z.array(boundedString(500)).max(100),
    claimed_posted_dates: z.array(date).max(100),
    sources: z.array(boundedString(64)).min(1).max(20),
    description_hashes: z.array(hashPrefix).min(1).max(100),
    last_salary: nullableBoundedString(500),
    description_length: z.number().int().min(0).max(2_000_000),
    canonical_url: z.string().url().max(2_000).refine(
      (value) => /^https?:\/\//.test(value),
      "Expected an HTTP(S) URL",
    ),
    score: z.number().int().min(0).max(100),
    verdict: z.enum(["active", "watch", "likely_ghost", "ghost"]),
    tags: z.array(boundedString(64)).max(30),
    reasons: z.array(reasonSchema).max(50),
    scored_at: date,
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.last_seen_at < observation.first_seen_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["last_seen_at"],
        message: "last_seen_at must not precede first_seen_at",
      });
    }
  });

export const ghostWatchIngestionSchema = z
  .object({
    schema_version: z.literal(1),
    source: z.literal("ghostwatch"),
    run: z
      .object({
        event_id: z.string().uuid(),
        observed_at: dateTime,
        workflow_run_id: boundedString(100),
        workflow_run_attempt: z.number().int().min(1).max(100),
        collector_version: boundedString(200),
        summary: z
          .object({
            tracked_postings: z.number().int().min(0).max(1_000_000),
            scored_postings: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
      })
      .strict(),
    observations: z.array(observationSchema).min(1).max(500),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.run.summary.scored_postings !== payload.observations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run", "summary", "scored_postings"],
        message: "scored_postings must equal observations.length",
      });
    }
    const keys = new Set<string>();
    payload.observations.forEach((observation, index) => {
      if (keys.has(observation.posting_key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observations", index, "posting_key"],
          message: "posting_key must be unique within a batch",
        });
      }
      keys.add(observation.posting_key);
    });
  });

export type GhostWatchIngestion = z.infer<typeof ghostWatchIngestionSchema>;
