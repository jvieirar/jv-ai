#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LinearClient } from './linear-client.js';

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error('LINEAR_API_KEY environment variable is required');
  process.exit(1);
}

const client = new LinearClient(apiKey, process.env.LINEAR_API_URL);
const server = new McpServer({ name: 'jv-linear-mcp', version: '0.1.0' });

const handleError = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    },
  ],
  isError: true,
});

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

// ─────────── Projects ───────────

server.registerTool(
  'jv_list_projects',
  {
    title: 'List Linear projects',
    description: 'List Linear projects (trimmed: id, name, description, url, status, teams).',
    inputSchema: {
      query: z.string().optional().describe('Substring match on project name (case-insensitive)'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 25)'),
    },
  },
  async ({ query, limit }) => {
    try {
      return ok(await client.listProjects(query, limit));
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_get_project',
  {
    title: 'Get Linear project (with parsed Agent Config)',
    description:
      'Get a Linear project by id or exact name. Returns the trimmed project plus parsed agentConfig from the description.',
    inputSchema: {
      idOrName: z.string().describe('Project UUID or exact name (case-insensitive)'),
    },
  },
  async ({ idOrName }) => {
    try {
      return ok(await client.getProject(idOrName));
    } catch (e) {
      return handleError(e);
    }
  },
);

// ─────────── Issues ───────────

server.registerTool(
  'jv_list_issues',
  {
    title: 'List Linear issues',
    description:
      'List issues (trimmed: id, identifier, title, url, state, labels, assignee). Filter by project, team, assignee, or title query.',
    inputSchema: {
      projectId: z.string().optional(),
      teamId: z.string().optional(),
      assignee: z.string().optional().describe('User name, id, or "me"'),
      query: z.string().optional().describe('Title substring match'),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
  async args => {
    try {
      return ok(await client.listIssues(args));
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_get_issue',
  {
    title: 'Get Linear issue',
    description:
      'Get a single issue by id or identifier (e.g. "MIT-12"). Includes description and attachments.',
    inputSchema: {
      idOrIdentifier: z.string(),
    },
  },
  async ({ idOrIdentifier }) => {
    try {
      return ok(await client.getIssue(idOrIdentifier));
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_save_issue',
  {
    title: 'Create or update a Linear issue',
    description:
      'If `id` is provided, updates the issue. Otherwise creates a new one. State and labels accept names or ids. labels[] REPLACES the full set.',
    inputSchema: {
      id: z.string().optional().describe('Issue id or identifier — present = update'),
      title: z.string().optional(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      teamId: z.string().optional(),
      state: z.string().optional().describe('State name or id'),
      labels: z.array(z.string()).optional().describe('Names or ids — replaces full set'),
      assignee: z.string().optional().describe('User name, id, or "me"'),
    },
  },
  async args => {
    try {
      return ok(await client.saveIssue(args));
    } catch (e) {
      return handleError(e);
    }
  },
);

// ─────────── Comments ───────────

server.registerTool(
  'jv_list_comments',
  {
    title: 'List comments on an issue',
    description: 'Returns all comments on an issue in chronological order: [{ id, body, createdAt, updatedAt }]. Use to read [PLAN]/[DECISION]/[RESULT]/[LEARNING] history before writing a new comment.',
    inputSchema: {
      idOrIdentifier: z.string(),
      limit: z.number().int().min(1).max(100).optional().describe('Max comments (default 50)'),
    },
  },
  async ({ idOrIdentifier, limit }) => {
    try {
      return ok(await client.listComments(idOrIdentifier, limit));
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_save_comment',
  {
    title: 'Create or update a comment',
    description: 'Pass `id` to update, or `issueId` + `body` to create. Returns { id }.',
    inputSchema: {
      id: z.string().optional(),
      issueId: z.string().optional(),
      body: z.string(),
    },
  },
  async args => {
    try {
      return ok(await client.saveComment(args));
    } catch (e) {
      return handleError(e);
    }
  },
);

// ─────────── Statuses & labels ───────────

server.registerTool(
  'jv_list_issue_statuses',
  {
    title: 'List workflow states for a team',
    description: 'Returns [{ id, name, type }] for the given team.',
    inputSchema: { teamId: z.string() },
  },
  async ({ teamId }) => {
    try {
      return ok(await client.listIssueStatuses(teamId));
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_list_issue_labels',
  {
    title: 'List issue labels for a team',
    description: 'Returns [{ id, name }] for the given team.',
    inputSchema: { teamId: z.string() },
  },
  async ({ teamId }) => {
    try {
      return ok(await client.listIssueLabels(teamId));
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_create_issue_label',
  {
    title: 'Create a team label',
    description: 'Creates a label on the given team. Color defaults to #0EA5E9.',
    inputSchema: {
      teamId: z.string(),
      name: z.string(),
      color: z.string().optional(),
    },
  },
  async ({ teamId, name, color }) => {
    try {
      return ok(await client.createIssueLabel(teamId, name, color));
    } catch (e) {
      return handleError(e);
    }
  },
);

// ─────────── Lifecycle ───────────

server.registerTool(
  'jv_lifecycle_transition',
  {
    title: 'Atomic state + AI_WORKING label transition',
    description:
      'Compound: moves the issue and updates the AI_WORKING label in one step. Transitions: pickup (→ In Progress + add AI_WORKING) · complete (→ In Review if exists else Done + remove AI_WORKING). Auto-creates AI_WORKING label if missing.',
    inputSchema: {
      idOrIdentifier: z.string(),
      transition: z.enum(['pickup', 'complete']),
    },
  },
  async ({ idOrIdentifier, transition }) => {
    try {
      return ok(await client.lifecycleTransition(idOrIdentifier, transition));
    } catch (e) {
      return handleError(e);
    }
  },
);

// ─────────── Attachments / images ───────────

server.registerTool(
  'jv_extract_images',
  {
    title: 'Extract and download images from an issue body',
    description:
      'Finds all markdown image refs in the issue description, downloads each to a local file, and returns them as inline image content blocks alongside JSON metadata [{ url, alt, path, bytes, mimeType }]. Images are immediately visible in context — no separate Read or curl needed.',
    inputSchema: { idOrIdentifier: z.string() },
  },
  async ({ idOrIdentifier }) => {
    try {
      const images = await client.extractImages(idOrIdentifier);
      if (images.length === 0) return ok([]);

      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = [
        { type: 'text', text: JSON.stringify(images.map(({ url, alt, path, bytes, mimeType }) => ({ url, alt, path, bytes, mimeType })), null, 2) },
      ];

      for (const img of images) {
        try {
          const buf = await Bun.file(img.path).arrayBuffer();
          const b64 = Buffer.from(buf).toString('base64');
          const mime = img.mimeType.startsWith('image/') ? img.mimeType : 'image/png';
          content.push({ type: 'image', data: b64, mimeType: mime });
        } catch {
          // if inline embedding fails, the path in the JSON metadata is still usable
        }
      }

      return { content };
    } catch (e) {
      return handleError(e);
    }
  },
);

server.registerTool(
  'jv_download_attachment',
  {
    title: 'Download an attachment to a local file',
    description:
      'Downloads by attachmentId (preferred) or url. Returns { path, bytes, mimeType }. Extension is inferred from Content-Type header so the file is always correctly named. Files land in $LINEAR_DOWNLOAD_DIR or /tmp/jv-linear-mcp by default.',
    inputSchema: {
      attachmentId: z.string().optional(),
      url: z.string().optional(),
      destPath: z.string().optional(),
    },
  },
  async args => {
    try {
      return ok(await client.downloadAttachment(args));
    } catch (e) {
      return handleError(e);
    }
  },
);

// ─────────── Bootstrap ───────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
