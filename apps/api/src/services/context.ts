import type { AgentTeamHandle } from "@ujima/framework";
import type { Repository } from "../repositories.ts";
import type { RealtimeService } from "../realtime.ts";

export interface ApiServiceContext {
  team: AgentTeamHandle | null;
  repo: Repository;
  realtime: RealtimeService;
}

