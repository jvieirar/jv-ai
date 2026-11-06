---
name: jv-bee
description: Use when a feature or ticket is big enough to split across agents. One home thread (where the wave starts) plans contract-first, a different-vendor model critiques the plan, and Build and Review + Ship run as delegated Opus children of that thread, so the user watches one thread per feature. DeepSeek V4.1 Flash implements in parallel with strict file ownership (Haiku 5.5 capped at 100k as fallback, a fresh Opus child for risky slices). Fix rounds go to fresh workers, a Haiku Visual QA agent checks screens as text and captures the PR preview, and a Haiku clerk does every Notion action. Triggers on "orchestrate this", "use the bee workflow", "you design, workers implement", or any multi-package feature where Juan asks for subagents plus a Codex review.
---

# jv-bee: orchestrated work with worker agents

A workflow skill. You are the **orchestrator and designer**: you own the plan, the contract between the workers, the
review, the verification and the hand-off. **Workers** write most of the code. A **reviewer from another vendor** reads
the result without anchoring on your reasoning, twice: once on the plan, once on the diff. Juan stays the only
approver.

This skill distils real runs: Cantoalegre CA-32/CA-34 (PR #82, 26/10/2026), CA-107 (PR #124, 02/11/2026), the cost
profile of wave 1 (CA-107/108/109/110, 02/11/2026) and wave 2 (CA-111/112, PR #134, 03/11/2026). Their lessons are
marked *(learned)*; keep them unless a later run disproves them. Version 2 (03/11/2026) added DeepSeek workers, the
Haiku cap, fresh fix workers, Visual QA and the Notion clerk. **Version 3 (06/11/2026)** replaces the four top-level
phase threads with one home thread and delegated phase children, adds the review rounds with Juan and the final wave
report, and fixes the reading limits, the Serena setup and the scout model after wave 2.

Repository instructions (`AGENTS.md`), ticket workflows (`jv-notion`, `jv-linear`) and policy (whether to create PRs,
worktrees) always win over this skill. This skill decides **who does what and in what order**, not project rules.

## Why it is shaped this way: context is the cost

*(learned, wave 1)* Cost is **calls × context per call**, not the model's list price. Workers started at 51–59k
tokens and grew to 200–750k because nothing compacted. Haiku sat above its 100k price tier on 94–98% of calls. The
orchestrator averaged 336k over 467 calls, about $0.07 for every Notion update or status check. Whole-file reads
were 36–69% of what workers read, and `preview_snapshot` images were 52% of the UI worker's and up to 84% of the
orchestrator's. *(learned, wave 2)* $96 API-equivalent over 05:26–13:10 UTC, home thread and Juan's review rounds
included (`waves.json` entry CA-111; Opus was $95 of it). The two Opus children of the risky slices were over half
(contexts of ~280k on average), whole-file and shell reads were still 68% of all tool-result bytes, and 94 calls were
denied by the repo's grep hook because the briefs prescribed `rg`/`sed` instead of Serena. So:

- **Short-lived contexts.** Fresh phase children, fresh workers for fix rounds, a clerk for Notion.
- **Haiku capped at 100k** (`autoCompactWindow`), with progress kept on disk so compaction loses nothing.
  *(measured, 03/11 and 06/11/2026)* Compaction fires at about 64–79k, so no call reaches the 100k price tier. Native
  Haiku agents start at ~26k and resume at ~37–42k after a compaction: **25–30k of working room**. A capped Haiku that
  read 300-line chunks of long Markdown docs refilled within three turns, three times, and Claude Code stopped it
  ("autocompact is thrashing"). **A capped Haiku reads at most ~8k tokens per call**: about 150 lines of prose, 250 of
  code, or one symbol. The cap saved real money (Haiku: ~$135 over 25/10–02/11 uncapped, under $1 over 03–04/11
  capped), so it stays for agents.
- **Narrow reads everywhere.** Children end with at most 20 lines and write the rest to a file. Read code by symbol,
  not whole files. Screens are checked as text; images are taken only from the PR preview.
- **Measure every wave**, last, with `wave-profile`, and compare against the history.

## Roles and models

| Role | Model and how it runs | Does |
| --- | --- | --- |
| Home (P1 Plan) | Opus 5.5, `xhigh` while writing the contract, else `high`; the thread where the wave starts | reading, plan, contract, shared code, critic, briefs, handoff; launches the phases; Juan's review rounds; the wave report |
| Build | Opus 5.5 `medium`, `delegate_task` child of home | dispatches workers, handles fallbacks, docs while waiting, narrow tests per slice, full check |
| Review + Ship | Opus 5.5 `high`, `delegate_task` child of home | reviews the diff, Visual QA (text), Codex review, fresh fix workers, second pass; PR, CI, preview, screenshots, clerk updates |
| Contract critic | Codex `gpt-6.1-sol` high, Bash, read-only, Serena off | reviews the committed plan against the requirements before any worker starts |
| Implementer | **DeepSeek V4.1 Flash** (`opencode-go`), `delegate_task` | builds one slice against the contract, writes its tests, commits its own paths |
| Implementer fallback | **Haiku 5.5** `high`, `delegate_task`, capped at 100k | the same brief, when DeepSeek fails (see "Fallback") |
| Implementer, risky slice | a **fresh Opus 5.5** child at `high`, `delegate_task` | slices where concurrency, idempotency, retries, money, migrations or security meet |
| Scout | Haiku 5.5, **native agent `haiku-5-5` only** | read-only fan-out: inventories, audits, "how is X used" |
| Visual QA | Haiku 5.5, native agent `bee-visual-qa` | Review: screens as text. Ship: screenshots of the PR preview, saved to disk |
| Notion clerk | Haiku 5.5, native agent `bee-clerk` | every jv-notion action, from packets the orchestrator writes |
| Cross-vendor reviewer | Codex `gpt-6.1-sol` high, Bash, read-only, Serena off | reviews the diff, then verifies the fixes |

`delegate_task` targets (T3 Code; check `orchestrator_capabilities` once per thread):

```text
DeepSeek  {providerInstanceId: "opencode", model: "opencode-go/deepseek-v4.1-flash", options: {variant: "high"}}
Haiku     {providerInstanceId: "claudeAgent_claude_personal", model: "claude-haiku-5-5", options: {effort: "high"}}
Opus      {providerInstanceId: "claudeAgent_claude_personal" or "claudeAgent", model: "claude-opus-5-5", options: {effort: "high"}}
```

- **Split Opus across the two Claude accounts** (`claudeAgent` and `claudeAgent_claude_personal`): put the phase
  children and the risky slices on whichever has usage left, and never two heavy Opus slices on the same account.
  *(learned, wave 2)* Both risky slices on one account hit its 5-hour limit, cost $5 and a restart; on a
  usage-limit error, relaunch the same brief on the other account at once.
- Never `opencode/deepseek-v4.1-flash-free` (unknown data policy) or the personal `opencode/` provider (no funds).
- **Scouts are always the native `haiku-5-5` agent**, never `Explore`, `general-purpose` or another type that inherits
  the parent's Opus. *(learned, wave 2)* A scout launched as a generic agent ran on Opus and cost 15× a Haiku one.
- Native agents (scout, Visual QA, clerk) run with `run_in_background: false`: they finish in the turn that needs them.
  Their definitions live in `~/.agents/agents/` (`haiku-5-5.md`, `bee-visual-qa.md`, `bee-clerk.md`), linked into both
  Claude profiles. Visual QA and the clerk skip `CLAUDE.md` (`omitClaudeMd`) to keep their starting context small.
- **Where the Haiku cap is set:** in each agent definition (`autoCompactWindow: 100000`, *verified 06/11/2026* to work
  without any global setting), and per model in the **personal profile only**
  (`~/.claude-personal/settings.json`: `"modelSettings": {"claude-haiku-5-5": {"autoCompactWindow": 100000}}`), so
  `delegate_task` Haiku children get it. The main profile has no global Haiku cap: an interactive Haiku chat carries
  ~45k of fixed context (MCP instructions, tool lists, hooks), so a 100k cap left it 3–5k of room and it compacted
  after almost every tool call *(measured 04/11/2026)*.

**No Sonnet.** The Sonnet 5.5 trial ended on 02/11/2026: at equal tokens it costs about 80% of Opus (cache reads
cost the same, $0.20/M), and its slice still drew 8 of 15 Codex findings. Retry it only once worker context is
capped and measured.

*(learned)* Implementers run at **high** effort. Most defects the review found came from gaps in the
**orchestrator's plan**, not from the implementer's tier, so improve the plan before upgrading the model.

*(learned, CA-107)* Of 13 cross-vendor findings, 8 traced to the orchestrator's plan, contract or own code, 3 to the
implementer, and the implementer caught 2 contract errors of the orchestrator's by reading the source blueprint. It
also *reported* a race but did not fix it, because the brief did not allow it. Hence the contract critic, the contract
checklist and the fix-then-report rule below.

## One home thread; the phases run as its children

*(learned, wave 2)* Four top-level phase threads meant four threads to watch per feature (eight with two features in
flight), none reported back, and Juan's review rounds landed in the last thread after its handoff was written. The
useful part was a **fresh context per phase**, not a top-level thread. So:

- **The home thread is the thread where Juan starts the wave.** It does P1 Plan itself and stays the only thread Juan
  talks to for that feature. It never launches top-level threads (`t3_thread_launch`) for phases.
- **Build and Review + Ship are `delegate_task` children of home**, each with a fresh context. *(verified 06/11/2026)* A
  delegated child can start its own `delegate_task` children on Claude and OpenCode and use native agents, so a phase
  child dispatches its workers itself.

  ```text
  delegate_task  mode: "async", role: "implementation", isolation: "shared"
                 title: "<ticket> · Build"   (or "<ticket> · Review + Ship")
                 target: Opus on the account with usage left, effort "medium"   (Review + Ship: "high")
                 task:  "Load the jv-bee skill. You are the Build phase of wave <ticket>, a child of its home thread.
                         Read /home/grawar/handoffs/<project>-<ticket>-bee.md first and follow it. Work only in
                         <absolute worktree>. Start workers, the clerk, Visual QA and Codex as the skill says."
  ```

  The child does not inherit home's working directory, so the task names the worktree. **Juan authorized this on
  03/11/2026:** a jv-bee wave may start its phases without asking.
- **A phase child owns its workers** and ends only when they have. It updates the wave handoff, then ends with at most
  20 lines: status, commits, PR, the handoff section to read. Its completion wakes home.
- **Home's wake-ups are short.** Read the child's summary and the handoff section it names, tell Juan the result in a
  few lines, start the next phase. Don't re-read the plan or the code: home's context is the largest in the wave and
  every turn re-reads it.
- If `delegate_task` fails, record the error in the handoff and run the phase in home.

**The wave handoff**, `/home/grawar/handoffs/<project>-<ticket>-bee.md`, follows the handoffs protocol
(`/home/grawar/handoffs/README.md`) and adds:

- **Wave**: tickets, worktree path, branch, base commit, start time (UTC, for `wave-profile --since`), home session id
  (for `--include-session`), plan path.
- **Phases**: one line per phase child: link, taskId, account, start and end. Take times from the thread's own
  timestamps (`t3_thread_list`, `task_status`), never from memory.
- **Slices**: slice, model, account, taskId, status, commits, brief path, report path, fallback used.
- **Findings ledger**: id, source (orchestrator, Codex pass 1 or 2, Visual QA, Juan R1…Rn), severity, file:line,
  decision, fix commit.
- **Decisions**: D1…Dn taken during the wave and why, so the reasons survive the phase change.
- **Packets**: the next free Notion packet number, so every phase and every review round numbers from one counter.
- **Wave report**: written last by home (step 11).

Phase work files live in the worktree under `.bee/` (briefs, reports, logs, Notion packets, evidence). Add `.bee/` to
the repository's `.git/info/exclude` in P1 so nothing there is ever committed.

## Tickets and documents: the clerk executes, the orchestrator decides

Ticket and document management follows the **`jv-notion`** skill (a Linear project uses `jv-linear` the same way):
hub bootstrap, ticket identity, Product and Epic, lifecycle comments, status changes, properties and living
documents. Its rules still apply, but the **clerk** loads it and executes; the orchestrator never calls Notion itself.

- **The orchestrator decides and writes.** For each batch of hub work it writes a packet,
  `.bee/notion/<NN>-<slug>.md`, with `NN` from the handoff's packet counter:
  - the ticket ids;
  - an ordered list of actions: status change, properties (Preview, PR, commit), comments (each one as a separate
    file, posted verbatim with its tag: [PLAN], [DECISION], [RESULT], [NOTE], [QUESTION], [LEARNING]), evidence images
    with captions, Related links, new backlog tickets (title, Product, Epic, Related);
  - what to read and digest, if anything (feedback, the Settings page);
  - **for any approval or Done, Juan's words quoted verbatim** with where and when he said them.
- **Juan asking for the merge is his approval.** When Juan asks to merge, the packet quotes him and sets the ticket to
  Done, and a [NOTE] says so. A merge Juan did not ask for is still not approval. *(learned, wave 2)* Without the quote
  the clerk read the repository's «Fusionar no significa aprobación» as overriding Juan and refused Done twice.
- **The clerk executes** with the `bee-clerk` agent (`run_in_background: false`). Its prompt is the packet path and
  nothing else. It verifies native ids after every create, as jv-notion requires. It answers in at most 10 lines
  (URLs, ids, failures). Anything it reads (feedback, Settings) comes back as a digest of at most 30 lines, with the
  full text saved to `.bee/notion/in-<date>.md` for the orchestrator to open selectively.
- **The clerk never decides:** it doesn't author comments, approve, mark anything done on its own or edit living
  documents beyond what the packet says. Workers never touch the hub.

## When to use it, and when not

Use it for work that has at least two independent parts (data and API, web UI, docs) and enough volume that delegating
saves your context and time. Do **not** use it for a handful of tool calls, a one-file fix or a pure investigation; do
those yourself or with one scout.

## Rules for every context

- **Batch independent reads in one turn** (parallel tool calls). Chain dependent shell steps in one command with
  quiet reporters and `| tail -n 40`.
- **Read code by symbol with Serena; use `rg` only for text.** Open code with `find_symbol` (with the body),
  `get_symbols_overview` and `find_referencing_symbols`; read a whole file only when it is under ~150 lines or the
  change spans most of it. Use `rg -n` for strings, docs and config, and `sed -n 'a,bp'` only for non-code ranges. Never
  re-read what is already in context. *(learned, wave 2)* With briefs that said "`rg` first, then `sed`", workers made
  zero Serena calls although it was indexed in the worktree, and the repo's grep hook denied 91 calls.
- **Serena works in any worktree that has `.serena/project.yml`** (Serena starts with `--project-from-cwd`); copy the
  file from the main checkout if the branch lacks it. Home checks it once in the wave worktree (activate the project,
  run one `find_symbol`) and writes the result into `.bee/briefs/_common.md`. If it doesn't work there, the brief says
  so and why, and the grep hook's nag is expected.
- **Re-check environment claims in each phase.** A claim in the handoff about tools or paths ("Serena only works in the
  main checkout", "the preview needs X") is verified by the phase that relies on it. *(learned, wave 2)* A wrong
  landmine written in P1 steered every later phase away from Serena.
- **Children end short.** A child's final message is at most 20 lines: status, commits (sha and subject), commands
  with counts, deviations, risks fixed (with their test), contract problems, and the path of its full report. The
  orchestrator reads the `task_status` summary first, opens a report only at the section it needs, and reads other
  threads with `t3_thread_read` using `limit` ≤ 5 and `maxCharsPerItem` ≤ 1500.
- **No images outside Visual QA.** See "Screens and screenshots".

## The loop

### P1 Plan (home)

#### 1. Read before designing

Read the repo's `AGENTS.md`, the ticket and its feedback (a clerk digest), the glossary and PRD sections involved, and
the code paths you will touch: data access, the authorization pattern, tests, UI neighbours. Check for open hand-offs.
You can only write a contract that workers can follow if you know the patterns they must copy. Ask the clerk for the
Settings fields that govern ticket work (`createPr`, `autoCommit`, `worktrees`) and record them in the wave handoff.

**Create the wave worktree only after every infrastructure PR the wave relies on has merged**, and branch it from the
fresh `origin/main`. *(learned, wave 2)* The Serena config PR merged after the worktree was cut, so the worktree lacked
it all wave.

#### 2. Write the plan as a committed document

Commit the plan in the repository (for example `docs/<product>/<feature>/implementation-plan.md`) before spawning
anyone. It is the single source of truth for every worker and for the reviewer. Include:

- **Outcome** in two paragraphs, and what is explicitly out of scope.
- **Provisional decisions** (D1…Dn) with their reason, for anything the client has not decided. Mark them as pending
  the client, and send the questions to the client (meeting agenda or ticket, through the clerk).
- **Data model**: tables, columns, checks, indexes, migration number, anything that must be written by hand.
- **Contract**: every route, body, response shape, error code, audit action, product event, live/push topic and
  performance budget. The web worker codes against this, not against code that does not exist yet.
- **Side-channel checklist** *(learned)*. For each permission-scoped field, say where it may and may not appear:
  list and detail responses, and aggregated **counts in shared lists**; the dashboard; **audit-log payloads**; **live
  notifications** (topic names can leak which record changed); exports and search. Missing this cost a full review
  round.
- **Contract checklist** *(learned, CA-107)*. State explicitly, for every operation and every external API:
  - **Concurrency**: can two callers hit it at once? Then say what must be atomic, and test it with simultaneous calls.
  - **Ranges**: every bounded value (months 01–12, amounts ≥ 0, real calendar dates, string lengths), in the schema
    *and* in the database CHECK.
  - **Source per rule**: name the document and section each rule comes from (requirement id, ADR, API blueprint
    line), so the critic and the worker can check it instead of trusting your summary.
  - **What must never leak**: credentials, tokens and personal data, including when an upstream service echoes them
    back in an error.
  - **One spelling per value**: the same enum values in the plan, the schema and the code; say where external casing is
    normalized.
- **Derived state rules**: if something is derived instead of stored, write the exact predicate and the edge cases.
  *(learned)* Reactivated rows keep their old `created_at`, so "after X" predicates break on re-activation.
- **Fixtures and seed** the screens need, including empty, intermediate and closed states.
- **Tests**: list them by name, including "who must not see" cases and the one test that proves the core promise.
  **Every list or table a UI slice adds gets a test that renders it with rows from the fixtures**, not only its empty
  state. *(learned, wave 2)* A DeepSeek UI slice shipped a blocker where every populated list rendered empty; all its
  own tests passed because none rendered data.
- **Slices**: the file ownership table (which slice owns which paths; docs belong to the orchestrator), and for each
  slice its **risk class** (bounded or risky, see Roles) and its **sub-slices**: test groups small enough to finish,
  commit and log between compactions. Size a risky slice's sub-slices so each one fits an Opus context of ~200k.
- **Acceptance checklist**.

Commit any **shared contract code** that both workers import (enum additions, shared types) yourself, before spawning,
so neither worker edits the other's package.

#### 3. Contract critic: review the plan before anyone implements (read-only)

Most defects are cheaper to fix in a 600-line plan than in a 13 000-line diff. Once the plan and the shared contract
code are committed, and before spawning any worker, run Codex read-only on them:

```bash
codex exec -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -c 'mcp_servers.serena.enabled=false' \
  -s read-only "<brief>" < /dev/null > /tmp/<feature>-plan-codex.log 2>&1
```

Serena stays off for Codex: its tools are auto-approved and its REPL runs Python outside the read-only sandbox. Run it
from the wave worktree, so `wave-profile` finds the rollout.

The brief names:

- the plan path and the contract files (`git show --stat HEAD`, the shared types, the migration if already written);
- the sources the plan must match: the requirement ids in the PRD, the ADRs, the glossary, the ticket and its agreed
  decisions, and any external API documentation (with its local path);
- what to look for: requirements or decisions the plan drops or contradicts; rules stated without a source; missing
  concurrency, range, leak or casing statements (the contract checklist); contradictions between sections; tests that
  would not prove the core promise; file ownership that makes two workers edit the same file;
- the output format: numbered gaps with the plan line, the source line, severity and the proposed plan change, ending
  with `NO MORE FINDINGS`.

Treat each gap on its merits, fix the plan and the contract code, commit, and only then write the briefs. Record in
the [PLAN] packet how many gaps the critic raised and which you rejected and why. Skip the critic only for a plan small
enough to review in a minute.

#### 4. Write one brief per slice, on disk

Write `.bee/briefs/_common.md` (rules every worker shares, including the Serena result from "Rules for every
context") and `.bee/briefs/<slice>.md` for each slice, so Build dispatches by path and a fallback reuses it unchanged.
A brief is pointers, not pasted text: the plan section, the files and **symbols** to copy, the docs sections. It
contains:

- where to work: the absolute worktree path and branch; the plan path and the slice's section;
- **owned paths** and an explicit "touch nothing else";
- the patterns to copy, as paths and symbol names;
- the rules that get the work rejected;
- the sub-slices, in order, and exact verification commands per sub-slice: narrow tests, typecheck, check, dead-code
  audit;
- **how to read**: code by symbol with Serena, `rg` for text; for a capped Haiku, at most ~8k tokens per read (about
  150 lines of prose or 250 of code);
- **disk-first progress**: after each sub-slice, commit, then append three lines to `.bee/log/<slice>.md` (done, next,
  open problems). After a compaction, re-read that log before anything else. At the third compaction (Haiku) or past
  ~200k of context (Opus), commit, write the report and stop: Build continues with a fresh worker from the log;
- commit rules: stage **explicit paths only**, never `git add -A` (other workers commit in the same worktree); retry
  on `index.lock`; the commit message format and co-author line; no push, no remote writes;
- **fix, then report** *(learned, CA-107)*: a defect or risk found inside its own paths (a race, a leak, a rule the
  source documents but the brief missed) is fixed there, with a test that fails without the fix, and listed in the
  report. Only what would change the contract or another slice's paths is reported without fixing;
- screens: text checks only (see "Screens and screenshots"); a UI slice also renders every new list with fixture rows;
- the ending: full report to `.bee/reports/<slice>-r<round>.md` (commits, deviations and why, risks fixed with their
  tests, contract problems, command results with counts, demo facts, gaps), then a final message of at most 20 lines.

Then write the wave handoff, post the [PLAN] through a clerk packet (tickets to In progress), tell Juan in a few lines,
and start the Build child.

### Build (child of home)

#### 5. Dispatch workers in parallel

For each slice, `delegate_task` with `mode: "async"`, `role: "implementation"`, the target from the Roles table and a
task of three lines: "Load nothing else first. Read `<absolute brief path>` and do exactly what it says. Work only in
`<absolute worktree>`." The child does not inherit your working directory. Record each taskId in the handoff.
Completion wakes this thread; do not poll. Keep at most three workers running at once.

- **Bounded slice → DeepSeek.** **Risky slice → fresh Opus child** at `high`, on the account with usage left, with the
  same kind of brief plus the contract checklist.
- **Fallback to Haiku**, same brief, plus "continue from `.bee/log/<slice>.md`" when anything was committed, if:
  - `delegate_task` returns an error;
  - the child ends with a provider error (region, funds, 429 or rate limit, model unavailable);
  - the child ends twice with failing checks for the same slice.

  If the Haiku fallback also fails, or Claude Code stops it for autocompact thrashing, give the slice to a fresh
  Opus child at `high` with the same brief and the log. An Opus child that stops on a usage limit is relaunched on the
  other account. Record every fallback and its reason in the handoff's slice table.
- *(learned)* UI workers run their **own dev server on their own port and their own browser tab**, and check their
  screens as text. Check first that the port matches the app's auth or CORS origin; in Cantoalegre, Better Auth only
  trusted `BETTER_AUTH_URL`, so another port answered 403 on sign-in.

While workers run, do your own non-overlapping work: the glossary, the PRD, the README walkthrough and the wave
handoff. When a slice completes, read its summary, run its narrow tests yourself, and note it in the handoff. When all
slices are in, run the repository's full check, every affected test project and the dead-code audit, update the
handoff, and end with your 20-line summary. Home starts Review + Ship.

### Review + Ship (child of home)

#### 6. Review like a reviewer

- Read `git diff --stat` against the base, then the diff hunk by hunk per package. Run the full check and every
  affected test project yourself; do not accept a worker's counts on trust.
- Look for contract drift, names matched by label instead of id, time zones (UTC dates where local dates are meant),
  missing invalidation or refresh keys, and permissions enforced in the UI but not in the API. With Serena, check the
  callers of every changed exported symbol.
- **Browser, as text, through Visual QA** (`bee-visual-qa`, `run_in_background: false`). Give it a checklist: screen ×
  role (main and one that must not see) × viewport (1440 and 360 px), the URL of a running dev server, the sign-in
  method, the expected states, the core flow end to end, the "someone else changed it" path, and **every list with
  data**. It returns a table: check, screen, role, viewport, PASS or FAIL, what it observed in at most two lines,
  console errors. No images in this step.
- When you fix something, prove the regression test **fails without the fix**: revert the fix temporarily, run the
  test, then restore it. Small fixes you make yourself; larger ones go to fresh workers (step 8).

#### 7. Cross-vendor review of the diff (read-only)

Run it on the committed branch, from the wave worktree:

```bash
codex exec -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -c 'mcp_servers.serena.enabled=false' \
  -s read-only "<brief>" < /dev/null > /tmp/<feature>-codex.log 2>&1
```

The brief names:

- the branch range: "run `git diff origin/main...HEAD`";
- the plan and the repo rules to judge against;
- the focus areas: authorization and side channels, races in writes, derived states, performance budget, migration,
  seed, UI bugs;
- the output format: numbered findings with file:line, severity, what breaks and a fix, ending with `NO MORE FINDINGS`.

*(learned)* Do not use `codex exec review --base <branch> "<prompt>"`: the CLI refuses `--base` together with a
custom prompt. The read-only sandbox cannot write a temporary directory for some test runners, so the reviewer may
skip tests; you run them.

*(learned, CA-40/CA-41)* Close stdin (`< /dev/null`) when `codex exec` runs in the background: otherwise it prints
«Reading additional input from stdin...» and waits for ever. A minute after starting, check that the log has grown
past the brief.

Treat each finding on its merits and record it in the findings ledger: accept, fix and test it, or reject it with a
reason. Never accept a finding blindly.

#### 8. Fix round with fresh workers

Send fixes to **new** workers, never back to the old ones *(learned, wave 1)*: a resumed worker drags its whole old
context, and its prompt cache has expired after a ten-minute review, so every call re-pays it. Each fix batch is a new
`delegate_task`, same model rules as step 5, with a fix brief in `.bee/briefs/fix-<n>.md`:

- the finding ids with file:line **and the symbol**, and the expected fix;
- the files it may touch;
- the slice report path, for background only;
- the tests to run, including the new regression test that must fail without the fix.

Then run a **second Codex pass** that only verifies the fixes and looks for regressions (a new run, same command).
Remaining edge cases you decide not to fix become a documented limit **and** a backlog ticket (through a clerk packet,
so it has a verified id, Product, Epic and Related link).

#### 9. Ship

- Push and open the PR when policy (`createPr`) or the user authorizes it. Link it wherever the harness tracks PRs.
- Wait for CI and the preview. Confirm the preview serves the head commit, and say what you could not verify.
- **Screenshots from the PR preview, posted to the ticket.** Once the preview serves the head commit, start Visual QA
  with the preview URLs and a capture list: each changed screen as the main role, the denied role's view, a 360 px
  phone, and any confirmation or error state the feature adds. It saves every capture as a PNG
  (`preview_snapshot` with `save: true`) under `.bee/evidence/`, named after what it proves, and returns a table of
  path, caption (role, URL, commit, what it shows) and PASS or FAIL. Then a clerk packet uploads them to the ticket: a
  dated «Evidencia · ciclo N» section with one caption per image, plus a short [NOTE] that points to it. Never save
  data in the preview just to get a shot; cancel the dialog instead.
  - Use the browser profile that keeps cookies (in T3 Code, `profileId: "default"`); an incognito tab loses the
    sign-in when it closes.
  - **Blocked** (an email-gated sign-in such as Cloudflare Access, a missing account): say so in your summary; home
    asks Juan to sign in once. Do not guess around it.
  - **If the user says they cannot check or sign in**, run the branch locally (the repo's «run locally» steps, a fresh
    seed, its own port), take the same captures there, and label every caption «local, commit <sha>» instead of the
    preview URL.
- Through a clerk packet: preview, PR, commit, a [RESULT] with evidence (preview or local) and limits, and In Review.
  Never mark the ticket done without the client's approval.
- Update the living docs, following jv-notion's living-document rules: the glossary, PRD status, the walkthrough, the
  role and permission pages when a permission changed, and the repo's `AGENTS.md` when a durable rule appeared.
- Update the handoff (findings ledger, packets, what Juan should test) and end with your 20-line summary, including
  the PR, the preview URL and a short manual test walkthrough in plain language. The [LEARNING] and the cost chart
  wait for step 11.

### Review with Juan (home)

#### 10. Review rounds

Home tells Juan the PR, the preview and the walkthrough from the Review + Ship summary. Juan reviews in the preview and
answers in home. For each round:

- Record it as R1…Rn in the findings ledger and in the plan's decisions section, with Juan's words where they decide
  something.
- Small fixes home makes itself; larger ones go to a fresh fix worker (`.bee/briefs/fix-r<n>.md`, same model rules),
  never to an old one. Run the narrow tests and the full check, push, and when screens changed, run Visual QA on the
  preview again (text, plus captures of what changed).
- Post each round through a clerk packet numbered from the handoff's counter: a [DECISION] for what Juan decided and a
  [NOTE] for what changed, with commits.
- When Juan asks to merge, merge if he asked you to, then post a packet that quotes him, sets Done and notes the merge
  commit (see "Tickets and documents").

#### 11. Close the wave: one report, written last

When the review rounds are over (merged, or Juan stops the wave), home measures and reports once:

```bash
cd /home/grawar/development/ai/jv-ai && bun run wave-profile \
  --project <worktree folder name> --since <wave start> --until <now> --min-calls 3 \
  --include-session <home session id> --html /tmp/<ticket>-cost.html --history <ticket>
```

- `--project` counts every session whose working directory is the wave worktree (phase children, workers, subagents,
  OpenCode children) and the Codex rollouts run from it. `--include-session` adds home's own transcript, counted only
  inside `--since`/`--until` (home lives in the main checkout and outlives the wave). Home's session id is the
  newest transcript in `~/.claude/projects/<main checkout folder>/` whose first prompt names the wave; record it in
  the handoff in P1.
- Show `/tmp/<ticket>-cost.html` with `html_preview` and then `html_render`, and commit `waves/waves.json` in jv-ai.
  Claude costs are API-equivalent estimates; OpenCode and Codex run on subscriptions and are reported as tokens.
- Write the **wave report** into the handoff:
  - timing per phase;
  - cost by role;
  - what each role caught or missed: critic gaps, Codex findings per pass, Visual QA, Juan's rounds;
  - fallbacks fired;
  - Serena use per worker, or the reason it wasn't used;
  - whole-file read share;
  - Haiku calls above 100k;
  - what to change next time.
- Post the [LEARNING] through a clerk packet as a short summary of that report.
- Close the wave handoff (`status: done`, or what remains), and give Juan the summary in home.

## Screens and screenshots

- **Workers (any model):** no image screenshots. Only once the slice's tests pass, at most six checks:
  `preview_snapshot` without `includeImage` (the accessibility tree as text), or `preview_evaluate` probes that return
  JSON (overflowing elements, clipped text, console errors).
- **Visual QA in Review:** text only, as in step 6.
- **Visual QA in Ship and in Juan's rounds:** captures from the **PR preview**, saved with `save: true`. It loads an
  image (`includeImage: true`) only to judge appearance, at most eight per agent; more screens means another agent.
- **The orchestrator never loads an image**, except to settle a disputed FAIL.

## Budget and honesty

- The `wave-profile` chart replaces asking agents for their token counts; its numbers go in the wave report and the
  [LEARNING]. Acceptance for v3:
  - under 5% of Haiku calls above 100k;
  - every Opus worker uses Serena, or the report says why not;
  - whole-file and shell reads under 50% of tool-result bytes;
  - no grep-hook denials caused by the briefs;
  - wave cost below wave 2's ($96 API-equivalent, home and review rounds included) for a comparable scope.
- Never present a worker's or reviewer's result as verified until you have checked its evidence.
- When the user asks how the setup performed, give an honest read with evidence: what each role caught, what it
  missed, what the plan got wrong, and which fallbacks fired.

## Checklist

- [ ] Home: infrastructure PRs merged before cutting the worktree; wave handoff (with home session id) written;
      `.bee/` excluded; Settings fields recorded (clerk digest); Serena checked in the worktree, result in `_common.md`
- [ ] Plan committed, with contract, side-channel checklist, slices with risk class and sub-slices, ownership, tests
      (every new list rendered with rows)
- [ ] Contract checklist covered: concurrency, ranges, source per rule, what must never leak, one spelling per value
- [ ] Shared contract code committed; contract critic run (Serena off); gaps fixed or rejected, committed
- [ ] One brief per slice in `.bee/briefs/`, with Serena-first reading, disk-first progress, fix-then-report and the
      20-line ending
- [ ] Build child: DeepSeek for bounded slices, fresh Opus for risky ones on the account with usage left, Haiku
      fallbacks recorded; at most three at once; full check, affected tests and dead-code audit
- [ ] Review + Ship child: diff reviewed; Visual QA (text) for main and denied roles, desktop and phone, core flow,
      lists with data, console; Codex review, fresh fix workers, second pass; findings ledger complete; limits ticketed
- [ ] PR (if authorized), CI, preview on the head commit; Visual QA screenshots posted by the clerk with captions;
      [RESULT] and In Review
- [ ] Home: Juan's rounds recorded R1…Rn with packets from one counter; merge only when Juan asks, then Done with his
      words quoted
- [ ] Home, last: `wave-profile` with `--include-session`, chart shown, `waves.json` committed, wave report in the
      handoff, [LEARNING] posted, handoff closed
