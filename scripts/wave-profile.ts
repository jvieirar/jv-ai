// Profile agent sessions by per-call context, estimated cost and tool mix.
//
// Cost is calls × context per call, so totals hide the problem: this reads every
// assistant call from Claude Code transcripts (both profiles, subagents included) and
// from OpenCode's database, groups tool-result bytes by source (whole-file reads,
// Serena, ccc, Context Mode, previews…), and counts how often Serena's `remind` hook
// denied a call. Built from the 02/11/2026 jv-bee wave-1 analysis.
//
//   bun run wave-profile --hours 24
//   bun run wave-profile --since 2026-11-03T00:00Z --project cantaryjugar --json
//   bun run wave-profile --project CA-110-siigo --since 2026-11-04T09:00Z \
//     --html /tmp/CA-110-cost.html --history CA-110
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export type Category =
  | "read:file"
  | "search"
  | "bash:test/check"
  | "bash:read"
  | "bash:other"
  | "serena"
  | "ccc"
  | "context-mode"
  | "preview"
  | "notion"
  | "other";

export interface CostBreakdown {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export interface SessionProfile {
  file: string;
  label: string;
  source: "claude" | "opencode";
  model: string;
  calls: number;
  contextMin: number;
  contextAvg: number;
  contextMax: number;
  callsOver100k: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  costUsd: number;
  cost: CostBreakdown;
  toolCalls: Record<string, number>;
  resultBytes: Partial<Record<Category, number>>;
  remindDenials: number;
  firstPrompt: string;
}

// API-equivalent USD per million tokens, as researched on 02/11/2026. Cache writes are
// assumed at 1.25× input (5-minute TTL). Haiku 5.5 switches tier per call above 100k.
// OpenCode sessions report their own cost (0 on the opencode-go subscription).
const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number }
> = {
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  haikuShort: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  haikuLong: { input: 0.5, output: 2.5, cacheRead: 0.05 },
};
const CACHE_WRITE_FACTOR = 1.25;
const LONG_CONTEXT = 100_000;

export function priceFor(model: string, context: number) {
  if (/haiku/i.test(model))
    return context > LONG_CONTEXT ? PRICES.haikuLong : PRICES.haikuShort;
  if (/sonnet/i.test(model)) return PRICES.sonnet;
  return PRICES.opus;
}

