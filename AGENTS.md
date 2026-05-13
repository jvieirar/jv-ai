# Agent Development Guidelines

Shared rules for every agent / harness Juan operates (Claude Code, Codex, Copilot CLI, Gemini, …). The first half is personal preferences; the second half is JS/TS/Node project conventions. Python and other ecosystems follow the same spirit — substitute the obvious package manager and tooling.

---

## A. Personal preferences

### A.1 Don't auto-process images

Don't auto-download, OCR, transcribe, or vision-extract images unless the user explicitly asks. Applies everywhere — Brain1 ingest, web clipping, Linear / Trello attachments, anything else. Default action when an image URL appears in a source: leave the URL as-is. Only fetch and process when there's an explicit "look at this image", "extract text from this", or similar request.

Why: most images in clipped/saved content are decorative (logos, badges, charts as figures) — not load-bearing for synthesis. Auto-processing burns tokens on assets that won't be used.

### A.2 graphify

`graphify` (`~/.claude/skills/graphify/SKILL.md`) turns any input into a knowledge graph. Trigger: `/graphify`. When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

### A.3 Today's date

When the harness exposes a `currentDate` field in system context, trust it over training-data assumptions.

---

## B. Package management

### B.1 Always install packages via CLI — never edit manifests by hand

Use the package manager's add/install command so the lockfile stays in sync. Never manually add a dependency to `package.json`.

```bash
# ✅ correct
bun add ai-sdk
pnpm add ai-sdk
yarn add ai-sdk
npm install ai-sdk

# ❌ wrong — breaks lockfile integrity
# editing package.json directly, then running install
```

Python equivalents: `uv add <pkg>` or `pip install <pkg>` rather than editing `pyproject.toml` / `requirements.txt` directly.

### B.2 Detect the right package manager from the lockfile

Check the repository root for lockfiles and follow this priority order:

| Priority | Lockfile                 | Package manager | One-off runner |
| -------- | ------------------------ | --------------- | -------------- |
| 1        | `bun.lockb` / `bun.lock` | `bun`           | `bunx`         |
| 2        | `pnpm-lock.yaml`         | `pnpm`          | `pnpm dlx`     |
| 3        | `yarn.lock`              | `yarn`          | `yarn dlx`     |
| 4        | `package-lock.json`      | `npm`           | `npx`          |

If multiple lockfiles exist, use the priority above. Apply the same rule to one-off runners (`bunx`, `pnpm dlx`, `npx`, etc.).

---

## C. File navigation

### C.1 Always use absolute paths

Relative paths break as soon as the working directory changes. Use absolute paths in all commands, scripts, and tool calls.

```bash
# ✅ correct
cat /Users/juanvieira/development/h3d/apps/web/src/index.ts

# ❌ avoid
cat src/index.ts
```

---

## D. Wrap-up checklist

Run these at the end of every feature or task, in order.

### D.1 Lint & format — modified/created files only

Scope the linter and formatter to files changed in this session. Do not run project-wide and surface pre-existing issues in untouched files.

```bash
# adapt to project config
bunx eslint src/feature/newFile.ts src/feature/updatedFile.ts
bunx prettier --write src/feature/newFile.ts src/feature/updatedFile.ts
```

### D.2 Tests & typecheck

Look for test and typecheck scripts in `package.json` first. Also check `.github/` for CI/CD workflows — they often contain the canonical commands used in production.

Default fallbacks:
- **Tests:** `vitest` → `jest`
- **Typecheck:** `tsc --noEmit`

Run tests and typecheck automatically — no need to ask the user. For **build commands**, always ask first: the user may prefer to trigger the build themselves or via CI.

```bash
# run without asking
bun run test        # or: bunx vitest run
bun run typecheck   # or: tsc --noEmit

# always ask before running
bun run build
```

### D.3 Validate documentation

After completing a task, review any `.md` files in the root and in `docs/` to confirm they still reflect the current state of the project (commands, architecture, API references, etc.). Update them if needed.

### D.4 Dependency vulnerability check

Run a quick audit for critical/high vulnerabilities before closing out the task. Surface any findings to the user.

```bash
bun audit
pnpm audit --audit-level=high
yarn npm audit --all --severity high
npm audit --audit-level=high
```

---

## E. Blockers & complexity escalation

If you hit a blocker, or a task is turning out significantly more complex than expected, **stop and raise it with the user immediately** rather than pushing through silently.

When raising a blocker also assess whether it warrants a new standing rule:
- If `AGENTS.md` is present → propose an addition there (preferred).
- If only `CLAUDE.md` is present → propose an addition there.
- If neither exists → suggest creating `AGENTS.md`.

---

## F. CI/CD & GitHub Actions

### F.1 Use Blacksmith runners

Default to [Blacksmith](https://blacksmith.sh) instances instead of GitHub-hosted runners. They are faster and more cost-effective.

```yaml
# ✅ preferred
runs-on: blacksmith-2vcpu-ubuntu-22.04

# ❌ avoid unless Blacksmith is unavailable
runs-on: ubuntu-latest
```

Common sizes: `blacksmith-2vcpu-ubuntu-22.04`, `blacksmith-4vcpu-ubuntu-22.04`, `blacksmith-8vcpu-ubuntu-22.04`.
