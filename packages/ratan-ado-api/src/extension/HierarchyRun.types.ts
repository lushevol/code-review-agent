export interface Stage {
  id: string;
  name: string;
  refName: string;
  state: number;
  result: number;
  startTime: string;
  finishTime: string;
  order: number;
  parentId: string | null;
  checkpoint: Checkpoint | null;
  stateData: StateData | null;
}

export interface Checkpoint {
  id: string;
  name: string;
  refName: string;
  state: number;
  result: number;
  startTime: string;
  finishTime: string;
  order: number | null;
  parentId: string | null;
  checkpoint: null;
  stateData: null;
}

export interface StateData {
  pendingDependencies: boolean;
  pendingChecks: boolean;
  ignoreDependencies: boolean;
}

export interface StageDependencies {
  [key: string]: string[];
}

export interface Run {
  retentionLeases: any[];
  id: number;
  buildNumber: string;
  sourceBranch: string;
  sourceVersion: string;
  artifactName: string | null;
  artifactProducerId: string | null;
  repository: Repository;
  queueTime: string;
  startTime: string;
  finishTime: string | null;
  reason: number;
  status: number;
  result: number | null;
  definition: Definition;
  triggerInfo: object;
  requestedFor: RequestedFor;
  requestedById: string;
  appendCommitMessageToRunName: boolean;
  triggeringRepository: null;
}

export interface Repository {
  id: string;
  type: string;
  name: string;
  url: string;
  clean: null;
  checkoutSubmodules: boolean;
}

export interface Definition {
  drafts: any[];
  id: number;
  name: string;
  path: string;
  type: number;
  queueStatus: number;
  project: Project;
}

export interface Project {
  id: string;
  state: number;
  visibility: number;
  lastUpdateTime: string;
}

export interface RequestedFor {
  displayName: string;
  url: string;
  _links: {
    avatar: {
      href: string;
    };
  };
  id: string;
  uniqueName: string;
  imageUrl: string;
  descriptor: string;
}

export interface LinkProps {
  href: string;
}

export interface HierarchyRun {
  stages: Stage[];
  stageDependencies: StageDependencies;
  run: Run;
  sourceVersionMessage: string;
  linkProps: LinkProps;
}
