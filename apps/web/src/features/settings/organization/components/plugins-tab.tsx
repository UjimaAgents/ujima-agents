"use client";

import { useMemo, useState, useCallback, memo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Lightbulb, Package, Plus, Search, Trash2, Upload } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { settingsFetch, settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { SettingsErrorAlert } from "@/features/settings/shared/settings-alert";
import {
  SettingsDestructiveButton,
  SettingsGhostIconButton,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsSection } from "@/features/settings/shared/settings-section";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { useWorkspaceSuggestions } from "../hooks/useWorkspaceSuggestions";

const SKILLS_PAGE_SIZE = 20;

function matchesSkillSearch(
  skill: BootstrapResponse["skills"][number],
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    skill.commandName,
    skill.description,
    skill.skillName,
    skill.pluginName,
    skill.pluginId,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

export const PluginsTab = memo(function PluginsTab({ bootstrap, createdBy }: { bootstrap: BootstrapResponse; createdBy: string }) {
  const orgId = bootstrap.organization?.id ?? "";
  const [removedSkillIds, setRemovedSkillIds] = useState<string[]>([]);
  const installedSkills = useMemo(
    () => (bootstrap.skills ?? []).filter((skill) => !removedSkillIds.includes(skill.id)),
    [bootstrap.skills, removedSkillIds],
  );
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; commandName: string } | null>(null);

  // New selection states
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

  const filteredSkills = useMemo(
    () => installedSkills.filter((skill) => matchesSkillSearch(skill, searchQuery)),
    [installedSkills, searchQuery],
  );

  const pageCount = Math.max(1, Math.ceil(filteredSkills.length / SKILLS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);

  const visibleSkills = useMemo(
    () => filteredSkills.slice(safePage * SKILLS_PAGE_SIZE, safePage * SKILLS_PAGE_SIZE + SKILLS_PAGE_SIZE),
    [filteredSkills, safePage],
  );

  const rangeStart = filteredSkills.length === 0 ? 0 : safePage * SKILLS_PAGE_SIZE + 1;
  const rangeEnd = Math.min((safePage + 1) * SKILLS_PAGE_SIZE, filteredSkills.length);

  // Selection state helpers
  const isAllPageSelected = useMemo(
    () => visibleSkills.length > 0 && visibleSkills.every((skill) => selectedSkillIds.includes(skill.id)),
    [visibleSkills, selectedSkillIds],
  );
  const isSomePageSelected = useMemo(
    () => visibleSkills.length > 0 && visibleSkills.some((skill) => selectedSkillIds.includes(skill.id)) && !isAllPageSelected,
    [visibleSkills, selectedSkillIds, isAllPageSelected],
  );
  const hasMoreMatchingSkills = useMemo(
    () => filteredSkills.length > visibleSkills.length,
    [filteredSkills.length, visibleSkills.length],
  );
  const isGlobalSelectAllActive = useMemo(
    () => selectedSkillIds.length === filteredSkills.length && filteredSkills.length > 0,
    [selectedSkillIds.length, filteredSkills.length],
  );

  const handleToggleSelectPage = useCallback(() => {
    if (isAllPageSelected) {
      const visibleIds = visibleSkills.map((s) => s.id);
      setSelectedSkillIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      const newSelections = [...selectedSkillIds];
      for (const skill of visibleSkills) {
        if (!newSelections.includes(skill.id)) {
          newSelections.push(skill.id);
        }
      }
      setSelectedSkillIds(newSelections);
    }
  }, [isAllPageSelected, visibleSkills, selectedSkillIds]);

  const install = useCallback(async (nextSourceUrl = sourceUrl) => {
    if (!nextSourceUrl.trim()) return;
    if (!orgId) {
      setError("Organization not loaded. Refresh the page and try again.");
      return;
    }
    setError(null);
    setInstalling(true);
    try {
      await settingsFetch(
        "/api/settings/plugins/install",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            createdBy,
            sourceUrl: nextSourceUrl.trim(),
          }),
        },
        "Failed to install skill.",
      );
      setSourceUrl("");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install skill.");
    } finally {
      setInstalling(false);
    }
  }, [orgId, createdBy, sourceUrl]);

  const deleteSkill = useCallback(async (skillId: string) => {
    setError(null);
    setBusy(`delete:${skillId}`);
    try {
      await settingsFetchVoid(
        `/api/settings/skills/${encodeURIComponent(skillId)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
        "Failed to delete skill.",
      );
      setRemovedSkillIds((current) => [...current, skillId]);
      setSelectedSkillIds((current) => current.filter((id) => id !== skillId));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete skill.");
    } finally {
      setBusy(null);
    }
  }, [orgId]);

  const deleteMultipleSkills = useCallback(async (ids: string[]) => {
    setError(null);
    setBusy("bulk-delete");
    try {
      for (const id of ids) {
        await settingsFetchVoid(
          `/api/settings/skills/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(orgId)}`,
          { method: "DELETE" },
          "Failed to delete skill.",
        );
      }
      setRemovedSkillIds((current) => [...current, ...ids]);
      setSelectedSkillIds([]);
      setPendingBulkDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete selected skills.");
    } finally {
      setBusy(null);
    }
  }, [orgId]);

  const { workspaces: suggestionWorkspaces, fetching: fetchingSuggestions, refresh: refreshSuggestions } = useWorkspaceSuggestions(orgId);

  const installedPluginIds = useMemo(
    () => new Set(installedSkills.map((s) => s.pluginId)),
    [installedSkills],
  );
  const installedSkillKeys = useMemo(
    () => new Set(installedSkills.map((s) => `${s.pluginId}::${s.skillName}`)),
    [installedSkills],
  );

  const suggestedPluginWorkspaces = useMemo(
    () => suggestionWorkspaces
      .map((ws) => ({
        ...ws,
        pluginInstalls: ws.pluginInstalls.filter((p) => !installedPluginIds.has(p.pluginId)),
        skillInstalls: ws.skillInstalls.filter((s) => !installedSkillKeys.has(`${s.pluginId}::${s.skillName}`)),
      }))
      .filter((ws) => ws.pluginInstalls.length > 0 || ws.skillInstalls.length > 0),
    [suggestionWorkspaces, installedPluginIds, installedSkillKeys],
  );

  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [expandedPluginWorkspace, setExpandedPluginWorkspace] = useState<string | null>(null);
  const [suggestionInstalling, setSuggestionInstalling] = useState<string | null>(null);

  const installFromSuggestion = useCallback(async (sourceUrl: string) => {
    if (!orgId) return;
    setSuggestionInstalling(sourceUrl);
    setError(null);
    try {
      await settingsFetch(
        "/api/settings/plugins/install",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            createdBy,
            sourceUrl: sourceUrl.trim(),
          }),
        },
        "Failed to install skill.",
      );
      await refreshSuggestions();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install skill.");
    } finally {
      setSuggestionInstalling(null);
    }
  }, [orgId, createdBy, refreshSuggestions]);

  const sectionTitle =
    installedSkills.length > 0 ? `Installed skills (${installedSkills.length})` : "Installed skills";

  return (
    <>
      <SettingsTabActions>
        <SettingsPrimaryButton onClick={() => void install()} disabled={installing || !sourceUrl.trim()}>
          <Plus className="h-4 w-4" />
          Install
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {error ? <SettingsErrorAlert message={error} /> : null}

      <SettingsSection title="Install skill from repo">
        <div className="flex gap-2">
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="owner/repo, marketplace URL, or plugin folder URL"
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <SettingsSecondaryButton onClick={() => void install()} disabled={installing || !sourceUrl.trim()}>
            Install
          </SettingsSecondaryButton>
        </div>
      </SettingsSection>

      <SettingsSection
        title={sectionTitle}
        description="Available to the agent prompt and, when user-invocable, as slash commands."
      >
        {installedSkills.length === 0 ? (
          <SettingsEmptyState icon={Package} title="No skills installed" description="Install a skill repo to get started." />
        ) : (
          <>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Search by command, description, plugin, or skill name"
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>

            {filteredSkills.length === 0 ? (
              <SettingsEmptyState
                icon={Search}
                title="No matching skills"
                description={`Nothing matched "${searchQuery.trim()}". Try a different search.`}
              />
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between rounded-lg bg-zinc-50/50 border border-zinc-100 p-2 pl-3 dark:bg-zinc-900/20 dark:border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = isSomePageSelected;
                        }
                      }}
                      onChange={handleToggleSelectPage}
                      className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-zinc-600 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {selectedSkillIds.length > 0 ? `${selectedSkillIds.length} selected` : "Select Page"}
                    </span>
                  </div>
                  {selectedSkillIds.length > 0 ? (
                    <SettingsDestructiveButton onClick={() => setPendingBulkDelete(true)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Selected
                    </SettingsDestructiveButton>
                  ) : null}
                </div>

                {isAllPageSelected && hasMoreMatchingSkills && !isGlobalSelectAllActive ? (
                  <div className="mb-4 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-2.5 text-center text-xs text-zinc-600 dark:text-zinc-400">
                    All {visibleSkills.length} skills on this page are selected.{" "}
                    <button
                      onClick={() => setSelectedSkillIds(filteredSkills.map((s) => s.id))}
                      className="font-medium text-zinc-950 hover:underline dark:text-zinc-100"
                    >
                      Select all {filteredSkills.length} matching skills
                    </button>
                  </div>
                ) : null}

                {isGlobalSelectAllActive ? (
                  <div className="mb-4 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 p-2.5 text-center text-xs text-zinc-600 dark:text-zinc-400">
                    All {filteredSkills.length} matching skills are selected.{" "}
                    <button
                      onClick={() => setSelectedSkillIds([])}
                      className="font-medium text-zinc-950 hover:underline dark:text-zinc-100"
                    >
                      Clear selection
                    </button>
                  </div>
                ) : null}

                <SettingsList>
                  {visibleSkills.map((skill) => (
                    <SettingsListRow
                      key={skill.id}
                      leading={
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedSkillIds.includes(skill.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSkillIds((prev) => [...prev, skill.id]);
                              } else {
                                setSelectedSkillIds((prev) => prev.filter((id) => id !== skill.id));
                              }
                            }}
                            className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-zinc-600 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                          />
                          <SettingsRowIcon icon={Package} />
                        </div>
                      }
                      primary={skill.commandName}
                      secondary={skill.description || skill.pluginName}
                      actions={
                        <SettingsGhostIconButton
                          title="Delete skill"
                          disabled={busy === `delete:${skill.id}`}
                          onClick={() => setPendingDelete({ id: skill.id, commandName: skill.commandName })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </SettingsGhostIconButton>
                      }
                    />
                  ))}
                </SettingsList>
                {filteredSkills.length > SKILLS_PAGE_SIZE ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Showing {rangeStart}–{rangeEnd} of {filteredSkills.length}
                      {searchQuery.trim() ? ` (${installedSkills.length} total)` : ""}
                    </p>
                    <div className="flex items-center gap-2">
                      <SettingsSecondaryButton
                        disabled={safePage === 0}
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </SettingsSecondaryButton>
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Page {safePage + 1} of {pageCount}
                      </span>
                      <SettingsSecondaryButton
                        disabled={safePage >= pageCount - 1}
                        onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </SettingsSecondaryButton>
                    </div>
                  </div>
                ) : searchQuery.trim() ? (
                  <p className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {filteredSkills.length} match{filteredSkills.length === 1 ? "" : "es"} of {installedSkills.length} installed
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </SettingsSection>

      {!fetchingSuggestions && suggestedPluginWorkspaces.length > 0 ? (
        <SettingsSection
          title="Suggestions from other workspaces"
          description="Plugins and skills found in other workspaces that haven't been installed here."
          className="border-t border-zinc-200 pt-8 dark:border-zinc-800"
        >
          <button
            type="button"
            onClick={() => setSuggestionsOpen((v) => !v)}
            className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            <Lightbulb className="h-4 w-4 text-amber-500" />
            {suggestionsOpen ? "Hide suggestions" : `Show ${suggestedPluginWorkspaces.reduce((sum, ws) => sum + ws.pluginInstalls.length + ws.skillInstalls.length, 0)} suggestions`}
            {suggestionsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {suggestionsOpen ? (
            <div className="space-y-4">
              {suggestedPluginWorkspaces.map((ws) => (
                <div key={ws.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {ws.name}
                    </span>
                    <SettingsSecondaryButton
                      onClick={async () => {
                        for (const p of ws.pluginInstalls) {
                          await installFromSuggestion(p.sourceUrl);
                        }
                      }}
                      disabled={suggestionInstalling !== null}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Sync all
                    </SettingsSecondaryButton>
                  </div>
                  {ws.pluginInstalls.map((plugin) => {
                    const isExpanded = expandedPluginWorkspace === `${ws.id}::${plugin.id}`;
                    const wsSkills = ws.skillInstalls.filter((s) => s.pluginId === plugin.pluginId);
                    return (
                      <div key={plugin.id} className="mb-2 last:mb-0">
                        <SettingsListRow
                          leading={<SettingsRowIcon icon={Package} />}
                          primary={plugin.pluginName}
                          secondary={
                            <span className="text-xs text-zinc-400">{plugin.sourceUrl}</span>
                          }
                          actions={
                            <div className="flex items-center gap-2">
                              {wsSkills.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedPluginWorkspace(isExpanded ? null : `${ws.id}::${plugin.id}`)
                                  }
                                  className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              ) : null}
                              <SettingsSecondaryButton
                                disabled={suggestionInstalling === plugin.sourceUrl}
                                onClick={() => void installFromSuggestion(plugin.sourceUrl)}
                              >
                                {suggestionInstalling === plugin.sourceUrl ? "…" : "Install"}
                              </SettingsSecondaryButton>
                            </div>
                          }
                        />
                        {isExpanded && wsSkills.length > 0 ? (
                          <div className="ml-6 mt-1 space-y-1 border-l border-zinc-200 pl-4 dark:border-zinc-700">
                            {wsSkills.map((skill) => (
                              <div
                                key={skill.id}
                                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                                    /{skill.commandName}
                                  </span>
                                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {skill.description}
                                  </span>
                                </div>
                                {skill.userInvocable ? (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                    User
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {ws.skillInstalls.filter((s) => !ws.pluginInstalls.some((p) => p.pluginId === s.pluginId)).length > 0 ? (
                    <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                      {ws.skillInstalls.filter((s) => !ws.pluginInstalls.some((p) => p.pluginId === s.pluginId)).length} orphan skill(s) without a parent plugin in this workspace
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete skill?"
        message={
          pendingDelete
            ? `Remove /${pendingDelete.commandName} from this organization.`
            : ""
        }
        confirmLabel="Delete"
        busy={pendingDelete ? busy === `delete:${pendingDelete.id}` : false}
        onConfirm={() => {
          if (pendingDelete) void deleteSkill(pendingDelete.id);
        }}
      />

      <ConfirmDialog
        isOpen={pendingBulkDelete}
        onClose={() => setPendingBulkDelete(false)}
        title="Delete multiple skills?"
        message={`Are you sure you want to delete ${selectedSkillIds.length} selected skill${selectedSkillIds.length === 1 ? "" : "s"}?`}
        confirmLabel="Delete Selected"
        busy={busy === "bulk-delete"}
        onConfirm={() => void deleteMultipleSkills(selectedSkillIds)}
      />
    </>
  );
});
