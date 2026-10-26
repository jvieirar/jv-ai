---
name: jv-notion
description: Manage tasks, epics, review feedback, delivery evidence, and linked living documents in a configured Notion hub. Use for Notion ticket work, lifecycle updates, and keeping documentation aligned with implementation or accepted feedback; resolve the hub from repository configuration or explicit user selection.
---

# Notion task hub

This global skill contains workflow rules, never customer IDs or a default customer.
Repository configuration selects the hub; its Notion Settings define development
policy. Use the selected hub's actual schema and terminology.

## Bootstrap and hub selection

1. In a Git repository, locate the current worktree root with
   `git rev-parse --show-toplevel` and read its `.agents/task-tracking.json`.
2. Only when that file is absent, use `git worktree list --porcelain` to locate the
   primary worktree and read its `.agents/task-tracking.json`. Report that fallback
   source. Never choose an arbitrary sibling worktree. A malformed or conflicting
   current-worktree config is an error, not permission to select another customer.
3. Outside a repository, require an explicit hub URL/ID or user-selected configuration.
   If no repository configuration exists, ask for the hub/configuration. Never infer
   a hub from a ticket prefix, previous session, search ranking or this skill's path.
4. Resolve multiple customers/hubs/products from explicit user intent and repository
   mappings; ask when ambiguous. Explicit selection of a second customer starts a
   new context: reload its configuration, Settings, schema, products and prefix;
   never carry IDs from the first customer. Clarify conflicts with repository mappings
   before writes. State the selected hub/product and config source before mutation.

### Workspace and connection verification

Before creating or moving any project content, including standalone documents and
private drafts, verify the selected connection can fetch the intended hub and target
parent by their exact configured or user-selected IDs. An authenticated connection
or a successful write elsewhere does not establish the correct workspace. Multiple
Notion connections may belong to different workspaces even for the same user.
Choose the connection that can access the intended project destination; verify
workspace identity from available metadata and the fetched hub/parent, not a tool
prefix, account email, default workspace or search ranking.

Keep project documents under the selected project's existing hierarchy and follow
its document conventions. A connector's private-draft default must never override
an established project/workspace destination. If the intended destination is not
accessible, resolve the connection or access gap before writing; do not create a
fallback copy in Personal or another unrelated workspace. When a parent is missing,
clarify only that placement, retaining the already selected workspace/project.

For a requested workspace correction, prefer moving the original page tree with
its media, links and review history. Verify the destination parent and descendants
afterward. If cross-workspace moves require a signed-in browser or additional
access, report that specific prerequisite and continue independent work. Do not
silently recreate the pages or lose comments/history. If the user explicitly accepts
recreation, transfer content and media with the destination connection, rebuild the
hierarchy and internal links, and verify the result before removing source pages.
When source removal is authorized, perform it through an available supported delete
capability. If deletion is unavailable, report the originals still present and the
specific cleanup action needed; a verified destination copy alone is not a completed
move. Do not make browser login a prerequisite for copying when both connections
already provide the necessary read/create/media access. Store customer-specific
workspace/hub mappings in project configuration, never in this global skill.

Read the config's existing structure rather than imposing a new JSON layout. It must
resolve these logical mappings, directly or through referenced Notion pages:

- Hub identity, Settings page, task database ID and data source ID (distinct IDs).
- Exact case-sensitive property names/types, task/Epic type values, and status names
  for backlog, ready, working, review and done.
- Ticket ID property and expected prefix; Product choices/IDs and repository/product
  mappings; Epic/Tasks hierarchy and Related tickets relation mappings.
- Documents, Preview, Pull request, Preview commit and Reviewers property mappings,
  plus any hub-specific review/feedback conventions.

Fetch the selected database/data source schema and Settings before writes. Verify
IDs, property types, relation targets and status/type/product values. Cache for this
hub during the session; refresh on hub switches, schema changes or unexpected
responses. Missing mappings, inaccessible Settings or schema gaps block dependent
writes: report the exact gap. Never silently create properties, options, relations,
databases or Settings, or substitute similar-looking fields.

## Policy and capability discovery

Notion Settings is authoritative for development policy, including `worktrees`,
`autoCommit`, `createPr` and `memory`. Read actual values and linked policy before
work; do not maintain a competing policy copy in this skill or routing config.
Surface unresolved policy conflicts. For work linked to a ticket, Settings grant what
they state: with `createPr: true`, pushing the feature branch and opening its PR are
part of the task, without asking; `autoCommit` and `worktrees` apply the same way.
Without a ticket, ask before pushing or opening a PR. Settings never authorize merging,
deploying or customer approval; those stay with the user.

Discover Notion capabilities and input schemas through the current client's tool
catalog. Do not assume a tool prefix, client, discovery command or setup procedure.
Look for search/query, schema/page fetch, page create/update, comments and media
support. Read the provider's native Notion Markdown documentation before reading or
writing page content so mentions, relations, images and preserved blocks are handled
correctly. Discover comment-update support separately; never assume it exists.
Distinguish missing access from missing capability.

