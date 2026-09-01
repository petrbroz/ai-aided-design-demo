# AI-Aided Design — WebMCP on top of the APS Viewer

A CAD design rendered in the [APS Viewer](https://aps.autodesk.com/viewer-sdk), with the
viewer's capabilities exposed to an AI agent as [WebMCP](https://github.com/webmachinelearning/webmcp)
tools. The agent can look at the model, search it, aggregate its properties, isolate,
section and colour it, measure it approximately, and screenshot itself to check its own work.

It is a hackathon demo, not a product: no auth for end users, no database, no tests.

## Setup

Requires [Bun](https://bun.com) 1.3+. There is no Node.js dependency.

```bash
bun install
cp .env.example .env     # fill in APS_CLIENT_ID / APS_CLIENT_SECRET / APS_BUCKET_KEY
bun run dev              # API + client on :8080, hot reload → open http://localhost:8080
```

Production:

```bash
bun start                # same one port, minified client, no hot-reload client
```

`bun run build` writes a static `dist/client` if you want to host the front end
somewhere else; the server does not need it — it bundles `client/index.html` itself.

The bucket named by `APS_BUCKET_KEY` holds the two or three demo designs, uploaded and
translated to SVF2 ahead of time. The app assumes that: it lists the bucket into the
top-left combo-box and loads the first object, or the first whose name contains
`?model=<substring>`. There is no manifest polling and no translation path — if you add a
design, translate it before the demo.

Screenshot URLs are built from `PUBLIC_BASE_URL`, which is required — the agent host fetches
the PNG itself, so the origin has to be one it can reach. Locally that is
`http://localhost:8080`; behind a tunnel, set it to the tunnel's URL.

### Where WebMCP works

WebMCP is experimental and secure-context only (`https://` or `http://localhost`).
Tested against:

- **ChatGPT's in-app browser** — WebMCP on by default.
- **Chrome** with the WebMCP flag / origin trial enabled.

Anywhere else the page notes it on the console and still works manually: orbit, select
objects, use the viewer's own toolbar. Nothing crashes without `document.modelContext`.

## The tools

All eight operate on the currently loaded model. `dbId` is the APS Viewer object id.

| Tool | What it does |
| --- | --- |
| `get-view-state` | Model name, selection, isolated/hidden sets, cut-plane count, theming flag, camera, unit string. This is the tool that makes deixis work — "what am I looking at", "these two". |
| `browse-hierarchy` | One step down the instance tree: a node, its breadcrumb back to the root, and its immediate children. For walking the model's logical structure when there is no name to search for. |
| `search-design` | Name-substring search via `viewer.search`. Names only, not properties. |
| `get-properties` | Detail mode (per-object property maps) or aggregate mode (`sum`/`avg`/`min`/`max`/`count`/`group-by`) over any set, up to the whole model. Aggregations return statistics, never rows. |
| `set-view-state` | The one writer for everything `get-view-state` reads — `visibility`, `section`, and `camera`, singly or together. Visibility is `isolate`/`show`/`hide`/`reset` with an animated fit-to-view so the human sees the agent's focus move; section is one cut plane on a world axis, `offset` normalized 0..1 across the bounding box ("halfway up" needs no world coordinates); camera is an exact eye/target jump. Applied in that order, and passing `camera` suppresses the framing animation so an explicit shot is never overwritten. Returns the resulting view state. |
| `color-elements` | Explicit `groups`, or `byProperty` bucketing over the whole model (max 12 buckets, rest → "other"). Themes the viewport and returns the matching legend with counts. |
| `measure-elements` | Bounding-box dimensions for one object, centre distance + per-axis gap for two. Every result is flagged `"approximate": true`. |
| `capture-viewport` | Renders a PNG, uploads it, returns a URL. |

### Why the screenshot is a URL

Multimodal tool output is not standardized in WebMCP yet (webmcp issues #41/#81/#86), so
every tool returns text only. `capture-viewport` therefore returns a URL and its
description tells the agent to fetch it. The PNG is served with permissive CORS so an
agent host on another origin can pull it. That round trip is what lets the agent verify
its own camera moves instead of trusting them.

## Design notes

Two ideas do the real work here. They are the reason this is more than a wrapper around
`viewer.isolate`.

### The tool surface is a function of what is on screen

Model tools are registered only after `GEOMETRY_LOADED_EVENT`, under an `AbortController`
held in `client/webmcp.ts`:

```ts
controller = new AbortController();
await mc.registerTool(descriptor, { signal: controller.signal });
```

Before a different model loads, `main.ts` calls `unregisterTools()`, which aborts that
controller and drops all eight tools; they are re-registered when the new model's geometry
arrives. The agent therefore never sees a tool it cannot meaningfully call. `get-properties`
against a model that is half-unloaded is not a degraded answer — it is a wrong answer, and a
wrong answer the agent will confidently repeat. Tying registration to viewer state makes the
failure impossible rather than handled.

### Token budget is a design constraint, not an afterthought

A model has hundreds of thousands of objects. Any tool that can return "the list" will
eventually return a list that costs more than the answer is worth.

- Every list is capped at `MAX_ITEMS = 50` and always carries the true total plus a
  `truncated` flag, so the agent knows it is looking at a sample and can say so.
- Aggregations return summary statistics only. `group-by` returns `{ value, count }` per
  bucket and the number of objects *missing* the property — never dbId lists. That last
  number is the point: "how many doors have no fire rating set?" is a question no
  screenshot can answer, and it costs about 20 tokens.
- `color-elements` caps at 12 buckets and rolls the remainder into "other", because a
  13-colour legend is not legible to a human either.

### The page is the viewer

There is no application chrome — the viewport fills the window, and the only DOM outside
it is the design combo-box in the top-left corner. Setup failures (no bucket, no WebMCP, a
load error) are reported with `console.error` and never on screen. Any UI this needs later
belongs in the viewer's own extension/toolbar surface, not in a parallel panel that has to
be kept in sync with viewer state.

That puts the burden of visible evidence on the viewport itself, which is where it should
be: theming colours, cut planes, and `fitToView`'s animated transition rather than an
instant jump. A human watching the screen can follow what the agent did without reading
the transcript. Each mutating tool also traces what it did to the console for debugging.

### Layout

```
index.ts               Bun.serve — API routes, 2-legged tokens, OSS bucket listing, the
                        in-memory screenshot store, and the bundled client
client/main.ts         entrypoint — wires the viewer, the picker and the tool surface
client/viewer.ts       APS Viewer bootstrap, model loading, and the viewer primitives
client/webmcp.ts       the WebMCP layer: ToolSpec, the result envelope, registration
client/tools/*.ts      one file per tool, plus index.ts listing the surface
client/utils.ts        pure helpers (capping, number coercion, colour parsing)
```

The three layers do not know about each other's concerns: `viewer.ts` has never heard of
WebMCP, `webmcp.ts` has never heard of the viewer, and each tool file is the one place
where the two meet. A tool is `{ name, description, inputSchema, run }`; each `run`
validates input, calls a couple of viewer primitives, and returns a plain object. A single
registration-time wrapper in `webmcp.ts` turns that into the compact text result WebMCP
expects — which is why the tool descriptions can be audited for honesty one file at a
time. Adding a tool means adding one file and one line in `tools/index.ts`.

The browser only ever receives a `viewables:read` token; the OSS bucket listing uses a
separate server-side token with `data:read`/`bucket:read`. No code path here holds a write
scope.

### No build step, no framework, two dev dependencies

Bun runs the TypeScript directly and bundles the client on demand: `index.ts`
imports `client/index.html`, and Bun serves that route as a bundled page — hot-reloading
under `bun --hot`, minified when `NODE_ENV=production`. So there is no compile step for
either half, one `tsconfig.json` typechecks both, and dev and production are the same
single process on the same single port. No dev proxy, no second dev server, and
`PUBLIC_BASE_URL` points at the page the browser is actually on.

What that removes relative to the usual setup: Express (`Bun.serve` routes), `dotenv`
(Bun reads `.env`), `tsx` (Bun runs `.ts`), Vite and `concurrently` (Bun bundles and
serves), and `Buffer` (`Uint8Array.fromBase64` / `toBase64({ alphabet: "base64url" })`).
The runtime dependency list is empty; `@types/bun` and `typescript` are the only
devDependencies.

`client/globals.d.ts` holds minimal ambient types for the CDN-loaded `Autodesk`/`THREE`
globals and for WebMCP; `webmcp-types` is deliberately not a dependency so an experimental
package cannot break the build.

## Acceptance prompts

Try these against the deployed page:

1. "What am I looking at?"
2. "Find all the doors and isolate them."
3. "How many walls are there, and what's their total area?"
4. "Cut the model horizontally at half height and show me."
5. "Color the elements by category and tell me what the legend says."
6. "Roughly how far apart are these two selected pipes?"
7. "Reset everything."
