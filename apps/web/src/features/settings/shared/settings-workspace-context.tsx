"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  OrganizationSettingsResponse,
  ProviderStatus,
  TeamSettingsResponse,
} from "@ujima/api-schema";
import type { McpServerPublic, Member, Channel } from "@ujima/shared";

type SettingsPageSnapshot = {
  orgSettings: OrganizationSettingsResponse | null;
  teamSettings: TeamSettingsResponse | null;
  members: Member[];
  channels: Channel[];
  providers: ProviderStatus[];
  mcpServers: McpServerPublic[];
};

type SettingsPageContextValue = SettingsPageSnapshot & {
  setOrgSettings: Dispatch<SetStateAction<OrganizationSettingsResponse | null>>;
  setMembers: Dispatch<SetStateAction<Member[]>>;
  setChannels: Dispatch<SetStateAction<Channel[]>>;
  setProviders: Dispatch<SetStateAction<ProviderStatus[]>>;
  setMcpServers: Dispatch<SetStateAction<McpServerPublic[]>>;
};

const SettingsPageContext = createContext<SettingsPageContextValue | null>(null);

export function useSettingsPage() {
  const ctx = useContext(SettingsPageContext);
  if (!ctx) {
    throw new Error("useSettingsPage must be used within SettingsPageProvider");
  }
  return ctx;
}

export function SettingsPageProvider({
  initial,
  children,
}: {
  initial: SettingsPageSnapshot;
  children: ReactNode;
}) {
  const [orgSettings, setOrgSettings] = useState(initial.orgSettings);
  const [teamSettings] = useState(initial.teamSettings);
  const [members, setMembers] = useState(initial.members);
  const [channels, setChannels] = useState(initial.channels);
  const [providers, setProviders] = useState(initial.providers);
  const [mcpServers, setMcpServers] = useState(initial.mcpServers);

  const value: SettingsPageContextValue = {
    orgSettings,
    teamSettings,
    members,
    channels,
    providers,
    mcpServers,
    setOrgSettings,
    setMembers,
    setChannels,
    setProviders,
    setMcpServers,
  };

  return (
    <SettingsPageContext.Provider value={value}>{children}</SettingsPageContext.Provider>
  );
}