Use connected Notion tools when they work. Never bypass working MCP access with raw
`curl`, direct API calls or extracted credentials. For unexpected responses, inspect
the error, rediscover the tool/schema and refresh relevant state before retrying.
If MCP is unavailable, report that fact and use an available authorized fallback
only after reading its documentation (for `ntn`, the notion-cli skill). An uncertain
mutation response is not proof of failure. Stop when identity or write outcome
cannot be established; report what was checked rather than retrying indefinitely.

## Ticket identity and lookup

`Ticket ID` is Notion's native read-only `unique_id`, generated by Notion. Never
write it, implement a duplicate counter, allocate the next number, renumber tickets
or reuse deleted numbers. The configured prefix plus integer is the public identity.

For “please work on CA-110”:

1. Bootstrap the hub first. Verify the requested prefix matches the selected hub's
   prefix; a mismatch requires clarification, never a cross-customer guess.
2. Query the selected data source for the exact numeric ID. The current SQL interface
   returns `Ticket ID` as an INTEGER, while page fetch displays e.g. `CA-15`.
   Use numeric equality such as `"Ticket ID" = 110` with the mapped property and
   documented query syntax, not string equality with `CA-110`.
3. Fetch the candidate and verify the complete displayed/native unique ID, prefix,
   number, database/data source and Product. SQL's integer alone cannot establish
   customer identity. Without SQL, use supported exact property filters or scoped
   search and the same fetch/verify. Never substitute a fuzzy title match for an ID.
4. Read the body, linked requirements/Documents, epic, comments and all review
   feedback before planning or changing work. Resolve outstanding feedback against
   current scope; do not resume solely from an old plan or PR.

## Product, epic and related work

- Every task has exactly one Product and exactly one Epic. Fetch the epic: it must
  be typed Epic, have the same Product, and have no Epic parent. Tasks must not be
  typed Epic. Epics also have exactly one Product.
- `Epic` is the task's hierarchy relation; `Tasks` is its reciprocal child relation
  on the epic. Verify reciprocity after changes using the mapped names and schema.
  Do not manually duplicate a relation Notion maintains.
- `Related tickets` is a separate relation for related work. Never misuse Epic/Tasks
  hierarchy for dependencies, peers or follow-ups. Maintain the related relation's
  reciprocal side when the schema requires it.
- If Product or Epic is ambiguous, ask before creating/moving a task. Never create
  an orphan, invent an epic, silently reparent work or repair invalid relationships
  without authorization. Create epics only when asked; validate type, Product and
  empty Epic parent.

## Idempotent create and uncertain results

Before creating, query/search the selected data source for the same intended work,
exact title, Product and Epic. Inspect candidates and reuse the matching task; a
similar title alone is insufficient. Preserve a stable operation/request identifier
across retries using provider idempotency support when available. Otherwise record
a correlation marker in allowed page content without adding schema, and search for
that same marker on retries.

Create with validated Product/Epic, mapped ready status and required fields; omit
Ticket ID. After every create, fetch the resulting page and verify a valid native
`PREFIX-integer` Ticket ID with the expected prefix, requested properties and
relations. **Never report creation as successful until this fetch/verification
succeeds.** If ID generation is delayed, refetch the same page; do not create another.

After a timeout or uncertain error, inspect any returned page ID, then query for the
stable marker and matching work before retrying. Concurrent agents may both pass
preflight search: use provider idempotency/coordination when available and requery
after the write. Without atomic support, preflight search cannot guarantee uniqueness.
If multiple candidates exist or the outcome remains uncertain, stop and report the
candidates. Never blindly create again, delete duplicates, renumber or reuse an ID.
Retry creation only after establishing no write occurred.

## Work, feedback and approval

The task is the review unit. For the current project's workflow, text and images
belong in ticket comments; there are no forms, separate feedback records, releases
or versioning workflow. Other hubs may explicitly configure alternatives; never
introduce them by default. Preserve review cycles, history and old preview evidence.

| Event | Required action | Logical status |
| --- | --- | --- |
| Start/resume | Read feedback/requirements and post/update the current [PLAN] | working |
| Meaningful decision | Record rationale, scope/priority changes and their source | unchanged |
| Ready for review | Post [RESULT], evidence and draft/update [LEARNING]; set mapped Reviewers | review |
| Changes requested | Read feedback, record the next cycle/revised plan, implement and verify | working, then review |
| Explicit human approval | Record approver, source/date and approved scope/evidence; finalize learning | done |
| Blocked | Post [QUESTION] with missing input; stop dependent work | unchanged |

Use configured status names rather than these logical labels. Change only intended
properties and refetch to confirm writes. Humans own epic status unless explicitly
delegated. Never self-approve: an agent may record explicit human approval and set
done on that basis. Checks passing, PR merge, deployment and agent review do not
constitute customer approval. Approval must cover current scope and review evidence;
changed scope/new revisions require renewed review.

Record meaningful decisions when made, especially feedback changing scope,
acceptance criteria or priority. Update the linked requirement/PRD/glossary where
the decision belongs, within authorized scope, and point from the ticket to the exact
section and commit (when committed). If blocked or unauthorized, identify the document/
section still needing an update; never claim synchronization. Do not invent decisions
to satisfy a comment quota.

