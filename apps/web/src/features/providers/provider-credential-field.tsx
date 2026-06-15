"use client";

import { useEffect, useState } from "react";
import { TextInput } from "@/components/ui/form-fields";
import {
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  isCodexProvider,
  isOpenAIProvider,
  providerLabelFromToken,
  type OpenAIAuthMode,
} from "./catalog";

export function ProviderCredentialField({
  provider,
  apiKey,
  onApiKeyChange,
  authMode,
  onAuthModeChange,
  onCodexConnectionChange,
  className,
}: {
  provider: string;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  /** Only relevant when provider is "openai" or "openai-codex". */
  authMode?: OpenAIAuthMode;
  onAuthModeChange?: (mode: OpenAIAuthMode) => void;
  onCodexConnectionChange?: (connected: boolean) => void;
  className?: string;
}) {
  const isOpenAI = isOpenAIProvider(provider);
  const isCodex = isCodexProvider(provider);
  const effectiveMode: OpenAIAuthMode = isCodex ? "codex" : (authMode ?? "apikey");

  const [loginState, setLoginState] = useState<
    "checking" | "idle" | "starting" | "authorizing" | "completed" | "failed"
  >("checking");
  const [userCode, setUserCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [loginId, setLoginId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // Check initial login status
  useEffect(() => {
    if (effectiveMode !== "codex") {
      onCodexConnectionChange?.(false);
      return;
    }
    onCodexConnectionChange?.(false);

    let active = true;
    async function checkStatus() {
      try {
        const res = await fetch("/api/auth/openai/codex/status?loginId=check");
        if (!active) return;
        if (res.ok) {
          const body = await res.json();
          if (body.status === "completed") {
            setLoginState("completed");
            onCodexConnectionChange?.(true);
          } else {
            setLoginState("idle");
            onCodexConnectionChange?.(false);
          }
        } else {
          setLoginState("idle");
          onCodexConnectionChange?.(false);
        }
      } catch {
        if (active) {
          setLoginState("idle");
          onCodexConnectionChange?.(false);
        }
      }
    }
    void checkStatus();
    return () => {
      active = false;
    };
  }, [effectiveMode, onCodexConnectionChange]);

  // Handle polling during authorization
  useEffect(() => {
    if (loginState !== "authorizing" || !loginId) return;

    let active = true;
    let timer: NodeJS.Timeout;

    async function poll() {
      try {
        const res = await fetch(`/api/auth/openai/codex/status?loginId=${encodeURIComponent(loginId)}`);
        if (!active) return;
        if (res.ok) {
          const body = await res.json();
          if (body.status === "completed") {
            setLoginState("completed");
            onCodexConnectionChange?.(true);
          } else if (body.status === "failed" || body.status === "timeout") {
            setLoginState("failed");
            setErrorMsg(body.error || "Authorization failed or timed out.");
            onCodexConnectionChange?.(false);
          } else {
            timer = setTimeout(poll, 2000);
          }
        } else {
          timer = setTimeout(poll, 2000);
        }
      } catch {
        if (active) timer = setTimeout(poll, 2000);
      }
    }

    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loginState, loginId, onCodexConnectionChange]);

  const handleStartLogin = async () => {
    setLoginState("starting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth/openai/codex/start", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to start login flow.");
      }
      const data = await res.json();
      setUserCode(data.userCode);
      setVerificationUrl(data.verificationUrl);
      setLoginId(data.loginId);
      setLoginState("authorizing");
      onCodexConnectionChange?.(false);
    } catch (err) {
      setLoginState("failed");
      setErrorMsg(err instanceof Error ? err.message : String(err));
      onCodexConnectionChange?.(false);
    }
  };

  const handleCopyCode = () => {
    void navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isOpenAI) {
    return (
      <div className={className ?? "min-w-0 flex-1 space-y-3"}>
        {/* Auth mode picker */}
        {onAuthModeChange && !isCodex ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onAuthModeChange("apikey");
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                effectiveMode === "apikey"
                  ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              API key
            </button>
            <button
              type="button"
              onClick={() => {
                onAuthModeChange("codex");
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                effectiveMode === "codex"
                  ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              ChatGPT subscription
            </button>
          </div>
        ) : null}

        {/* Credential input based on mode */}
        {effectiveMode === "apikey" ? (
          <TextInput
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="OpenAI API key (sk-…)"
          />
        ) : (
          <div className="space-y-3">
            {loginState === "checking" && (
              <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                Checking login status...
              </div>
            )}

            {loginState === "idle" && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  ChatGPT Subscription Login
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Connect your ChatGPT Plus or Pro subscription to use OpenAI models without consumption limits or API billing.
                </p>
                <button
                  type="button"
                  onClick={handleStartLogin}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 active:bg-violet-800"
                >
                  Connect subscription
                </button>
              </div>
            )}

            {loginState === "starting" && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 flex flex-col items-center justify-center py-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                <p className="mt-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Contacting Codex App Server...
                </p>
              </div>
            )}

            {loginState === "authorizing" && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-400">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                  </span>
                  Waiting for authorization...
                </div>

                <div className="bg-white border border-zinc-100 rounded-lg p-3 dark:bg-zinc-950 dark:border-zinc-900 flex items-center justify-between">
                  <div className="font-mono text-lg font-bold tracking-wider text-zinc-800 dark:text-zinc-200 select-all">
                    {userCode}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 flex items-center gap-1.5 border border-zinc-200 rounded px-2 py-1 dark:border-zinc-800 transition bg-zinc-50 dark:bg-zinc-900"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-green-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy code
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <p>1. Open the OpenAI device page:</p>
                  <a
                    href={verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-violet-600 underline hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300"
                  >
                    {verificationUrl}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <p className="mt-2">2. Paste the code above to authorize this application.</p>
                </div>
              </div>
            )}

            {loginState === "completed" && (
              <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 dark:border-green-950 dark:bg-green-950/20 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                    ChatGPT subscription connected
                  </p>
                  <p className="mt-1 text-xs text-green-700/80 dark:text-green-400/80">
                    Ujima is connected to your ChatGPT session and will use your subscription quota.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartLogin}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-green-700 underline hover:text-green-950 dark:text-green-400 dark:hover:text-green-200 animate-fade-in"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Reconnect subscription
                  </button>
                </div>
              </div>
            )}

            {loginState === "failed" && (
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-950 dark:bg-red-950/20">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                      Connection failed
                    </p>
                    <p className="mt-1 text-xs text-red-700/80 dark:text-red-400/80">
                      {errorMsg}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleStartLogin}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 active:bg-red-800"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
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