const TEST_WORDS = [
  "vitest",
  "pnpm test",
  "pnpm check",
  "vp check",
  "vp test",
  "typecheck",
  "fallow",
  "bun test",
  "node --test",
];
const READ_PATTERN =
  /(^|[\s|;&(])(cat|sed -n|head|tail|grep|rg|git (diff|show|log)|find|ls|wc)\s/;

function bashCategory(command: string): Category {
  const lower = command.toLowerCase();
  if (TEST_WORDS.some((word) => lower.includes(word))) return "bash:test/check";
  if (READ_PATTERN.test(` ${lower}`)) return "bash:read";
  return "bash:other";
}

export function categorize(name: string, input: unknown): Category {
  if (name === "Read") return "read:file";
  if (name === "Grep" || name === "Glob") return "search";
  if (name.startsWith("mcp__serena__")) return "serena";
  if (/cocoindex/i.test(name)) return "ccc";
  if (/context-mode|ctx_/i.test(name)) return "context-mode";
  if (/preview_|device_screenshot/.test(name)) return "preview";
  if (/notion/i.test(name)) return "notion";
  if (name === "Bash")
    return bashCategory(
      String((input as { command?: string } | null)?.command ?? ""),
    );
  return "other";
}

// OpenCode tool names are lowercase; MCP servers are called from `execute` code.
export function categorizeOpencode(name: string, input: unknown): Category {
  const fields = (input ?? {}) as { command?: string; code?: string };
  if (name === "read") return "read:file";
  if (name === "grep" || name === "glob" || name === "list") return "search";
  if (name === "bash") return bashCategory(String(fields.command ?? ""));
  if (name === "execute") {
    const code = String(fields.code ?? "");
    if (/tools\.serena/.test(code)) return "serena";
    if (/cocoindex/.test(code)) return "ccc";
    if (/notion/.test(code)) return "notion";
  }
  return "other";
}

// Serena's remind hook denies the call with an error result such as
// "PreToolUse:Bash hook error: Too many consecutive grep calls without using symbolic tools…".
const REMIND_DENIAL = /PreToolUse:\w+ hook error: Too many consecutive/;

interface Call {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  model: string;
  reportedCost?: number;
}

function size(content: unknown): number {
  return typeof content === "string"
    ? content.length
    : JSON.stringify(content ?? "").length;
}

function summarize(
  calls: Call[],
  base: Pick<
    SessionProfile,
    | "file"
    | "label"
    | "source"
    | "model"
    | "toolCalls"
    | "resultBytes"
    | "remindDenials"
    | "firstPrompt"
  >,
): SessionProfile | null {
  if (calls.length === 0) return null;
  const contexts = calls.map(
    (call) => call.input + call.cacheWrite + call.cacheRead,
  );
  const cost: CostBreakdown = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let reported = 0;
  for (const [index, call] of calls.entries()) {
    if (call.reportedCost !== undefined) {
      reported += call.reportedCost;
      continue;
    }
    const price = priceFor(call.model, contexts[index]);
    cost.input += (call.input * price.input) / 1e6;
    cost.cacheWrite += (call.cacheWrite * price.input * CACHE_WRITE_FACTOR) / 1e6;
    cost.cacheRead += (call.cacheRead * price.cacheRead) / 1e6;
    cost.output += (call.output * price.output) / 1e6;
  }
  const sum = (key: keyof CostBreakdown) =>
    calls.reduce((total, call) => total + call[key], 0);
  return {
    ...base,
    calls: calls.length,
    contextMin: Math.min(...contexts),
    contextAvg: Math.round(
      contexts.reduce((a, b) => a + b, 0) / contexts.length,
    ),
    contextMax: Math.max(...contexts),
    callsOver100k: contexts.filter((context) => context > LONG_CONTEXT).length,
    input: sum("input"),
    cacheWrite: sum("cacheWrite"),
    cacheRead: sum("cacheRead"),
    output: sum("output"),
    costUsd:
      cost.input + cost.cacheWrite + cost.cacheRead + cost.output + reported,
    cost,
  };
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  text?: string;
}

export function profileTranscript(
  text: string,
  file = "",
  label = basename(file),
): SessionProfile | null {
  const callsById = new Map<string, Call>();
  const toolById = new Map<string, { name: string; input: unknown }>();
  const toolCalls: Record<string, number> = {};
  const resultBytes: Partial<Record<Category, number>> = {};
  let remindDenials = 0;
  let firstPrompt = "";
  let model = "";

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: {
      type?: string;
      message?: {
        id?: string;
        model?: string;
        usage?: Record<string, number>;
        content?: unknown;
      };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message) continue;
    const blocks = Array.isArray(message.content)
      ? (message.content as Block[])
      : [];
    if (entry.type === "user" && !firstPrompt) {
      const prompt =
        typeof message.content === "string"
          ? message.content
          : (blocks.find((block) => block.type === "text")?.text ?? "");
      firstPrompt = prompt.replace(/\s+/g, " ").slice(0, 90);
    }
    // "<synthetic>" messages are written by Claude Code itself (errors, interruptions) with zero usage.
    if (
      entry.type === "assistant" &&
      message.usage &&
      message.id &&
      message.model !== "<synthetic>"
    ) {
      model = message.model ?? model;
      const usage = message.usage;
      callsById.set(message.id, {
        input: usage.input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        model,
      });
    }
    for (const block of blocks) {
      if (block.type === "tool_use" && block.id && block.name) {
        if (!toolById.has(block.id))
          toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
        toolById.set(block.id, { name: block.name, input: block.input });
      }
      if (block.type === "tool_result") {
        const tool = toolById.get(block.tool_use_id ?? "");
        const category = tool ? categorize(tool.name, tool.input) : "other";
        const bytes = size(block.content);
        resultBytes[category] = (resultBytes[category] ?? 0) + bytes;
        // A denial is a short error result; skip big outputs that merely mention Serena.
        if (bytes < 4000 && REMIND_DENIAL.test(JSON.stringify(block.content)))
          remindDenials++;
      }
    }
  }

  return summarize([...callsById.values()], {
    file,
    label,
    source: "claude",
    model,
    toolCalls,
    resultBytes,
    remindDenials,
    firstPrompt,
  });
}

