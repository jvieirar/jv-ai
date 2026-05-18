# Setup — fresh machine

End-to-end runbook for replicating Juan's agent setup. Paste-friendly. Assumes macOS; adapt obvious bits for Linux.

## Prerequisites

Make sure you have these on your machine. Sanity check:

```bash
git --version && claude --version && bun --version
```

- **git** and **claude** ([Claude Code](https://claude.com/code)) — assumed already installed.
- **bun** — install via the official script (Homebrew is **not** the supported channel):

  ```bash
  curl -fsSL https://bun.com/install | bash
  ```

  See [bun.com/docs/installation](https://bun.com/docs/installation#macos-%26-linux).

> **Using `pnpm` or `npm` instead?** Commands below use `bun` / `bunx`. You can substitute in this preference order: `bun` → `pnpm` (with `pnpm dlx` for `bunx`) → `npm` (with `npx` for `bunx`). Bun is the recommended choice — the repo's scripts (`bun run sync-mcp`) and lockfile are bun-native, so some commands may need light adapting on the other two.

## Clone the repo

```bash
mkdir -p ~/development/codebases/ai
git clone https://github.com/jvieirar/jv-ai.git ~/development/codebases/ai/jv-ai
cd ~/development/codebases/ai/jv-ai
bun install
```

`jv-linear-mcp` is vendored under `custom_mcps/jv-linear-mcp` — no separate clone needed.

## Pick a tier

| Tier | What you get | When to pick |
| ---- | ------------ | ------------ |
| **[Minimal](#minimal-setup)** | `jv-linear` skill + `jv-linear-mcp` only. | Linear-aware Claude Code on a clean machine. |
| **[Comprehensive](#comprehensive-setup)** | Minimal **+** Obsidian/Brain1 (`graphify`) **+** optional `brain1-maintainer` agent. | You also keep a personal Obsidian second brain. |
| **[Full](#full-setup)** | Comprehensive **+** Ormah persistent memory **+** all skills, marketplaces, plugins, broader MCP sync targets. | You want Juan's full daily-driver stack. |

Each tier is cumulative — Comprehensive assumes Minimal; Full assumes Comprehensive.

---

## Minimal setup

**Goal:** Linear skill + Linear MCP. Nothing else.

### 1. Configure the Linear MCP

```bash
cd custom_mcps/jv-linear-mcp
cp .env.template .env.local
$EDITOR .env.local                 # paste LINEAR_API_KEY (lin_api_…)
bun install
cd ../..
```

> **MCP checked out elsewhere?** Either set `JV_LINEAR_MCP_DIR=/path/to/jv-linear-mcp` in your shell rc, or edit `mcp/servers.json` directly with the absolute path.

### 2. Install the `jv-linear` skill

Run from the repo root:

```bash
bunx skills add ./skills/jv-linear --global
```

What the flags do:
- The positional arg (`./skills/jv-linear`) is a **local path** to the skill folder. The `skills` CLI also accepts `<owner>/<repo>` to pull from GitHub, or `<owner>/<repo> -s <name>` to select a specific skill out of a multi-skill repo (`-s` = `--select`). Pointing at a local path is simpler and lets you iterate without pushing.
- `--global` installs into `~/.claude/skills/` instead of `.claude/skills/` in the current directory. Use it so the skill is available from every project, not just inside this repo.

### 3. Register the MCP with Claude Code

Preview first, then apply:

```bash
bun run sync-mcp -- --dry-run      # preview the diff
bun run sync-mcp                   # apply
```

What it does:
- Reads `mcp/servers.json` (with `${VAR}` expansion from real env + `mcp/.env`)
- Writes into `~/.claude.json` (Claude Code), `~/.agents/mcp.json` (mirror), `~/.gemini/settings.json` (Gemini CLI), and `~/.codex/config.toml` (Codex CLI)
- Additive + idempotent

Targets are declared in `mcp/targets.json`. All enabled targets receive the sync; disable any you don't need by setting `"enabled": false`.

### 4. Verify

```bash
claude mcp list                    # jv-linear-mcp should be connected
bunx skills ls                     # jv-linear listed
```

Open Claude Code and try `/jv-linear` — you're done.

---

## Comprehensive setup

**Goal:** Minimal **+** Obsidian / Brain1 vault **+** `graphify` knowledge-graph skill. Optional: `brain1-maintainer` subagent.

> Run the **[Minimal setup](#minimal-setup)** first.

### 1. Extra tooling

```bash
brew install uv
brew install --cask obsidian

# graphify (Python via uv) — Brain1 knowledge graph builder
uv tool install graphifyy          # provides the `graphify` command
```

> **Obsidian CLI required.** The `kepano/obsidian-skills` and `graphify` workflows shell out to the `obs` CLI, which ships only with **recent Obsidian releases**. After installing/updating Obsidian, enable the CLI per the [official docs](https://help.obsidian.md/command-line) and verify with `obs --version`.

Sanity check:

```bash
uv --version && graphify --version && obs --version
```

### 2. Install the `graphify` skill

From the repo root:

```bash
bunx skills add ./skills/graphify --global
```

### 3. Install `kepano/obsidian-skills` (recommended)

A useful pack of Obsidian-aware skills (note creation, linking, daily-note helpers, etc.) from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills). Two install paths:

**As a Claude Code plugin (recommended):**

```
/plugin marketplace add kepano/obsidian-skills
/plugin install obsidian@obsidian-skills
```

**Or as a skills bundle:**

```bash
bunx skills add git@github.com:kepano/obsidian-skills.git --global
```

### 4. Brain1 (Obsidian vault)

Open your vault. Point Claude Code at it by running `claude` from inside the vault directory — the vault carries its own `CLAUDE.md` and `.claude/settings.local.json`. **Do not** copy those into `~/.claude/`; they're vault-scoped on purpose.

**Recommended (not required):** the [`obsidian-livesync`](https://github.com/vrtmrz/obsidian-livesync) community plugin pointed at your CouchDB for multi-device sync. Any sync mechanism works — Dropbox, iCloud, a git repo, or no sync at all if it's a single-machine vault.

### 5. Optional: `brain1-maintainer` subagent

A cheap maintenance agent for the Brain1 vault (runs `/graphify --update`, lint passes, refresh-queue scans). Only useful alongside `graphify` + Obsidian.

```bash
mkdir -p ~/.claude/agents
ln -sf "$PWD/agents/brain1-maintainer.md" ~/.claude/agents/brain1-maintainer.md
```

### 6. Verify

```bash
bunx skills ls                     # jv-linear, graphify listed
ls ~/.claude/agents/               # brain1-maintainer.md if you symlinked it
```

From inside the vault:

```bash
cd ~/path/to/Brain1
claude                             # session should load Brain1 CLAUDE.md
# inside Claude: /graphify --update
```

---

## Full setup

**Goal:** Everything Juan runs — persistent memory (Ormah), all remaining skills, plugin marketplaces, and broader MCP sync targets.

> Run the **[Comprehensive setup](#comprehensive-setup)** first.

### 1. Ormah (persistent memory)

Ormah gives agents memory that survives across sessions and projects.

```bash
claude plugins install ormah
```

Then from inside Claude Code:

```
/ormah:setup
```

Verify with `/ormah:status`.

### 2. Install all remaining skills

```bash
bunx skills add ./skills --all --global
```

### 3. Claude Code settings

`claude/settings.template.json` is a snapshot of the worth-keeping keys. **Don't replace your live file** — copy bits over by hand:

```bash
# Inspect current
cat ~/.claude/settings.json

# See what to add
cat ./claude/settings.template.json
```

### 4. Plugin marketplaces + plugins

These are what Juan has enabled on the source machine. Currently confirmed installed: `frontend-design`, `superpowers`, `context7`, `playwright`, `code-review`, `feature-dev`, `pr-review-toolkit`, `typescript-lsp`, `swift-lsp`.

```bash
claude plugins install frontend-design superpowers context7 playwright \
                       code-review feature-dev pr-review-toolkit
```

**Optional:** the `fallow-rs/fallow-skills` marketplace is not in active use on the source machine but is wired up as an add-on:

```bash
claude plugins marketplace add fallow-rs/fallow-skills
claude plugins install fallow@fallow-skills
```

(`kepano/obsidian-skills` is covered in the **[Comprehensive setup](#3-install-kepanoobsidian-skills-recommended)**.)

### 5. Expand MCP sync targets

Open `mcp/targets.json` and flip `enabled: true` on additional targets (all are enabled by default now):

- `pi` — Pi agent (`~/.pi/agent/mcp.json`)
- `claude-desktop` — Claude Desktop macOS app
- `gemini` — Google Gemini CLI (`~/.gemini/settings.json`)
- `codex` — OpenAI Codex CLI (`~/.codex/config.toml`, TOML format)

Then re-apply:

```bash
bun run sync-mcp -- --dry-run
bun run sync-mcp
```

### 6. Verify

```bash
claude mcp list                    # all configured servers connected
bunx skills ls                     # full skill list
claude plugins list                # marketplaces + plugins enabled
```

---

## Maintenance

- **Add a new MCP:** edit `mcp/servers.json`, then `bun run sync-mcp`.
- **Update a skill:** edit `skills/<name>/SKILL.md` here, commit, push, then `bunx skills update <name>` on each machine.
- **Add a new subagent:** drop it in `agents/`, add a symlink line to the Comprehensive setup step 4.
- **Drift check:** `bun run sync-mcp -- --dry-run` will surface any per-machine divergence (it warns on conflicts instead of overwriting).
