# jv-ai

Personal monorepo for AI orchestration: Claude Code skills, subagents, harness configs, and supporting glue.

Skills here are consumed by [Claude Code](https://docs.claude.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), and other agent harnesses via the [`skills` CLI](https://github.com/vercel-labs/agent-skills) from Vercel Labs.

## Layout

```
skills/        # Agent skills (SKILL.md per directory)
  jv-linear/   # Lean Linear MCP workflow (jv-linear-mcp wrapper)
  linear/      # Stock linear-server MCP workflow
  jv-trello/   # Trello MCP workflow
  graphify/    # Any input → knowledge graph (Brain1 / Obsidian vault)
agents/        # Claude Code subagents
  brain1-maintainer.md  # Mechanical maintenance for the Brain1 vault
```

## Installing skills

Use Vercel's `skills` CLI — `bunx` runs it without a global install.

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

> Note: `skills update` re-pulls from the source repo. It does not diff against local edits, so if you've patched a skill in `~/.claude/skills/<name>` directly, that change will be overwritten on update. Edit here and re-`add` instead.

## Installing agents

The `skills` CLI handles skills, not subagents. Agents in `agents/` are plain markdown — symlink or copy them into `~/.claude/agents/`:

```bash
ln -s "$PWD/agents/brain1-maintainer.md" ~/.claude/agents/brain1-maintainer.md
```

## Working on a skill

1. Edit the `SKILL.md` in `skills/<name>/`.
2. Re-run `bunx skills add juanvieiraio/jv-ai -s <name>` from a consuming agent to pull the new version, or sync your local `~/.claude/skills/<name>` manually while iterating.
3. Commit. Push. Other agents pick it up on their next `skills update`.
