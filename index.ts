import index from "./client/index.html";

const { APS_CLIENT_ID, APS_CLIENT_SECRET, APS_BUCKET_KEY, PUBLIC_BASE_URL } = Bun.env;
if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !APS_BUCKET_KEY || !PUBLIC_BASE_URL) {
  console.error(`[config] Missing one or more of APS_CLIENT_ID, APS_CLIENT_SECRET, APS_BUCKET_KEY, PUBLIC_BASE_URL.`);
  console.error(`[config] Copy .env.example to .env and fill it in (see README).`);
  process.exit(1);
}
const APS_BASE = Bun.env.APS_BASE ?? "https://developer.api.autodesk.com";
const BASE_URL = PUBLIC_BASE_URL!.replace(/\/$/, "");
const PORT = Bun.env.PORT ?? "8080";
const DEVELOPMENT = Bun.env.NODE_ENV !== "production";

async function getToken(scope: string) {
  const res = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) {
    throw new Error(`APS token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

async function listModels() {
  const { access_token } = await getToken("data:read");
  const res = await fetch(`${APS_BASE}/oss/v2/buckets/${encodeURIComponent(APS_BUCKET_KEY!)}/objects?limit=100`, {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  });
  if (!res.ok) {
    throw new Error(`OSS listing failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { items?: Array<{ objectKey: string; objectId: string; }> };
  return (json.items ?? []).map((item) => ({
    name: item.objectKey,
    urn: new TextEncoder().encode(item.objectId).toBase64({ alphabet: "base64url", omitPadding: true }),
  }));
}

/**
 * Screenshots live in memory only, and only for as long as the agent plausibly needs
 * to fetch one. The URLs are unauthenticated, so an unbounded cache would keep every
 * frame of customer geometry ever captured readable for the process lifetime; Map
 * preserves insertion order, so evicting the oldest key is enough.
 */
const MAX_SCREENSHOTS = 32;
const screenshotCache = new Map<string, Uint8Array<ArrayBuffer>>();

function saveScreenshot(png: string): string {
  const base64 = png.startsWith("data:") ? png.slice(png.indexOf(",") + 1) : png;
  const bytes = Uint8Array.fromBase64(base64);
  const id = crypto.randomUUID();
  screenshotCache.set(id, bytes);
  while (screenshotCache.size > MAX_SCREENSHOTS) {
    screenshotCache.delete(screenshotCache.keys().next().value!);
  }
  return id;
}

function getScreenshot(id: string): Uint8Array<ArrayBuffer> | undefined {
  return screenshotCache.get(id.replace(/\.png$/i, ""));
}

const server = Bun.serve({
  port: Number(PORT),
  maxRequestBodySize: 12 * 1024 * 1024, // ~8 MB of PNG once base64-inflated
  development: DEVELOPMENT,

  routes: {
    "/": index,
    "/api/auth/token": {
      GET: async () => Response.json(await getToken("viewables:read"))
    },
    "/api/models": {
      GET: async () => Response.json(await listModels())
    },
    "/api/screenshots": {
      POST: async (req) => {
        const body = (await req.json().catch(() => null)) as { png?: unknown } | null;
        if (typeof body?.png !== "string" || body.png.length === 0) {
          return Response.json({ error: "Expected `png` to be a base64 data URL or raw base64." }, { status: 400 });
        }
        try {
          const id = saveScreenshot(body.png);
          return Response.json({ url: `${BASE_URL}/api/screenshots/${id}.png` });
        } catch {
          return Response.json({ error: "`png` is not valid base64." }, { status: 400 });
        }
      }
    },
    "/api/screenshots/:id": {
      GET: async (req: Bun.BunRequest<"/api/screenshots/:id">) => {
        const cors = { "Access-Control-Allow-Origin": "*" };
        const png = getScreenshot(req.params.id);
        if (!png) {
          return Response.json({ error: "Screenshot not found." }, { status: 404, headers: { ...cors } });
        }
        return new Response(png, { headers: { "Content-Type": "image/png", ...cors } });
      }
    }
  }
});

console.log(`[server] listening on ${server.url}`);
