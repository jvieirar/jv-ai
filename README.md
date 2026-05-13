# jv-ai

Personal monorepo for AI orchestration: Claude Code skills, subagents, harness configs, and supporting glue.

> **New machine?** Follow [`docs/setup.md`](docs/setup.md) end-to-end.

## Layout

```
skills/        # Agent skills (SKILL.md per directory)
  jv-linear/   # Lean Linear MCP workflow (jv-linear-mcp wrapper)
  graphify/    # Any input → knowledge graph (Brain1 / Obsidian vault)
agents/        # Claude Code subagents
  brain1-maintainer.md  # Mechanical maintenance for the Brain1 vault
mcp/           # Cross-harness MCP server config
  servers.json     # Canonical set of MCP servers (source of truth)
  targets.json     # Where to fan them out (Claude Code, Pi, ~/.agents mirror, …)
  .env.example     # Optional path overrides (copy to mcp/.env, gitignored)
claude/
  settings.template.json  # Snapshot of worth-keeping keys for ~/.claude/settings.json
scripts/
  sync-mcp.ts    # Idempotent, additive sync from mcp/servers.json → every target
docs/
  setup.md       # New-machine bootstrap runbook
AGENTS.md      # Cross-harness rules (used by Claude Code, Codex, Copilot CLI, Gemini)
```

## Installing skills

Skills are consumed via Vercel Labs' [`skills` CLI](https://github.com/vercel-labs/agent-skills). `bunx` runs it without a global install.

```bash
# Install everything from this repo into the current agent (project-local)
bunx skills add juanvieiraio/jv-ai --all

# Install globally (user-level, ~/.claude/skills)
bunx skills add juanvieiraio/jv-ai --all --global

# Pick specific skills
bunx skills add juanvieiraio/jv-ai -s jv-linear,graphify -g

# List what's available without installing
bunx skills add juanvieiraio/jv-ai --list
```

Replace `juanvieiraio/jv-ai` with the actual GitHub `owner/repo` once this repo is pushed.

### Updates

```bash
bunx skills update                       # update all installed skills
bunx skills update jv-linear graphify    # update specific ones
bunx skills ls                           # see what's installed
```

> `skills update` re-pulls from the source repo. It does not diff against local edits, so if you've patched a skill in `~/.claude/skills/<name>` directly, that change will be overwritten on update. Edit here and re-`add` instead.

## Installing agents

The `skills` CLI handles skills, not subagents. Agents in `agents/` are plain markdown — symlink or copy them into `~/.claude/agents/`:

```bash
ln -s "$PWD/agents/brain1-maintainer.md" ~/.claude/agents/brain1-maintainer.md
```

## Syncing MCP servers across harnesses

Each agent harness (Claude Code, Pi, Claude Desktop, Codex, …) reads its own MCP config file. `mcp/servers.json` is the single source of truth. `scripts/sync-mcp.ts` fans it out.

```bash
bun run sync-mcp                  # apply (default: skip + warn on conflict)
bun run sync-mcp -- --dry-run     # show what would change, write nothing
bun run sync-mcp -- --force       # canonical wins on conflict (overwrite)
bun run sync-mcp -- --target pi   # one target only
bun run sync-mcp -- --server jv-linear-mcp  # one server only
```

**Behavior**
- **Additive** — only touches servers listed in `mcp/servers.json`. Anything else in the target file (other MCPs, Claude Code's full state JSON, etc.) is preserved.
- **Idempotent** — diffs against the target after normalizing noise fields (`type:"stdio"`, empty `args`/`env`). Re-running with no changes writes nothing.
- **Conflict-safe by default** — if a server with the same name exists in a target with a different config, the script leaves it alone and prints a warning. Use `--force` to override.

**Targets** (`mcp/targets.json`)

| Name | Path | Kind | Enabled by default |
|---|---|---|---|
| `claude-code` | `~/.claude.json` (`mcpServers` key) | json-nested | ✓ |
| `agents-mirror` | `~/.agents/mcp.json` | json-root | ✓ |
| `pi` | `~/.pi/agent/mcp.json` | json-root | ✓ |
| `claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` | json-root | — |
| `codex` | `~/.codex/config.toml` | toml-root | — (not implemented yet) |

Flip `enabled: true` in `mcp/targets.json` to turn one on, or use `--include-disabled` to test against a disabled target without committing the flip.

**Path placeholders**: `mcp/servers.json` supports `${VAR}` and `${VAR:-default}`. Real env vars win, then `mcp/.env` (gitignored, copy from `.env.example`). Prefer hardcoding? Just paste the absolute path — `pwd` inside the MCP source dir gets you the prefix.

**Pre-flight**: stdio commands with absolute paths are verified to exist on disk before any write. Missing → red `! missing` and the script exits 1.

**Adding a new MCP server**: edit `mcp/servers.json`, then `bun run sync-mcp`. That's it.

**Pi note**: Pi doesn't natively support MCP. The user has `pi-mcp-adapter` installed (see `~/.pi/agent/settings.json`'s `packages` field) — the adapter reads `~/.pi/agent/mcp.json`, which is what we write to.
