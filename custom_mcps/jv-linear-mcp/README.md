# jv-linear-mcp

A hand-written Linear MCP server optimised for agentic workflows. Mirrors the [`jv-trello-mcp`](../jv-trello-mcp) stack (Bun + TypeScript + `@modelcontextprotocol/sdk`) — same conventions, same response philosophy.

---

## Why Linear instead of Trello

Both platforms work. Linear is the better fit for agent-driven workflows because of three structural differences:

**1. No active-board state.**
Trello's MCP requires setting an "active board" before any call. If a previous session left it on the wrong board, you pay 3–5 extra tool calls before work can begin (discover board → switch → re-fetch labels → re-fetch lists). Linear has no equivalent — `jv_get_project("ProjectName")` always resolves directly. In our benchmarks this alone accounts for **71% of Trello's session-setup overhead**.

**2. Proper workflow states.**
Linear has first-class `Backlog → In Progress → In Review → Done` states with team-level workflow configuration. Trello maps these to list names — which work, but require the agent to know your list naming convention and fetch all lists to resolve them. Linear states are queryable, filterable, and consistent.

**3. Precise search.**
`jv_list_issues(query)` matches on title only, scoped to a project. Trello's search matches body text, comments, and card names across all boards — useful for humans, noisy for agents doing project-scoped lookups (produces false positives from description/comment matches).

### Benchmark — jv-trello vs jv-linear (daily-action flows)

Three common workflows: list In Progress tasks · full lifecycle (Backlog → In Progress → Done) · keyword search. Run in parallel on the same data set. See [`docs/comparison.md`](docs/comparison.md) for full methodology.

| Metric | jv-trello | jv-linear | Δ |
|---|---|---|---|
| Session setup calls | 7 | 2 | **−71%** |
| Full lifecycle calls | 6 | 5 | −1 |
| **Total tool calls** | **16** | **10** | **−38%** |
| **Tokens** | **32,995** | **28,851** | **−13%** |
| **Duration** | **92 s** | **61 s** | **−34%** |
| Search false positives | 2 | 0 | — |

---

## Why this MCP instead of the official `linear-server`

The official [Linear MCP](https://linear.app/changelog/2025-01-21-linear-mcp-server) works but is built for general use — it returns full GraphQL objects sized for UI renders, not agent consumption.

**Three specific differences:**

**1. Trimmed responses (3–4× smaller payloads).**

| Tool | Official `save_issue` | `jv_save_issue` |
|---|---|---|
| Mutation echo | ~1.3 KB (full issue object) | ~380 chars (confirmation only) |
| Project response | ~2–4 KB | ~750 chars (incl. parsed agentConfig) |
| Lifecycle transition | n/a (manual) | ~220 chars |

**2. `jv_lifecycle_transition` — one atomic call instead of three.**
The official server requires: `list_issue_statuses` → `list_issue_labels` → `save_issue` (with full label array) for every lifecycle move. `jv_lifecycle_transition("MIT-12", "pickup")` does all of that in one call, auto-creates the `AI_WORKING` label if missing, and returns a 220-char confirmation.

**3. `jv_get_project` returns parsed `agentConfig`.**
The official server returns the raw description string. This wrapper parses the `## Agent Config` JSON block from the project description and returns structured fields (`worktrees`, `autoCommit`, `states`, etc.) ready to use — no manual parsing in the agent.

### Benchmark — official vs wrapper (identical task, parallel agents)

Task: create issue → lifecycle (Backlog → In Progress → In Review) → `[PLAN]` + `[RESULT]` comments. No attachments.

| Metric | `linear-server` | `jv-linear-mcp` | Δ |
|---|---|---|---|
| Agent tokens | 30,313 | **23,589** | **−22%** |
| Duration | 129 s | **68 s** | **−47%** |
| MCP calls | 9 | **7** | −2 |

Consistent across image-reading tasks too: **−23% tokens, −17% time** with the same 2-call saving from `jv_lifecycle_transition`.

Full results across all runs: [`docs/comparison.md`](docs/comparison.md)

---

## Setup

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- A Linear personal API key

### 1 — Install

```bash
cd /path/to/jv-linear-mcp
bun install
```

No build step needed — Bun runs TypeScript directly.

### 2 — Configure

```bash
cp .env.template .env.local
```

Get your API key: **Linear → Settings → Account → API → Personal API keys → Create key** (name it `jv-linear-mcp`).

Paste into `.env.local`:

```env
LINEAR_API_KEY=lin_api_...
```

Optional: set a custom download directory for attachments (defaults to `/tmp/jv-linear-mcp`):

```env
LINEAR_DOWNLOAD_DIR=/path/to/downloads
```

### 3 — Register with Claude Code

```bash
claude mcp add jv-linear-mcp \
  /path/to/jv-linear-mcp/scripts/start-mcp.sh \
  -s user
```

Use `-s user` to make it available across all projects, or `-s project` / `-s local` to scope it to specific repos.

Verify: `claude mcp list` — you should see `jv-linear-mcp` with a ✓ Connected status.

The official `linear-server` (OAuth) can run in parallel if you need it — call `mcp__linear-server__*` vs `mcp__jv-linear-mcp__*` to choose per-call.

### 4 — Add the agent skill

The `jv-linear` skill lives at `~/.claude/skills/jv-linear/SKILL.md`. It teaches agents:
- Session setup (one `jv_get_project` call, everything cached)
- Lifecycle discipline (`[PLAN]` / `[DECISION]` / `[RESULT]` comments)
- Project validation (detect missing Agent Config blocks, verify state names)
- Tool selection (load only the 90% set, add on demand)

Invoke it via the `Skill` tool at the start of any Linear session.

---

## Agent Config (per-project settings)

Each Linear project can carry a machine-readable config block in its description. `jv_get_project` parses this automatically:

````markdown
## Agent Config
```json
{
  // worktree behaviour: "always" | "ask" | "never"
  "worktrees": { "create": "always", "path": ".worktrees", "branchFormat": "feature/{name}" },
  "autoCommit": true,
  "createPr": false,
  // null = auto-resolve from team workflow
  "states": { "inProgress": "In Progress", "inReview": "In Review", "done": "Done" },
  "agentAssigneeFilter": null
}
```
````

Add this block to any project's description in the Linear UI. Agents pick it up on the next `jv_get_project` call — no restart needed.

---

## Tools

| Tool | Purpose |
|---|---|
| `jv_list_projects` | List projects (id, name, description, url, status, teams) |
| `jv_get_project` | Project + parsed `agentConfig` — use this for session setup |
| `jv_list_issues` | Slim issue list — filter by project, team, assignee, or title query |
| `jv_get_issue` | Full issue — description + attachments |
| `jv_save_issue` | Create or update — state and labels accept names or ids |
| `jv_save_comment` | Create or update comment — returns `{ id }` only |
| `jv_lifecycle_transition` | **Compound:** state move + AI_WORKING label in one call (`pickup` / `complete`) |
| `jv_list_issue_statuses` | Workflow states for a team |
| `jv_list_issue_labels` | Labels for a team |
| `jv_create_issue_label` | Create a team label |
| `jv_extract_images` | Download markdown image refs from issue body — returns inline image content blocks |
| `jv_download_attachment` | Download paperclip attachment to local file — extension inferred from Content-Type |

## Out of scope (v1)

- Attachment uploads (by design — no base64-in-argument workaround)
- Documents, milestones, cycles, users
- Webhook listener

---

## Dev

```bash
bun run dev        # watch mode
bun run typecheck  # tsc --noEmit
```
