export interface LinearTeamRef {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  url: string;
  status: { id: string; name: string; type: string } | null;
  teams: LinearTeamRef[];
}

export interface LinearProjectWithConfig extends LinearProject {
  agentConfig: AgentConfig;
}

export interface LinearIssueState {
  id: string;
  name: string;
  type: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
}

export interface LinearLabelRef {
  id: string;
  name: string;
}

export interface LinearUserRef {
  id: string;
  name: string;
}

export interface LinearIssueSlim {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: LinearIssueState | null;
  labels: LinearLabelRef[];
  assignee: LinearUserRef | null;
}

export interface LinearAttachmentRef {
  id: string;
  title: string;
  url: string;
}

export interface LinearIssueFull extends LinearIssueSlim {
  description: string | null;
  attachments: LinearAttachmentRef[];
}

export type AgentMemoryKind = 'engineering' | 'learning' | 'reference';

export interface AgentMemoryConfig {
  /** Project character. Drives wiki page typology and per-issue routing. Default: "engineering". */
  kind: AgentMemoryKind;
  /** Override for the wiki page path (relative to vault `wiki/`). Default: derived from project name. */
  hubPath: string | null;
  /** Default tags applied to any auto-created wiki pages. */
  tags: string[];
  /** For kind:"learning", whether to ask before creating per-issue concept/area pages. Default: false. */
  askWhenUncertain: boolean;
}

export interface AgentConfig {
  worktrees: {
    create: 'always' | 'ask' | 'never';
    path: string;
    branchFormat: string;
  };
  autoCommit: boolean;
  createPr: boolean;
  states: {
    inProgress: string | null;
    inReview: string | null;
    done: string | null;
  };
  agentAssigneeFilter: string | null;
  memory: AgentMemoryConfig;
}

export const DEFAULT_AGENT_MEMORY_CONFIG: AgentMemoryConfig = {
  kind: 'engineering',
  hubPath: null,
  tags: ['project'],
  askWhenUncertain: false,
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  worktrees: {
    create: 'ask',
    path: '.worktrees',
    branchFormat: 'feature/${featureName}',
  },
  autoCommit: false,
  createPr: false,
  states: { inProgress: null, inReview: null, done: null },
  agentAssigneeFilter: null,
  memory: DEFAULT_AGENT_MEMORY_CONFIG,
};

export type LifecycleTransition = 'pickup' | 'complete';