interface OpencodeMessage {
  type: string;
  data: string;
}

export function profileOpencodeSession(
  messages: OpencodeMessage[],
  file: string,
  label: string,
  title = "",
): SessionProfile | null {
  const calls: Call[] = [];
  const toolCalls: Record<string, number> = {};
  const resultBytes: Partial<Record<Category, number>> = {};
  let model = "";
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    let data: {
      model?: { id?: string; providerID?: string };
      cost?: number;
      tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
      };
      content?: {
        type?: string;
        name?: string;
        state?: { input?: unknown; content?: unknown };
      }[];
    };
    try {
      data = JSON.parse(message.data);
    } catch {
      continue;
    }
    model = data.model?.id ?? model;
    const tokens = data.tokens ?? {};
    calls.push({
      input: tokens.input ?? 0,
      cacheWrite: tokens.cache?.write ?? 0,
      cacheRead: tokens.cache?.read ?? 0,
      output: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
      model,
      reportedCost: data.cost ?? 0,
    });
    for (const block of data.content ?? []) {
      if (block.type !== "tool" || !block.name) continue;
      toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
      const category = categorizeOpencode(block.name, block.state?.input);
      resultBytes[category] =
        (resultBytes[category] ?? 0) + size(block.state?.content);
    }
  }
  return summarize(calls, {
    file,
    label,
    source: "opencode",
    model,
    toolCalls,
    resultBytes,
    remindDenials: 0,
    firstPrompt: title.slice(0, 90),
  });
}

interface Options {
  since: number;
  project: string;
  sessions: string[];
  minCalls: number;
  json: boolean;
  roots: string[];
  opencodeDb: string | null;
  html: string | null;
  history: string | null;
}

export function parseArgs(argv: string[], now = Date.now()): Options {
  const options: Options = {
    since: now - 24 * 3_600_000,
    project: "cantaryjugar",
    sessions: [],
    minCalls: 5,
    json: false,
    roots: [
      join(homedir(), ".claude", "projects"),
      join(homedir(), ".claude-personal", "projects"),
    ],
    opencodeDb: join(homedir(), ".local", "share", "opencode", "opencode.db"),
    html: null,
    history: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === "--hours") options.since = now - Number(value()) * 3_600_000;
    else if (flag === "--since") {
      const since = Date.parse(value());
      if (Number.isNaN(since)) throw new Error("--since needs an ISO date");
      options.since = since;
    } else if (flag === "--project") options.project = value();
    else if (flag === "--session") options.sessions.push(value());
    else if (flag === "--min-calls") options.minCalls = Number(value());
    else if (flag === "--root") options.roots = [value()];
    else if (flag === "--opencode-db") options.opencodeDb = value();
    else if (flag === "--no-opencode") options.opencodeDb = null;
    else if (flag === "--html") options.html = value();
    else if (flag === "--history") options.history = value();
    else if (flag === "--json") options.json = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

// Claude Code names project folders after the working directory with every
// non-alphanumeric character replaced by "-", so match the project the same way.
const slug = (text: string) => text.replace(/[^a-zA-Z0-9]/g, "-");

async function transcripts(options: Options): Promise<string[]> {
  const found: string[] = [];
  for (const root of options.roots) {
    let projects: string[];
    try {
      projects = await readdir(root);
    } catch {
      continue;
    }
    for (const project of projects) {
      if (!project.includes(slug(options.project))) continue;
      const directory = join(root, project);
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl"))
          found.push(join(directory, entry.name));
        if (entry.isDirectory()) {
          const subagents = join(directory, entry.name, "subagents");
          const files = await readdir(subagents).catch(() => [] as string[]);
          for (const file of files)
            if (file.endsWith(".jsonl")) found.push(join(subagents, file));
        }
      }
    }
  }
  const recent: string[] = [];
  for (const file of found) {
    const matches =
      options.sessions.length === 0 ||
      options.sessions.some((session) => file.includes(session));
    if (matches && (await stat(file)).mtimeMs >= options.since)
      recent.push(file);
  }
  return recent;
}

