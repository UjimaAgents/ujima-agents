"use client";

import { TextInput } from "@/components/ui/form-fields";
import { providerLabelFromToken } from "./catalog";
import { isOAuthProvider } from "./constants";
import { OpenAISignInButton, openOpenAIOAuthPopup } from "./openai-sign-in-button";
import { useOpenAICodexOAuth } from "./use-openai-codex-oauth";

export function ProviderCredentialField({
  provider,
  apiKey,
  onApiKeyChange,
  className,
  onOAuthError,
}: {
  provider: string;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  className?: string;
  onOAuthError?: (message: string) => void;
}) {
  useOpenAICodexOAuth(
    (token) => {
      if (isOAuthProvider(provider)) {
        onApiKeyChange(token);
      }
    },
    onOAuthError,
  );

  if (isOAuthProvider(provider)) {
    return (
      <OpenAISignInButton
        signedIn={Boolean(apiKey.trim())}
        onClick={openOpenAIOAuthPopup}
        className={className ?? "min-w-0 flex-1"}
      />
    );
  }

  return (
    <TextInput
      type="password"
      value={apiKey}
      onChange={(e) => onApiKeyChange(e.target.value)}
      className={className ?? "min-w-0 flex-1"}
      placeholder={provider ? `${providerLabelFromToken(provider)} API key` : "Provider API key"}
    />
  );
}
