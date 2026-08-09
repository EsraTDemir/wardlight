export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

const DEFENSIVE_HEADERS = {
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export function defensiveHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);

  for (const [name, value] of Object.entries(DEFENSIVE_HEADERS)) {
    headers.set(name, value);
  }

  return headers;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: defensiveHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
}

export function error(status: number, errorBody: ApiError): Response {
  return json({ error: errorBody }, status);
}
