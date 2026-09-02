const REQUIRED = ["APS_CLIENT_ID", "APS_CLIENT_SECRET", "APS_BUCKET_KEY", "PUBLIC_BASE_URL"] as const;

const missing = REQUIRED.filter((name) => !Bun.env[name]);
if (missing.length > 0) {
  console.error(`[config] Missing ${missing.join(", ")}.`);
  console.error(`[config] Copy .env.example to .env and fill it in (see README).`);
  process.exit(1);
}

// The check above is what makes these assertions true.
export const APS_CLIENT_ID = Bun.env.APS_CLIENT_ID!;
export const APS_CLIENT_SECRET = Bun.env.APS_CLIENT_SECRET!;
export const APS_BUCKET_KEY = Bun.env.APS_BUCKET_KEY!;
export const BASE_URL = Bun.env.PUBLIC_BASE_URL!.replace(/\/$/, "");

export const APS_BASE = Bun.env.APS_BASE ?? "https://developer.api.autodesk.com";
export const PORT = Number(Bun.env.PORT ?? "8080");
export const DEVELOPMENT = Bun.env.NODE_ENV !== "production";
