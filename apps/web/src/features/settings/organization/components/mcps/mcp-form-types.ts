import type { McpServerPublic, McpServerStatus, McpTransport } from "@ujima/shared";
import { formatArgsInput } from "../mcps-form-helpers";

export type ServerFormState = {
  name: string;
  description: string;
  category: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  envText: string;
  headersText: string;
  isolation: "shared" | "per-agent";
  status: McpServerStatus;
  clearEnv: boolean;
  clearHeaders: boolean;
  envTouched: boolean;
  headersTouched: boolean;
};

export const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
  { value: "stdio", label: "stdio" },
  { value: "sse", label: "sse" },
  { value: "http-streamable", label: "http-streamable" },
];

export function emptyForm(): ServerFormState {
  return {
    name: "",
    description: "",
    category: "general",
    transport: "stdio",
    command: "",
    argsText: "",
    url: "",
    envText: "",
    headersText: "",
    isolation: "shared",
    status: "active",
    clearEnv: false,
    clearHeaders: false,
    envTouched: false,
    headersTouched: false,
  };
}

export function formFromServer(server: McpServerPublic): ServerFormState {
  return {
    name: server.name,
    description: server.description,
    category: server.category,
    transport: server.transport,
    command: server.command ?? "",
    argsText: formatArgsInput(server.args),
    url: server.url ?? "",
    envText: "",
    headersText: "",
    isolation: server.isolation,
    status: server.status,
    clearEnv: false,
    clearHeaders: false,
    envTouched: false,
    headersTouched: false,
  };
}

export function serverLabel(server: McpServerPublic): string {
  return `${server.name} (${server.transport})`;
}
