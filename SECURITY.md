# Security Policy

Ujima Agents is a local-first system that can execute real work on a developer machine. Security boundaries matter.

## Supported Versions

Security fixes land on the current `main` branch.

## Reporting a Vulnerability

Do not open a public issue or pull request for a security vulnerability.

Use GitHub's private vulnerability reporting for this repository so maintainers can review the issue confidentially.

When you report a vulnerability, include:

- a short summary
- the affected package or app
- the exact path or command that exposed the issue
- whether secrets, workspace boundaries, or tool execution were involved
- a minimal reproduction if one exists

## High-Value Areas to Check

- workspace root escapes
- shell, git, and filesystem tool boundaries
- secret handling
- provider key storage
- realtime event authorization
- package loading and config validation

## Response

We will prioritize confirmation, triage, and a fix path as soon as possible after a report is received.
