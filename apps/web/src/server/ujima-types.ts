export interface AuthUser {
  id: string;
  organizationId: string;
  memberId: string;
  email: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Member {
  id: string;
  organizationId: string;
  name: string;
  kind: "human" | "agent";
  roleName: string;
  presence: "online" | "offline" | "busy" | "away";
  createdAt?: string;
  retiredAt?: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  organizationId: string;
  memberId: string;
  createdAt?: string;
  expiresAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface SessionAuthState {
  authenticated: boolean;
  user: AuthUser | null;
  member: Member | null;
  session: AuthSession | null;
}

export interface TeamSummary {
  name: string;
  workspaceRoot: string;
  roles: string[];
  agents: string[];
  channels: string[];
  organizationChart?: { reportsTo: Record<string, string> };
}

export interface Channel {
  id: string;
  organizationId?: string;
  name: string;
  kind: "general" | "group" | "dm" | "task-run" | "self";
  topic: string;
  memberIds: string[];
  parentMessageId?: string;
  createdAt?: string;
  archivedAt?: string;
}

export interface BootstrapResponse {
  serviceReady: true;
  onboardingStatus: "pending" | "ready";
  organization: { id: string; name: string } | null;
  team: TeamSummary | null;
  providers: Array<{ name: string; hasKey: boolean }>;
  members: Member[];
  channels: Channel[];
  pendingApprovals: unknown[];
  activeRuns: unknown[];
  auth: SessionAuthState;
}

export interface OnboardingResponse {
  organization: { id: string; name: string };
  members: Member[];
  channels: Channel[];
  team: TeamSummary;
  auth: SessionAuthState & {
    authenticated: true;
    user: AuthUser;
    member: Member;
    session: AuthSession;
  };
}

export interface LoginResponse {
  auth: SessionAuthState & {
    authenticated: true;
    user: AuthUser;
    member: Member;
    session: AuthSession;
  };
}
