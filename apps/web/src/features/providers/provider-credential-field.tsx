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
  isClaudeCodeProvider,
  isOpenAIProvider,
  isAnthropicProvider,
  providerLabelFromToken,
  type ProviderAuthModeUI,
} from "./catalog";
import { CLAUDE_CODE_LOGIN_HELP_PATH } from "./constants";

export function ProviderCredentialField({
  provider,
  apiKey,
  onApiKeyChange,
  authMode,
  onAuthModeChange,
  onCodexConnectionChange,
  onClaudeCodeConnectionChange,
  className,
}: {
  provider: string;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  authMode?: ProviderAuthModeUI;
  onAuthModeChange?: (mode: ProviderAuthModeUI) => void;
  onCodexConnectionChange?: (connected: boolean) => void;
  onClaudeCodeConnectionChange?: (connected: boolean) => void;
  className?: string;
}) {
  const isOpenAI = isOpenAIProvider(provider);
  const isAnthropic = isAnthropicProvider(provider);
  const isCodex = isCodexProvider(provider);
  const isClaudeCode = isClaudeCodeProvider(provider);
  const effectiveMode: ProviderAuthModeUI = isCodex ? "codex" : isClaudeCode ? "claude-code" : (authMode ?? "apikey");

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

  // Claude Code detection: check ~/.claude/ directory
  const [claudeCodeState, setClaudeCodeState] = useState<
    "checking" | "idle" | "completed" | "failed"
  >("checking");
  const [claudeCodeRefresh, setClaudeCodeRefresh] = useState(0);
  useEffect(() => {
    if (effectiveMode !== "claude-code") {
      onClaudeCodeConnectionChange?.(false);
      return;
    }
    onClaudeCodeConnectionChange?.(false);
    let active = true;
    async function checkClaudeCode() {
      try {
        const res = await fetch("/api/auth/anthropic/claude-code/status");
        if (!active) return;
        if (res.ok) {
          const body = await res.json();
          if (body.status === "connected") {
            setClaudeCodeState("completed");
            onClaudeCodeConnectionChange?.(true);
          } else {
            setClaudeCodeState("idle");
            onClaudeCodeConnectionChange?.(false);
          }
        }
      } catch {
        if (active) setClaudeCodeState("idle");
      }
    }
    void checkClaudeCode();
    return () => { active = false; };
  }, [effectiveMode, onClaudeCodeConnectionChange, claudeCodeRefresh]);

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

  const hasAuthModeToggle = isOpenAI || isAnthropic;

  if (hasAuthModeToggle) {
    return (
      <div className={className ?? "min-w-0 flex-1 space-y-3"}>
        {onAuthModeChange && !isCodex && !isClaudeCode ? (
          <div className="grid grid-cols-2 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => {
                onAuthModeChange("apikey");
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                effectiveMode === "apikey"
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              API key
            </button>
            <button
              type="button"
              onClick={() => {
                onAuthModeChange(isOpenAI ? "codex" : "claude-code");
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                effectiveMode === (isOpenAI ? "codex" : "claude-code")
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {isOpenAI ? "Codex" : "Claude Code"}
            </button>
          </div>
        ) : null}

        {effectiveMode === "apikey" ? (
          <TextInput
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="OpenAI API key (sk-…)"
          />
        ) : effectiveMode === "claude-code" ? (
          <div className="space-y-3">
            {claudeCodeState === "checking" && (
              <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking Claude Code login...
              </div>
            )}
            {claudeCodeState === "idle" && (
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Use local Claude Code login</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Run <code>claude auth login</code>, then refresh.</p>
                <div className="mt-3 flex gap-3">
                  <a
                    href={CLAUDE_CODE_LOGIN_HELP_PATH}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950"
                  >
                    Login help
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setClaudeCodeRefresh((value) => value + 1)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </button>
                </div>
              </div>
            )}
            {claudeCodeState === "completed" && (
              <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/20">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Claude Code connected</p>
                  <button
                    type="button"
                    onClick={() => setClaudeCodeRefresh((value) => value + 1)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline dark:text-emerald-400"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Recheck
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {loginState === "checking" && (
              <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking Codex login...
              </div>
            )}

            {loginState === "idle" && (
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Use local Codex login</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">ChatGPT Plus/Pro, no API key.</p>
                <button
                  type="button"
                  onClick={handleStartLogin}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Connect Codex
                </button>
              </div>
            )}

            {loginState === "starting" && (
              <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting login...
              </div>
            )}

            {loginState === "authorizing" && (
              <div className="space-y-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Waiting for OpenAI
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 dark:bg-zinc-950">
                  <div className="select-all font-mono text-lg font-bold tracking-wider text-zinc-900 dark:text-zinc-100">
                    {userCode}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
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

                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  <a
                    href={verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-zinc-900 underline hover:text-zinc-600 dark:text-zinc-100 dark:hover:text-zinc-300"
                  >
                    Open device page
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="ml-2">Paste code above.</span>
                </div>
              </div>
            )}

            {loginState === "completed" && (
              <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/20">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Codex connected</p>
                  <button
                    type="button"
                    onClick={handleStartLogin}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline hover:text-emerald-950 dark:text-emerald-400 dark:hover:text-emerald-200"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Reconnect
                  </button>
                </div>
              </div>
            )}

            {loginState === "failed" && (
              <div className="rounded-lg bg-red-50 p-3 dark:bg-red-950/20">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-red-800 dark:text-red-300">Login failed</p>
                    <p className="mt-1 text-xs text-red-700/80 dark:text-red-400/80">{errorMsg}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleStartLogin}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700"
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
