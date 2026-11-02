---
name: jv-bee
description: Use when a feature or ticket is big enough to split across agents. The orchestrator designs and writes a contract-first plan, a different-vendor model critiques the plan against the requirements before anyone builds, cheaper models implement in parallel with strict file ownership (Haiku for bounded slices, Sonnet for risky ones), the orchestrator reviews and verifies in a browser, a different-vendor model reviews read-only, and fixes go back to the same implementers before the PR. Triggers on "orchestrate this", "you design, Haiku implements", "use the bee workflow", or any multi-package feature where Juan asks for subagents plus a Codex review.
---

# jv-bee: orchestrated work with worker agents

A workflow skill. You are the **orchestrator and designer**: you own the plan, the contract between the workers, the
review, the verification and the hand-off. **Workers** write most of the code. A **reviewer from another vendor** reads
the result without anchoring on your reasoning, twice: once on the plan, once on the diff. Juan stays the only
approver.

This draft distils real runs: Cantoalegre CA-32/CA-34 (PR #82, 26/10/2026) and CA-107 (PR #124, 02/11/2026). Their
lessons are marked *(learned)*; keep them unless a later run disproves them.

Repository instructions (`AGENTS.md`), ticket workflows (`jv-notion`, `jv-linear`) and policy (whether to create PRs,
worktrees) always win over this skill. This skill decides **who does what and in what order**, not project rules.

## Tickets and documents: always through jv-notion

Ticket and document management goes through the **`jv-notion`** skill. Load it before the first ticket or document
action, and follow its rules; this skill does not repeat them. That covers:

- **Hub bootstrap**: `.agents/task-tracking.json` and the Settings page.
- **Ticket identity**: native ids, verified after every create.
- **Product and Epic**, and the reciprocal Related links.
- **Lifecycle comments**: [PLAN], [DECISION], [RESULT], [NOTE], [QUESTION], [LEARNING].
- **Status changes**, and never self-approving.
- **Preview, PR and commit properties.**
- **Living-document upkeep**: requirements, glossary, journeys, the role and permission map.

The orchestrator owns every jv-notion action. Workers never touch the ticket hub. A project on Linear uses `jv-linear`
the same way.

## When to use it, and when not

Use it for work that has at least two independent parts (data and API, web UI, docs) and enough volume that delegating
saves your context and time. Do **not** use it for a handful of tool calls, a one-file fix or a pure investigation; do
those yourself or with one scout.

## Roles and model tiers

| Role | Default model | Effort | Does |
| --- | --- | --- | --- |
| Orchestrator | the strongest available (you) | session default; `xhigh` is worth it only while writing the contract | design, plan, contract, review, browser verification, docs, PR, ticket updates |
| Contract critic | Codex `gpt-6.1-sol` | high | read-only review of the committed plan and contract against the requirements, before any worker starts |
| Implementer, bounded slice | Haiku 5.5 | high | builds one slice against the contract, writes its tests, commits its own paths |
| Implementer, risky slice | Sonnet 5.5 | high | the same, for slices where concurrency, idempotency, retries, money or migrations meet |
| Scout | Haiku 5.5 | default | read-only fan-out: inventories, audits, "how is X used", seed and data analysis |
| Cross-vendor reviewer | Codex `gpt-6.1-sol` | high | read-only review of the diff, then a second pass that verifies the fixes |

Choosing the implementer tier:

- **Haiku 5.5 high** for slices a precise contract fully describes: UI screens, a library against a documented API,
  forms, seed data, a mock service. It reads long specifications well and reports gaps honestly.
- **Sonnet 5.5 high** for slices where following the brief literally is the risk: concurrent writers, idempotency keys,
  queues and retries, balances and money, sync jobs, security boundaries. Trial since CA-107 (02/11/2026): keep it
  only if its slices come back with fewer review findings than Haiku's at an acceptable cost, and record both.
- Opus at low effort is not an implementer tier: low effort removes the deliberation Opus is paid for.

*(learned)* Haiku at **high** handled race-safe SQL, audit batches and good tests against a precise contract. Do not
drop implementers to medium; use the default effort only for scouts. Most defects the review found came from gaps in
the **orchestrator's plan**, not from the implementer's tier, so improve the plan before upgrading the model.

*(learned, CA-107)* Of 13 cross-vendor findings, 8 traced to the orchestrator's plan, contract or own code (an
unstated concurrency assumption behind four of them, a wrong balance rule written into the brief, an unchecked month
range, inconsistent enum casing, a fix that introduced a regression), 3 to the implementer (an upstream error echoing a
credential, two payment rules deep in a 5 000-line API blueprint), and the implementer caught 2 contract errors of the
orchestrator's by reading that blueprint. It also *reported* the race but did not fix it, because the brief did not
allow it. Hence the contract critic, the contract checklist and the fix-and-report rule below.

## The loop

### 1. Read before designing

