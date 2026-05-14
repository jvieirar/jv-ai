import {
  AgentConfig,
  AgentMemoryConfig,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AGENT_MEMORY_CONFIG,
  LifecycleTransition,
  LinearAttachmentRef,
  LinearIssueFull,
  LinearIssueSlim,
  LinearIssueState,
  LinearLabelRef,
  LinearProject,
  LinearProjectWithConfig,
  LinearTeamRef,
} from './types.js';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: unknown }>;
}

export class LinearClient {
  private apiKey: string;
  private endpoint: string;

  constructor(apiKey: string, endpoint?: string) {
    if (!apiKey) throw new Error('LINEAR_API_KEY is required');
    this.apiKey = apiKey;
    this.endpoint = endpoint ?? 'https://api.linear.app/graphql';
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Linear API ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL: ${json.errors.map(e => e.message).join('; ')}`);
    }
    if (!json.data) throw new Error('Linear GraphQL returned no data');
    return json.data;
  }

  // ─────────── Projects ───────────

  async listProjects(query?: string, limit = 25): Promise<LinearProject[]> {
    const data = await this.gql<{ projects: { nodes: RawProject[] } }>(
      `query($filter: ProjectFilter, $first: Int) {
        projects(filter: $filter, first: $first, orderBy: updatedAt) {
          nodes { ${PROJECT_FIELDS} }
        }
      }`,
      {
        filter: query ? { name: { containsIgnoreCase: query } } : undefined,
        first: limit,
      },
    );
    return data.projects.nodes.map(trimProject);
  }

  async getProject(idOrName: string): Promise<LinearProjectWithConfig> {
    const isUuid = UUID_RE.test(idOrName);
    const data = await this.gql<{ projects: { nodes: RawProject[] } }>(
      `query($filter: ProjectFilter, $first: Int) {
        projects(filter: $filter, first: $first) {
          nodes { ${PROJECT_FIELDS} }
        }
      }`,
      {
        filter: isUuid ? { id: { eq: idOrName } } : { name: { eqIgnoreCase: idOrName } },
        first: 1,
      },
    );
    const node = data.projects.nodes[0];
    if (!node) throw new Error(`Project not found: ${idOrName}`);
    const project = trimProject(node);
    return { ...project, agentConfig: parseAgentConfig(project.description) };
  }

  // ─────────── Issues ───────────

  async listIssues(args: {
    projectId?: string;
    teamId?: string;
    assignee?: string;
    query?: string;
    limit?: number;
  }): Promise<LinearIssueSlim[]> {
    const filter: Record<string, unknown> = {};
    if (args.projectId) filter.project = { id: { eq: args.projectId } };
    if (args.teamId) filter.team = { id: { eq: args.teamId } };
    if (args.assignee === 'me') filter.assignee = { isMe: { eq: true } };
    else if (args.assignee) filter.assignee = { name: { containsIgnoreCase: args.assignee } };
    if (args.query) filter.title = { containsIgnoreCase: args.query };

    const data = await this.gql<{ issues: { nodes: RawIssue[] } }>(
      `query($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first, orderBy: updatedAt) {
          nodes { ${ISSUE_SLIM_FIELDS} }
        }
      }`,
      { filter, first: args.limit ?? 25 },
    );
    return data.issues.nodes.map(trimIssueSlim);
  }

  async getIssue(idOrIdentifier: string): Promise<LinearIssueFull> {
    const data = await this.gql<{ issue: RawIssueFull | null }>(
      `query($id: String!) {
        issue(id: $id) {
          ${ISSUE_FULL_FIELDS}
        }
      }`,
      { id: idOrIdentifier },
    );
    if (!data.issue) throw new Error(`Issue not found: ${idOrIdentifier}`);
    return trimIssueFull(data.issue);
  }

  async saveIssue(args: {
    id?: string;
    title?: string;
    description?: string;
    projectId?: string;
    teamId?: string;
    state?: string; // name or id
    labels?: string[]; // names or ids — replaces full set
    assignee?: string; // name, id, or "me"
  }): Promise<LinearIssueSlim> {
    const isUpdate = !!args.id;

    let teamId = args.teamId;
    if (!isUpdate) {
      if (!teamId && args.projectId) {
        const proj = await this.getProject(args.projectId);
        teamId = proj.teams[0]?.id;
      }
      if (!teamId) throw new Error('save_issue create requires teamId or projectId');
      if (!args.title) throw new Error('save_issue create requires title');
    }

    let stateId: string | undefined;
    if (args.state) {
      const tid = teamId ?? (isUpdate ? await this.teamIdForIssue(args.id!) : undefined);
      if (!tid) throw new Error('cannot resolve team for state lookup');
      stateId = await this.resolveStateId(tid, args.state);
    }

    let labelIds: string[] | undefined;
    if (args.labels) {
      const tid = teamId ?? (isUpdate ? await this.teamIdForIssue(args.id!) : undefined);
      if (!tid) throw new Error('cannot resolve team for label lookup');
      labelIds = await this.resolveLabelIds(tid, args.labels);
    }

    let assigneeId: string | undefined;
    if (args.assignee) assigneeId = await this.resolveUserId(args.assignee);

    const input: Record<string, unknown> = {};
    if (args.title !== undefined) input.title = args.title;
    if (args.description !== undefined) input.description = args.description;
    if (!isUpdate && args.projectId) input.projectId = args.projectId;
    if (!isUpdate) input.teamId = teamId;
    if (stateId) input.stateId = stateId;
    if (labelIds) input.labelIds = labelIds;
    if (assigneeId) input.assigneeId = assigneeId;

    if (isUpdate) {
      const data = await this.gql<{ issueUpdate: { success: boolean; issue: RawIssue } }>(
        `mutation($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { ${ISSUE_SLIM_FIELDS} }
          }
        }`,
        { id: args.id, input },
      );
      if (!data.issueUpdate.success) throw new Error('issueUpdate returned success=false');
      return trimIssueSlim(data.issueUpdate.issue);
    }

    const data = await this.gql<{ issueCreate: { success: boolean; issue: RawIssue } }>(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { ${ISSUE_SLIM_FIELDS} }
        }
      }`,
      { input },
    );
    if (!data.issueCreate.success) throw new Error('issueCreate returned success=false');
    return trimIssueSlim(data.issueCreate.issue);
  }

  // ─────────── Comments ───────────

  async listComments(issueIdOrIdentifier: string, limit = 50): Promise<Array<{ id: string; body: string; createdAt: string; updatedAt: string }>> {
    const data = await this.gql<{ issue: { comments: { nodes: Array<{ id: string; body: string; createdAt: string; updatedAt: string }> } } | null }>(
      `query($id: String!, $first: Int) {
        issue(id: $id) {
          comments(first: $first, orderBy: createdAt) {
            nodes { id body createdAt updatedAt }
          }
        }
      }`,
      { id: issueIdOrIdentifier, first: limit },
    );
    if (!data.issue) throw new Error(`Issue not found: ${issueIdOrIdentifier}`);
    return data.issue.comments.nodes;
  }

  async saveComment(args: { id?: string; issueId?: string; body: string }): Promise<{ id: string }> {
    if (args.id) {
      const data = await this.gql<{ commentUpdate: { success: boolean; comment: { id: string } } }>(
        `mutation($id: String!, $input: CommentUpdateInput!) {
          commentUpdate(id: $id, input: $input) { success comment { id } }
        }`,
        { id: args.id, input: { body: args.body } },
      );
      return { id: data.commentUpdate.comment.id };
    }
    if (!args.issueId) throw new Error('save_comment requires id (update) or issueId (create)');
    const data = await this.gql<{ commentCreate: { success: boolean; comment: { id: string } } }>(
      `mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id } }
      }`,
      { input: { issueId: args.issueId, body: args.body } },
    );
    return { id: data.commentCreate.comment.id };
  }

  // ─────────── Statuses & Labels ───────────

  async listIssueStatuses(teamId: string): Promise<LinearIssueState[]> {
    const data = await this.gql<{ workflowStates: { nodes: LinearIssueState[] } }>(
      `query($filter: WorkflowStateFilter) {
        workflowStates(filter: $filter, first: 50) {
          nodes { id name type }
        }
      }`,
      { filter: { team: { id: { eq: teamId } } } },
    );
    return data.workflowStates.nodes;
  }

  async listIssueLabels(teamId: string): Promise<LinearLabelRef[]> {
    const data = await this.gql<{ issueLabels: { nodes: LinearLabelRef[] } }>(
      `query($filter: IssueLabelFilter) {
        issueLabels(filter: $filter, first: 100) {
          nodes { id name }
        }
      }`,
      { filter: { team: { id: { eq: teamId } } } },
    );
    return data.issueLabels.nodes;
  }

  async createIssueLabel(teamId: string, name: string, color?: string): Promise<LinearLabelRef> {
    const data = await this.gql<{ issueLabelCreate: { success: boolean; issueLabel: LinearLabelRef } }>(
      `mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) { success issueLabel { id name } }
      }`,
      { input: { teamId, name, color: color ?? '#0EA5E9' } },
    );
    if (!data.issueLabelCreate.success) throw new Error('issueLabelCreate returned success=false');
    return data.issueLabelCreate.issueLabel;
  }

  // ─────────── Lifecycle (compound) ───────────

  async lifecycleTransition(
    issueIdOrIdentifier: string,
    transition: LifecycleTransition,
  ): Promise<{
    id: string;
    identifier: string;
    state: LinearIssueState;
    labelsAdded: string[];
    labelsRemoved: string[];
  }> {
    const issue = await this.getIssue(issueIdOrIdentifier);
    const teamId = await this.teamIdForIssue(issue.id);
    const states = await this.listIssueStatuses(teamId);
    const labels = await this.listIssueLabels(teamId);

    let aiWorking = labels.find(l => l.name === 'AI_WORKING');
    if (!aiWorking) aiWorking = await this.createIssueLabel(teamId, 'AI_WORKING');

    const aiReady = labels.find(l => l.name === 'AI_READY');

    const currentLabelIds = issue.labels.map(l => l.id);
    let nextLabelIds: string[];
    let labelsAdded: string[] = [];
    let labelsRemoved: string[] = [];
    let nextState: LinearIssueState;

    if (transition === 'pickup') {
      const inProgress =
        states.find(s => s.type === 'started' && s.name.toLowerCase() === 'in progress') ??
        states.find(s => s.type === 'started');
      if (!inProgress) throw new Error('No started-type state found for pickup');
      nextState = inProgress;
      // Remove AI_READY (if present) and add AI_WORKING atomically
      let ids = currentLabelIds.filter(id => id !== aiReady?.id);
      if (aiReady && currentLabelIds.includes(aiReady.id)) labelsRemoved = ['AI_READY'];
      if (!ids.includes(aiWorking.id)) {
        ids = [...ids, aiWorking.id];
        labelsAdded = ['AI_WORKING'];
      }
      nextLabelIds = ids;
    } else {
      const inReview = states.find(s => s.type === 'started' && s.name.toLowerCase() === 'in review');
      const done = states.find(s => s.type === 'completed');
      const target = inReview ?? done;
      if (!target) throw new Error('No In Review or completed state found for complete');
      nextState = target;
      if (currentLabelIds.includes(aiWorking.id)) {
        nextLabelIds = currentLabelIds.filter(id => id !== aiWorking.id);
        labelsRemoved = ['AI_WORKING'];
      } else {
        nextLabelIds = currentLabelIds;
      }
    }

    await this.gql<{ issueUpdate: { success: boolean } }>(
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: issue.id, input: { stateId: nextState.id, labelIds: nextLabelIds } },
    );

    return {
      id: issue.id,
      identifier: issue.identifier,
      state: nextState,
      labelsAdded,
      labelsRemoved,
    };
  }

  // ─────────── Attachments / images ───────────

  extractImagesFromBody(description: string | null): Array<{ url: string; alt: string }> {
    if (!description) return [];
    const out: Array<{ url: string; alt: string }> = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(description))) {
      out.push({ alt: m[1] ?? '', url: m[2] ?? '' });
    }
    return out;
  }

  async extractImages(issueIdOrIdentifier: string): Promise<Array<{ url: string; alt: string; path: string; bytes: number; mimeType: string }>> {
    const issue = await this.getIssue(issueIdOrIdentifier);
    const refs = this.extractImagesFromBody(issue.description);
    return Promise.all(
      refs.map(async ref => {
        const dl = await this.downloadAttachment({ url: ref.url });
        return { url: ref.url, alt: ref.alt, path: dl.path, bytes: dl.bytes, mimeType: dl.mimeType };
      }),
    );
  }

  async listAttachments(issueIdOrIdentifier: string): Promise<LinearAttachmentRef[]> {
    const issue = await this.getIssue(issueIdOrIdentifier);
    return issue.attachments;
  }

  async downloadAttachment(args: {
    attachmentId?: string;
    url?: string;
    destPath?: string;
  }): Promise<{ path: string; bytes: number; mimeType: string }> {
    let url = args.url;
    if (!url && args.attachmentId) {
      const data = await this.gql<{ attachment: { url: string; title: string } | null }>(
        `query($id: String!) { attachment(id: $id) { url title } }`,
        { id: args.attachmentId },
      );
      if (!data.attachment) throw new Error(`Attachment not found: ${args.attachmentId}`);
      url = data.attachment.url;
    }
    if (!url) throw new Error('download_attachment requires attachmentId or url');

    const downloadDir = process.env.LINEAR_DOWNLOAD_DIR ?? '/tmp/jv-linear-mcp';
    await Bun.$`mkdir -p ${downloadDir}`.quiet();

    const headers: Record<string, string> = {};
    if (url.includes('linear.app') || url.includes('linear-app')) headers.Authorization = this.apiKey;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);

    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream';
    const ext = mimeToExt(mimeType) ?? extFromUrl(url) ?? '';

    let dest = args.destPath;
    if (!dest) {
      const base = url.split('/').pop()?.split('?')[0] ?? 'attachment';
      const stem = base.includes('.') ? base : base + ext;
      dest = `${downloadDir}/${Date.now()}-${stem}`;
    }

    const buf = await res.arrayBuffer();
    await Bun.write(dest, buf);
    return { path: dest, bytes: buf.byteLength, mimeType };
  }

  // ─────────── Helpers ───────────

  private async teamIdForIssue(idOrIdentifier: string): Promise<string> {
    const data = await this.gql<{ issue: { team: { id: string } } | null }>(
      `query($id: String!) { issue(id: $id) { team { id } } }`,
      { id: idOrIdentifier },
    );
    if (!data.issue) throw new Error(`Issue not found: ${idOrIdentifier}`);
    return data.issue.team.id;
  }

  private async resolveStateId(teamId: string, nameOrId: string): Promise<string> {
    if (UUID_RE.test(nameOrId)) return nameOrId;
    const states = await this.listIssueStatuses(teamId);
    const match = states.find(s => s.name.toLowerCase() === nameOrId.toLowerCase());
    if (!match) throw new Error(`State not found: ${nameOrId}`);
    return match.id;
  }

  private async resolveLabelIds(teamId: string, namesOrIds: string[]): Promise<string[]> {
    const labels = await this.listIssueLabels(teamId);
    const out: string[] = [];
    for (const v of namesOrIds) {
      if (UUID_RE.test(v)) {
        out.push(v);
        continue;
      }
      const match = labels.find(l => l.name.toLowerCase() === v.toLowerCase());
      if (!match) throw new Error(`Label not found: ${v}`);
      out.push(match.id);
    }
    return out;
  }

  private async resolveUserId(nameOrIdOrMe: string): Promise<string> {
    if (UUID_RE.test(nameOrIdOrMe)) return nameOrIdOrMe;
    if (nameOrIdOrMe.toLowerCase() === 'me') {
      const data = await this.gql<{ viewer: { id: string } }>(`query { viewer { id } }`);
      return data.viewer.id;
    }
    const data = await this.gql<{ users: { nodes: Array<{ id: string; name: string }> } }>(
      `query($filter: UserFilter, $first: Int) {
        users(filter: $filter, first: $first) { nodes { id name } }
      }`,
      { filter: { name: { containsIgnoreCase: nameOrIdOrMe } }, first: 5 },
    );
    const match = data.users.nodes[0];
    if (!match) throw new Error(`User not found: ${nameOrIdOrMe}`);
    return match.id;
  }
}

