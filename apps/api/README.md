# @ujima/api

Local backend for Ujima.

This service owns:
- team loading and validation
- organization onboarding and settings
- local SQLite persistence
- AI SDK orchestration
- `socket.io` realtime events
- approvals and audit logs
- workspace root enforcement
- tool and MCP policy checks
- agent messaging across threads, channels, and DMs

## Architecture

```mermaid
flowchart TD
  U["User / Web / VS Code"]

  subgraph Setup["1) Onboarding and Org Setup"]
    ONB["POST /api/onboarding"]
    TEAM["Load AgentTeam config"]
    ORG["Create organization record"]
    OWNER["Create human owner member"]
    AGENTS["Create named agent members from team agents"]
    CHANS["Create channels and thread memberships"]
    CHART["Save org chart / reporting lines"]
    SECRETS["Store provider keys"]
  end

  subgraph Settings["2) Org Settings"]
    GETSET["GET /api/settings/organization"]
    PATCHSET["PATCH /api/settings/organization"]
    EDITNAME["Edit organization name"]
    EDITHIER["Edit org hierarchy"]
    EDITPROV["Update provider keys"]
  end

  subgraph Messaging["3) Messaging"]
    MSG["POST /api/messages"]
    CONV["ConversationService"]
    THREAD["Thread record"]
    CHANNEL["Channel-backed thread"]
    DM["DM channel + thread"]
    EMITMSG["Emit channel:message / thread:message / dm:message"]
  end

  subgraph Runs["4) Agent Run Loop"]
    RUN["POST /api/runs"]
    RS["RunService"]
    AI["AiService"]
    PROMPT["Build system prompt<br/>organization name + employee list + org chart<br/>role instructions + personality prompt + workspace scopes + tools + messaging IDs"]
    MODEL["AI SDK provider<br/>OpenAI Responses / Anthropic / Google"]
    TOOLDEFS["Register model tools"]
    TOOL["ToolService"]
    POLICY["Policy check<br/>workspace root + role scopes + approval rules"]
    APPROVAL["ApprovalService"]
    EXEC["Execute tool<br/>filesystem / shell (including git) / message / mcp placeholder"]
    RESUME["Resume run after approval"]
    ASSISTANT["Assistant response message"]
  end

  subgraph Storage["5) SQLite Storage"]
    DB["Repository / SQLite"]
    ORGS["organizations<br/>workspace + org chart"]
    MEMBERS["members<br/>join time + role"]
    CONVERSATIONS["channels / threads / messages"]
    RUNSDB["runs / approvals / audit / provider creds"]
  end

  subgraph Realtime["6) Realtime / socket.io"]
    RT["RealtimeService"]
    ORGROOM["org room"]
    CHROOM["channel room"]
    THROOM["thread room"]
    MEMROOM["member room"]
    RUNROOM["run room"]
    EVENTS["Events<br/>channel:message<br/>thread:message<br/>dm:message<br/>run:started<br/>run:updated<br/>run:completed<br/>approval:requested<br/>approval:resolved<br/>tool:called<br/>tool:result"]
  end

  U --> ONB
  U --> GETSET
  U --> PATCHSET
  U --> MSG
  U --> RUN

  ONB --> TEAM
  TEAM --> ORG
  TEAM --> OWNER
  TEAM --> AGENTS
  TEAM --> CHANS
  TEAM --> CHART
  TEAM --> SECRETS

  GETSET --> DB
  PATCHSET --> EDITNAME
  PATCHSET --> EDITHIER
  PATCHSET --> EDITPROV
  EDITNAME --> DB
  EDITHIER --> DB
  EDITPROV --> DB

  MSG --> CONV
  CONV --> THREAD
  CONV --> CHANNEL
  CONV --> DM
  CONV --> DB
  CONV --> EMITMSG
  EMITMSG --> RT

  RUN --> RS
  RS --> DB
  RS --> AI
  AI --> DB
  AI --> PROMPT
  PROMPT --> MODEL
  PROMPT --> TOOLDEFS
  TOOLDEFS --> TOOL
  TOOL --> POLICY
  POLICY -->|blocked| APPROVAL
  POLICY -->|allowed| EXEC
  EXEC --> DB
  APPROVAL --> DB
  APPROVAL -->|approved| RESUME
  RESUME --> RS
  AI --> ASSISTANT
  ASSISTANT --> CONV

  DB --> ORGS
  DB --> MEMBERS
  DB --> CONVERSATIONS
  DB --> RUNSDB

  RT --> ORGROOM
  RT --> CHROOM
  RT --> THROOM
  RT --> MEMROOM
  RT --> RUNROOM
  RT --> EVENTS

  CONV --> ORGROOM
  CONV --> CHROOM
  CONV --> THROOM
  CONV --> MEMROOM

  RS --> ORGROOM
  RS --> THROOM
  RS --> MEMROOM
  RS --> RUNROOM

  APPROVAL --> ORGROOM
  APPROVAL --> RUNROOM
```

## Status

The backend is implemented and is the first runnable app in the stack.

## Install

From the monorepo root:

```bash
bun install
```

## Development Notes

- Keep the API local-first.
- Never expose provider secrets to the browser.
- Use the workspace root as a hard boundary for local execution.
- Keep orchestration centered around the AI SDK, Ujima policy layers, and the conversation service.
- Treat shell as the execution path for git commands.
