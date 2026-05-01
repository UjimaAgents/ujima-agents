import { Select } from "@/components/ui/select";
import { FieldShell } from "@/components/ui/form-fields";
import { defaultModelForProvider, getModelOptionsForProvider } from "@ujima/api-schema";
import { PROVIDER_OPTIONS } from "@/features/onboarding/provider-catalog";
import { useMemo } from "react";

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
}) {
  const modelOptions = useMemo(() => {
    const options = getModelOptionsForProvider(provider);
    if (model && !options.some((option) => option.value === model)) {
      return [{ value: model, label: model }, ...options];
    }
    return options;
  }, [model, provider]);

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
          options={PROVIDER_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </FieldShell>

      <FieldShell label={modelLabel} htmlFor={modelId} hint={modelHint}>
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
