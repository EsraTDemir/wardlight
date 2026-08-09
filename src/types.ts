export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  WARDLIGHT_DB: D1Database;
  WARDLIGHT_INGEST_SIGNING_SECRET: string;
}
