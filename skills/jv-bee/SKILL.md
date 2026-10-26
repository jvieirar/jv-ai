---
name: jv-bee
description: Use when a feature or ticket is big enough to split across agents. The orchestrator designs and writes a contract-first plan, cheaper models implement in parallel with strict file ownership, the orchestrator reviews and verifies in a browser, a different-vendor model reviews read-only, and fixes go back to the same implementers before the PR. Triggers on "orchestrate this", "you design, Haiku implements", "use the bee workflow", or any multi-package feature where Juan asks for subagents plus a Codex review.
---

# jv-bee: orchestrated work with worker agents

A workflow skill. You are the **orchestrator and designer**: you own the plan, the contract between the workers, the
review, the verification and the hand-off. **Workers** write most of the code. A **reviewer from another vendor** reads
the result without anchoring on your reasoning. Juan stays the only approver.

This draft distils a real run, Cantoalegre CA-32/CA-34 (PR #82, 26/10/2026). The lessons from that run are marked
*(learned)*; keep them unless a later run disproves them.

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
| Orchestrator | the strongest available (you) | session default | design, plan, contract, review, browser verification, docs, PR, ticket updates |
| Implementer | Haiku 5.5 | high | builds one slice against the contract, writes its tests, commits its own paths |
| Scout | Haiku 5.5 | default | read-only fan-out: inventories, audits, "how is X used", seed and data analysis |
| Cross-vendor reviewer | Codex `gpt-6.1-sol` | high | read-only review of the diff, then a second pass that verifies the fixes |
| Security-critical slice (optional) | Opus | default | permissions, migrations, money: when a slice is small but a mistake is expensive |

*(learned)* Haiku at **high** handled race-safe SQL, audit batches and good tests against a precise contract. Do not
drop implementers to medium; use the default effort only for scouts. Most defects the review found came from gaps in
the **orchestrator's plan**, not from the implementer's tier, so improve the plan before upgrading the model.

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
- **Derived state rules**: if something is derived instead of stored, write the exact predicate and the edge cases.
  *(learned)* Reactivated rows keep their old `created_at`, so "after X" predicates break on re-activation.
- **Fixtures and seed** the screens need, including empty, intermediate and closed states.
- **Tests**: list them by name, including "who must not see" cases and the one test that proves the core promise.
- **File ownership table**: which worker owns which paths. Docs belong to the orchestrator.
- **Acceptance checklist**.

Commit any **shared contract code** that both workers import (enum additions, shared types) yourself, before spawning,
so neither worker edits the other's package.

### 3. Spawn workers in parallel

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
- the report format: commits, deviations from the plan and why, command results with counts, demo facts, gaps.

*(learned)* Let UI workers run their **own dev server on their own port and their own browser tab**. A UI worker that
cannot see its screens ships overflowing tables and crowded headers. Check first that the port matches the app's
auth or CORS origin; in Cantoalegre, Better Auth only trusted `BETTER_AUTH_URL`, so another port answered 403 on
sign-in.

While workers run, do your own non-overlapping work: the glossary, the PRD, the README walkthrough, and the hand-off
file. Through **jv-notion**, set the tickets to working and post their [PLAN].

### 4. Review like a reviewer, then verify for real

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

### 5. Cross-vendor review (read-only)

Run it on the committed branch:

```bash
codex exec -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -s read-only "<brief>" > /tmp/<feature>-codex.log 2>&1
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

Treat each finding on its merits. Accept, fix and test it, or reject it with a reason. Never accept a finding blindly.

### 6. Fix round with the same workers

Send one consolidated list (your findings plus the reviewer's) to the **same** worker agents. That way they keep their
context, which is cheaper and more accurate than new agents. Keep the same ownership rules. Then run a **second
reviewer pass** that only verifies the fixes and looks for regressions. Remaining edge cases you decide not to fix
become a documented limit **and** a backlog ticket, created through jv-notion so it has a verified id, Product, Epic
and Related link, so they are not forgotten.

### 7. Hand-off

- Push and open the PR only when the user or policy authorizes it. Link it wherever the harness tracks PRs.
- Wait for CI and the preview. Confirm the preview serves the head commit, and say what you could not verify (for
  example, an email-gated sign-in).
- Update the ticket **through jv-notion**: preview, PR, commit, a [RESULT] with evidence and limits, a draft [LEARNING],
  and In Review. Never
  mark the ticket done without the client's approval.
- Update the living docs, following jv-notion's living-document rules: the glossary, PRD status, the walkthrough, the
  role and permission pages when a permission changed, and
  the repo's `AGENTS.md` when a durable rule appeared.
- Give the user a short manual test walkthrough. Explain domain words in plain language.

## Budget and honesty

- Report token-heavy steps and where time went. In the reference run, two implementers used about 1.8M tokens over two
  rounds, each reviewer pass about 130k, and a scout about 140k.
- Never present a worker's or reviewer's result as verified until you have checked its evidence.
- When the user asks how the setup performed, give an honest read with evidence: what each role caught, what it
  missed, and what the plan got wrong.

## Checklist

- [ ] Plan committed, with contract, side-channel checklist, ownership and tests
- [ ] Shared contract code committed before spawning
- [ ] Workers briefed with explicit paths, commands and commit rules; UI workers have their own port and tab
- [ ] jv-notion loaded; tickets set to working with [PLAN]; orchestrator docs done while the workers run
- [ ] Full diff reviewed; full check and tests run by the orchestrator
- [ ] Browser: main role and denied role, desktop and phone, core flow, console
- [ ] Cross-vendor review, fixes, second pass
- [ ] Limits documented and ticketed
- [ ] PR (if authorized), CI, preview commit, ticket evidence (jv-notion), living docs and role pages, walkthrough for
      the user