Read the repo's `AGENTS.md`, the ticket and its feedback, the glossary and PRD sections involved, and the code paths
you will touch: data access, the authorization pattern, tests, UI neighbours. Check for open hand-offs. You can only
write a contract that workers can follow if you know the patterns they must copy.

### 2. Write the plan as a committed document

Commit the plan in the repository (for example `docs/<product>/<feature>/implementation-plan.md`) before spawning
anyone. It is the single source of truth for every worker and for the reviewer. Include:

- **Outcome** in two paragraphs, and what is explicitly out of scope.
- **Provisional decisions** (D1…Dn) with their reason, for anything the client has not decided. Mark them as pending
  the client, and send the questions to the client (meeting agenda or ticket).
- **Data model**: tables, columns, checks, indexes, migration number, anything that must be written by hand.
- **Contract**: every route, body, response shape, error code, audit action, product event, live/push topic and
  performance budget. The web worker codes against this, not against code that does not exist yet.
- **Side-channel checklist** *(learned)*. For each permission-scoped field, say where it may and may not appear:
  - list and detail responses, and aggregated **counts in shared lists**;
  - the dashboard;
  - **audit-log payloads**;
  - **live notifications**: topic names can leak which record changed;
  - exports and search.

  Missing this cost a full review round.
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
- **File ownership table**: which worker owns which paths. Docs belong to the orchestrator.
- **Acceptance checklist**.

Commit any **shared contract code** that both workers import (enum additions, shared types) yourself, before spawning,
so neither worker edits the other's package.

### 3. Contract critic: review the plan before anyone implements (read-only)

Most defects are cheaper to fix in a 600-line plan than in a 13 000-line diff. Once the plan and the shared contract
code are committed, and before spawning any worker, run Codex read-only on them:

```bash
codex exec -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -s read-only "<brief>" < /dev/null > /tmp/<feature>-plan-codex.log 2>&1
```

The brief names:

- the plan path and the contract files (`git show --stat HEAD`, the shared types, the migration if already written);
- the sources the plan must match: the requirement ids in the PRD, the ADRs, the glossary, the ticket and its agreed
  decisions, and any external API documentation (with its local path);
- what to look for: requirements or decisions the plan drops or contradicts; rules stated without a source; missing
  concurrency, range, leak or casing statements (the contract checklist); contradictions between sections; tests that
  would not prove the core promise; file ownership that makes two workers edit the same file;
- the output format: numbered gaps with the plan line, the source line, severity and the proposed plan change, ending
  with `NO MORE FINDINGS`.

Treat each gap on its merits, fix the plan and the contract code, commit, and only then spawn. Record in the ticket's
[PLAN] how many gaps the critic raised and which you rejected and why. Skip the critic only for a plan small enough to
review in a minute.

### 4. Spawn workers in parallel

Give each worker a self-contained brief. A good brief has:

- where to work (absolute worktree path and branch), and the plan path to read in full first;
- the repo docs to read (sections, not whole folders);
- **owned paths** and an explicit "touch nothing else";
- the patterns to copy, with file paths;
- the rules that get the work rejected;
- exact verification commands: narrow tests, typecheck, check, dead-code audit;
- commit rules:
  - stage **explicit paths only**, never `git add -A`, because another worker commits in the same worktree;
  - retry on `index.lock`;
  - the commit message format and co-author line;
  - no push, no remote writes;
- **fix, then report** *(learned, CA-107)*: a defect or risk the worker finds inside its own paths (a race, a leak, a
  rule the source documents but the brief missed) is fixed there, with a test that fails without the fix, and listed in
  the report. Only what would change the contract or another worker's paths is reported without fixing;
- the report format: commits, deviations from the plan and why, risks found and fixed (with their tests), contract
  problems left for the orchestrator, command results with counts, demo facts, gaps, and **the tokens it used**.

*(learned)* Let UI workers run their **own dev server on their own port and their own browser tab**. A UI worker that
cannot see its screens ships overflowing tables and crowded headers. Check first that the port matches the app's
auth or CORS origin; in Cantoalegre, Better Auth only trusted `BETTER_AUTH_URL`, so another port answered 403 on
sign-in.

*(learned, CA-107)* In T3 Code, start background workers with `delegate_task` (`mode: "async"`, the model and its
effort in `target`) and give the absolute worktree path in the task: the child does not inherit your working
directory. Completion wakes the orchestrator; do not poll.

While workers run, do your own non-overlapping work: the glossary, the PRD, the README walkthrough, and the hand-off
file. Through **jv-notion**, set the tickets to working and post their [PLAN].

### 5. Review like a reviewer, then verify for real

- Read the full diff against the base. Run the repository's whole check and every affected test project yourself; do
  not accept a worker's counts on trust.
- Look for contract drift, names matched by label instead of id, time zones (UTC dates where local dates are meant),
  missing invalidation or refresh keys, and permissions enforced in the UI but not in the API.
