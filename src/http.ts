export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function error(status: number, errorBody: ApiError): Response {
  return json({ error: errorBody }, status);
}
