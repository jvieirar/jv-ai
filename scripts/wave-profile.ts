// Profile Claude Code sessions by per-call context, estimated cost and tool mix.
//
// Cost is calls × context per call, so totals hide the problem: this reads every
// assistant call from the transcripts, groups tool-result bytes by source (whole-file
// reads, Serena, ccc, Context Mode, previews…), and counts how often Serena's
// `remind` hook denied a call. Built from the 02/11/2026 jv-bee wave-1 analysis.
//
//   bun run wave-profile --hours 24
//   bun run wave-profile --since 2026-11-03T00:00Z --project cantaryjugar --json
//   bun run wave-profile --session bbbe56db --session 3f2a
import { readdir, readFile, stat } from "node:fs/promises";
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

export interface SessionProfile {
  file: string;
  label: string;
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
  toolCalls: Record<string, number>;
  resultBytes: Partial<Record<Category, number>>;
  remindDenials: number;
  firstPrompt: string;
}

// API-equivalent USD per million tokens, as researched on 02/11/2026. Cache writes are
// assumed at 1.25× input (5-minute TTL). Haiku 5.5 switches tier per call above 100k.
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

export function categorize(name: string, input: unknown): Category {
  if (name === "Read") return "read:file";
  if (name === "Grep" || name === "Glob") return "search";
  if (name.startsWith("mcp__serena__")) return "serena";
  if (/cocoindex/i.test(name)) return "ccc";
  if (/context-mode|ctx_/i.test(name)) return "context-mode";
  if (/preview_|device_screenshot/.test(name)) return "preview";
  if (/notion/i.test(name)) return "notion";
  if (name === "Bash") {
    const command = String(
      (input as { command?: string } | null)?.command ?? "",
    ).toLowerCase();
    if (TEST_WORDS.some((word) => command.includes(word)))
      return "bash:test/check";
    if (READ_PATTERN.test(` ${command}`)) return "bash:read";
    return "bash:other";
  }
  return "other";
}

// Serena's remind hook denies the call with an error result such as
// "PreToolUse:Bash hook error: Too many consecutive grep calls without using symbolic tools…".
const REMIND_DENIAL = /PreToolUse:\w+ hook error: Too many consecutive/;

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

function size(content: unknown): number {
  return typeof content === "string"
    ? content.length
    : JSON.stringify(content ?? "").length;
}

export function profileTranscript(
  text: string,
  file = "",
  label = basename(file),
): SessionProfile | null {
  const usageById = new Map<
    string,
    {
      input: number;
      cacheWrite: number;
      cacheRead: number;
      output: number;
      model: string;
    }
  >();
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
      const content = message.content;
      const textBlock = blocks.find((block) => block.type === "text") as
        | { text?: string }
        | undefined;
      const prompt =
        typeof content === "string" ? content : (textBlock?.text ?? "");
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
      usageById.set(message.id, {
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

  const calls = [...usageById.values()];
  if (calls.length === 0) return null;
  const contexts = calls.map(
    (call) => call.input + call.cacheWrite + call.cacheRead,
  );
  let costUsd = 0;
  for (const [index, call] of calls.entries()) {
    const price = priceFor(call.model, contexts[index]);
    costUsd +=
      (call.input * price.input +
        call.cacheWrite * price.input * CACHE_WRITE_FACTOR +
        call.cacheRead * price.cacheRead +
        call.output * price.output) /
      1e6;
  }
  const sum = (key: "input" | "cacheWrite" | "cacheRead" | "output") =>
    calls.reduce((total, call) => total + call[key], 0);
  return {
    file,
    label,
    model,
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
    costUsd,
    toolCalls,
    resultBytes,
    remindDenials,
    firstPrompt,
  };
}

interface Options {
  since: number;
  project: string;
  sessions: string[];
  minCalls: number;
  json: boolean;
  roots: string[];
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
    else if (flag === "--json") options.json = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

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
      if (!project.includes(options.project)) continue;
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

function labelFor(file: string): string {
  const profile = file.includes(".claude-personal") ? "P" : "M";
  const name = basename(file, ".jsonl");
  if (dirname(file).endsWith("subagents"))
    return `${profile} ${basename(dirname(dirname(file))).slice(0, 8)}/${name.replace("agent-", "").slice(0, 8)}`;
  return `${profile} ${name.slice(0, 8)}`;
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;
const percent = (part: number, whole: number) =>
  whole ? `${Math.round((100 * part) / whole)}%` : "-";

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
    `TOTAL ${profiles.length} sessions  $${cost.toFixed(2)} (API-equivalent estimate)  remind denials=${denials}`,
    `   whole-file and shell reads ${percent(fileReads, allBytes)} of tool-result bytes; serena ${percent(totals.serena ?? 0, allBytes)}; ccc ${percent(totals.ccc ?? 0, allBytes)}; context-mode ${percent(totals["context-mode"] ?? 0, allBytes)}; preview ${percent(totals.preview ?? 0, allBytes)}`,
  );
  return lines.join("\n");
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
  console.log(
    options.json ? JSON.stringify(profiles, null, 2) : report(profiles),
  );
}

if (import.meta.main) await main();
