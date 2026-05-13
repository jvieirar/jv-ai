#!/usr/bin/env bun
/**
 * sync-mcp — propagate ./mcp/servers.json into every harness's native MCP config.
 *
 * Defaults:
 *   - additive: never removes servers we didn't add
 *   - skip + warn on conflict (same name, different config)
 *   - idempotent: same canonical → same target → no writes
 *   - ${VAR} / ${VAR:-default} expansion using real env + ./mcp/.env
 *   - pre-flight: stdio commands with absolute paths must exist on disk
 *
 * Flags:
 *   --dry-run            don't write, just report
 *   --force              on conflict, canonical overwrites the target entry
 *   --target <name>      only sync this target (repeatable)
 *   --server <name>      only sync this server (repeatable)
 *   --include-disabled   include targets with `"enabled": false`
 *   -h, --help           print this help
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

type ServerConfig = Record<string, unknown>;
type Servers = Record<string, ServerConfig>;

interface Target {
  name: string;
  path: string;
  kind: "json-root" | "json-nested" | "toml-root";
  jsonPath?: string;
  createIfMissing?: boolean;
  enabled?: boolean;
  note?: string;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const SERVERS_FILE = resolve(REPO_ROOT, "mcp/servers.json");
const TARGETS_FILE = resolve(REPO_ROOT, "mcp/targets.json");
const ENV_FILE = resolve(REPO_ROOT, "mcp/.env");

// ----- Env loading + ${VAR} expansion -----------------------------------

function loadEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const [, k, raw] = m;
    if (!k || raw === undefined) continue;
    const stripped = raw.replace(/^"(.*)"$|^'(.*)'$/, "$1$2");
    env[k] = stripped;
  }
  return env;
}

// Real env wins over mcp/.env (so `JV_FOO=x bun run sync-mcp` works).
const ENV_VARS: Record<string, string> = {
  ...loadEnvFile(ENV_FILE),
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >,
};

// Expand bash-style ${VAR} and ${VAR:-default}.
// Innermost-first: only matches ${...} that contains no further ${...}.
// Iterates until stable (handles nested defaults like ${A:-${B:-fallback}}).
function expandVars(input: string): string {
  const inner = /\$\{([^${}]+)\}/;
  let prev: string;
  let cur = input;
  let iterations = 0;
  do {
    prev = cur;
    cur = cur.replace(inner, (_, expr: string) => {
      const idx = expr.indexOf(":-");
      const name = idx >= 0 ? expr.slice(0, idx) : expr;
      const fallback = idx >= 0 ? expr.slice(idx + 2) : "";
      const val = ENV_VARS[name];
      return val !== undefined && val !== "" ? val : fallback;
    });
    if (++iterations > 32) break; // safety
  } while (cur !== prev);
  return cur;
}

function expandServers(servers: Servers): Servers {
  const out: Servers = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const expanded: ServerConfig = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === "string") expanded[k] = expandVars(v);
      else if (Array.isArray(v))
        expanded[k] = v.map((x) => (typeof x === "string" ? expandVars(x) : x));
      else if (v && typeof v === "object") {
        const obj: Record<string, unknown> = {};
        for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
          obj[kk] = typeof vv === "string" ? expandVars(vv) : vv;
        }
        expanded[k] = obj;
      } else expanded[k] = v;
    }
    out[name] = expanded;
  }
  return out;
}

// ----- CLI parsing -------------------------------------------------------

interface Args {
  dryRun: boolean;
  force: boolean;
  targets: string[];
  servers: string[];
  includeDisabled: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, force: false, targets: [], servers: [], includeDisabled: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "-h" || x === "--help") {
      printHelp();
      process.exit(0);
    } else if (x === "--dry-run") a.dryRun = true;
    else if (x === "--force") a.force = true;
    else if (x === "--include-disabled") a.includeDisabled = true;
    else if (x === "--target") a.targets.push(argv[++i]!);
    else if (x === "--server") a.servers.push(argv[++i]!);
    else {
      console.error(`unknown flag: ${x}`);
      printHelp();
      process.exit(2);
    }
  }
  return a;
}

function printHelp(): void {
  const lines = (readFileSync(import.meta.path, "utf8").split("\n").slice(1, 22) as string[])
    .map((l) => l.replace(/^ \* ?/, ""))
    .filter((l) => l !== "/**" && l !== " */")
    .join("\n");
  console.log(lines);
}