// ─────────── Field selections (centralised so trimming is consistent) ───────────

const PROJECT_FIELDS = `
  id name description content url
  status { id name type }
  teams { nodes { id name key } }
`;

const ISSUE_SLIM_FIELDS = `
  id identifier title url
  state { id name type }
  labels { nodes { id name } }
  assignee { id name }
`;

const ISSUE_FULL_FIELDS = `
  id identifier title description url
  state { id name type }
  labels { nodes { id name } }
  assignee { id name }
  attachments { nodes { id title url } }
`;

// ─────────── Raw shapes (just enough to map) ───────────

interface RawProject {
  id: string;
  name: string;
  description: string | null; // short summary
  content: string | null;     // full markdown body — where ## Agent Config lives
  url: string;
  status: { id: string; name: string; type: string } | null;
  teams: { nodes: LinearTeamRef[] };
}

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: LinearIssueState | null;
  labels: { nodes: LinearLabelRef[] };
  assignee: { id: string; name: string } | null;
}

interface RawIssueFull extends RawIssue {
  description: string | null;
  attachments: { nodes: LinearAttachmentRef[] };
}

function trimProject(p: RawProject): LinearProject {
  return {
    id: p.id,
    name: p.name,
    // expose full body as `description` to match upstream MCP naming convention
    description: p.content ?? p.description,
    url: p.url,
    status: p.status,
    teams: p.teams.nodes,
  };
}

