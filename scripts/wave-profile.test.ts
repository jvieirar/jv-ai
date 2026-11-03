import { expect, test } from "bun:test";
import {
  categorize,
  categorizeOpencode,
  parseArgs,
  priceFor,
  profileOpencodeSession,
  profileTranscript,
  renderHtml,
  report,
  summarizeWave,
} from "./wave-profile";

function assistant(
  id: string,
  usage: Record<string, number>,
  content: unknown[] = [],
  model = "claude-haiku-5-5",
) {
  return JSON.stringify({
    type: "assistant",
    message: { id, model, usage, content },
  });
}
function user(content: unknown) {
  return JSON.stringify({ type: "user", message: { content } });
}

const transcript = [
  user("Implement slice A"),
  assistant(
    "m1",
    { input_tokens: 10, cache_creation_input_tokens: 50_000, output_tokens: 100 },
    [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } }],
  ),
  // Claude Code writes one line per content block with the same message id.
  assistant(
    "m1",
    { input_tokens: 10, cache_creation_input_tokens: 50_000, output_tokens: 100 },
    [{ type: "text", text: "reading" }],
  ),
  user([{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(3000) }]),
  assistant(
    "m2",
    { input_tokens: 5, cache_read_input_tokens: 120_000, output_tokens: 50 },
    [
      {
        type: "tool_use",
        id: "t2",
        name: "mcp__serena__serena_repl",
        input: { code: "s.lsp.find_symbol('touch')" },
      },
      { type: "tool_use", id: "t3", name: "Bash", input: { command: "rg -n touch packages" } },
    ],
  ),
  user([
    { type: "tool_result", tool_use_id: "t2", content: "y".repeat(1000) },
    {
      type: "tool_result",
      tool_use_id: "t3",
      is_error: true,
      content:
        "PreToolUse:Bash hook error: Too many consecutive grep calls without using symbolic tools. You can continue using grep now if needed, the counter was reset.",
    },
  ]),
  assistant("s1", { input_tokens: 0, output_tokens: 0 }, [], "<synthetic>"),
  "not json",
].join("\n");

test("dedupes calls by message id and measures context per call", () => {
  const profile = profileTranscript(transcript, "/x/s.jsonl", "s")!;
  expect(profile.calls).toBe(2);
  expect(profile.contextMin).toBe(50_010);
  expect(profile.contextMax).toBe(120_005);
  expect(profile.callsOver100k).toBe(1);
  expect(profile.toolCalls).toEqual({
    Read: 1,
    mcp__serena__serena_repl: 1,
    Bash: 1,
  });
  expect(profile.firstPrompt).toBe("Implement slice A");
});

test("groups tool-result bytes by source and counts remind denials", () => {
  const profile = profileTranscript(transcript)!;
  expect(profile.resultBytes["read:file"]).toBe(3000);
  expect(profile.resultBytes.serena).toBe(1000);
  expect(profile.resultBytes["bash:read"]).toBeGreaterThan(100);
  expect(profile.remindDenials).toBe(1);
});

test("prices Haiku per call by context tier", () => {
  const profile = profileTranscript(transcript)!;
  // m1: 10×0.10 + 50 000×0.10×1.25 + 100×0.50; m2: 5×0.50 + 120 000×0.05 + 50×2.50 (per million)
  const expected =
    (10 * 0.1 + 50_000 * 0.1 * 1.25 + 100 * 0.5) / 1e6 +
    (5 * 0.5 + 120_000 * 0.05 + 50 * 2.5) / 1e6;
  expect(profile.costUsd).toBeCloseTo(expected, 10);
  expect(priceFor("claude-opus-5-5", 10).cacheRead).toBe(0.2);
  expect(priceFor("claude-sonnet-5-5", 500_000).input).toBe(2);
});

test("categorizes shell commands and MCP tools", () => {
  expect(categorize("Bash", { command: "pnpm exec vp test run" })).toBe(
    "bash:test/check",
  );
  expect(categorize("Bash", { command: "sed -n 1,80p a.ts" })).toBe("bash:read");
  expect(categorize("Bash", { command: "git commit -m x" })).toBe("bash:other");
  expect(categorize("mcp__plugin_cocoindex-code_cocoindex-code__search", {})).toBe(
    "ccc",
  );
  expect(
    categorize("mcp__plugin_context-mode_context-mode__ctx_execute", {}),
  ).toBe("context-mode");
  expect(categorize("mcp__t3-code__preview_snapshot", {})).toBe("preview");
  expect(categorize("Grep", {})).toBe("search");
});

