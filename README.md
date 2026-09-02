# BIM Design Review — WebMCP on top of the APS Viewer

A Revit model rendered in the [APS Viewer](https://aps.autodesk.com/viewer-sdk), with the
viewer *and the review's issue list* exposed to an AI agent as
[WebMCP](https://github.com/webmachinelearning/webmcp) tools. You walk the building in
first person, select something, and talk: the agent measures it, drafts an issue against
it, revises the draft while you watch, and submits it when you say so.

Revit only — no other design format is supported, and the design picker lists `.rvt`
objects.

It is a hackathon demo, not a product: no auth for end users, no server-side storage,
no tests.

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
| `get-view-state` | Model name, selection, isolated/hidden sets, active cut planes, the colour-coding legend, camera, unit string. This is the tool that makes deixis work — "what am I looking at", "these two", "how tall is *this*". |
| `browse-hierarchy` | The design's logical hierarchy, one level at a time: model → category (`Doors`) → family (`M_Single flush`) → type (`915x2135mm`) → instance, each node with its `role` and `childCount`. Pass a selected dbId and the `ancestors` chain says which category, family and type it belongs to — the type's `childCount` is how many instances of it exist, so "are there any other doors of this type?" is one call. This is how a name becomes dbIds without guessing. |
| `get-properties` | Detail mode (per-object property maps) or aggregate mode (`sum`/`avg`/`min`/`max`/`group-by`) over any set, up to the whole model. Aggregations return statistics, never rows. |
| `measure-elements` | Bounding-box dimensions for one object, centre distance + per-axis gap for two. Every result is flagged `"approximate": true`. |
| `set-view-state` | Everything `get-view-state` reads except the colour-coding — `visibility`, `section`, and `camera`, singly or together. Visibility is `isolate`/`show`/`hide`/`reset` with an animated fit-to-view so the human sees the agent's focus move; section is one cut plane on a world axis, `offset` normalized 0..1 across the bounding box ("halfway up" needs no world coordinates); camera is an animated flight to an exact eye/target. Applied in that order, and passing `camera` suppresses the framing animation so an explicit shot is never overwritten. |
| `set-theming-color` | Colour-code objects: one colour per group of dbIds, so a property becomes visible across the whole model at once — "show me all the rooms and colour-code them by type". No built-in palette; **the agent picks the colours**, which is also why it has to say what each one means. Painting is recursive, so a category, family or type node from `browse-hierarchy` colours every instance under it and 5,000 doors cost one dbId. Later groups win on overlap, `keepExisting` layers instead of replacing, `clear` removes it. |
| `list-issues` | Issues already raised on this design, newest first, with optional `status`/`severity`/`assignedTo` filters. Each carries the element it was raised against, so the agent can check for a duplicate before drafting one. |
| `show-issue` | Navigate to an issue: restore the whole view it was raised from — camera, section planes, isolated/hidden sets, selection, colour-coding — so the reviewer sees what the reporter saw, cutaway and all. "Take me to ISS-2." |
| `draft-issue` | Fill in the on-screen form without submitting. Every omitted field keeps its value, so "change the severity to high" is a one-field call. The element and the *entire* view state are captured from the live viewer when the draft lacks them. Returns the draft plus `missing` — what still has to be asked for. |
| `submit-issue` | Submits the draft exactly as it stands. Takes no arguments. |

### The agent can already see the viewport

There is no screenshot tool, and that is the interesting part. There was one: it rendered
a PNG, uploaded it, and returned a URL for the agent to fetch, because multimodal tool
output is not standardized in WebMCP yet (webmcp issues #41/#81/#86) and every tool here
returns text only.

It went because the hosts this is built for see the page without being asked. ChatGPT's
in-app browser reads the viewport directly — confirmed against the desktop app, not
assumed — so "look at what is on screen" was never a capability this app needed to
provide. What it did provide was the cost: a `POST` that accepted any base64 blob and a
`GET` that served rendered imagery of somebody's building to anyone holding an id,
unauthenticated and with `Access-Control-Allow-Origin: *`, because the fetch came from
another origin. Wide open by construction, for something the host does for free.

So the tool, its two routes, the in-memory PNG store, the `screenshotUrl` field on an
issue and the `PUBLIC_BASE_URL` config that existed only to build those URLs are all
gone rather than switched off. What replaces it: `get-view-state` still reports the
camera, and the agent still verifies its own moves — it just reads the result off the
screen instead of being handed a copy of it.

The one thing genuinely lost is evidence attached to an issue. A stored viewpoint is a
better record anyway, because it is live: `show-issue` puts the reviewer back inside the
model at the reporter's eye position with the same cutaway, which a PNG cannot do.

## Design notes

Four ideas do the real work here.

### The form is the draft

There is no draft anywhere but on screen, and no second copy of one. `draft-issue` writes
into the same form the human can type into, `submit-issue` takes **no arguments at all**,
and the only issues that get stored are ones that went through it.

That is a deliberate constraint on the agent, not an oversight. Let `submit-issue` accept
overrides and the review step becomes a formality: the agent says "I've set the severity to
high and submitted it" and the human has no way to tell whether it did. Force every edit
back through `draft-issue` and "looks good, submit" means something — the thing being
approved is on screen, and *only* what is on screen can be filed.

`draft-issue` also captures the two fields nobody dictates: the selected `dbId` and the
viewpoint. An issue you cannot navigate back to is a sticky note, and `show-issue`
restoring the exact eye position — no `fitToView`, because the stored camera *is* the
framing — is what makes "the third column from the left, at head height, from the
corridor" survive being written down.

The viewpoint is the whole view, not just the camera: eye, target, up and fov, plus the
active cut planes and the isolated, hidden and selected sets. A camera alone is not
reproducible. Half the problems worth reporting are only visible because a floor was
isolated, a ceiling hidden, or the model cut at mid-height — restore the eye position
without those and the reviewer arrives at the right coordinates looking at an opaque
wall, which is worse than not navigating at all, because it looks like the issue is
wrong. So `show-issue` clears whatever is hidden or cut *now* and puts the stored state
back: it is a jump to a recorded view, not a change layered onto the present one.

Those sets are stored uncapped — the one place in the app that ignores `MAX_ITEMS`. A
truncated hidden set does not restore a smaller version of the view, it restores a
*different* view while claiming to be the original one. So `readViewpoint` is a separate
reader from the agent-facing `readViewState`, and `show-issue` reports counts of what it
put back rather than the dbId lists themselves. Both stay small in practice: the Viewer
tracks explicitly hidden and isolated nodes as sets, not as the complement of what is
visible.

Saving and restoring are the Viewer's own `getState` and `restoreState`, and what is
stored is the viewer state object verbatim rather than a subset copied out field by
field. That is how a viewpoint quietly stops carrying things: the copy has to be kept in
step at both ends, and whatever nobody remembers to add to both is simply gone from every
issue filed after it. Handing the object back unopened also means visibility is restored
the one way that cannot lose information — reset, then isolate, then hide, with the
aggregate events the Model Browser listens to — which `viewer.isolate()` followed by
`viewer.hide()` gets pixel-right while leaving that panel out of step.

`immediate` is left `false`, so the camera flies to the stored view instead of cutting to
it, for the same reason `set-view-state` uses `utilities.transitionView` rather than
`navigation.setView`: a hard cut drops the reviewer somewhere else in the building with
nothing to say how the two places relate, and the flight path carries exactly that.

The colour-coding travels with it too, and for the same reason the cut planes do:
"these three rooms are the wrong type" only reads as an issue while the types are
painted. Arriving at that issue with the model in its native grey is arriving at a
different view. So `set-theming-color` is the one writer that `set-view-state` is not,
and the record it keeps is a first-class part of the viewpoint — stored as
`{ color, intensity, dbIds }` groups, uncapped like the rest, beside the viewer state
rather than inside it, because the viewer state has no field for theming colours.

Keeping that record is the app's job rather than the Viewer's, because `setThemingColor`
writes into the model and nothing gives the colours back — there is no
`getThemingColor`. Without a record on this side, `get-view-state` could not report the
colour-coding the agent applied one call earlier, and the legend the agent reads out
would have nothing behind it. `applyTheming` therefore clears and repaints the whole
record every time instead of layering onto the screen: it costs one write per themed
object and it makes "what is on screen" and "what we think is on screen" the same object
by construction, including when a later group overpaints an earlier one.

Explode scale, render options and whatever the loaded extensions inject ride along too,
even though no tool here can read or write them: `get-view-state` cannot report the
explode scale and nothing can set it. Storing them anyway is the point of keeping the
state verbatim — a viewpoint is not limited to the vocabulary the tools happen to share
today, and a view the user set up by hand in the Viewer's own UI comes back the way they
left it.

### Issues never leave the browser

An issue is the most sensitive thing this app produces. The model is already in APS, but
"the north stair does not meet code" next to a client's project name is a professional
judgement about someone else's building, and the demo has no user auth to protect it with.
So it is not sent anywhere. There is no issue endpoint, no server-side store, and no
network request on submit — `client/issue-store.ts` writes to IndexedDB and that is the
end of it. What made this worth doing rather than deferring: the endpoint it replaces had
no auth either, so `GET /api/issues?urn=…` served every issue on a design to anyone who
guessed the urn, and `POST` accepted one from anyone at all.

**Why IndexedDB and not `localStorage`.** `localStorage` is the obvious reach for
something this small, and for the issue *text* it would be fine. The viewpoint is what
rules it out. Every issue carries uncapped `isolated`/`hidden` dbId arrays, so isolating a
floor before reporting a problem can mean a few thousand numbers on that one record. Under
`localStorage` those become JSON in a ~5 MB origin quota, and exceeding it throws
`QuotaExceededError` at the exact worst moment — on submit, with an issue the human has
just read and approved. IndexedDB's quota is a share of free disk, so that failure is off
the table. Two smaller things follow from the same choice: structured clone stores the
dbId arrays as arrays rather than round-tripping them through a string, and the API is
async, which the app was already shaped for — `refreshIssues()` has always been async and
the panel has always rendered from a synchronous cache that it fills. Swapping a `fetch`
for an IndexedDB read changed no call signatures at all.

The store is deliberately plain: one object store, one index on `urn`, out-of-line keys so
the `Issue` records hold no storage field the agent could read back. Keys are the issue's
sequence number, taken from the largest existing key rather than a counter — a counter
resets when the tab does, and now that the data outlives the tab, `ISS-1` would come round
a second time. The 200-record cap the server store had is still there and matters more,
because nothing clears this on restart.

Two consequences worth stating plainly. Issues are per-browser and per-origin: they do not
follow the user to another machine, and there is no sharing — a real product needs a
server for that, with the auth this demo does not have. And "in the browser" is not
"encrypted"; IndexedDB is readable by anything with access to the profile on disk.
Restarting the server no longer resets the demo, either — clearing site data for the
origin does (DevTools → Application → IndexedDB → `bim-design-review`).

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
  number is the point: "how many doors have no fire rating set?" is a question no amount
  of looking at the screen can answer, and it costs about 20 tokens.

### Layout

The files carry no header comments — what each one is for is here instead.

```
index.ts                    Bun.serve: the HTTP surface, and nothing but
server/config.ts            the environment, validated once at import; exits before the
                             port is bound if anything required is missing
server/aps.ts               the only file that talks to Autodesk — 2-legged tokens and the
                             OSS bucket listing the design picker is built from
client/issue-schema.ts      what an issue is: enums, types (including the `Viewpoint` an
                             issue is raised from), defaults, validation. One declaration
                             behind the form's options, the tools' inputSchema enums and
                             the check made before a record is written
client/issue-store.ts       IndexedDB: the only place an issue is persisted, and the whole
                             of what used to be an HTTP round trip

client/main.ts              the entrypoint, and the one place that knows all the layers —
                             which is why the form's two capture buttons are wired here
client/viewer.ts            APS Viewer bootstrap, model loading, and the primitives the
                             tools are built from. Knows nothing of WebMCP or of issues
client/panel.ts             every piece of DOM outside the viewport: header, design picker,
                             issue list, new-issue form. Cannot read the viewer
client/issues.ts            the live draft, the cached issue list, and the two calls into
                             the store — the last check before anything is written
client/webmcp.ts            ToolSpec, argument validation, the result envelope, the
                             registration lifecycle. Knows nothing of the viewer
client/tools/*.ts           one file per tool, plus index.ts listing the surface
client/utils.ts             pure helpers: capping, number coercion, grouping, JSON fetch
client/globals.d.ts         ambient types for the CDN `Autodesk` global and for WebMCP
```

The layers do not know about each other's concerns, and each tool file is one place where
two of them meet. `viewer.ts` has never heard of WebMCP or of an issue; its one import
from `issue-schema.ts` is the `Viewpoint` *type*, which describes the viewer's own state
and lives there only because an issue is what stores one — `restoreViewpoint` takes a
`Viewpoint` and knows nothing of the words wrapped around it. `panel.ts` cannot read the
viewer, so the two things it needs from it, the selection and the viewpoint, arrive as
callbacks `main.ts` wires up.

A tool is `{ name, description, inputSchema, run }`; each `run` validates input, calls a
couple of primitives, and returns a plain object. A single registration-time wrapper in
`webmcp.ts` turns that into the compact text result WebMCP expects — which is why the tool
descriptions can be audited for honesty one file at a time. Adding a tool means adding one
file and one line in `tools/index.ts`.

`webmcp.ts` validates arguments against `inputSchema` itself because the host is not
required to: the arguments are model-generated, and an unchecked `position: [1, 2]` reaches
`Math.Vector3` and leaves the user with a NaN camera to undo by hand.

The server splits the same way, and there is little of it left to split: it holds no
review data at all, the APS client deals in values, and only `index.ts` has ever seen a
`Request`. `Bun.serve` has no error middleware, so an APS outage becomes a default 500 —
correct — while a malformed body is caught by the handler that knows what shape it wanted.

The browser only ever receives a `viewables:read` token; the OSS bucket listing uses a
separate server-side token with `data:read`/`bucket:read`. No code path here holds a write
scope.

Nothing this app produces is reachable without a credential, because nothing it produces
is on the server: no issue endpoint and no image endpoint, so there is no unauthenticated
`GET` to find. The last one to go was `/api/screenshots/:id`, and it went with the
capability rather than being patched — see "The agent can already see the viewport".

### No build step, no framework, two dev dependencies

Bun runs the TypeScript directly and bundles the client on demand: `index.ts`
imports `client/index.html`, and Bun serves that route as a bundled page — hot-reloading
under `bun --hot`, minified when `NODE_ENV=production`. So there is no compile step for
either half, one `tsconfig.json` typechecks both directories, and dev and production
are the same single process on the same single port. No dev proxy and no second dev
server, so there is no second origin for anything to be configured against.

What that removes relative to the usual setup: Express (`Bun.serve` routes), `dotenv`
(Bun reads `.env`), `tsx` (Bun runs `.ts`), Vite and `concurrently` (Bun bundles and
serves), and `Buffer` (`Uint8Array.fromBase64` / `toBase64({ alphabet: "base64url" })`).
The runtime dependency list is empty; `@types/bun` and `typescript` are the only
devDependencies. The panel is plain DOM and one inline `<style>` block — no framework.

`client/globals.d.ts` holds minimal ambient types for the CDN-loaded `Autodesk` global
and for WebMCP; `webmcp-types` is deliberately not a dependency so an experimental
package cannot break the build. The Viewer SDK is pinned to v7.126 in `client/index.html`
rather than floated on `7.*`, so a future SDK release cannot change the app underneath it.

The server keeps no state at all now — no issues, no images, nothing bounded to trim.
Issues are in the browser's IndexedDB and survive both a reload and a restart, so
clearing site data for the origin is the demo's reset button.

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
6. Orbit away, unhide things, cut the model somewhere else, then: "Take me back to
   ISS-1." → you are back at head height looking at the column, with it selected, and
   with the section and visibility exactly as they were when you raised it. Clicking the
   row in the panel does the same thing.
7. "Are there any critical issues on this model?"
8. "Show me all the rooms and colour-code them by type." → the model repaints, and the
   agent tells you which colour is which, because it chose them.
