"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Save } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { ChannelMemberMode } from "@ujima/shared";
import { Avatar } from "./chat";

type Channel = BootstrapResponse["channels"][number];
type Member = BootstrapResponse["members"][number];

interface MemberMode {
  channelId: string;
  memberId: string;
  mode: ChannelMemberMode;
}

const MODE_LABELS: Record<ChannelMemberMode, string> = {
  active: "Active",
  passive: "Passive",
  muted: "Muted",
  temp_disable: "Temp Disabled",
};

const MODE_ORDER: ChannelMemberMode[] = ["active", "passive", "muted", "temp_disable"];

const MODE_DESCRIPTIONS: Record<ChannelMemberMode, string> = {
  active: "Responds to all messages and @mentions",
  passive: "Reads context but only replies when @mentioned",
  muted: "Ignored in this channel",
  temp_disable: "Temporarily disabled",
};

function normalizeMemberIds(memberIds: string[]): string[] {
  return [...new Set(memberIds)].sort();
}

function sameMemberIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((memberId, index) => memberId === right[index]);
}

function sortMembers(left: Member, right: Member): number {
  if (left.kind === right.kind) {
    return left.name.localeCompare(right.name);
  }
  return left.kind === "agent" ? -1 : 1;
}

export function ChannelMembersTab({
  organizationId,
  channel,
  members,
  onSaved,
}: {
  organizationId?: string;
  channel: Channel;
  members: Member[];
  onSaved: (memberIds: string[]) => void;
}) {
  const knownMemberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const savedMemberIds = useMemo(
    () => normalizeMemberIds(channel.memberIds.filter((memberId) => knownMemberIds.has(memberId))),
    [channel.memberIds, knownMemberIds],
  );
  const [draftMemberIds, setDraftMemberIds] = useState(savedMemberIds);
  // Track the savedMemberIds we initialized draft from, so we can
  // detect prop changes and resync. React 19's official "Adjusting
  // state when a prop changes" pattern — done during render, not in
  // an effect — so react-hooks/set-state-in-effect doesn't fire and
  // the resync lands BEFORE the next paint instead of one frame
  // later. savedMemberIds is reference-stable via the useMemo above,
  // so the cheap `!==` check is correct.
  const [lastSyncedSavedIds, setLastSyncedSavedIds] = useState(savedMemberIds);
  if (savedMemberIds !== lastSyncedSavedIds) {
    setLastSyncedSavedIds(savedMemberIds);
    setDraftMemberIds(savedMemberIds);
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [memberModes, setMemberModes] = useState<Map<string, ChannelMemberMode>>(new Map());
  const [loadingModes, setLoadingModes] = useState(true);
  const [savingMode, setSavingMode] = useState<string | undefined>();
  const modesFetched = useRef(false);

  const selectedMemberIds = useMemo(() => new Set(draftMemberIds), [draftMemberIds]);
  const selectedMembers = useMemo(
    () => members.filter((member) => selectedMemberIds.has(member.id)).sort(sortMembers),
    [members, selectedMemberIds],
  );
  const availableMembers = useMemo(
    () => members.filter((member) => !selectedMemberIds.has(member.id)).sort(sortMembers),
    [members, selectedMemberIds],
  );
  const dirty = !sameMemberIds(savedMemberIds, draftMemberIds);

  // Fetch member modes on mount
  useEffect(() => {
    if (!organizationId || modesFetched.current) return;
    modesFetched.current = true;
    setLoadingModes(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/orgs/${encodeURIComponent(organizationId)}/channels/${encodeURIComponent(channel.id)}/modes`,
        );
        if (!res.ok) return;
        const modes: MemberMode[] = await res.json().catch(() => []);
        setMemberModes(new Map(modes.map((m) => [m.memberId, m.mode])));
      } finally {
        setLoadingModes(false);
      }
    })();
  }, [organizationId, channel.id]);

  const setMode = useCallback(async (memberId: string, mode: ChannelMemberMode) => {
    if (!organizationId) return;
    setSavingMode(memberId);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/channels/${encodeURIComponent(channel.id)}/modes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId, mode }),
        },
      );
      if (!res.ok) return;
      setMemberModes((prev) => {
        const next = new Map(prev);
        next.set(memberId, mode);
        return next;
      });
    } finally {
      setSavingMode(undefined);
    }
  }, [organizationId, channel.id]);

  const toggleMember = useCallback((memberId: string) => {
    setDraftMemberIds((current) => {
      const next = new Set(current);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return normalizeMemberIds([...next]);
    });
  }, []);

  const save = useCallback(async () => {
    if (!organizationId || !dirty || saving) return;
    setSaving(true);
    setError(undefined);
    const nextMemberIds = normalizeMemberIds(draftMemberIds);
    try {
      const response = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/channels/${encodeURIComponent(channel.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberIds: nextMemberIds }),
        },
      );
      const body = (await response.json().catch(() => null)) as Channel | null;
      if (!response.ok || !body) {
        throw new Error("Unable to update channel members.");
      }
      const nextSavedMemberIds = normalizeMemberIds(body.memberIds);
      setDraftMemberIds(nextSavedMemberIds);
      onSaved(nextSavedMemberIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update channel members.");
    } finally {
      setSaving(false);
    }
  }, [channel.id, dirty, draftMemberIds, organizationId, onSaved, saving]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Members
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {savedMemberIds.length} in channel
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || !organizationId}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving" : "Save"}
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            In channel
          </p>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {selectedMembers.length > 0 ? (
              selectedMembers.map((member, index) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  checked
                  disabled={saving}
                  onToggle={toggleMember}
                  colorIndex={index}
                  mode={member.kind === "agent" ? memberModes.get(member.id) ?? "active" : undefined}
                  modeLoading={loadingModes || savingMode === member.id}
                  onModeChange={member.kind === "agent" ? (mode) => void setMode(member.id, mode) : undefined}
                />
              ))
            ) : (
              <p className="py-2 text-xs text-zinc-500 dark:text-zinc-400">No members yet.</p>
            )}
          </div>
        </section>

        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            Available
          </p>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {availableMembers.length > 0 ? (
              availableMembers.map((member, index) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  checked={false}
                  disabled={saving}
                  onToggle={toggleMember}
                  colorIndex={selectedMembers.length + index}
                  mode={member.kind === "agent" ? memberModes.get(member.id) ?? "active" : undefined}
                  modeLoading={loadingModes || savingMode === member.id}
                  onModeChange={member.kind === "agent" ? (mode) => void setMode(member.id, mode) : undefined}
                />
              ))
            ) : (
              <p className="py-2 text-xs text-zinc-500 dark:text-zinc-400">Everyone is in this channel.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  checked,
  disabled,
  onToggle,
  colorIndex,
  mode,
  modeLoading,
  onModeChange,
}: {
  member: Member;
  checked: boolean;
  disabled: boolean;
  onToggle: (memberId: string) => void;
  colorIndex: number;
  mode?: ChannelMemberMode;
  modeLoading?: boolean;
  onModeChange?: (mode: ChannelMemberMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 py-2.5">
      <input
        type="checkbox"
        aria-label={`${checked ? "Remove" : "Add"} ${member.name}`}
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(member.id)}
        className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
      />
      <Avatar name={member.name} colorIndex={colorIndex} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {member.name}
          </span>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {member.kind}
          </span>
          {mode !== undefined && onModeChange ? (
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(!open);
                }}
                disabled={modeLoading}
                className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                {modeLoading ? "..." : MODE_LABELS[mode]}
                <ChevronDown className="h-3 w-3" />
              </button>
              {open && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {MODE_ORDER.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          onModeChange(m);
                          setOpen(false);
                        }}
                        className={`flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          m === mode ? "bg-violet-500/10" : ""
                        }`}
                      >
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {MODE_LABELS[m]}
                        </span>
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                          {MODE_DESCRIPTIONS[m]}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{member.roleName}</p>
      </div>
    </div>
  );
}