async function opencodeProfiles(options: Options): Promise<SessionProfile[]> {
  if (!options.opencodeDb) return [];
  try {
    await stat(options.opencodeDb);
  } catch {
    return [];
  }
  const { Database } = await import("bun:sqlite");
  const db = new Database(options.opencodeDb, { readonly: true });
  try {
    const sessions = db
      .query(
        "select id, directory, title from session_v2 where directory like ? and time_updated >= ?",
      )
      .all(`%${options.project}%`, options.since) as {
      id: string;
      directory: string;
      title: string;
    }[];
    const profiles: SessionProfile[] = [];
    for (const session of sessions) {
      if (
        options.sessions.length > 0 &&
        !options.sessions.some((prefix) => session.id.includes(prefix))
      )
        continue;
      const messages = db
        .query(
          "select type, cast(data as text) as data from session_message where session_id = ? order by seq",
        )
        .all(session.id) as OpencodeMessage[];
      const profile = profileOpencodeSession(
        messages,
        `${options.opencodeDb}#${session.id}`,
        `O ${session.id.slice(4, 12)}`,
        session.title,
      );
      if (profile) profiles.push(profile);
    }
    return profiles;
  } finally {
    db.close();
  }
}

function labelFor(file: string): string {
  const profile = file.includes(".claude-personal") ? "P" : "M";
  const name = basename(file, ".jsonl");
  if (dirname(file).endsWith("subagents"))
    return `${profile} ${basename(dirname(dirname(file))).slice(0, 8)}/${name.replace("agent-", "").slice(0, 8)}`;
  return `${profile} ${name.slice(0, 8)}`;
}

const k = (tokens: number) =>
  tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`;
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((100 * part) / whole)}%` : "-";

export interface WaveSummary {
  label: string;
  date: string;
  project: string;
  since: string;
  sessions: number;
  claudeUsd: number;
  reportedUsd: number;
  claudeCalls: number;
  haikuCalls: number;
  haikuCallsOver100k: number;
  fileReadShare: number;
  subscriptionTokens: number;
  remindDenials: number;
}

export function summarizeWave(
  profiles: SessionProfile[],
  label: string,
  project: string,
  since: number,
  now = Date.now(),
): WaveSummary {
  const bytes: Partial<Record<Category, number>> = {};
  for (const profile of profiles)
    for (const [category, value] of Object.entries(profile.resultBytes))
      bytes[category as Category] =
        (bytes[category as Category] ?? 0) + (value ?? 0);
  const allBytes = Object.values(bytes).reduce((a, b) => a + (b ?? 0), 0);
  const claude = profiles.filter((profile) => profile.source === "claude");
  const opencode = profiles.filter((profile) => profile.source === "opencode");
  const haiku = claude.filter((profile) => /haiku/i.test(profile.model));
  return {
    label,
    date: new Date(now).toISOString(),
    project,
    since: new Date(since).toISOString(),
    sessions: profiles.length,
    claudeUsd: claude.reduce((total, profile) => total + profile.costUsd, 0),
    reportedUsd: opencode.reduce((total, profile) => total + profile.costUsd, 0),
    claudeCalls: claude.reduce((total, profile) => total + profile.calls, 0),
    haikuCalls: haiku.reduce((total, profile) => total + profile.calls, 0),
    haikuCallsOver100k: haiku.reduce(
      (total, profile) => total + profile.callsOver100k,
      0,
    ),
    fileReadShare: allBytes
      ? ((bytes["read:file"] ?? 0) + (bytes["bash:read"] ?? 0)) / allBytes
      : 0,
    subscriptionTokens: opencode.reduce(
      (total, profile) =>
        total +
        profile.input +
        profile.cacheRead +
        profile.cacheWrite +
        profile.output,
      0,
    ),
    remindDenials: profiles.reduce(
      (total, profile) => total + profile.remindDenials,
      0,
    ),
  };
}