function trimIssueSlim(i: RawIssue): LinearIssueSlim {
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    url: i.url,
    state: i.state,
    labels: i.labels.nodes,
    assignee: i.assignee,
  };
}

function trimIssueFull(i: RawIssueFull): LinearIssueFull {
  return {
    ...trimIssueSlim(i),
    description: i.description,
    attachments: i.attachments.nodes,
  };
}

// ─────────── Agent config parsing (## Agent Config block in project.description) ───────────

export function parseAgentConfig(description: string | null): AgentConfig {
  if (!description) return DEFAULT_AGENT_CONFIG;

  // Find a fenced block under "## Agent Config" or fall back to first ```json block.
  const heading = /##\s*Agent\s*Config[^\n]*\n+```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(description);
  const fallback = !heading ? /```json\s*\n([\s\S]*?)\n```/.exec(description) : null;
  const raw = heading?.[1] ?? fallback?.[1];
  if (!raw) return DEFAULT_AGENT_CONFIG;

  try {
    const cleaned = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(cleaned) as Partial<AgentConfig>;
    return mergeConfig(parsed);
  } catch {
    return DEFAULT_AGENT_CONFIG;
  }
}

function mergeConfig(p: Partial<AgentConfig>): AgentConfig {
  return {
    worktrees: { ...DEFAULT_AGENT_CONFIG.worktrees, ...(p.worktrees ?? {}) },
    autoCommit: p.autoCommit ?? DEFAULT_AGENT_CONFIG.autoCommit,
    createPr: p.createPr ?? DEFAULT_AGENT_CONFIG.createPr,
    states: { ...DEFAULT_AGENT_CONFIG.states, ...(p.states ?? {}) },
    agentAssigneeFilter: p.agentAssigneeFilter ?? DEFAULT_AGENT_CONFIG.agentAssigneeFilter,
    memory: mergeMemoryConfig(p.memory),
  };
}

function mergeMemoryConfig(p: Partial<AgentMemoryConfig> | undefined): AgentMemoryConfig {
  if (!p) return DEFAULT_AGENT_MEMORY_CONFIG;
  const kind = p.kind && (['engineering', 'learning', 'reference'] as const).includes(p.kind)
    ? p.kind
    : DEFAULT_AGENT_MEMORY_CONFIG.kind;
  return {
    kind,
    hubPath: p.hubPath ?? DEFAULT_AGENT_MEMORY_CONFIG.hubPath,
    tags: Array.isArray(p.tags) ? p.tags : DEFAULT_AGENT_MEMORY_CONFIG.tags,
    askWhenUncertain: p.askWhenUncertain ?? DEFAULT_AGENT_MEMORY_CONFIG.askWhenUncertain,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
};

function mimeToExt(mime: string): string | undefined {
  return MIME_TO_EXT[mime.toLowerCase()];
}

function extFromUrl(url: string): string | undefined {
  const path = url.split('?')[0] ?? '';
  const dot = path.lastIndexOf('.');
  if (dot === -1 || dot < path.lastIndexOf('/')) return undefined;
  return path.slice(dot);
}
