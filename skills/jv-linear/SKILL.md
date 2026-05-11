---
name: jv-linear
description: Use when an agent needs to work with Linear via the jv-linear-mcp server (trimmed wrapper). Covers session setup, lifecycle transitions, attachment patterns, tool selection, response shapes, and drift detection. Prefer this over the `linear` skill whenever jv-linear-mcp is available — responses are leaner and lifecycle is atomic.
---

# jv-linear MCP Agent Skill

Use this skill when operating against the `jv-linear-mcp` server — the trimmed Linear wrapper that returns only the fields agents need. It mirrors `jv-trello` and `linear` skill conventions so cross-platform workflows stay consistent.

**This skill vs `linear`:** Same workflow discipline, half the plumbing. The wrapper handles `agentConfig` parsing, atomic lifecycle transitions, label auto-creation, and path-based attachment downloads — things the `linear` skill had to do manually.

Tools are prefixed `mcp__jv-linear-mcp__jv_*`. Schemas are deferred — load with `ToolSearch` before calling.

---

## Session setup

### 1 — Resolve project, team, and config in one call

```
ToolSearch: "select:mcp__jv-linear-mcp__jv_get_project,mcp__jv-linear-mcp__jv_list_issues,mcp__jv-linear-mcp__jv_get_issue,mcp__jv-linear-mcp__jv_save_issue,mcp__jv-linear-mcp__jv_list_comments,mcp__jv-linear-mcp__jv_save_comment,mcp__jv-linear-mcp__jv_lifecycle_transition,mcp__jv-linear-mcp__jv_extract_images,mcp__jv-linear-mcp__jv_download_attachment"
```

Then:

```json
{ "name": "jv_get_project", "arguments": { "idOrName": "<project name>" } }
```

The response includes everything you need for the session in one payload:

```js
{
  id, name, description, url, status,
  teams: [{ id, name, key }],   // team embedded — never call list_teams
  agentConfig: {
    worktrees: { create, path, branchFormat },
    autoCommit, createPr,
    states: { inProgress, inReview, done },  // already resolved — null = auto
    agentAssigneeFilter,
    memory: {                                // NEW — drives Obsidian sync routing
      kind: "engineering" | "learning" | "reference",  // default "engineering"
      hubPath: string | null,                // path (relative to wiki/) of the page that receives ## Linear log entries. null = auto-derived: "engineering"/"reference" → wiki/<ProjectName>.md, "learning" → wiki/Areas/<ProjectName>.md. Set only when the Linear project name doesn't match the wiki page title you want (e.g. project "Per" → hubPath: "Areas/Personal").
      tags: string[],                        // default ["project"]
      askWhenUncertain: boolean              // default false
    }
  }
}
```

Cache from this response:

```js
{
  projectId: project.id,
  teamId:    project.teams[0].id,
  teamKey:   project.teams[0].key,   // e.g. "MIT" → identifiers like MIT-12
  agentConfig: project.agentConfig
}
```

**Do not call `jv_list_projects` first** unless you genuinely don't know the project name — `jv_get_project` is a single focused call.

### 2 — Workflow states (only if creating issues with an explicit initial state)

If you need to create an issue with a specific non-default state, call once:

```json
{ "name": "jv_list_issue_statuses", "arguments": { "teamId": "<teamId>" } }
```

Returns `[{ id, name, type }]`. Cache and don't call again.

**Skip this call entirely** if you're only using `jv_lifecycle_transition` — it resolves states internally.

### 3 — No label setup needed

`jv_lifecycle_transition` auto-creates the `AI_WORKING` label if it doesn't exist. You never need to manually call `jv_list_issue_labels` or `jv_create_issue_label` at session start.

### 4 — Identifier system (no setup needed)

Linear auto-assigns identifiers like `MIT-12`. Resolve directly:

```json
{ "name": "jv_get_issue", "arguments": { "idOrIdentifier": "MIT-12" } }
```

Accepts both UUIDs and team-key identifiers. Prefer identifiers in user-visible communication.

### 5 — Worktree config

Apply `agentConfig.worktrees` from the project response:

| `worktrees.create` | Action |
|---|---|
| `'always'` | Create `.worktrees/<featureName>` with branch `feature/<featureName>` |
| `'ask'` (default) | Ask the user before creating |
| `'never'` | Work in current branch |

`featureName` = kebab-case slug from the issue title, max 40 chars. **One session = one worktree.** Subagents inherit the parent's `cwd`.

```bash
git worktree add .worktrees/<featureName> -b feature/<featureName>
```

If the project description has no `## Agent Config` block, `agentConfig` contains safe defaults — no need to post a `[NOTE]` about it unless defaults cause a problem. Do not write to the project description automatically.

---

## Project validation

Run this check whenever `jv_get_project` returns a project you haven't worked in before, or when the user asks you to start work on a project with no prior session context.

### 1 — Check for Agent Config block

After `jv_get_project`, inspect `agentConfig` from the response:

```js
// Safe defaults (what you get when no ## Agent Config block exists):
{
  worktrees: { create: 'ask', path: '.worktrees', branchFormat: 'feature/{name}' },
  autoCommit: false,
  createPr: false,
  states: { inProgress: null, inReview: null, done: null },
  agentAssigneeFilter: null
}
```

If `agentConfig.states.inProgress === null && agentConfig.states.inReview === null && agentConfig.states.done === null`, the project has **no Agent Config block** — it is running on defaults.

Post a `[NOTE]` on the issue you're working:

```
[NOTE] Project "X" has no ## Agent Config block in its description. Running on defaults (states auto-resolved, worktrees: ask). To configure: add the block to the project description matching LocalLedger's format.
```

### 2 — Validate states exist in the team workflow

If `agentConfig.states` has non-null values, call `jv_list_issue_statuses(teamId)` and verify each named state actually exists in the team's workflow:

```
agentConfig.states.inProgress → must match a status name (case-insensitive)
agentConfig.states.inReview   → must match a status name (or null = skip)
agentConfig.states.done       → must match a status name
```

If a configured state name doesn't match any real status, post:

```
[NOTE] agentConfig.states.X = "Y" but no matching workflow state found for this team. Check the ## Agent Config block — valid states are: {list from jv_list_issue_statuses}.
```

Then fall back to auto-resolution (null behavior) for that state.

### 3 — Consistency check (multi-project sessions)

If you have already loaded another project in the same session, compare:
- Do both projects belong to the same team? (same `teamId`) — if not, each needs its own `jv_list_issue_statuses` call; don't reuse cached statuses across teams.
- Do both projects have similar agentConfig structures? If one has a full config and another has none, note it to the user so they can align them.

### 4 — When to skip this check

- If you've already validated this project in the current session — skip.
- If the user explicitly says "skip validation" — skip.
- If you're just listing issues or reading without picking up work — skip.

---

## Comment discipline

Same taxonomy as `jv-trello` and `linear` — keep it consistent across platforms.

| Tag | When |
|---|---|
| `[PLAN]` | Before starting — what steps you will take and why |
| `[DECISION]` | At the moment you make a non-trivial judgment call |
| `[RESULT]` | What was done, what changed, deliverable or answer |
| `[NOTE]` | Context: worktree path, session info, admin notes |
| `[QUESTION]` | User input needed — blocks progress |
| `[LEARNING]` | At review approval — distilled journey, decisions, reversals, and key insight |

**A diff with zero `[DECISION]` comments is a process failure.**

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

`jv_save_comment` returns `{ id }` only — do not try to read the comment back.

---

## Issue lifecycle

Use `jv_lifecycle_transition` for all standard lifecycle moves — it handles state + `AI_WORKING` label atomically in one call, and auto-creates the label if missing. Mirrors `jv_lifecycle_transition` in `jv-trello`.

| Event | Call | Labels removed | Labels added |
|---|---|---|---|
| Agent picks up issue | `jv_lifecycle_transition(id, "pickup")` → In Progress | `AI_READY` (if present) | `AI_WORKING` |
| Agent finishes | Write/update `[LEARNING]`, stash ID, then `jv_lifecycle_transition(id, "complete")` → In Review | `AI_WORKING` | — |
| Agent blocked | Post `[QUESTION]`, stop. No state move needed. | — | — |
| Human approves (In Review → Done) | Human transitions in Linear UI; agent posts `[NOTE] Review approved.` + removes worktree | — | — |

