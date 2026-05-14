# MCP comparison: Linear vs Trello (LocalLedger)

Test task: create issue/card "Linear vs Trello MCP" → set description → attach `~/Downloads/recurring_ui.png` → comment what was done → move to Done → read attachment → comment image description.

## Linear MCP (`linear-server`) — completed 2026-05-08

| Metric | Value |
|---|---|
| **Agent total tokens** | **69,270** |
| **Agent tool_uses (harness count)** | **20** |
| **Agent duration_ms (harness)** | **337,330 ms (~5 min 37 s)** |
| Wall-clock task time (agent self-measured) | 296.16 s (~4 min 56 s) |
| MCP tool calls | 8 |
| Non-MCP tool calls | 9 |
| Retries / errors | 0 |
| Result | Success (with caveat) |
| Issue | [MIT-12](https://linear.app/mitocreations/issue/MIT-12/linear-vs-trello-mcp) |
| Team | MitoCreations (`MIT`) |
| Project | LocalLedger |
| Agent ID | `a91a90fa3b248c2db` |

### MCP call breakdown
- `list_projects` × 1
- `list_issues` × 1
- `get_issue` × 1
- `list_issue_statuses` × 1
- `create_attachment` × 1
- `save_comment` × 2
- `save_issue` × 1

### Non-MCP call breakdown
- `Bash` × 6 (timestamps, image downscale via `sips`, base64 encode)
- `Read` × 1 (PNG)
- `ToolSearch` × 1 (load Linear schemas)
- `Write` × 1 (plan file)

### Key limitation discovered
`create_attachment` requires the file to be inlined as base64 in the tool argument. The harness truncates Bash outputs >2 KB, so real-world images (>~10 KB base64) cannot be round-tripped through a tool argument cleanly. The agent had to downscale the 1.4 MB PNG to ~17 KB / 120 px wide via `sips -Z 120` to fit. **A path-based or presigned-URL upload mode would close this gap.** Trello's `jv_attach_file_to_card` accepts a path directly and sidesteps the issue.

`extract_images` parses markdown image refs in the issue body — it does not fetch issue attachments. To "describe what's in the image" the agent had to read the local file directly.

### Ergonomics note
Project / team / status flow felt natural — `list_projects` returns embedded teams (no extra `list_teams` needed), `save_issue` accepts either the status name or id, and idempotent re-use via `list_issues` query worked cleanly. Schemas are well-typed; no errors during the run.

## Trello MCP (`jv-trello`) — completed 2026-05-08

| Metric | Value |
|---|---|
| **Agent total tokens** | **50,683** |
| **Agent tool_uses (harness count)** | **35** |
| **Agent duration_ms (harness)** | **560,841 ms (~9 min 21 s)** |
| Wall-clock task time (agent self-measured) | 511.0 s (~8 min 31 s) |
| MCP tool calls | 11 |
| Non-MCP tool calls | 17 |
| Retries / errors | 2 (both on attachment) |
| Result | Success (with caveat — stray garbage attachment left on card) |
| Card | [LL-40](https://trello.com/c/88GOVWhi) |
| Board | LocalLedger |
| Agent ID | `a2a78649be4ddae6f` |

### MCP call breakdown
- `jv_list_boards` × 1
- `jv_get_active_board_info` × 1
- `jv_search_cards` × 1
- `jv_get_lists` × 1
- `jv_get_card` × 1
- `jv_attach_file_to_card` × 1 (failed: 411 on `file://` URL)
- `jv_attach_image_data_to_card` × 1 (succeeded but produced a 150-byte garbage PNG from a truncated base64 prefix)
- `jv_attach_image_to_card` × 1 (succeeded after uploading to catbox.moe)
- `jv_add_comment` × 2
- `jv_lifecycle_transition` × 1 (atomic move + label swap)

### Non-MCP call breakdown
- `Skill` × 1 (jv-trello)
- `ToolSearch` × 3
- `Bash` × 11
- `Read` × 2

### Key limitations discovered
1. **No way to attach a local file directly.** `jv_attach_file_to_card` rejects `file://` URLs with an unhelpful 411. `jv_attach_image_data_to_card` requires base64 inlined as a tool argument (~1.87 M chars for the 1.4 MB PNG — impractical). The agent ended up uploading to a third-party host (catbox.moe) and passing a public URL. Offline or network-restricted sessions would be stuck.
2. **No `jv_delete_attachment` tool.** A 150-byte malformed attachment from the truncated-base64 attempt is permanently stuck on LL-40.
3. **Error messages from Trello's API** (411 on `file://`) don't surface useful context.

### Ergonomics note
`jv_lifecycle_transition` is a standout — one call atomically moved column + swapped labels and returned a small confirmation. The skill's comment-style discipline (`[PLAN]`/`[RESULT]`/`[NOTE]`) felt natural. Read / move / comment / label workflows are smooth; the rough edge is exclusively at the file-upload boundary. Tool responses were lean overall (largest ~4 KB).

## Comparison summary

| | **Linear** | **Trello** | Winner |
|---|---|---|---|
| Tokens | 69,270 | **50,683** | Trello (-27%) |
| Harness tool_uses | **20** | 35 | Linear (-43%) |
| Harness duration | **337 s** | 561 s | Linear (-40%) |
| Self-measured wall-clock | **296 s** | 511 s | Linear (-42%) |
| MCP calls | **8** | 11 | Linear |
| Non-MCP calls | **9** | 17 | Linear |
| Retries / errors | **0** | 2 | Linear |
| Local-file attachment | ❌ (base64 only, harness truncates >2 KB output) | ❌ (URL-only or base64; no path mode) | Tie — both broken |
| Attachment delete tool | n/a (didn't need) | ❌ missing — left garbage on card | Linear |
| Status/list resolution | Clean (`list_issue_statuses` → `save_issue` accepts name or id) | Clean via `jv_lifecycle_transition` (atomic move + label swap) | Tie |
| Schema verbosity | Heavier (deferred-tool ToolSearch loads + larger response shapes) | Lighter, well-trimmed responses | Trello |
| Idempotent re-use | `list_issues` query worked first try | `jv_search_cards` worked first try | Tie |

### Headline takeaways
- **Trello uses ~27% fewer tokens but takes ~70% longer wall-clock.** The token efficiency comes from leaner response shapes; the time cost comes from the attachment retry loop (3 separate attach attempts + sips/curl gymnastics) and overall longer per-call latency.
- **Linear is faster and cleaner per call** — well-typed schemas, no retries, fewer total calls. The schema/tool descriptions cost more tokens up front but the workflow lands quickly.
- **Both MCPs share the same fundamental gap**: no first-class way to upload a local file. Each works around it differently, and both workarounds are awkward inside an agent harness that truncates >2 KB stdout.
- **Trello's missing `delete_attachment`** is a real correctness gap — once you create a bad attachment, it stays. Linear didn't expose this issue in this test but worth checking if it has the same gap.
- **`jv_lifecycle_transition` is a genuinely nice ergonomic win** — folding column move + label swap into one call is the kind of compound primitive that pays off across runs.

### Recommendations
- Add a path-based attachment tool to **both** MCPs (`jv_attach_local_file_to_card` and a `linear-server` equivalent that uploads via the underlying API rather than inlining base64). This is the single highest-leverage improvement for either server.
- Add `jv_delete_attachment` to the Trello MCP.
- Consider adding a Linear analog of `jv_lifecycle_transition` (atomic status + label change in one call) for parity.

---

## Linear MCP — run 2 (with `linear` skill, 2026-05-08)

Different task (no attachment): create `testing linear mcp` → full lifecycle (Backlog → In Progress → In Review) → fetch latest Bun release details → comment results.

| Metric | MIT-12 (no skill) | **MIT-13 (with skill)** | Δ |
|---|---|---|---|
| Agent total tokens | 69,270 | **48,322** | **−30.2%** |
| Agent duration_ms | 337,330 (~5m37s) | **114,376 (~1m54s)** | **−66.1%** |
| Agent tool_uses | 20 | **17** | −15% |
| MCP calls | 8 | 7 | −1 |
| Non-MCP calls | 9 | 6 | −3 |
| Retries / errors | 0 | 1 (skill drift, see below) | — |
| Result | ✅ MIT-12 | ✅ MIT-13 | — |
| Agent ID | `a91a90fa3b248c2db` | `a553d1c9fde0c0a1f` | — |

### What the skill changed in practice
- Single `save_issue` did state + label changes in one call (vs. multi-step probing in run 1).
- `state` and `labels` accepted by **name** — saved a `get_issue` round-trip per lifecycle step.
- Zero `list_teams` calls (skill explicitly forbids it).
- Zero `list_issue_statuses` calls (caller pre-resolved; skill's "cache once per session" rule held).
- No attachment overhead (different task). Per-task token comparison would shift if attachment work is included; skill effect on attachment-heavy tasks needs a separate measurement.

### Skill drift caught (and fixed)
The skill's `ToolSearch select:` snippet used bare tool names (`select:list_issues,…`) but deferred tools are namespaced `mcp__linear-server__*`. Bare names returned zero matches → agent had to retry with the prefix. **Fixed in the skill** — `select:` examples now use the full `mcp__linear-server__` prefix.

### Caveat
MIT-12 included the image-attachment retry loop (a known-rough surface); MIT-13 did not. The headline -30% / -66% deltas blend two effects: (a) the skill's workflow guidance, and (b) skipping the attachment-heavy work. A clean isolated re-run with attachment + skill would separate them.

---

## Linear: upstream vs wrapper — apples-to-apples (2026-05-08)

**Identical task, run in parallel**: create issue → set description → lifecycle (Backlog → In Progress → In Review) → `[PLAN]` + `[RESULT]` comments. No attachments, no worktrees. Both agents used their respective skill.

| Metric | `linear-server` (MIT-15) | **`jv-linear-mcp` (MIT-14)** | Δ |
|---|---|---|---|
| **Agent total tokens** | 30,313 | **23,589** | **−22%** |
| **Agent duration_ms (harness)** | 129,144 (~2m9s) | **68,044 (~1m8s)** | **−47%** |
| **Wall-clock (self-measured)** | ~110s | **~51s** | **−54%** |
| **Agent tool_uses** | 13 | **11** | −2 |
| **MCP calls** | 9 | **7** | −2 |
| **Non-MCP calls** | 4 | 4 | tied |
| **Retries / errors** | 0 | 0 | tied |
| Result | ✅ MIT-15 | ✅ MIT-14 | — |
| Agent ID | `ac1d47aba0e215e37` | `af14b633f383bd009` | — |

### The two saved MCP calls

| Call eliminated | Why |
|---|---|
| `list_issue_statuses` | `jv_lifecycle_transition` resolves states internally |
| `list_issue_labels` | `jv_lifecycle_transition` auto-creates `AI_WORKING` if missing |

### Response size comparison

| Tool | upstream `save_issue` | wrapper `jv_save_issue` | Ratio |
|---|---|---|---|
| Mutation echo | ~1.3 KB (full issue object) | ~380 chars (trimmed slim) | **3.4× leaner** |
| Project response | ~2–4 KB | ~750 chars (incl. parsed agentConfig) | **~4× leaner** |
| Lifecycle transition | n/a (manual 2-call) | ~220 chars | — |

### Ergonomics delta

- **Upstream**: `list_issue_statuses` + `list_issue_labels` required before any lifecycle move. Full label array must be passed on every `save_issue` mutation (replace semantics). `list_issues` fuzzy-matched and returned 3 unrelated results — client must filter in-memory.
- **Wrapper**: `jv_get_project` returned project + team + parsed `agentConfig` in one call. `jv_lifecycle_transition` collapsed a 3-call sequence into 1. No label pre-fetch needed. One agent note: `jv_list_issues` dedupe query should always pass `projectId` for strict scoping.

### Headline takeaways

- **−22% tokens, −47% wall-clock, −54% self-measured time** on an identical, clean task. This is the wrapper's baseline advantage before any attachment savings are factored in.
- **All savings came from two sources**: (1) wrapper's compound `jv_lifecycle_transition` replacing 2 separate upstream calls, and (2) trimmed response shapes reducing per-call payload 3–4×.
- **Non-MCP calls were identical (4)** — the overhead of Skill + ToolSearch + timestamps is the same for both; the wrapper doesn't help there.
- Both runs were clean (0 retries). The wrapper's smaller surface means less schema to load and fewer opportunities for shape-probing detours.

### Cumulative Linear skill + wrapper impact (vs original no-skill run MIT-12)

| | MIT-12 (no skill, w/ attachment) | MIT-15 (skill, upstream) | MIT-14 (skill, wrapper) |
|---|---|---|---|
| Tokens | 69,270 | 30,313 | **23,589** |
| Duration | 337s | 129s | **68s** |
| vs MIT-12 | baseline | −56% tokens / −62% time | **−66% tokens / −80% time** |

The skill alone (MIT-12 → MIT-15) cut tokens in half and time by 62%. Adding the wrapper (MIT-15 → MIT-14) pushed it to −66% tokens and −80% time vs the original. Not all of that is the wrapper — MIT-12 had attachment overhead — but the trend is clear and consistent across all three task shapes tested.

---

## Linear: upstream vs wrapper — image task, run 2 (2026-05-09)

**Same parallel setup, now with image reading.** Both issues (MIT-14, MIT-15) had an image pasted in the body with the prompt "Please describe what you see in the image above." First run (same day) revealed `jv_extract_images` had a file-extension bug causing a Read failure. Bug fixed before this run — extension now inferred from Content-Type header, image returned inline.

**Task**: pick up issue → `[PLAN]` → extract + describe image → `[RESULT]` → complete lifecycle. No worktrees.

| Metric | `linear-server` (MIT-15) | **`jv-linear-mcp` (MIT-14)** | Δ |
|---|---|---|---|
| **Agent total tokens** | 32,736 | **25,241** | **−23%** |
| **Agent duration_ms (harness)** | 77,580 ms (~1m18s) | **64,271 ms (~1m4s)** | **−17%** |
| **Wall-clock (self-measured)** | ~51s | **~47s** | **−8%** |
| **MCP calls** | 8 | **6** | **−2** |
| **Non-MCP calls** | 4 | **3** | −1 |
| **Retries / errors** | 0 | 0 | tied |

### MCP call breakdown

| Tool | linear-server (MIT-15) | jv-linear-mcp (MIT-14) |
|---|---|---|
| get/resolve issue | `get_issue` ×1 | `get_issue` ×1 |
| state resolution | `list_issue_statuses` ×1 | — (handled by `jv_lifecycle_transition`) |
| label resolution | `list_issue_labels` ×1 | — (auto-created by `jv_lifecycle_transition`) |
| lifecycle moves | `save_issue` ×2 | `jv_lifecycle_transition` ×2 |
| comments | `save_comment` ×2 | `jv_save_comment` ×2 |
| image extraction | `extract_images` ×1 | `jv_extract_images` ×1 |
| **Total** | **8** | **6** |

### Image extraction — both now inline, one call each

Both MCPs returned the image as an inline content block with no extra steps:
- **Upstream `extract_images`**: fetched signed URL and returned `<output_image>` inline. Token was from the preceding `save_issue` response, still valid.
- **`jv_extract_images` (after fix)**: downloaded to `/tmp/jv-linear-mcp/`, base64-encoded, returned inline. Agent confirmed: *"One MCP call, zero follow-up steps."* File saved with correct `.png` extension (from Content-Type header).

Previous run's extra 3 non-MCP calls (Bash + Read retry due to missing extension) now gone — bug closed.

### Headline takeaways

- Wrapper wins on **every metric** in this run: tokens, harness time, self-measured time, MCP calls, non-MCP calls. The image fix removed the last rough edge.
- **−23% tokens, −17% harness time** vs upstream on an image-reading task — consistent with the no-image run (−22% tokens, −47% time). Wall-clock gap is smaller here because image download is the dominant time cost for both, not API calls.
- **`jv_lifecycle_transition` eliminated 2 MCP calls** (label fetch + status fetch) in both runs consistently. This is the single biggest token/call saver in the wrapper.

### Cumulative summary across all runs

| Run | Task | MCP | Tokens | Duration |
|---|---|---|---|---|
| MIT-12 | create + attach + image (no skill) | upstream | 69,270 | 337s |
| MIT-13 | create + research (with skill) | upstream | 48,322 | 114s |
| MIT-15 run 1 | create + lifecycle | upstream | 30,313 | 129s |
| MIT-15 run 2 | lifecycle + image | upstream | 32,736 | 78s |
| MIT-14 run 1 | create + lifecycle | wrapper | 23,589 | 68s |
| MIT-14 run 2 | lifecycle + image | **wrapper** | **25,241** | **64s** |

Wrapper is now consistently **−20 to −25% tokens** and **−8 to −50% time** vs upstream across all task shapes. The time gap is largest when the task involves many small API calls (lifecycle-heavy); smallest when dominated by a single large operation (image download) that both handle equivalently.

---

## Round 5 — jv-trello vs jv-linear, daily-action flows (Personal board/project, 2026-05-09)

**Test design:** Three common daily-agent workflows run back-to-back on both platforms. Same task set, different MCPs.

| Flow | Description |
|---|---|
| 1 | "What am I working on?" — list In Progress tasks |
| 2 | Full lifecycle — pick Backlog task → [PLAN] → pickup → [DECISION] → [RESULT] → complete |
| 3 | Keyword search — find tasks containing "AI" or "agent" |

### jv-trello (Personal Trello board)

| Phase | Tools used | Calls |
|---|---|---|
| Session setup | `jv_get_active_board_info`, `jv_get_board_labels`, `jv_list_board_prefixes`, `jv_get_lists`, `jv_set_active_board` (board was wrong), `jv_get_board_labels` ×2, `jv_get_lists` ×2 | 7 |
| Flow 1 — In Progress | `jv_get_cards_by_list_id` | 1 |
| Flow 2 — Full lifecycle | `jv_get_cards_by_list_id`, `jv_get_card`, `jv_add_comment` ×2, `jv_lifecycle_transition` ×2 | 6 |
| Flow 3 — Keyword search | `jv_search_cards` ×2 (parallel) | 2 |
| **Total** | | **16** |

- Task worked on: "Research Hermes vs OpenClaw for simple cron to fetch price from URL [PER-2]"
- Results found (search): 7 unique cards (2 false positives from description/comment text)
- Friction: active board was JvLearning, not Personal — required `jv_set_active_board` + 2 re-fetches. BLOCKED label missing → auto-created (parallelised, no latency cost).
- Tokens: 32,995 | Duration: 92,146 ms

### jv-linear (Personal Linear project)

| Phase | Tools used | Calls |
|---|---|---|
| Session setup | `ToolSearch`, `jv_get_project` | 2 |
| Flow 1 — In Progress | `jv_list_issues` (state filter) | 1 |
| Flow 2 — Full lifecycle | `jv_get_issue`, `jv_save_comment` ×2, `jv_lifecycle_transition` ×2 | 5 |
| Flow 3 — Keyword search | `jv_list_issues` ×2 (parallel) | 2 |
| **Total** | | **10** |

- Task worked on: MIT-77 "Check Wix charge"
- Results found (search): 7 unique issues (title-only match, no false positives)
- Friction: none. Clean path — no board switching, no missing labels, no re-fetches.
- Tokens: 28,851 | Duration: 61,148 ms

### Delta

| Metric | jv-trello | jv-linear | Δ |
|---|---|---|---|
| Session setup calls | 7 | 2 | **−5 (−71%)** |
| Flow 1 calls | 1 | 1 | = |
| Flow 2 calls | 6 | 5 | **−1** |
| Flow 3 calls | 2 | 2 | = |
| **Total tool calls** | **16** | **10** | **−6 (−38%)** |
| **Tokens** | **32,995** | **28,851** | **−4,144 (−13%)** |
| **Duration** | **92,146 ms** | **61,148 ms** | **−30,998 ms (−34%)** |
| Search false positives | 2 | 0 | Linear cleaner |

### Key qualitative findings

- **Active-board state is Trello's biggest structural liability for agents.** Any session where a different board was left active (a normal occurrence in multi-project workflows) costs 3 extra calls before work can begin. Linear has no equivalent concept — `jv_get_project` is always direct.
- **Search precision:** Linear's `jv_list_issues(query)` matches on title only and scopes to a project. Trello's `jv_search_cards` matches body + comments + card names across all boards — useful for humans, noisy for agents doing scoped lookups.
- **Lifecycle parity:** Both platforms used a single atomic `jv_lifecycle_transition` call each direction. No difference in lifecycle ergonomics.
- **Setup cost:** Linear's 2-call session setup (ToolSearch + jv_get_project) vs Trello's 7-call setup (board discovery + label fetch + list fetch + possible board switch) is the dominant gap. Across a 10-issue workday this compounds significantly.

### Cumulative: Linear vs Trello across all rounds

| | Tokens | Duration | Tool calls | Errors |
|---|---|---|---|---|
| Round 1 (Trello, attachment-heavy) | 50,683 | 561s | 35 | 2 |
| Round 1 (Linear upstream, attachment) | 69,270 | 337s | 20 | 0 |
| Round 3 (Trello, lifecycle) | — | — | — | — |
| Round 3 (jv-linear-mcp, lifecycle) | 23,589 | 68s | 11 | 0 |
| **Round 5 (Trello, daily flows)** | **32,995** | **92s** | **16** | 0 |
| **Round 5 (jv-linear, daily flows)** | **28,851** | **61s** | **10** | 0 |

jv-linear-mcp wins on tool calls and duration in every comparable run. Trello's token advantage in Round 1 was attachment-specific (image upload gymnastics cost Linear more tokens); on clean lifecycle and daily-action tasks, Linear is consistently leaner on all three metrics.