- **Browser**, as the main role and as a role that must not see the feature:
  - desktop and a 360 px phone;
  - the core flow end to end, for example: free a seat, then see the alert appear;
  - the concurrency or "someone else changed it" path;
  - a clean console.
- When you fix something, prove the regression test **fails without the fix**: revert the fix temporarily, run the test,
  then restore it.
- Small fixes you may make yourself. Send larger ones back.

### 6. Cross-vendor review of the diff (read-only)

Run it on the committed branch:

```bash
codex exec -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -s read-only "<brief>" < /dev/null > /tmp/<feature>-codex.log 2>&1
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
«Reading additional input from stdin...» and waits for ever, and the run looks busy while doing nothing. A minute after
starting, check that the log has grown past the brief (hooks and tool calls appear).

Treat each finding on its merits. Accept, fix and test it, or reject it with a reason. Never accept a finding blindly.

### 7. Fix round with the same workers

Send one consolidated list (your findings plus the reviewer's) to the **same** worker agents. That way they keep their
context, which is cheaper and more accurate than new agents. Keep the same ownership rules. Then run a **second
reviewer pass** that only verifies the fixes and looks for regressions. Remaining edge cases you decide not to fix
become a documented limit **and** a backlog ticket, created through jv-notion so it has a verified id, Product, Epic
and Related link, so they are not forgotten.

### 8. Hand-off

- Push and open the PR only when the user or policy authorizes it. Link it wherever the harness tracks PRs.
- Wait for CI and the preview. Confirm the preview serves the head commit, and say what you could not verify (for
  example, an email-gated sign-in).
- **Screenshot evidence on the preview, posted to the ticket.** Once the preview serves the head commit, walk the core
  flow there and capture it: each changed screen as the main role, the denied role's view, a 360 px phone, and any
  confirmation or error state that the feature adds. Name each capture after what it proves, then upload them to the
  ticket **through jv-notion**: a dated «Evidencia · ciclo N» section on the page with one caption per image (role, URL,
  commit, what it shows), plus a short [NOTE] comment that points to it. Never save data in the preview just to get a
  shot; cancel the dialog instead.
  - Use the browser profile that keeps cookies (in T3 Code, `profileId: "default"`); an incognito tab loses the
    sign-in when it closes.
  - **Blocked** (an email-gated sign-in such as Cloudflare Access, a missing account, an unattached tab): ask the user
    to sign in once, then continue. Do not guess around it.
  - **If the user says they cannot check or sign in**, run the branch locally (the repo's «run locally» steps, a fresh
    seed, its own port), take the same captures there, and label every caption «local, commit <sha>» instead of the
    preview URL.
  - The [RESULT] states which kind of evidence was posted (preview or local) and anything left unverified.
- Update the ticket **through jv-notion**: preview, PR, commit, a [RESULT] with evidence and limits, a draft [LEARNING],
  and In Review. Never
  mark the ticket done without the client's approval.
- Update the living docs, following jv-notion's living-document rules: the glossary, PRD status, the walkthrough, the
  role and permission pages when a permission changed, and
  the repo's `AGENTS.md` when a durable rule appeared.
- Give the user a short manual test walkthrough. Explain domain words in plain language.

## Budget and honesty

- Ask every worker and reviewer for its token usage, and record per role in the ticket's [LEARNING]: the tier
  decisions (Haiku or Sonnet, `high` or `xhigh` for the orchestrator) are only as good as these numbers. In CA-107 the
  first Codex diff pass used about 175k tokens; the implementer did not report its usage.
- Report token-heavy steps and where time went. In the reference run, two implementers used about 1.8M tokens over two
  rounds, each reviewer pass about 130k, and a scout about 140k.
- Never present a worker's or reviewer's result as verified until you have checked its evidence.
- When the user asks how the setup performed, give an honest read with evidence: what each role caught, what it
  missed, and what the plan got wrong.

## Checklist

- [ ] Plan committed, with contract, side-channel checklist, ownership and tests
- [ ] Contract checklist covered: concurrency, ranges, source per rule, what must never leak, one spelling per value
- [ ] Shared contract code committed before spawning
- [ ] Contract critic run on the committed plan; gaps fixed or rejected with a reason, then committed
- [ ] Workers briefed with explicit paths, commands, commit rules and the fix-then-report rule; tier chosen per slice
      (Haiku bounded, Sonnet risky); UI workers have their own port and tab
- [ ] Token usage of every worker and reviewer recorded
- [ ] jv-notion loaded; tickets set to working with [PLAN]; orchestrator docs done while the workers run
- [ ] Full diff reviewed; full check and tests run by the orchestrator
- [ ] Browser: main role and denied role, desktop and phone, core flow, console
- [ ] Cross-vendor review, fixes, second pass
- [ ] Limits documented and ticketed
- [ ] PR (if authorized), CI, preview commit, ticket evidence (jv-notion), living docs and role pages, walkthrough for
      the user
- [ ] Screenshots of the preview (or local run, if the user can't sign in) posted to the ticket with captions