Response shape:

```js
{ id, identifier, state: { id, name, type }, labelsAdded: [], labelsRemoved: [] }
```

**Only fall back to `jv_save_issue` for state/label changes** if `jv_lifecycle_transition` doesn't cover your case (e.g. a custom transition, or resetting to Backlog).

### Review handoff

When the user says "reviewed", "approved", "looks good":

1. **Write/update the `[LEARNING]` comment** (see below) — do this first, before anything else.
2. **Sync to Obsidian** (see "Obsidian sync" below) — appends a row to the wiki page's `## Linear log`. Skip if the project has no `linear_project`-tagged wiki page AND auto-stub creation isn't desired (default is auto-create).
3. **Run the `brain1-maintainer` subagent** to refresh the vault graph after the Obsidian sync:

   ```
   Agent(subagent_type: "brain1-maintainer", run_in_background: true,
     prompt: "Run /graphify --update on the Brain1 vault and report nodes/edges added.")
   ```

   Always dispatch in the background — the worktree cleanup and Done transition don't depend on it. Dispatch once per review handoff (not per cycle).

4. Post `[NOTE] Review approved. Cleaning up worktree.` on the issue.
5. Remove the worktree:

   ```sh
   gwr <featureName>
   ```

   `gwr` is the user's zsh function (`~/.zshrc`): `git worktree remove .worktrees/$1 && git branch -d feature/$1`. It cleans up both the worktree and the local branch — `git worktree remove` alone leaves the branch behind. The Claude Code Bash tool sources `~/.zshrc` via shell snapshot, so `gwr` is available.

   **Fallback** (if `gwr` is not on PATH for some reason — e.g. running outside the user's shell context):

   ```sh
   git worktree remove .worktrees/<featureName> && git branch -d feature/<featureName>
   ```

6. If the issue is still in "In Review" (human forgot to move it), call `jv_save_issue` to move to Done.

### [LEARNING] comment

**Trigger:** at `jv_lifecycle_transition("complete")` — every time the issue moves to In Review. If the issue cycles back to In Progress and you call `complete` again, update the existing `[LEARNING]` comment rather than creating a new one. One comment per issue, growing with each iteration.

**Finding the existing [LEARNING] comment** — use the **issue meta block** (see § Issue meta block below) instead of scanning all comments. On first creation, the skill stashes `learning_comment_id` in the description's meta block; on later cycles, it reads the ID from there and updates the comment by ID directly. **Zero `jv_list_comments` calls in steady state.**

**Reconstructing the journey** — to write/update the body, you still need the prior `[PLAN]`, `[DECISION]`, `[RESULT]` comments. Call `jv_list_comments(idOrIdentifier)` once and scan. Count how many times the issue cycled back from In Review to In Progress — each reversal is the highest-signal content to preserve.

**First-time creation flow:**

1. Build the `[LEARNING]` body (format below).
2. `jv_save_comment({ issueId, body })` → returns `{ id }`.
3. **Immediately stash that `id` in the issue meta block** (see § Issue meta block). One write to `jv_save_issue({ id, description })` with the updated description.

**Update flow (cycles 2+):**

1. `jv_get_issue(identifier)` → parse the meta block for `learning_comment_id`.
2. Build the updated `[LEARNING]` body (re-scan comments to capture the new cycle).
3. `jv_save_comment({ id: <stashed id>, body: <updated body> })` — direct update by ID.
4. Update `last_synced` and (after Obsidian sync) `obsidian_page` in the meta block — single `jv_save_issue` write.

**Format:**

```
[LEARNING]
## What was done
{one sentence — the outcome, not the steps}

## Iterations
- Cycle 1: {what the agent did} → {why it went back / what the user wanted instead}
- Cycle 2: {what changed} → approved
(omit if only one cycle — just note "single pass, no reversals")

## Key decisions & reversals
- {decision from a [DECISION] comment} — held / reversed — {why}
(include ALL [DECISION] tags; mark each as held or reversed)

## What to remember
{the single most important insight — what a future agent working on this issue, this project, or a similar task needs to know}

## Connects to
{other issue identifiers or project names this work relates to — leave blank if none}
```

**Rules:**
- Write it even on a single-pass issue — a null-reversal record is still useful signal.
- Never summarise what the `[RESULT]` already said. Focus on the journey and the insight, not the deliverable.
- If the user said "skip learning" or "no learning comment", skip it — user instruction overrides.

---

## Issue meta block

The skill stores small structured metadata on each issue at the **bottom of the description** as an HTML comment block. Hidden in Linear's rendered card; addressable by regex; survives editing the rest of the description.

**Format:**

```
<!-- jv-linear-meta
learning_comment_id: 01234abc-5678-...
obsidian_page: Local Ledger
last_synced: 2026-05-12T14:30:00Z
-->
```

Fields (all optional, only write what's relevant):

| Field | When set | Purpose |
|---|---|---|
| `learning_comment_id` | At first `[LEARNING]` write | Direct lookup on cycles 2+ — avoids `jv_list_comments` scan |
| `obsidian_page` | After Obsidian sync | The wiki page that received this issue's log entry. Helps re-sync on reversal/correction. |
| `last_synced` | After Obsidian sync | ISO 8601 timestamp of last wiki write |

**Read pattern:**

```js
// regex: extract block, parse YAML-ish key:value lines
const match = description.match(/<!--\s*jv-linear-meta\s*\n([\s\S]*?)\n\s*-->/);
const meta = parseLines(match?.[1] ?? "");
```

**Write pattern:** rebuild the block with current fields and replace the existing one (or append if absent), then `jv_save_issue({ id, description })`.

**Don't:**
- Put metadata anywhere else in the description — keep it in this block only.
- Strip the block on regular description edits — preserve it.
- Rely on labels or comments for metadata that the skill needs to read mechanically.

## Obsidian sync

The wiki at `/Users/juanvieira/development/knowledge/Brain1` (`~/development/knowledge/Brain1`) accumulates a record of completed Linear work. **Read its `CLAUDE.md` for full vault conventions** — this section covers only the sync hook.

**When this runs:** at review approval (step 2 of Review handoff above), after the `[LEARNING]` comment is written/updated and BEFORE the worktree cleanup.

**Steps:**

1. **Find the wiki page.** Prefer the `obsidian` CLI:

   ```sh
   obsidian search query="linear_project: <slug>" limit=3
   ```

   Fallback if CLI unavailable: scan `<vault>/wiki/` for files whose frontmatter contains `linear_project: <slug>`. Use the cached `agentConfig` from `jv_get_project` if you've stored the project slug there.

2. **If no wiki page exists, auto-create a stub honoring `agentConfig.memory`.**

   **Path resolution:**
   - If `agentConfig.memory.hubPath` is set → use `<vault>/wiki/<hubPath>.md`
   - Else if `kind: "engineering"` (default) → `<vault>/wiki/<Title Case Project Name>.md`
   - Else if `kind: "learning"` → `<vault>/wiki/Areas/<Title Case Project Name>.md`
   - Else if `kind: "reference"` → `<vault>/wiki/<Title Case Project Name>.md`

   **Stub `type:` frontmatter:**
   - `kind: "engineering"` → `type: entity`
   - `kind: "learning"` → `type: area`
   - `kind: "reference"` → `type: area`

   **Stub `tags:` frontmatter:** use `agentConfig.memory.tags` (default `["project"]`).

   Full frontmatter format defined in Brain1 `CLAUDE.md` § Conventions → Linear linkage. After creation, set `obsidian_page` in the issue meta block to the resolved page title.

   **Per-issue routing for `kind: "learning"`:** the hub page always gets a `## Linear log` row, but completed issues may *also* spawn or update a dedicated topic page:

   - **Update an existing wiki page** if `obsidian search query="<topic from issue title>"` finds a match — append to that page's relevant section, link from hub.
   - **Create a new `concept` page** (`wiki/<Topic>.md`, `type: concept`) when the `[LEARNING]` "What to remember" is a self-contained insight about a specific subject (e.g. "Tree-sitter incremental parses are O(log n)").
   - **Create a new `area` page** (`wiki/Areas/<Topic>.md`, `type: area`) when the topic is a *survey* of a domain ("Surveyed Rust async runtimes — Tokio dominant…") or when the same topic has shown up in 3+ completed issues (promote to area).
   - **No new page, hub log row only** for tiny incidental learning (e.g. "Read the docs for `git switch -c`").

   If `agentConfig.memory.askWhenUncertain` is true and the routing decision is ambiguous, post `[QUESTION]` on the issue and stop — don't guess.

   For `kind: "engineering"` and `kind: "reference"`, completed issues only update the hub page — no per-issue spawned pages.

3. **Append a row to `## Linear log`.** Newest on top. Section format defined in Brain1 `CLAUDE.md` § Operations → Linear sync.

   **Section placement on the wiki page** (when creating the section for the first time): always at the **bottom** of the page, after all hand-curated content. The section is auto-maintained — keeping it at the bottom protects user-written prose from being pushed down by accumulated entries. For auto-created stubs (page didn't exist before), the section sits below the H1 + one-line stub description. Once the section exists, only its rows update; the section never moves.

   Use:

   - **Substantive entry** (real `[LEARNING]` insight — reversals, edge cases, durable rules):
     ```
     - **<YYYY-MM-DD>** [<identifier> — <title>](<linear_url>)
       - **Did:** <one-liner from [RESULT] "## Changes">
       - **Insight:** <"What to remember" from [LEARNING]>
     ```
   - **Routine entry** (no real insight — small fix, dep bump, copy edit):
     ```
     - **<YYYY-MM-DD>** [<identifier> — <title>](<linear_url>) — *Did:* <one-liner>
     ```

   Decide routine-vs-substantive by inspecting the `[LEARNING]` "What to remember" line: empty / "n/a" / a single short clause that just restates the title → routine. Otherwise → substantive.

4. **Bump page metadata.** Set `updated: <today>` on the wiki page; increment `sources:` by 1. Don't touch `status` (user-owned).

5. **Append to `<vault>/log.md`** (one line, per Brain1 conventions):

   ```
   ## [YYYY-MM-DD] linear-sync | <project> ← <identifier>
   ```

6. **Update the issue meta block** with `obsidian_page` and `last_synced`. Single `jv_save_issue` write.

**Idempotency:** if `obsidian_page` is already set in the meta block AND a row for this `<identifier>` already exists in `## Linear log`, this is a re-sync (issue cycled back and out again). Update the existing row in place rather than appending a duplicate. Bump the date to the latest sync. The `[LEARNING]` comment is the source of truth — the wiki row reflects current state.

**Don't sync per-cycle.** The hook only runs at review approval. In-flight `complete` calls update the Linear comment but never touch the wiki — avoids reversal noise.

**Generalization:** the same flow handles a "Personal Learning" Linear project (issues like "Learn tree-sitter") writing to a `wiki/Personal Learning.md` page. No code-vs-knowledge special casing — the routing key is the project.

## Tool selection

Load the 90% set once at session start:

```
ToolSearch: "select:mcp__jv-linear-mcp__jv_get_project,mcp__jv-linear-mcp__jv_list_issues,mcp__jv-linear-mcp__jv_get_issue,mcp__jv-linear-mcp__jv_save_issue,mcp__jv-linear-mcp__jv_list_comments,mcp__jv-linear-mcp__jv_save_comment,mcp__jv-linear-mcp__jv_lifecycle_transition,mcp__jv-linear-mcp__jv_extract_images,mcp__jv-linear-mcp__jv_download_attachment"
```

Add on demand (same `mcp__jv-linear-mcp__` prefix):
- `jv_list_projects` — only if project name is unknown
- `jv_list_issue_statuses` — only if creating issues with specific states
- `jv_list_issue_labels` / `jv_create_issue_label` — only if managing labels beyond AI_WORKING

**Never load `jv_list_teams`** — it doesn't exist. Team data comes from `jv_get_project`.

### Tool cheat-sheet

| Goal | Tool |
|---|---|
| Project + config | `jv_get_project` |
| Resolve identifier / get full issue | `jv_get_issue` |
| Search by title or filter | `jv_list_issues` |
| Create or update issue | `jv_save_issue` |
| Read comment history | `jv_list_comments` |
| Create or update comment | `jv_save_comment` |
| Lifecycle move | `jv_lifecycle_transition` |
| Images in issue body | `jv_extract_images` |
| Download attachment to local file | `jv_download_attachment` |
| Workflow states | `jv_list_issue_statuses` |
| Labels | `jv_list_issue_labels` / `jv_create_issue_label` |

### Response shapes (trimmed by wrapper — smaller than upstream)

| Tool | Returns |
|---|---|
| `jv_get_project` | `{ id, name, description, url, status, teams[], agentConfig }` (~0.5 KB) |
| `jv_list_issues` | `[{ id, identifier, title, url, state, labels[], assignee }]` (compact per item) |
| `jv_get_issue` | slim + `description`, `attachments[]` |
| `jv_save_issue` | `{ id, identifier, state, labels[] }` (~0.2 KB — much smaller than upstream) |
| `jv_list_comments` | `[{ id, body, createdAt, updatedAt }]` (chronological) |
| `jv_save_comment` | `{ id }` |
| `jv_lifecycle_transition` | `{ id, identifier, state, labelsAdded[], labelsRemoved[] }` |
| `jv_extract_images` | inline image content block(s) + `[{ url, alt, path, bytes, mimeType }]` |
| `jv_download_attachment` | `{ path, bytes, mimeType }` |
| `jv_list_issue_statuses` | `[{ id, name, type }]` |

---

## Tool ordering rules

- **Before creating an issue:** run `jv_list_issues({ projectId, query: "<exact title>", limit: 5 })`. If a match exists, reuse — do not duplicate.
- **Before changing labels via `jv_save_issue`:** read current labels with `jv_get_issue` first — `labels` array replaces the full set.
- **Never call `jv_list_issue_statuses` more than once per team per session** — cache.
- **For all standard lifecycle moves:** use `jv_lifecycle_transition`, not raw `jv_save_issue` — it's atomic and handles edge cases.

---

## Attachments

### Images pasted into the issue body (recommended pattern)

When humans paste images into a Linear issue description, Linear inserts a markdown ref. Use `jv_extract_images` — it downloads each image and returns them as **inline image content blocks** directly in the tool response. No extra Read or curl step.

```
1. jv_extract_images(idOrIdentifier)
   → returns inline image(s) visible in context immediately
   → also returns JSON metadata: [{ url, alt, path, bytes, mimeType }]
```

**One MCP call. Image is in context. Done.**

If for any reason an image fails to embed inline, fall back to `Read <path>` using the `path` from the metadata — the file is always downloaded locally regardless.

**Encourage humans to paste images into the description**, not attach via the paperclip rail. Pasted images create markdown refs; `jv_extract_images` works on those. Paperclip attachments require the longer path below.

### Paperclip attachments

```
1. jv_get_issue(id)                           → issue.attachments[{ id, title, url }]
2. jv_download_attachment({ attachmentId })   → { path, bytes, mimeType }
3. Read <path>
```

`jv_download_attachment` handles auth headers for `linear.app` URLs automatically and always saves with the correct file extension (inferred from Content-Type) — no manual curl, no extension guessing.

### Uploading attachments from an agent

Not supported in v1 by design. If an agent needs to attach a file, suggest the user upload via the Linear UI and paste/link it in the description.

---

## Efficient workflow patterns

### Happy path: pick up and complete an issue

```
1. jv_get_project("LocalLedger")                     → cache projectId, teamId, agentConfig
2. jv_get_issue("MIT-12")                            → full issue; cache labels; parse meta block
3. jv_save_comment({ issueId, body: "[PLAN]…" })
4. jv_lifecycle_transition("MIT-12", "pickup")       → In Progress + AI_WORKING
5. {do the work, post [DECISION] comments as choices come up}
6. jv_save_comment({ issueId, body: "[RESULT]…" })
7. jv_list_comments("MIT-12")                        → reconstruct the journey
8. jv_save_comment({ issueId, body: "[LEARNING]…" }) → returns { id }, stash for later
9. jv_save_issue({ id, description: <updated with meta block> }) → stash learning_comment_id
10. jv_lifecycle_transition("MIT-12", "complete")    → In Review + removes AI_WORKING
```

Ten calls on the first cycle. On reversal cycles (issue bounces back to In Progress), drop the meta-block read since you already have the `learning_comment_id` cached, and use it to **update the existing [LEARNING] in place** rather than scanning comments to find it. Cycle 2 is ~6 calls.

### Review approved (after the user signs off)

```
1. {already-cached: learning_comment_id, projectSlug, identifier, title, [RESULT] one-liner}
2. obsidian search query="linear_project: <slug>"    → wiki page path (or stub if absent)
3. {append/update row in ## Linear log on that page; bump frontmatter; create stub if needed}
4. {append one line to <vault>/log.md}
5. jv_save_comment({ issueId, body: "[NOTE] Review approved. Cleaning up worktree." })
6. jv_save_issue({ id, description: <meta block updated with obsidian_page + last_synced> })
7. gwr <featureName>                                  → removes worktree + deletes branch
8. {if still In Review: jv_save_issue to move to Done}
```

### Idempotent create

```
1. jv_list_issues({ projectId, query: "<exact title>", limit: 5 })
   → if match: reuse id
   → else: jv_save_issue({ title, description, projectId, teamId })
```

### Read image from issue body

```
1. jv_extract_images("MIT-12")   → inline image in context + [{ url, alt, path, bytes, mimeType }]
```

One call. No Read, no curl.

---

## Drift detection

`jv-linear-mcp` is under our control, so schema drift is less likely than with the upstream MCP. However, if Linear's underlying GraphQL API changes (new required fields, renamed mutation inputs), tool calls may start failing.

**If any tool returns an unexpected error or shape:**

1. Post `[NOTE] jv-linear-mcp tool <name> behaved unexpectedly: <what>. Wrapper may need updating.` on the active issue.
2. Fall back to the upstream `mcp__linear-server__*` tools for the remainder of the session if possible.
3. Report the discrepancy to the user so `linear-client.ts` can be patched.

**If `jv_lifecycle_transition` fails to find a state or label:**

- States: call `jv_list_issue_statuses` and check what's there — the team's workflow may have changed.
- Labels: call `jv_list_issue_labels` and check — the label may have been manually deleted.

---

## Anti-patterns (don't do these)

- Loading all `jv-linear-mcp` tools with a broad ToolSearch — load only the 90% set.
- Calling `jv_list_issue_statuses` more than once per team per session.
- Using `jv_save_issue` for lifecycle moves instead of `jv_lifecycle_transition`.
- Setting `labels` in `jv_save_issue` without first reading current labels — you'll wipe them.
- Doing a raw `curl` to download attachments — `jv_download_attachment` handles auth.
- Creating a new issue without first checking for duplicates with `jv_list_issues`.
- Calling `jv_get_project` more than once per session — cache the response.
- Creating a new `[LEARNING]` comment on each `complete` call — read `learning_comment_id` from the issue meta block and update the existing comment in place.
- Calling `jv_list_comments` to find the `[LEARNING]` comment when its ID is already stashed in the meta block.
- Putting metadata anywhere outside the `<!-- jv-linear-meta ... -->` block in the description.
- Syncing to Obsidian on every `jv_lifecycle_transition("complete")` cycle — only at review approval.
- Creating per-issue wiki pages — completed-issue summaries accrete on the project's wiki page, not in their own files.
- Mirroring the full `[LEARNING]` comment to Obsidian — the wiki gets one-line "Did:" plus optional one-line "Insight:" (for substantive issues only).
- Tracking active/in-progress state in Obsidian — Linear is the source of truth for state; wiki only records completed work.
- Using `git worktree remove ...` directly when `gwr` is available — `gwr` also deletes the local branch.
