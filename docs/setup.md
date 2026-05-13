# Setup — fresh machine

End-to-end runbook for replicating Juan's Linear + Obsidian/Brain1 agent setup. Paste-friendly. Assumes macOS; adapt obvious bits for Linux.

## 0. Prereqs

```bash
# Core tooling
brew install bun uv jq git gh
brew install --cask claude         # Claude Code CLI (or grab from claude.com/code)
brew install --cask obsidian       # also installs the `obs` CLI used by the obsidian-cli skill

# graphify (Python via uv) — Brain1 knowledge graph builder
uv tool install graphifyy          # provides the `graphify` command
```

Sanity check:

```bash
bun --version && uv --version && claude --version && graphify --version
```

## 1. Clone the MCP source

This repo registers `jv-linear-mcp` by path. The source must exist before `sync-mcp` will succeed (pre-flight check enforces this).

```bash
mkdir -p ~/development/codebases/tools
git clone https://github.com/<owner>/jv-linear-mcp.git \
  ~/development/codebases/tools/jv-linear-mcp
cd ~/development/codebases/tools/jv-linear-mcp
cp .env.template .env.local
$EDITOR .env.local                 # paste LINEAR_API_KEY (lin_api_…)
bun install
```

> **Different location?** Two options:
> - Set `JV_LINEAR_MCP_DIR=/path/to/jv-linear-mcp` in your shell rc, or copy `mcp/.env.example` → `mcp/.env` and edit there.
> - Or edit `mcp/servers.json` directly: replace the `${VAR}` placeholder with the absolute path. Use `pwd` from inside the cloned MCP to grab it: `echo "$(pwd)/scripts/start-mcp.sh"`.

## 2. Clone this repo

```bash
mkdir -p ~/development/codebases/ai
git clone https://github.com/<owner>/jv-ai.git ~/development/codebases/ai/jv-ai
cd ~/development/codebases/ai/jv-ai
bun install
```

## 3. Install skills

Skills are consumed via Vercel Labs' `skills` CLI. `--global` puts them in `~/.claude/skills/`.

```bash
bunx skills add <owner>/jv-ai --all --global
```

Pick specific ones if you don't want all:

```bash
bunx skills add <owner>/jv-ai -s jv-linear,graphify --global
```

## 4. Install subagents

`bunx skills` doesn't handle subagents. Symlink them:

```bash
ln -sf "$PWD/agents/brain1-maintainer.md" ~/.claude/agents/brain1-maintainer.md
```

## 5. Register MCP servers across every harness

```bash
bun run sync-mcp                   # apply
bun run sync-mcp -- --dry-run      # preview
```

What it does:
- Reads `mcp/servers.json` (with `${VAR}` expansion from real env + `mcp/.env`)
- Writes into `~/.claude.json` (Claude Code), `~/.agents/mcp.json` (mirror), `~/.pi/agent/mcp.json` (Pi agent)
- Additive + idempotent; skips entries it can't safely merge

Targets are declared in `mcp/targets.json`. Flip `enabled: true` to turn on Claude Desktop or Codex.

## 6. Claude Code settings + plugins

`claude/settings.template.json` is a snapshot of the worth-keeping keys. **Don't replace your live file**; copy bits over with `jq` or by hand:

```bash
# Inspect current
cat ~/.claude/settings.json

# See what to add
cat ~/development/codebases/ai/jv-ai/claude/settings.template.json
```

Then enable the plugin marketplaces + plugins via the CLI (cleanest):

```bash
# Marketplaces
claude plugins marketplace add fallow-rs/fallow-skills
claude plugins marketplace add kepano/obsidian-skills

# Plugins from the official marketplace
claude plugins install frontend-design superpowers context7 notion playwright posthog

# Plugins from the extra marketplaces
claude plugins install fallow@fallow-skills obsidian@obsidian-skills
```

Pick à la carte — none of these are required for the Linear + Obsidian core flow, but they're what's enabled on the source machine.

## 7. Brain1 (Obsidian vault)

LiveSync handles the heavy lifting. On a new machine:

1. Install Obsidian and the `obsidian-livesync` community plugin (or copy `.obsidian/` from another machine).
2. Point the vault at your CouchDB / configured sync endpoint.
3. Let it pull.

The vault carries its own `CLAUDE.md` and `.claude/settings.local.json`. **Do not** copy those into `~/.claude/` — they're vault-scoped on purpose and only apply when Claude Code is run from inside the vault directory.

## 8. Verify

```bash
claude mcp list                    # jv-linear-mcp should be connected
bunx skills ls                     # jv-linear, graphify, … listed
ls ~/.claude/agents/               # brain1-maintainer.md present
```

From inside the Brain1 vault:

```bash
cd ~/path/to/Brain1
claude                             # session should load Brain1 CLAUDE.md
# inside Claude: /graphify --update
```

---

## Maintenance

- **Add a new MCP:** edit `mcp/servers.json`, then `bun run sync-mcp`.
- **Update a skill:** edit `skills/<name>/SKILL.md` here, commit, push, then `bunx skills update <name>` on each machine.
- **Add a new subagent:** drop it in `agents/`, add a symlink line to step 4 above.
- **Drift check:** `bun run sync-mcp -- --dry-run` after the fact will surface any per-machine divergence (it warns on conflicts instead of overwriting).