export function report(profiles: SessionProfile[]): string {
  const lines: string[] = [];
  const totals: Partial<Record<Category, number>> = {};
  let cost = 0;
  let denials = 0;
  for (const profile of [...profiles].sort((a, b) => b.costUsd - a.costUsd)) {
    cost += profile.costUsd;
    denials += profile.remindDenials;
    const bytes = Object.values(profile.resultBytes).reduce(
      (a, b) => a + (b ?? 0),
      0,
    );
    for (const [category, value] of Object.entries(profile.resultBytes))
      totals[category as Category] =
        (totals[category as Category] ?? 0) + (value ?? 0);
    const mix = Object.entries(profile.resultBytes)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 5)
      .map(([category, value]) => `${category} ${percent(value ?? 0, bytes)}`)
      .join(", ");
    lines.push(
      `${profile.label}  ${profile.model.replace("claude-", "")}  $${profile.costUsd.toFixed(2)}  calls=${profile.calls}  ctx ${k(profile.contextMin)}/${k(profile.contextAvg)}/${k(profile.contextMax)}  >100k=${percent(profile.callsOver100k, profile.calls)}  cacheRead=${(profile.cacheRead / 1e6).toFixed(1)}M  remind=${profile.remindDenials}`,
      `   results ${Math.round(bytes / 1000)}KB: ${mix || "none"}`,
      `   first: ${profile.firstPrompt}`,
    );
  }
  const allBytes = Object.values(totals).reduce((a, b) => a + (b ?? 0), 0);
  const fileReads = (totals["read:file"] ?? 0) + (totals["bash:read"] ?? 0);
  lines.push(
    "",
    `TOTAL ${profiles.length} sessions  $${cost.toFixed(2)} (Claude: API-equivalent estimate; OpenCode: as reported)  remind denials=${denials}`,
    `   whole-file and shell reads ${percent(fileReads, allBytes)} of tool-result bytes; serena ${percent(totals.serena ?? 0, allBytes)}; ccc ${percent(totals.ccc ?? 0, allBytes)}; context-mode ${percent(totals["context-mode"] ?? 0, allBytes)}; preview ${percent(totals.preview ?? 0, allBytes)}`,
  );
  return lines.join("\n");
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const SEGMENTS: { key: keyof CostBreakdown; name: string }[] = [
  { key: "cacheRead", name: "Cache read" },
  { key: "cacheWrite", name: "Cache write" },
  { key: "output", name: "Output" },
  { key: "input", name: "Input" },
];

