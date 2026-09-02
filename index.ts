import index from "./client/index.html";
import { validateDraft } from "./shared/issues.ts";
import type { IssueDraft } from "./shared/issues.ts";
import { BASE_URL, DEVELOPMENT, PORT } from "./server/config.ts";
import { getToken, listModels } from "./server/aps.ts";
import { createIssue, listIssues } from "./server/issue-store.ts";
import { getScreenshot, saveScreenshot } from "./server/screenshot-store.ts";

/** Permissive on purpose: the agent host fetching a screenshot is on another origin. */
const CORS = { "Access-Control-Allow-Origin": "*" };

const server = Bun.serve({
  port: PORT,
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

    "/api/issues": {
      GET: (req) => Response.json(listIssues(new URL(req.url).searchParams.get("urn"))),
      POST: async (req) => {
        const body = (await req.json().catch(() => null)) as { urn?: unknown; draft?: unknown } | null;
        if (typeof body?.urn !== "string" || body.urn === "") {
          return Response.json({ error: "Expected `urn` to be the design the issue belongs to." }, { status: 400 });
        }
        // The tools are agent-callable, so an agent that skipped a step should get a
        // field list back rather than a 500.
        const missing = validateDraft(body.draft as IssueDraft | null);
        if (missing.length > 0) {
          return Response.json({ error: `Issue is incomplete: ${missing.join(", ")}.`, missing }, { status: 400 });
        }
        return Response.json(createIssue(body.urn, body.draft as IssueDraft), { status: 201 });
      }
    },

    "/api/screenshots": {
      POST: async (req) => {
        const body = (await req.json().catch(() => null)) as { png?: unknown } | null;
        if (typeof body?.png !== "string" || body.png.length === 0) {
          return Response.json({ error: "Expected `png` to be a base64 data URL or raw base64." }, { status: 400 });
        }
        try {
          return Response.json({ url: `${BASE_URL}/api/screenshots/${saveScreenshot(body.png)}.png` });
        } catch {
          return Response.json({ error: "`png` is not valid base64." }, { status: 400 });
        }
      }
    },

    "/api/screenshots/:id": {
      GET: (req) => {
        const png = getScreenshot(req.params.id);
        if (!png) {
          return Response.json({ error: "Screenshot not found." }, { status: 404, headers: { ...CORS } });
        }
        return new Response(png, { headers: { "Content-Type": "image/png", ...CORS } });
      }
    }
  }
});

console.log(`[server] listening on ${server.url}`);
