---
name: linear
description: Use when an agent needs to work with Linear via the linear-server MCP. Covers session setup, project/team/state resolution, comment discipline, attachment patterns, tool selection, response shapes, drift detection, and patterns for keeping token usage low.
---

# Linear MCP Agent Skill

Use this skill whenever you are operating against the `linear-server` MCP. It mirrors the `jv-trello` skill's structure so multi-platform workflows stay consistent, and encodes the lessons learned from real comparison runs (notably: where tokens go, how attachments actually work, and which tool calls are unnecessary).

The MCP exposes ~30 tools prefixed `mcp__linear-server__`. Schemas are deferred at session start — load only what you need with `ToolSearch` (see Tool selection).

---

## Session setup

### 1 — Resolve the project (and discover its team for free)

At the start of every session, if a project name is known:

```json
{ "name": "list_projects", "arguments": { "query": "<project name>" } }
```

The response embeds `teams[]` for every project — **do not call `list_teams`**, you already have the team. If multiple projects match, pick the most recently updated and surface that choice in a `[NOTE]` comment on the first issue you act on.

Cache for the session:

```js
{
  projectId: '...',
  teamId: '...',
  teamKey: 'MIT',          // e.g. used in identifiers like MIT-12
  workspaceUrlBase: 'https://linear.app/<workspace>'
}
```

### 2 — Cache the workflow states

Workflow states are per-team. Call once and build a map keyed by **state type**, not name (state names vary per workspace; types are stable):

```json
{ "name": "list_issue_statuses", "arguments": { "teamId": "<teamId>" } }
```

Linear's state types are: `triage` · `backlog` · `unstarted` · `started` · `completed` · `canceled`. Build:

```js
stateMap = {
  backlog:   { id, name },   // pick first state of type 'backlog'
  todo:      { id, name },   // first 'unstarted'
  inProgress:{ id, name },   // first 'started'
  done:      { id, name },   // first 'completed'
  canceled:  { id, name }    // first 'canceled'
}
```

If the team has multiple states of the same type (e.g. "In Progress" + "In Review", both `started`), keep both with their human names available, and ask the user before using a non-default one. Never create new states.

### 3 — Initialise lifecycle label

Linear's workflow states already encode "Backlog/In Progress/Done", so the **only** label this skill manages is `AI_WORKING` — a single signal that an agent currently owns the issue. Fetch team labels:

```json
{ "name": "list_issue_labels", "arguments": { "teamId": "<teamId>" } }
```

If `AI_WORKING` is missing, create it once:

```json
{ "name": "create_issue_label", "arguments": { "teamId": "<teamId>", "name": "AI_WORKING", "color": "#0EA5E9" } }
```

Cache `aiWorkingLabelId`. Do **not** create `AI_READY`, `IN_REVIEW`, or `BLOCKED` labels — Linear's workflow states cover those.

### 4 — Identifier system (no setup needed)

Linear auto-assigns identifiers like `MIT-12` at creation time using the team key. **You never set them.** When the user references `MIT-12`, resolve via:

```json
{ "name": "list_issues", "arguments": { "query": "MIT-12" } }
```

or directly:

```json
{ "name": "get_issue", "arguments": { "id": "MIT-12" } }
```

`get_issue` accepts both UUIDs and team-key identifiers. Prefer identifiers in user-visible communication.

### 5 — Per-project config (read from the project description)

Linear projects have a `description` field — that's where per-project settings live, the same way Trello uses board description. Read it once during session setup (you already have it from `list_projects` or via `get_project`).

#### Where to put it inside the description

To keep the description readable in Linear's UI, the convention is a fenced JSON block at the bottom under a `## Agent Config` heading. JS `//` comments are allowed and must be stripped before parsing.

````md
… normal project description …

## Agent Config

```json
{
  // optional — override which workflow states map to which lifecycle role
  // when the team has multiple states of the same type (e.g. "In Progress"
  // and "In Review" are both type=started)
  "states": {
    "inProgress": "In Progress",   // state name or id
    "inReview":   "In Review",     // state name or id; null = no review state
    "done":       "Done"           // state name or id
  },

  // worktree behaviour for this project
  "worktrees": {
    "create": "ask",               // "always" | "ask" | "never" — default "ask"
    "path": ".worktrees",
    "branchFormat": "feature/${featureName}"
  },

  // commit & PR behaviour
  "autoCommit": false,
  "createPr": false,

  // optional — restrict which assignees the agent acts on (skips others silently)
  "agentAssigneeFilter": null      // null | userId | "me"
}
```
````

Parsing rules:

1. Find the first ` ```json ... ``` ` fenced block in `description`.
2. Strip `//` line comments before `JSON.parse`.
3. Merge over defaults (below). Missing keys → defaults; malformed JSON → defaults + post `[NOTE]` warning to the user.
4. Cache the resolved config for the session.