test("returns null for transcripts without assistant calls", () => {
  expect(profileTranscript(user("hi"))).toBeNull();
});

test("parses options and rejects unknown flags", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const options = parseArgs(
    ["--hours", "2", "--project", "jv-ai", "--session", "ab12", "--json"],
    now,
  );
  expect(options.since).toBe(now - 2 * 3_600_000);
  expect(options.project).toBe("jv-ai");
  expect(options.sessions).toEqual(["ab12"]);
  expect(options.json).toBe(true);
  expect(parseArgs(["--since", "2026-11-01T00:00Z"]).since).toBe(
    Date.parse("2026-11-01T00:00Z"),
  );
  expect(() => parseArgs(["--nope"])).toThrow("Unknown option");
  expect(() => parseArgs(["--hours"])).toThrow("needs a value");
});

test("report shows totals and the whole-file read share", () => {
  const text = report([profileTranscript(transcript, "/x/s.jsonl", "s")!]);
  expect(text).toContain("TOTAL 1 sessions");
  expect(text).toContain("remind denials=1");
  expect(text).toMatch(/whole-file and shell reads \d+%/);
});

const opencodeMessages = [
  { type: "user", data: JSON.stringify({ content: [{ type: "text", text: "go" }] }) },
  {
    type: "assistant",
    data: JSON.stringify({
      model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" },
      cost: 0,
      tokens: { input: 9_000, output: 60, reasoning: 600, cache: { read: 48_000, write: 0 } },
      content: [
        {
          type: "tool",
          name: "execute",
          state: {
            input: { code: "await tools.serena.serena_repl({code: 's.lsp.find_symbol(1)'})" },
            content: [{ type: "text", text: "z".repeat(500) }],
          },
        },
        {
          type: "tool",
          name: "read",
          state: { input: { filePath: "/a.ts" }, content: "w".repeat(2000) },
        },
      ],
    }),
  },
  { type: "assistant", data: "{broken" },
];

test("profiles OpenCode sessions with their reported cost and tool mix", () => {
  const profile = profileOpencodeSession(opencodeMessages, "db#s", "O s", "Slice B")!;
  expect(profile.source).toBe("opencode");
  expect(profile.model).toBe("deepseek-v4.1-flash");
  expect(profile.calls).toBe(1);
  expect(profile.contextMax).toBe(57_000);
  expect(profile.output).toBe(660);
  expect(profile.costUsd).toBe(0);
  expect(profile.resultBytes.serena).toBeGreaterThan(500);
  expect(profile.resultBytes["read:file"]).toBe(2000);
  expect(profile.firstPrompt).toBe("Slice B");
  expect(categorizeOpencode("bash", { command: "pnpm test" })).toBe("bash:test/check");
  expect(categorizeOpencode("grep", {})).toBe("search");
});

test("summarizes a wave and renders a self-contained chart", () => {
  const claude = profileTranscript(transcript, "/x/s.jsonl", "P s")!;
  const opencode = profileOpencodeSession(opencodeMessages, "db#s", "O s")!;
  const wave = summarizeWave([claude, opencode], "CA-1", "proj", 0, 0);
  expect(wave.haikuCalls).toBe(2);
  expect(wave.haikuCallsOver100k).toBe(1);
  expect(wave.claudeUsd).toBeCloseTo(claude.costUsd, 10);
  expect(wave.subscriptionTokens).toBe(57_660);
  expect(wave.fileReadShare).toBeGreaterThan(0);
  const html = renderHtml([claude, opencode], wave, []);
  expect(html).toContain("<svg");
  expect(html).toContain("Table view");
  expect(html).toContain("second wave");
  const withHistory = renderHtml([claude], wave, [{ ...wave, label: "CA-0" }]);
  expect(withHistory).toContain("Claude cost per wave");
  expect(withHistory).toContain("CA-0");
  expect(renderHtml([], wave)).toContain("<tbody></tbody>");
});

test("cost breakdown adds up to the session cost", () => {
  const profile = profileTranscript(transcript)!;
  const parts =
    profile.cost.input + profile.cost.cacheWrite + profile.cost.cacheRead + profile.cost.output;
  expect(parts).toBeCloseTo(profile.costUsd, 12);
  expect(parseArgs(["--no-opencode", "--html", "/tmp/x.html", "--history", "CA-1"]).opencodeDb).toBeNull();
});