// One self-contained page: stat tiles, cost per session as stacked bars (by cost
// component), the wave trend from history, and a table view. Series colors are the
// dataviz reference palette slots 1–4, validated in light and dark (03/11/2026);
// text and lines use the host's theme variables.
export function renderHtml(
  profiles: SessionProfile[],
  wave: WaveSummary,
  history: WaveSummary[] = [],
): string {
  const sorted = [...profiles].sort((a, b) => b.costUsd - a.costUsd);
  const billed = sorted.filter((profile) => profile.source === "claude");
  const max = Math.max(0.01, ...billed.map((profile) => profile.costUsd));
  const width = 700;
  const labelWidth = 210;
  const valueWidth = 64;
  const plot = width - labelWidth - valueWidth;
  const row = 26;
  const bars = billed
    .map((profile, index) => {
      let x = labelWidth;
      const y = index * row;
      const segments = SEGMENTS.map((segment, slot) => {
        const value = profile.cost[segment.key];
        const w = (value / max) * plot;
        const rect =
          w < 0.5
            ? ""
            : `<rect class="seg s${slot + 1}" x="${x.toFixed(1)}" y="${y + 5}" width="${Math.max(0, w - 2).toFixed(1)}" height="16" rx="2" data-tip="${escapeHtml(`${profile.label} · ${segment.name}: $${value.toFixed(2)}`)}"/>`;
        x += w;
        return rect;
      }).join("");
      return `<text class="lbl" x="${labelWidth - 8}" y="${y + 17}" text-anchor="end">${escapeHtml(`${profile.label} · ${profile.model.replace("claude-", "").replace(/-\d.*$/, "")}`)}</text>${segments}<text class="val" x="${(x + 6).toFixed(1)}" y="${y + 17}">$${profile.costUsd.toFixed(2)}</text>`;
    })
    .join("");
  const barsHeight = Math.max(row, billed.length * row);
  const waves = [...history.filter((item) => item.label !== wave.label), wave];
  const trendMax = Math.max(0.01, ...waves.map((item) => item.claudeUsd));
  const trendBar = 44;
  const trend =
    waves.length < 2
      ? `<p class="note">The trend appears once a second wave is recorded with <code>--history</code>.</p>`
      : `<svg viewBox="0 0 ${width} 150" role="img" aria-label="Claude cost per wave">${waves
          .map((item, index) => {
            const h = (item.claudeUsd / trendMax) * 100;
            const x = 20 + index * (trendBar + 16);
            return `<rect class="seg s1" x="${x}" y="${120 - h}" width="${trendBar}" height="${h}" rx="4" data-tip="${escapeHtml(`${item.label}: $${item.claudeUsd.toFixed(2)}, ${percent(item.haikuCallsOver100k, item.haikuCalls)} Haiku calls >100k, reads ${Math.round(item.fileReadShare * 100)}%`)}"/><text class="lbl" x="${x + trendBar / 2}" y="136" text-anchor="middle">${escapeHtml(item.label)}</text><text class="val" x="${x + trendBar / 2}" y="${114 - h}" text-anchor="middle">$${item.claudeUsd.toFixed(0)}</text>`;
          })
          .join("")}<line class="axis" x1="12" x2="${width - 12}" y1="120" y2="120"/></svg>`;
  const tableRows = sorted
    .map(
      (profile) =>
        `<tr><td>${escapeHtml(profile.label)}</td><td>${escapeHtml(profile.model)}</td><td>${profile.calls}</td><td>${k(profile.contextAvg)}</td><td>${percent(profile.callsOver100k, profile.calls)}</td><td>${profile.source === "opencode" ? `$${profile.costUsd.toFixed(2)} (reported)` : `$${profile.costUsd.toFixed(2)}`}</td><td>${k(profile.input + profile.cacheRead + profile.cacheWrite + profile.output)}</td><td>${profile.remindDenials}</td></tr>`,
    )
    .join("");
  const tile = (value: string, caption: string) =>
    `<div class="tile"><div class="big">${value}</div><div class="cap">${caption}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100}
@media (prefers-color-scheme: dark){:root{--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500}}
body{font-family:var(--font-sans,system-ui);color:var(--foreground,#0b0b0b);margin:0}
h2{font-size:15px;margin:18px 0 6px}
.tiles{display:flex;gap:12px;flex-wrap:wrap}
.tile{flex:1 1 140px;padding:10px 0}
.big{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums}
.cap,.note,.lbl,.legend{color:var(--muted-foreground,#52514e);font-size:12px}
.val{fill:var(--foreground,#0b0b0b);font-size:12px;font-variant-numeric:tabular-nums}
.lbl{fill:var(--muted-foreground,#52514e)}
.axis{stroke:var(--border,#ddd)}
.s1{fill:var(--s1)}.s2{fill:var(--s2)}.s3{fill:var(--s3)}.s4{fill:var(--s4)}
.seg:hover{opacity:.8}
.legend{display:flex;gap:14px;margin:4px 0 8px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
svg{width:100%;height:auto;display:block}
#tip{position:fixed;pointer-events:none;background:var(--popover,#fff);color:var(--popover-foreground,#0b0b0b);border:1px solid var(--border,#ddd);border-radius:var(--radius,6px);padding:4px 8px;font-size:12px;display:none}
table{border-collapse:collapse;font-size:12px;width:100%;font-variant-numeric:tabular-nums}
td,th{text-align:left;padding:3px 6px;border-bottom:1px solid var(--border,#ddd)}
</style></head><body>
<div class="tiles">
${tile(`$${wave.claudeUsd.toFixed(2)}`, "Claude, API-equivalent estimate")}
${tile(k(wave.subscriptionTokens), "OpenCode tokens (subscription)")}
${tile(percent(wave.haikuCallsOver100k, wave.haikuCalls), "Haiku calls above 100k (target under 5%)")}
${tile(`${Math.round(wave.fileReadShare * 100)}%`, "tool output from whole-file and shell reads")}
</div>
<h2>Cost per Claude session · ${escapeHtml(wave.label)}</h2>
<div class="legend">${SEGMENTS.map((segment, slot) => `<span><i class="s${slot + 1}" style="background:var(--s${slot + 1})"></i>${segment.name}</span>`).join("")}</div>
<svg viewBox="0 0 ${width} ${barsHeight}" role="img" aria-label="Cost per session by cost component">${bars}</svg>
<h2>Claude cost per wave</h2>
${trend}
<details><summary class="cap">Table view (all sessions)</summary><table><thead><tr><th>Session</th><th>Model</th><th>Calls</th><th>Avg context</th><th>&gt;100k</th><th>Cost</th><th>Tokens</th><th>Remind</th></tr></thead><tbody>${tableRows}</tbody></table></details>
<div id="tip"></div>
<script>
const tip=document.getElementById('tip');
document.querySelectorAll('[data-tip]').forEach(el=>{
  el.addEventListener('mousemove',e=>{tip.textContent=el.dataset.tip;tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px'});
  el.addEventListener('mouseleave',()=>{tip.style.display='none'});
});
</script></body></html>`;
}

const HISTORY_FILE = join(import.meta.dir, "..", "waves", "waves.json");

async function readHistory(): Promise<WaveSummary[]> {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8")) as WaveSummary[];
  } catch {
    return [];
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const profiles: SessionProfile[] = [];
  for (const file of await transcripts(options)) {
    const profile = profileTranscript(
      await readFile(file, "utf8"),
      file,
      labelFor(file),
    );
    if (profile && profile.calls >= options.minCalls) profiles.push(profile);
  }
  for (const profile of await opencodeProfiles(options))
    if (profile.calls >= options.minCalls) profiles.push(profile);

  const label = options.history ?? options.project;
  const wave = summarizeWave(profiles, label, options.project, options.since);
  let history = await readHistory();
  if (options.history) {
    history = [...history.filter((item) => item.label !== label), wave];
    await mkdir(dirname(HISTORY_FILE), { recursive: true });
    await writeFile(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`);
  }
  if (options.html) {
    await writeFile(options.html, renderHtml(profiles, wave, history));
    console.error(`Chart written to ${options.html}`);
  }
  console.log(
    options.json
      ? JSON.stringify({ wave, profiles }, null, 2)
      : report(profiles),
  );
}

if (import.meta.main) await main();