// ----- IO helpers --------------------------------------------------------

function expand(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJsonPreserving(file: string, value: unknown): void {
  let indent: string | number = 2;
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    const m = raw.match(/^(\s+)"/m);
    if (m && m[1]) indent = m[1].includes("\t") ? "\t" : m[1].length;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, indent) + "\n");
}

// ----- Normalization for diff -------------------------------------------

function normalize(s: ServerConfig): ServerConfig {
  const out: ServerConfig = {};
  for (const [k, v] of Object.entries(s)) {
    // drop fields that don't affect runtime behavior
    if (k === "type" && v === "stdio") continue;
    if (k === "args" && Array.isArray(v) && v.length === 0) continue;
    if (k === "env" && v && typeof v === "object" && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ----- Core merge --------------------------------------------------------

type Action =
  | "added"
  | "unchanged"
  | "conflict-skipped"
  | "conflict-forced"
  | "filtered"
  | "missing-command";
interface ServerResult {
  server: string;
  action: Action;
  detail?: string;
}

// Pre-flight: for stdio entries, verify the command file exists.
// Returns a result if the command is missing, null if OK or N/A.
function preflightMissing(name: string, cfg: ServerConfig): ServerResult | null {
  const cmd = cfg.command;
  if (typeof cmd !== "string") return null; // HTTP/URL servers etc.
  if (cmd.startsWith("/") || cmd.startsWith("./") || cmd.startsWith("../")) {
    if (!existsSync(cmd)) {
      return {
        server: name,
        action: "missing-command",
        detail: `command file not found: ${cmd}`,
      };
    }
  }
  // bare command (e.g. "npx", "bun") — leave for the runtime to resolve.
  return null;
}

function mergeServers(
  canonical: Servers,
  existing: Servers,
  args: Args
): { merged: Servers; results: ServerResult[] } {
  const merged: Servers = { ...existing };
  const results: ServerResult[] = [];

  for (const [name, cfg] of Object.entries(canonical)) {
    if (args.servers.length && !args.servers.includes(name)) {
      results.push({ server: name, action: "filtered" });
      continue;
    }
    const missing = preflightMissing(name, cfg);
    if (missing) {
      results.push(missing);
      continue;
    }
    if (!(name in existing)) {
      merged[name] = cfg;
      results.push({ server: name, action: "added" });
      continue;
    }
    if (deepEqual(normalize(existing[name]!), normalize(cfg))) {
      results.push({ server: name, action: "unchanged" });
      continue;
    }
    if (args.force) {
      merged[name] = cfg;
      results.push({
        server: name,
        action: "conflict-forced",
        detail: "canonical overwrote existing entry",
      });
    } else {
      results.push({
        server: name,
        action: "conflict-skipped",
        detail: "existing config differs — kept as-is (use --force to overwrite)",
      });
    }
  }
  return { merged, results };
}

// ----- Per-target sync ---------------------------------------------------

interface TargetSummary {
  target: string;
  path: string;
  status: "ok" | "skipped-missing" | "skipped-unsupported" | "error";
  wrote: boolean;
  results: ServerResult[];
  error?: string;
}

function syncTarget(target: Target, canonical: Servers, args: Args): TargetSummary {
  const path = expand(target.path);
  const summary: TargetSummary = {
    target: target.name,
    path,
    status: "ok",
    wrote: false,
    results: [],
  };

  if (target.kind === "toml-root") {
    summary.status = "skipped-unsupported";
    summary.error = "TOML targets not yet implemented";
    return summary;
  }

  let fileObj: Record<string, unknown>;
  let existingServers: Servers;

  if (!existsSync(path)) {
    if (!target.createIfMissing) {
      summary.status = "skipped-missing";
      summary.error = `file does not exist and createIfMissing is false`;
      return summary;
    }
    fileObj = target.kind === "json-nested" ? { [target.jsonPath!]: {} } : { mcpServers: {} };
    existingServers = {};
  } else {
    try {
      fileObj = readJson<Record<string, unknown>>(path);
    } catch (e) {
      summary.status = "error";
      summary.error = `failed to parse JSON: ${(e as Error).message}`;
      return summary;
    }
    if (target.kind === "json-nested") {
      const key = target.jsonPath!;
      existingServers = (fileObj[key] as Servers | undefined) ?? {};
      fileObj[key] = existingServers;
    } else {
      existingServers = (fileObj.mcpServers as Servers | undefined) ?? {};
      fileObj.mcpServers = existingServers;
    }
  }

  const { merged, results } = mergeServers(canonical, existingServers, args);
  summary.results = results;

  const changed = results.some((r) => r.action === "added" || r.action === "conflict-forced");
  if (!changed) return summary;

  if (target.kind === "json-nested") fileObj[target.jsonPath!] = merged;
  else fileObj.mcpServers = merged;

  if (!args.dryRun) {
    writeJsonPreserving(path, fileObj);
    summary.wrote = true;
  }
  return summary;
}

// ----- Reporting ---------------------------------------------------------

function colorize(s: string, code: number): string {
  return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}
const C = {
  green: (s: string) => colorize(s, 32),
  yellow: (s: string) => colorize(s, 33),
  red: (s: string) => colorize(s, 31),
  dim: (s: string) => colorize(s, 90),
  bold: (s: string) => colorize(s, 1),
};

function report(summaries: TargetSummary[], args: Args): void {
  let exit = 0;
  for (const s of summaries) {
    console.log(C.bold(`\n[${s.target}] ${s.path}`));
    if (s.status === "skipped-missing") {
      console.log(`  ${C.dim("skipped:")} ${s.error}`);
      continue;
    }
    if (s.status === "skipped-unsupported") {
      console.log(`  ${C.yellow("skipped:")} ${s.error}`);
      continue;
    }
    if (s.status === "error") {
      console.log(`  ${C.red("error:")} ${s.error}`);
      exit = 1;
      continue;
    }
    for (const r of s.results) {
      if (r.action === "added") console.log(`  ${C.green("+ added     ")} ${r.server}`);
      else if (r.action === "unchanged") console.log(`  ${C.dim("= unchanged ")} ${r.server}`);
      else if (r.action === "filtered") console.log(`  ${C.dim("· filtered  ")} ${r.server}`);
      else if (r.action === "conflict-forced")
        console.log(`  ${C.yellow("! overwrote ")} ${r.server} ${C.dim(`(${r.detail})`)}`);
      else if (r.action === "conflict-skipped") {
        console.log(`  ${C.yellow("! conflict  ")} ${r.server} ${C.dim(`(${r.detail})`)}`);
        exit = exit || 0; // warning, not failure
      } else if (r.action === "missing-command") {
        console.log(`  ${C.red("! missing   ")} ${r.server} ${C.dim(`(${r.detail})`)}`);
        exit = 1;
      }
    }
    if (s.wrote) console.log(`  ${C.green("wrote")} ${s.path}`);
    else if (args.dryRun && s.results.some((r) => r.action === "added"))
      console.log(`  ${C.yellow("dry-run:")} would write changes`);
    else console.log(`  ${C.dim("no changes")}`);
  }
  process.exit(exit);
}

// ----- main --------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const canonical = expandServers(
  readJson<{ mcpServers: Servers }>(SERVERS_FILE).mcpServers ?? {}
);
const targets = readJson<{ targets: Target[] }>(TARGETS_FILE).targets;

const selected = targets.filter((t) => {
  if (!args.includeDisabled && t.enabled === false) return false;
  if (args.targets.length && !args.targets.includes(t.name)) return false;
  return true;
});

if (selected.length === 0) {
  console.log("no targets selected");
  process.exit(0);
}

console.log(
  C.bold(`sync-mcp`),
  C.dim(
    `(${args.dryRun ? "dry-run, " : ""}${args.force ? "force, " : ""}canonical=${Object.keys(canonical).length} servers, targets=${selected.length})`
  )
);

const summaries = selected.map((t) => syncTarget(t, canonical, args));
report(summaries, args);