Use `Documents` for requirement/PRD/glossary references, `Preview` for the current
review URL, `Pull request` for the relevant PR, `Preview commit` for the exact served
revision, and `Reviewers` for intended humans, matching actual property types.
Before replacing current preview/commit/PR properties, preserve the previous cycle's
values and feedback in comments. At handoff record the tested commit, preview
evidence, checks, limits and what needs human review. Verify the preview corresponds
to the claimed commit; mark it unverified when that cannot be confirmed. Leave
inapplicable evidence absent; do not fabricate it or create/deploy a preview/PR
without authorization. Read feedback images using supported media capabilities,
preserve links/context, and disclose attachments you could not inspect.

## Living documents and completion checks

Documentation upkeep is part of the work, not an optional follow-up. At planning,
identify the existing documents affected by the requested change through the ticket's
Documents links, requirements and relevant hub/repository references. At review
handoff, compare those documents with the implemented and verified outcome. Cover
requirements, decisions, operational guides, user journeys and permission maps when
affected; do not scan or rewrite unrelated documentation.

- Respect each document's source of truth. Update canonical content in its existing
  location; a Notion pointer to repository documentation stays a pointer rather than
  becoming a competing copy. Preserve stable page URLs, hierarchy and unrelated edits.
- Update instructions, terminology, examples, limitations and diagrams when the
  behavior they describe changes. Separate agreed requirements from observed behavior
  and permissions configured without a demonstrated workflow. Passing code checks
  alone does not verify a user journey.
- For affected journeys, recapture screenshots when navigation, controls, text,
  permissions or displayed outcomes materially change. Use the relevant role, scope
  and environment, wait for identity/data to settle, and inspect the capture before
  attaching it. Retain useful unchanged captures; do not recapture everything for a
  change that does not affect it. Never fabricate screenshots or imply production
  verification from local or preview evidence.
- Keep the story, screenshots, feature/permission map and related guidance consistent.
  Preserve feedback context: if an old capture or step is referenced by unresolved
  comments or approval, retain it as superseded with a link to the replacement until
  that review context is resolved. Do not erase review history during routine upkeep.
- Record meaningful updates with their reason and relevant ticket/change evidence
  using the document's existing conventions. A last-verified date or revision must
  describe what was actually checked, not merely the latest edit. Do not add database
  properties or a new tracking system just to record this.
- In the review result or handoff, name the documents updated, reviewed unchanged,
  or still stale, with links and verification limits. If access, a required login,
  authorization or an unavailable environment prevents an update, identify the exact
  page/section and follow-up. Complete independent work, but do not claim documentation
  is synchronized or the affected work fully complete while required updates remain.

### Document identity and history

Keep one current living document with a stable title and URL by default. Do not
append artificial V1/V2 labels, duplicate pages for routine edits, or infer a release
or approval from a document revision. Use Notion history for routine recovery and
the existing review/change record for rationale; verify the workspace's actual
history retention before relying on it for long-term evidence.

Use explicit versioned baselines only when requested or required by the selected
hub's policy, for example an approved specification or a release-specific guide that
must remain referenceable. Preserve its actual scope, evidence, date and approval
state, and clearly distinguish it from the current document. Do not invent an
initial version, approved snapshot or release/versioning workflow. Native edit
history alone does not establish human approval or an immutable baseline.

## Comments and learning

| Tag | Purpose |
| --- | --- |
| [PLAN] | Current approach, scope and response to outstanding feedback |
| [DECISION] | Meaningful judgment, rationale and scope/priority changes |
| [RESULT] | Outcome, verification, evidence and limitations for this cycle |
| [NOTE] | Branch/worktree context, approval record or administrative context |
| [QUESTION] | Specific input needed and what it blocks |
| [LEARNING] | Evolving journey, reversals and reusable insight |

Read the full comment journey before writing learning. Create/update it at each
review handoff, then finalize after explicit human approval; never defer all learning
until approval. Keep one current learning summary per task and retain review history.
If comment updates are supported, update the existing summary without erasing earlier
cycles. Otherwise preserve the old comment and add a linked superseding [LEARNING]
comment identifying which summary it replaces. Record the current comment ID/link
in a supported, non-destructive page metadata section when available; never assume
HTML comments survive native Notion Markdown. If metadata cannot be preserved, find
the latest linked summary through comments instead.

```markdown
[LEARNING]
## What was done
{outcome; draft at handoff or approved outcome after approval}

## Iterations
- Cycle 1: {work and evidence} → {feedback/reversal and why}
{or: single pass, no reversals}

## Key decisions & reversals
- {meaningful decision} — held / reversed — {reason}
{state none when no meaningful decisions occurred}

## What to remember
{most useful insight for a future agent}

## Connects to
{related tickets, requirement/PRD/glossary sections and commits, or none}
```

Skip learning if the user explicitly asks. Honor Settings' `memory` policy for any
additional memory storage; ticket learning does not authorize unrelated writes.
