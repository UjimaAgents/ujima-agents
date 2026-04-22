# @ujima/shared

Shared runtime contracts for Ujima.

This package is the common language for the whole monorepo. It holds the schemas, event contracts, workspace helpers, and small shared utilities that keep every app speaking the same dialect.

## What It Does

- validates organization, member, channel, message, run, approval, and governance data
- defines realtime socket event contracts
- keeps workspace path checks strict
- shares small helpers across the API, UI, CLI, and framework

## Why It Exists

If the apps disagree about shape, everything gets brittle. `@ujima/shared` keeps the data model explicit so the rest of the stack can move without drifting apart.

## Install

```bash
bun add @ujima/shared
```

In this monorepo:

```bash
bun install
```

## Public API

```ts
import {
  UJIMA_VERSION,
  OrganizationSchema,
  SocketEventSchemas,
  EMPTY_ACTIVITY_FILTER,
} from "@ujima/shared";

import { resolveWorkspacePath } from "@ujima/shared/workspace";
```

The package also exposes the `@ujima/shared/workspace` subpath for workspace helpers.

## Build

```bash
bun --cwd packages/shared run build
```

## Notes

- Keep this package framework-agnostic.
- Keep schemas explicit and small.
- Keep workspace boundary checks strict.
