# `@ujima/shared`

Shared runtime contracts for Ujima.

This package defines the data shapes, event payloads, and workspace safety helpers used by the rest of the monorepo.

## Install

```bash
bun add @ujima/shared
```

In this monorepo, the package is already available through workspace linking:

```bash
bun install
```

## Import

```ts
import {
  OrganizationSchema,
  MessageSchema,
  SocketEventNames,
  resolveWorkspacePath,
} from "@ujima/shared";
```

## What This Package Is For

- validating org, member, channel, message, run, approval, and audit data
- defining `socket.io` event contracts
- enforcing workspace root boundaries
- sharing enums, IDs, and defaults across the API, UI, CLI, and framework package

## What This Package Is Not For

- orchestration logic
- provider routing
- UI state
- database access
- editor integration

## Public API

### Schemas

Use the schemas to validate app state and incoming payloads.

- `IdSchema`
- `TimestampSchema`
- `MemberKindSchema`
- `ChannelKindSchema`
- `ToolActionSchema`
- `ProviderScopeSchema`
- `ApprovalStatusSchema`
- `AuditStatusSchema`
- `RunStatusSchema`
- `MessageKindSchema`
- `PresenceStateSchema`
- `ResourceTypeSchema`
- `RoleScopesSchema`
- `WorkspaceConfigSchema`
- `OrganizationSchema`
- `MemberSchema`
- `ChannelSchema`
- `ConversationThreadSchema`
- `MessageSchema`
- `ProviderBindingSchema`
- `ToolCapabilitySchema`
- `ApprovalRequestSchema`
- `AuditEventSchema`
- `RunStateSchema`

Example:

```ts
import { OrganizationSchema } from "@ujima/shared";

const organization = OrganizationSchema.parse({
  id: "org_1",
  name: "Acme",
  workspace: {
    root: "/Users/me/acme",
    roleScopes: {},
  },
});
```

### Events

Use these for realtime sync over `socket.io`.

- `SocketEventNames`
- `SocketEventSchemas`
- `ChannelMessageEventSchema`
- `ThreadMessageEventSchema`
- `ChannelPresenceEventSchema`
- `ApprovalRequestedEventSchema`
- `ApprovalResolvedEventSchema`
- `RunEventSchema`
- `MemberUpdatedEventSchema`
- `ChannelUpdatedEventSchema`

Example:

```ts
import { SocketEventNames, SocketEventSchemas } from "@ujima/shared";

const event = SocketEventSchemas[SocketEventNames.channelMessage].parse({
  organizationId: "org_1",
  channelId: "channel_1",
  message: {
    id: "msg_1",
    organizationId: "org_1",
    threadId: "thread_1",
    senderId: "member_1",
    senderKind: "agent",
    content: "hello",
    createdAt: "2026-04-19T00:00:00.000Z",
  },
});
```

### Workspace Helpers

Use these helpers to keep all agent work inside the organization workspace root.

- `normalizeWorkspaceRoot(root, baseDirectory?)`
- `isPathInsideRoot(root, candidatePath)`
- `resolveWorkspacePath(root, relativePath?)`
- `normalizeRoleScopes(roleScopes, root)`
- `assertWorkspaceBoundary(root, candidatePath)`

Example:

```ts
import { resolveWorkspacePath, assertWorkspaceBoundary } from "@ujima/shared";

const root = "/Users/me/acme";
const target = resolveWorkspacePath(root, "apps/web");
assertWorkspaceBoundary(root, target);
```

### Constants

- `DEFAULT_GENERAL_CHANNEL`
- `DEFAULT_WORKSPACE_ROLE_SCOPES`

## Workspace Safety

`@ujima/shared` treats the organization workspace root as a hard boundary.

If a path resolves outside the root, it should be rejected before any file, shell, or git action runs.

## Testing

```bash
bun test packages/shared/index.test.ts
```

## Notes

- Keep this package framework-agnostic.
- Keep schemas explicit and small.
- Keep workspace boundary checks strict.
