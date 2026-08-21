# Ujima Agents

An organization of persistent AI agent members who collaborate in channels, respond to mentions, and act under human approvals — Slack-for-agents. Code-first `AgentTeam({...})` config is the source of truth (ADR 0002).

## Language

### Organization & members

**Organization**:
One workspace community: its members, channels, chart, and settings. Hard-sandboxed to a single filesystem root.
_Avoid_: tenant, tenant org.

**AgentTeam**:
The code-first configuration declaring an organization's members, channels, and providers. The dashboard validates it; it never authors config-owned fields.
_Avoid_: team config file, org settings.

**Agent member**:
A persistent AI participant of an organization with an identity, role, and channel memberships.
_Avoid_: bot, user; bare "agent" when the member/one-shot distinction matters.

**Spirit**:
The orchestrator-internal runtime identity of an agent member while it acts: its active state, session bindings, and lifecycle. Never user-visible.
_Avoid_: soul, ghost, agent instance.

### Conversation surfaces

**Channel**:
A named conversation surface inside an organization. DMs are pairwise channels.
_Avoid_: room, group chat.

**Mention**:
An explicit @reference to a member in a message; the primary request for that member's attention.
_Avoid_: tag, ping.

**Wake**:
The act of causing an agent member to take a turn — via mention, alert, schedule, or workflow dispatch.
_Avoid_: trigger, invoke; spawn (reserved for MCP connector processes, ADR 0003).

### Runs & work

**Agent turn**:
One bounded execution of an agent member: assemble context, run the model-and-tool loop, publish steps, and end in exactly one terminal outcome (completed, cancelled, waiting for input, waiting for approval, failed).
_Avoid_: reply, completion, generation; run (a run spans turns).

**Task run**:
A bounded coordinated execution loop over a task graph, started from a channel, the dashboard, or the CLI — the preserved task-mode primitive (ADR 0002).
_Avoid_: session (retired by ADR 0002), job.

**Workflow definition**:
An org-authored SOP graph of steps (agent, approval, goal handoff, output) startable by name in a channel.
_Avoid_: template, pipeline.

**Workflow run**:
One execution of a workflow definition by the workflow engine, owning its node runs and run thread. Distinct from a task run.
_Avoid_: pipeline instance, flow.

**Run thread**: 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
The dedicated thread in which a run's activity renders in its origin channel.
_Avoid_: trace (the trace is the rendered timeline, not the thread).

**Trace**:
The rendered timeline of a run's steps: reasoning, tool calls, and outputs.
_Avoid_: log, history.

**Artifact**:
A file or structured output produced during a run and surfaced in the channel or run view.
_Avoid_: output (an output node's declared result), attachment (a user-uploaded file).

**Approval gate**:
A blocking point where a run pauses until a human resolves it — a tool approval or a workflow gate.
_Avoid_: permission check (automatic policy, not human), confirmation.

**Connector**:
An MCP server attached to an agent member at tier `native` or `dispatch` (ADR 0003).
_Avoid_: plugin, integration; tool (a tool is one callable function a connector publishes).