#### Defaults (when no Agent Config block exists)

```js
{
  states: {
    inProgress: null,   // first state of type 'started' (alphabetical by name)
    inReview:   null,   // any state of type 'started' literally named "In Review"
    done:       null    // first state of type 'completed'
  },
  worktrees: {
    create: 'ask',      // 'always' | 'ask' | 'never'
    path: '.worktrees',
    branchFormat: 'feature/${featureName}'
  },
  autoCommit: false,
  createPr: false,
  agentAssigneeFilter: null
}
```

`featureName` = kebab-case slug from the issue title, max 40 chars. **One session = one worktree.** Subagents inherit the parent's `cwd`.

#### State-pinning resolution (using `states.*` from config)

When the team has multiple `started`-type states (common: "In Progress", "In Review", "Blocked"), the `states.*` config disambiguates. Resolution order for each role:

1. If config has `states.<role>` set — match that name (case-insensitive) or id against `list_issue_statuses` for the team. If no match, post `[NOTE]` and fall back to default.
2. Otherwise use the default rule above.

If `states.inReview` is non-null, the lifecycle finish step moves the issue to that state (and the human transitions to `done` on approval). If null, the finish step moves directly to `done`.

#### When the config block is missing

On the **first** issue of the session against a project with no `## Agent Config` block, post a single `[NOTE]` like:

```
[NOTE] No `## Agent Config` block found on this project's description. Using defaults
(states auto-resolved by type, worktree=ask, autoCommit=false). To customise, paste
this template into the project description on Linear:

[paste the template above, with comments]
```

Do not nag again in the same session. Do not write to the project description automatically — the user controls that.

#### Worktree create behaviour

| `worktrees.create` | Action |
|---|---|
| `'always'` | Create `.worktrees/<featureName>` with branch `feature/<featureName>` |
| `'ask'` (default) | Ask the user before creating |
| `'never'` | Work in current branch |

Create command:

```bash
git worktree add .worktrees/<featureName> -b feature/<featureName>
```

---

## Comment discipline

Leave a structured comment on every issue you act on. Same tag taxonomy as jv-trello — keep it consistent across platforms.

| Tag | When |
|---|---|
| `[PLAN]` | Before starting — what steps you will take and why |
| `[DECISION]` | At the moment you make a non-trivial judgment call |
| `[RESULT]` | What was done, what changed, deliverable or answer |
| `[NOTE]` | Context: worktree path, session info, admin notes |
| `[QUESTION]` | User input needed — blocks progress |

**A diff with zero `[DECISION]` comments is a process failure.**

Format:

```
[PLAN]
## Goal
{what we're solving and why}
## Steps
1. …
## Non-goals
{what we're explicitly NOT doing}
```

```
[DECISION] {one-line: choice made and why}
```

```
[RESULT]
## Changes
- {what moved / updated / created}
## Follow-ups
- {deferred items or open questions}
```

`save_comment` returns `{ id }` only — do not try to read the comment back.

---

## Issue lifecycle

Every lifecycle event updates the workflow **state** and (where applicable) the `AI_WORKING` label. Linear has no atomic "lifecycle transition" tool — you do both in a single `save_issue` call.

| Event | State (via `stateMap`) | Label change |
|---|---|---|
| Agent picks up issue | → `inProgress` | Add `AI_WORKING` |
| Agent posts `[PLAN]` | — | — |
| Agent finishes | → `done` (or first `started` state named "In Review" if it exists) | Remove `AI_WORKING` |
| Agent blocked | stay in `inProgress` | Keep `AI_WORKING`; post `[QUESTION]` and stop |
| Agent unblocked | — | — |
| Human approves | — | — (label already removed at finish) |

If the team has a dedicated **In Review** state (a `started`-type state named "In Review"), prefer moving there at finish instead of `done`, and have the human transition to `done` on approval. Detect this once during session setup.

**How to execute a lifecycle step (single call):**

```json
{ "name": "save_issue", "arguments": {
  "id": "MIT-12",
  "state": "<inProgress state id or name>",
  "labelIds": ["<existing label ids minus AI_WORKING removed, plus AI_WORKING added>"]
}}
```

`save_issue` accepts the state by **id or name** and is the single create/update tool — `id` field present = update, absent = create.

To set labels, you must pass the full desired `labelIds` array (Linear replaces, not patches). Read current labels via `get_issue` first if you don't have them cached.

### Review handoff

When the user says "reviewed", "approved", "looks good":

1. Confirm `AI_WORKING` is already removed (it should be, from finish step).
2. If the team uses an "In Review" state, move issue to `done` now.
3. Post `[NOTE] Review approved. Cleaning up worktree.`
4. Remove the worktree: `git worktree remove .worktrees/<featureName>`.

Do **not** remove the worktree at any other point.

---

## Tool selection

Schemas are **deferred** at session start. Load a tight set up front to avoid the `ToolSearch` tax later. **The deferred tool names are namespaced `mcp__linear-server__*` — bare names will not match.**

```
ToolSearch query: "select:mcp__linear-server__list_projects,mcp__linear-server__list_issues,mcp__linear-server__get_issue,mcp__linear-server__save_issue,mcp__linear-server__save_comment,mcp__linear-server__list_issue_statuses,mcp__linear-server__list_issue_labels,mcp__linear-server__extract_images,mcp__linear-server__get_attachment"
```

That's the 90% set. Add (with the same prefix) `create_issue_label`, `create_attachment`, `delete_comment`, `list_users`, `list_cycles`, `list_milestones` only if the task actually needs them. **Don't load `list_teams`** — `list_projects` already embeds team data.

In tool-call examples elsewhere in this skill, names are written without the prefix for readability — but the actual tool name you call is always `mcp__linear-server__<name>`.

### Reading issues

| Goal | Tool | Notes |
|---|---|---|
| Resolve a known identifier (`MIT-12`) | `get_issue` | Single call, accepts identifier or UUID |
| Search by title or text | `list_issues` with `query` | Filter by `projectId`/`teamId` to stay scoped |
| Issues assigned to me | `list_issues` with `assigneeId: me` | Use `list_users` once to resolve "me" |
| All issues in a project | `list_issues` with `projectId` | Paginates — pass `limit` |
| Quick existence check (idempotent dedupe) | `list_issues` with exact title in `query` + small `limit` | Cheaper than `get_issue` if you only need yes/no |

### Mutation response shapes

`save_issue` and `save_comment` echo back richer objects than Trello's MCP — that's where Linear pays a token premium. Don't re-read state from the response unless you need it; trust the call succeeded if no error was raised.

| Tool | Returns (rough) |
|---|---|
| `save_issue` | full issue object incl. `state`, `team`, `project`, `labels`, `attachments` (~1-2 KB) |
| `save_comment` | comment object incl. `user`, `issue` ref (~0.5-1 KB) |
| `create_attachment` | attachment object incl. `id`, `url`, `metadata` (~0.5 KB) |
| `list_projects` | array of projects each with embedded `teams[]`, `lead`, `members` (~2-4 KB total for typical workspace) |
| `list_issues` | array of issues, each compact (~1-3 KB total per page) |
| `list_issue_statuses` | small array of `{ id, name, type, color }` (~0.5 KB) |

---

## Tool ordering rules

- **Before creating an issue:** run `list_issues` with the exact title in `query`, scoped by `projectId`. If a match exists, **reuse** — do not duplicate. Linear lets you create perfect-duplicate titles silently; this check is the only guard.
- **Before any mutation:** resolve to a stable id once (identifier → UUID via `get_issue`) and cache. `save_issue` is happy with either, but caching avoids re-resolution on retries.
- **Before changing labels:** you must pass the **full desired set** in `save_issue` — read current labels via `get_issue` first.
- **Never call `list_teams`** as a discovery step — `list_projects` embeds teams.
- **Never call `list_issue_statuses` more than once per team per session** — cache the map.

---

## Attachments — the big one

Linear's attachment surface is the single roughest area of the MCP. Read this section before touching any image-related task.

### What each tool actually does (and doesn't)

| Tool | Reality |
|---|---|
| `create_attachment` | Requires the file inlined as **base64 in the tool argument**. The agent harness truncates Bash outputs >2 KB, so anything larger than ~10-20 KB base64 cannot be round-tripped cleanly. In practice, only useful for tiny images. |
| `get_attachment` | Returns metadata + the attachment URL. Does **not** download bytes. |
| `delete_attachment` | Removes an attachment. Use this if a `create_attachment` attempt produced a malformed file (the Trello MCP lacks this — Linear has it; use it). |
| `extract_images` | Parses **markdown image refs in the issue body**. Does **not** read attachments uploaded via the paperclip UI. URLs returned may be signed/expiring — fetch in the same run. |

### Recommended pattern: **images go in the body, not the attachment rail**

For the vast majority of agent-read workflows, the cleanest path is:

1. Humans paste images directly into the issue **description** (Linear uploads to `uploads.linear.app` and inserts a markdown ref automatically).
2. Agent reads via `extract_images` on the issue → returns markdown image URLs in one call.
3. Agent fetches each URL with `Bash` curl to a temp file → `Read` to analyze.

**Two MCP calls + one Bash + one Read.** No auth-header juggling, no base64 dance.

### When you must work with paperclip attachments

```
1. get_issue                     → attachments[] with ids and filenames
2. get_attachment(id)            → returns URL
3. Bash: curl <url> -o /tmp/...  → may need auth header for non-public uploads
4. Read /tmp/...
```

If `curl` returns 401/403, the attachment is behind auth. The MCP does not currently expose a clean way to download authenticated attachments — surface this to the user as a `[NOTE]` and ask them to either (a) re-paste the file into the description as markdown, or (b) provide a workaround.

### When you must upload from an agent

Don't, if you can avoid it. If you must:

1. Downscale the image to under ~15 KB on disk first (`sips -Z 120 input.png --out out.png` for PNGs).
2. Base64-encode and inline to `create_attachment`.
3. Verify the resulting attachment with `get_attachment` — confirm the size matches your encoded payload. **If size < 200 bytes, the upload was truncated by the harness — call `delete_attachment` immediately and try a smaller source.**
4. Prefer suggesting "paste it into the description" to the user as the first-class path.

---

## Documents and milestones (when relevant)

| Goal | Tool |
|---|---|
| Read a Linear doc | `get_document` (by id) |
| Search docs | `list_documents` with `query` |
| Find a project's milestones | `list_milestones` with `projectId` |
| Update a doc | `save_document` — passes `id` for update, no `id` for create |

Docs are large — only fetch when you need the body. Use `list_documents` with `query` and skim titles first.

---

## Efficient workflow patterns

### Find and update an issue

```
1. get_issue("MIT-12")                                    → full issue (cache labels)
2. save_comment(issueId, "[PLAN]…")
3. save_issue(id, state=stateMap.inProgress.id,
              labelIds=[...currentLabels, aiWorkingLabelId])
4. {do the work}
5. save_issue(id, state=stateMap.done.id,
              labelIds=[currentLabels minus aiWorkingLabelId])
6. save_comment(issueId, "[RESULT]…")
```

Six calls, no retries, no shape probing. This is the target shape for a finished run.

### Idempotent re-use before create

```
1. list_issues({ projectId, query: "<exact title>", limit: 5 })
   → if any result.title === target, reuse its id
   → else: save_issue (no id) to create
```

### Reading an image referenced in the body

```
1. extract_images(issueId)               → [{ url, alt }, ...]
2. Bash: curl -sSL "<url>" -o /tmp/img   → bytes on disk
3. Read /tmp/img                         → image into context
```

### Bulk comment loop

`save_comment` is cheap on tokens (~250 in / ~100 out per call) but every call hits the network. Linear has no documented strict rate limit on this endpoint, but assume ≤5 req/s as a conservative floor. Batch into one rich comment when possible — multiple short comments are noise.

---

## Drift detection

The Linear MCP can change shape between releases. **If you observe any of the following, post a `[NOTE]` to the user and treat the relevant section of this skill as suspect**:

- A tool name in this skill (`save_issue`, `extract_images`, etc.) is not in the available tool list — the MCP renamed or removed it.
- A response shape differs materially from the "Returns" column above (e.g. `save_issue` no longer echoes `state`).
- An argument this skill says is supported (e.g. `state` accepting a name) is rejected as invalid.
- `list_projects` no longer embeds `teams[]` and you genuinely need `list_teams`.

When drift is detected:

1. Post `[NOTE] Linear MCP behaviour diverged from the skill: <what>. Skill may be stale.` on the active issue.
2. Continue the task using the actual tool surface, not the documented one.
3. Tell the user at the end of the run so they can update this file.

---

## Anti-patterns (don't do these)

- Calling `list_teams` as a discovery step. Use `list_projects`.
- Calling `list_issue_statuses` more than once per team per session.
- Calling `create_attachment` for any image >20 KB without downscaling first.
- Calling `extract_images` expecting to read paperclip attachments.
- Reading a `save_issue` response just to confirm the mutation — trust the absence of error.
- Asking `ToolSearch` for "all linear tools" — load only what you need (see Tool selection).
- Creating duplicate issues because you skipped the `list_issues` dedupe check.
- Setting labels via `save_issue` without first reading current labels (you'll wipe them).

---

## Quick reference: minimal create-issue-with-comment

```js
// One-time per session
const proj = await list_projects({ query: "LocalLedger" });        // embeds team
const states = await list_issue_statuses({ teamId: proj.team.id });
const labels = await list_issue_labels({ teamId: proj.team.id });

// Per task
const dupes = await list_issues({ projectId: proj.id, query: title, limit: 3 });
const issue = dupes[0] ?? await save_issue({
  title, description, projectId: proj.id, teamId: proj.team.id,
  state: states.find(s => s.type === 'backlog').id
});
await save_comment({ issueId: issue.id, body: "[PLAN]\n…" });
```

That's the happy path. Everything else in this skill is detail for when the happy path isn't enough.
