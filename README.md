# BIM Design Review — WebMCP on top of the APS Viewer

A Revit model rendered in the [APS Viewer](https://aps.autodesk.com/viewer-sdk), with the
viewer *and the review's issue list* exposed to an AI agent as
[WebMCP](https://github.com/webmachinelearning/webmcp) tools. You walk the building in
first person, select something, and talk: the agent measures it, drafts an issue against
it, revises the draft while you watch, and submits it when you say so.

Revit only — no other design format is supported, and the design picker lists `.rvt`
objects.

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

The bucket named by `APS_BUCKET_KEY` holds the demo models, uploaded and translated to SVF2
ahead of time. The app assumes that: it lists the bucket's `.rvt` objects into the design
dropdown and loads the first one, or the first whose name contains `?model=<substring>`.
There is no manifest polling and no translation path — if you add a design, translate it
before the demo.

Screenshot URLs are built from `PUBLIC_BASE_URL`, which is required — the agent host fetches
the PNG itself, so the origin has to be one it can reach. Locally that is
`http://localhost:8080`; behind a tunnel, set it to the tunnel's URL.

First-person walkthrough is the Viewer's own — `Autodesk.DefaultTools.NavTools` is loaded,
so it is in the camera menu on the viewer toolbar. There is no app code for it and nothing
agent-facing: getting the human to head height inside the building is the human's job.

### Where WebMCP works

WebMCP is experimental and secure-context only (`https://` or `http://localhost`).
Tested against:

- **ChatGPT's in-app browser** — WebMCP on by default.
- **Chrome** with the WebMCP flag / origin trial enabled.

Anywhere else the header says so and the app still works entirely by hand: orbit, select
objects, use the viewer's own toolbar, and fill in the issue form yourself. Nothing crashes
without `document.modelContext`.

## The tools

Ten tools, all scoped to the design currently on screen. `dbId` is the APS Viewer object id.

| Tool | What it does |
| --- | --- |
| `get-view-state` | Model name, selection, isolated/hidden sets, active cut planes, camera, unit string. This is the tool that makes deixis work — "what am I looking at", "these two", "how tall is *this*". |
| `browse-hierarchy` | The design's logical hierarchy, one level at a time: model → category (`Doors`) → family (`M_Single flush`) → type (`915x2135mm`) → instance, each node with its `role` and `childCount`. Pass a selected dbId and the `ancestors` chain says which category, family and type it belongs to — the type's `childCount` is how many instances of it exist, so "are there any other doors of this type?" is one call. This is how a name becomes dbIds without guessing. |
| `get-properties` | Detail mode (per-object property maps) or aggregate mode (`sum`/`avg`/`min`/`max`/`group-by`) over any set, up to the whole model. Aggregations return statistics, never rows. |
| `measure-elements` | Bounding-box dimensions for one object, centre distance + per-axis gap for two. Every result is flagged `"approximate": true`. |
| `set-view-state` | The one writer for everything `get-view-state` reads — `visibility`, `section`, and `camera`, singly or together. Visibility is `isolate`/`show`/`hide`/`reset` with an animated fit-to-view so the human sees the agent's focus move; section is one cut plane on a world axis, `offset` normalized 0..1 across the bounding box ("halfway up" needs no world coordinates); camera is an exact eye/target jump. Applied in that order, and passing `camera` suppresses the framing animation so an explicit shot is never overwritten. |
| `capture-viewport` | Renders a PNG, uploads it, returns a URL — which `draft-issue` accepts as `screenshotUrl`. |
| `list-issues` | Issues already raised on this design, newest first, with optional `status`/`severity`/`assignedTo` filters. Each carries the element it was raised against, so the agent can check for a duplicate before drafting one. |
| `show-issue` | Navigate to an issue: jump to the viewpoint it was raised from and re-select its element. "Take me to ISS-2." |
| `draft-issue` | Fill in the on-screen form without submitting. Every omitted field keeps its value, so "change the severity to high" is a one-field call. The element and the viewpoint are captured from the live viewer when the draft lacks them. Returns the draft plus `missing` — what still has to be asked for. |
| `submit-issue` | Submits the draft exactly as it stands. Takes no arguments. |

### Why the screenshot is a URL

Multimodal tool output is not standardized in WebMCP yet (webmcp issues #41/#81/#86), so
every tool returns text only. `capture-viewport` therefore returns a URL and its
description tells the agent to fetch it. The PNG is served with permissive CORS so an
agent host on another origin can pull it. That round trip is what lets the agent verify
its own camera moves instead of trusting them.

## Design notes

Three ideas do the real work here.

### The form is the draft

There is no server-side draft and no second copy of one. `draft-issue` writes into the same
form the human can type into, `submit-issue` takes **no arguments at all**, and the only
issues the server ever sees are ones that went through it.

That is a deliberate constraint on the agent, not an oversight. Let `submit-issue` accept
overrides and the review step becomes a formality: the agent says "I've set the severity to
high and submitted it" and the human has no way to tell whether it did. Force every edit
back through `draft-issue` and "looks good, submit" means something — the thing being
approved is on screen, and *only* what is on screen can be filed.

`draft-issue` also captures the two fields nobody dictates: the selected `dbId` and the
camera. An issue you cannot navigate back to is a sticky note, and `show-issue` restoring
the exact eye position — no `fitToView`, because the stored camera *is* the framing — is
what makes "the third column from the left, at head height, from the corridor" survive
being written down.

### The tool surface is a function of what is on screen

Model tools are registered only after `GEOMETRY_LOADED_EVENT`, under an `AbortController`
held in `client/webmcp.ts`:

```ts
controller = new AbortController();
await mc.registerTool(descriptor, { signal: controller.signal });
```

Before a different model loads, `main.ts` calls `unregisterTools()`, which aborts that
controller and drops all ten tools; they are re-registered when the new model's geometry
arrives. The agent therefore never sees a tool it cannot meaningfully call. `get-properties`
against a model that is half-unloaded is not a degraded answer — it is a wrong answer, and a
wrong answer the agent will confidently repeat. Tying registration to viewer state makes the
failure impossible rather than handled.

The issue tools live in that same surface on purpose: issues belong to a design, and a
draft's `dbId` and camera are meaningless once the model they refer to has gone. Switching
designs clears the draft for the same reason.

### Token budget is a design constraint, not an afterthought

A model has hundreds of thousands of objects. Any tool that can return "the list" will
eventually return a list that costs more than the answer is worth.

- Every list is capped at `MAX_ITEMS = 50` and always carries the true total plus a
  `truncated` flag, so the agent knows it is looking at a sample and can say so. That
  includes `list-issues`.
- `browse-hierarchy` is capped twice, because levels multiply: 50 children per level *and*
  200 nodes across the whole reply. Three levels at 50 each would be 125,000 nodes. The
  cure is to expand one branch, not to ask for more depth — which is also how a human
  reads a model tree.
- Aggregations return summary statistics only. `group-by` returns `{ value, count }` per
  bucket and the number of objects *missing* the property — never dbId lists. That last
  number is the point: "how many doors have no fire rating set?" is a question no
  screenshot can answer, and it costs about 20 tokens.

### Layout

The files carry no header comments — what each one is for is here instead.

```
index.ts                    Bun.serve: the HTTP surface, and nothing but
server/config.ts            the environment, validated once at import; exits before the
                             port is bound if anything required is missing
server/aps.ts               the only file that talks to Autodesk — 2-legged tokens and the
                             OSS bucket listing the design picker is built from
server/issue-store.ts       submitted issues, in memory, bounded
server/screenshot-store.ts  viewport PNGs, in memory, bounded

shared/issues.ts            what an issue is: enums, types, defaults, validation. Imported
                             by both halves, so the form's options, the tools' inputSchema
                             enums and the server's validation cannot disagree

client/main.ts              the entrypoint, and the one place that knows all the layers —
                             which is why the form's two capture buttons are wired here
client/viewer.ts            APS Viewer bootstrap, model loading, and the primitives the
                             tools are built from. Knows nothing of WebMCP or of issues
client/panel.ts             every piece of DOM outside the viewport: header, design picker,
                             issue list, new-issue form. Cannot read the viewer
client/issues.ts            the live draft, the cached issue list, the two API calls
client/webmcp.ts            ToolSpec, argument validation, the result envelope, the
                             registration lifecycle. Knows nothing of the viewer
client/tools/*.ts           one file per tool, plus index.ts listing the surface
client/utils.ts             pure helpers: capping, number coercion, grouping, JSON fetch
client/globals.d.ts         ambient types for the CDN `Autodesk` global and for WebMCP
```

The layers do not know about each other's concerns, and each tool file is one place where
two of them meet. `viewer.ts` has never heard of WebMCP *or* of an issue — `selectAndFocus`
takes a camera and some dbIds, which is all a stored viewpoint is once the metadata is
stripped off it. `panel.ts` cannot read the viewer, so the two things it needs from it, the
selection and the camera, arrive as callbacks `main.ts` wires up.

A tool is `{ name, description, inputSchema, run }`; each `run` validates input, calls a
couple of primitives, and returns a plain object. A single registration-time wrapper in
`webmcp.ts` turns that into the compact text result WebMCP expects — which is why the tool
descriptions can be audited for honesty one file at a time. Adding a tool means adding one
file and one line in `tools/index.ts`.

`webmcp.ts` validates arguments against `inputSchema` itself because the host is not
required to: the arguments are model-generated, and an unchecked `position: [1, 2]` reaches
`Math.Vector3` and leaves the user with a NaN camera to undo by hand.

The server splits the same way. The stores and the APS client deal in values; only
`index.ts` has ever seen a `Request`. `Bun.serve` has no error middleware, so an APS outage
becomes a default 500 — correct — while a malformed body is caught by the handler that
knows what shape it wanted.

The browser only ever receives a `viewables:read` token; the OSS bucket listing uses a
separate server-side token with `data:read`/`bucket:read`. No code path here holds a write
scope.

### No build step, no framework, two dev dependencies

Bun runs the TypeScript directly and bundles the client on demand: `index.ts`
imports `client/index.html`, and Bun serves that route as a bundled page — hot-reloading
under `bun --hot`, minified when `NODE_ENV=production`. So there is no compile step for
either half, one `tsconfig.json` typechecks all four directories, and dev and production
are the same single process on the same single port. No dev proxy, no second dev server, and
`PUBLIC_BASE_URL` points at the page the browser is actually on. `shared/issues.ts` is
imported by client and server alike and needs no build wiring for it.

What that removes relative to the usual setup: Express (`Bun.serve` routes), `dotenv`
(Bun reads `.env`), `tsx` (Bun runs `.ts`), Vite and `concurrently` (Bun bundles and
serves), and `Buffer` (`Uint8Array.fromBase64` / `toBase64({ alphabet: "base64url" })`).
The runtime dependency list is empty; `@types/bun` and `typescript` are the only
devDependencies. The panel is plain DOM and one inline `<style>` block — no framework.

`client/globals.d.ts` holds minimal ambient types for the CDN-loaded `Autodesk` global
and for WebMCP; `webmcp-types` is deliberately not a dependency so an experimental
package cannot break the build. The Viewer SDK is pinned to v7.126 in `client/index.html`
rather than floated on `7.*`, so a future SDK release cannot change the app underneath it.

Issues and screenshots are in memory only, both on a bounded insertion-ordered `Map`.
Restarting the server is the demo's reset button.

## Acceptance walkthrough

The workflow this app exists for, against the deployed page. Pick a design, then use the
viewer toolbar's camera menu to switch to first person and walk inside.

1. Click a column. — "What am I looking at?"
2. "How tall is this column?"
3. "That should be 250 cm, not 220. Draft an issue." → the form fills in on screen, with
   the element and your viewpoint already captured.
4. "Change the severity to high and assign it to the structural engineer." → the selects
   move while you watch.
5. "Looks good, submit." → the form clears and the issue appears at the top of the list.
6. Orbit away, then: "Take me back to ISS-1." → you are back at head height looking at the
   column, with it selected. Clicking the row in the panel does the same thing.
7. "Are there any critical issues on this model?"
