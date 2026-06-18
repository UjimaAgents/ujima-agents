import { Select } from "@/components/ui/select";
import { FieldShell } from "@/components/ui/form-fields";
import { defaultModelForProvider, getModelOptionsForProvider } from "@ujima/shared/browser";
import { PROVIDER_OPTIONS, normalizeProviderKey } from "@/features/providers/catalog";
import { useEffect, useMemo, useState } from "react";

export function ProviderModelFields({
  provider,
  model,
  onProviderChange,
  onModelChange,
  providerLabel = "LLM provider",
  modelLabel = "Model",
  providerHint,
  modelHint,
  providerId = "provider",
  modelId = "model",
  orgId,
}: {
  provider: string;
  model: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  providerLabel?: string;
  modelLabel?: string;
  providerHint?: string;
  modelHint?: string;
  providerId?: string;
  modelId?: string;
  /** When set, /v1/models is queried for live discovery; results merge with the static catalog. */
  orgId?: string;
}) {
  const { models: discovered, loading: discovering, error: discoverError } = useDiscoveredModels(orgId, provider);

  const modelOptions = useMemo(() => {
    const catalogOptions = getModelOptionsForProvider(provider);
    const discoveredOptions = discovered.map((id) => ({ value: id, label: id }));
    const merged = mergeOptions(discoveredOptions, catalogOptions);
    if (model && !merged.some((option) => option.value === model)) {
      return [{ value: model, label: model }, ...merged];
    }
    return merged;
  }, [model, provider, discovered]);

  const providerOptions = useMemo(() => {
    return PROVIDER_OPTIONS.map((option) => ({ value: option.token, label: option.label }));
  }, []);

  const modelHintText = discovering
    ? "Discovering models from your configured endpoint…"
    : discoverError
      ? `Falling back to catalog (${discoverError})`
      : discovered.length > 0
        ? `${discovered.length} live + ${getModelOptionsForProvider(provider).length} catalog`
        : modelHint;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FieldShell label={providerLabel} htmlFor={providerId} hint={providerHint}>
        <Select
          id={providerId}
          value={provider}
          onChange={(event) => {
            const nextProvider = event.target.value;
            onProviderChange(nextProvider);
            onModelChange(defaultModelForProvider(nextProvider));
          }}
          className="w-full"
          placeholder="Select provider"
          options={providerOptions}
        />
      </FieldShell>

      <FieldShell label={modelLabel} htmlFor={modelId} hint={modelHintText}>
        <Select
          id={modelId}
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          className="w-full"
          placeholder="Select model"
          options={modelOptions.map((option) => ({ value: option.value, label: option.label }))}
        />
      </FieldShell>
    </div>
  );
}

type ModelOption = { value: string; label: string };

function mergeOptions(primary: ModelOption[], secondary: readonly ModelOption[]): ModelOption[] {
  const seen = new Set(primary.map((o) => o.value));
  const merged: ModelOption[] = [...primary];
  for (const option of secondary) {
    if (!seen.has(option.value)) {
      merged.push(option);
      seen.add(option.value);
    }
  }
  return merged;
}

function useDiscoveredModels(orgId: string | undefined, provider: string) {
  const [state, setState] = useState<{ models: string[]; loading: boolean; error: string | null }>({
    models: [],
    loading: false,
    error: null,
  });
  const emptyState = { models: [], loading: false, error: null };
  const activeState = !orgId || !provider ? emptyState : state;

  useEffect(() => {
    if (!orgId || !provider) return;
    const normalized = normalizeProviderKey(provider);
    const controller = new AbortController();
    queueMicrotask(() => {
      setState({ models: [], loading: true, error: null });
    });
    fetch(
      `/api/settings/providers/${encodeURIComponent(normalized)}/models?organizationId=${encodeURIComponent(orgId)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `HTTP ${response.status}`);
        }
        const body = (await response.json()) as { models?: { id: string }[] };
        const ids = (body.models ?? []).map((m) => m.id).filter(Boolean);
        setState({ models: ids, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ models: [], loading: false, error: err instanceof Error ? err.message : "discovery failed" });
      });
    return () => controller.abort();
  }, [orgId, provider]);

  return activeState;
}
