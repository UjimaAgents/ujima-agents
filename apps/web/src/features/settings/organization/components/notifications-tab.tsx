"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Bell, ExternalLink, Plus, Trash2, RefreshCw, AlertCircle, MessageSquare, ShieldCheck } from "lucide-react";
import { TextInput } from "@/components/ui/form-fields";
import { Modal } from "@/components/ui/modal";
import { clientFetchJson, clientFetchVoid } from "@/lib/client-api";

interface NotificationChannel {
  id: string;
  provider: "telegram" | "whatsapp" | "webhook";
  config: {
    chatId?: string;
    phone?: string;
    webhookUrl?: string;
    botTokenConfigured?: boolean;
    apiKeyConfigured?: boolean;
  };
  enabled: boolean;
  notifyMessages: boolean;
  notifyApprovals: boolean;
}

export function NotificationsTab() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formProvider, setFormProvider] = useState<"telegram" | "whatsapp" | "webhook">("telegram");
  const [guideProvider, setGuideProvider] = useState<"telegram" | "whatsapp" | "webhook" | null>(null);
  const [formBotToken, setFormBotToken] = useState("");
  const [formChatId, setFormChatId] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formWebhookUrl, setFormWebhookUrl] = useState("");

  const fetched = useRef(false);
  const resetNotificationForm = () => {
    setShowForm(false);
    setFormBotToken("");
    setFormChatId("");
    setFormPhone("");
    setFormApiKey("");
    setFormWebhookUrl("");
  };
  const fetchChannels = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await clientFetchJson<{ channels?: NotificationChannel[] }>(
        "/api/notifications/channels",
        {},
        "Failed to fetch",
      );
      setChannels(data.channels ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchChannels().catch(() => undefined);
  }, [fetchChannels]);

  const createChannel = async () => {
    const config: Record<string, string> = {};
    if (formProvider === "telegram") {
      if (!formBotToken || !formChatId) return;
      config.botToken = formBotToken;
      config.chatId = formChatId;
    } else if (formProvider === "whatsapp") {
      if (!formPhone || !formApiKey) return;
      config.phone = formPhone;
      config.apiKey = formApiKey;
    } else {
      if (!formWebhookUrl) return;
      config.webhookUrl = formWebhookUrl;
    }
    setSaving(true); setError(null);
    try {
      await clientFetchJson<unknown>("/api/notifications/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: formProvider, config }),
      }, "Failed to create");
      resetNotificationForm();
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally { setSaving(false); }
  };

  const deleteChannel = async (id: string) => {
    try {
      await clientFetchVoid(`/api/notifications/channels/${id}`, { method: "DELETE" }, "Failed to delete");
      setChannels((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const toggleProp = async (id: string, key: "enabled" | "notifyMessages" | "notifyApprovals") => {
    const ch = channels.find((c) => c.id === id);
    if (!ch) return;
    try {
      await clientFetchJson<unknown>(`/api/notifications/channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: !ch[key] }),
      }, "Failed to update");
      setChannels((prev) => prev.map((c) => c.id === id ? { ...c, [key]: !c[key] } : c));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
      <span className="ml-3 text-sm text-zinc-500">Loading notification channels...</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Send push notifications for new messages and approval requests via Telegram or a custom webhook.
        </p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Add channel
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 space-y-3 dark:border-violet-500/30 dark:bg-violet-500/5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setFormProvider("telegram")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${formProvider === "telegram" ? "bg-violet-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300"}`}
            >
              Telegram
            </button>
            <button
              type="button"
              onClick={() => setFormProvider("whatsapp")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${formProvider === "whatsapp" ? "bg-violet-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300"}`}
            >
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() => setFormProvider("webhook")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${formProvider === "webhook" ? "bg-violet-600 text-white" : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300"}`}
            >
              Webhook
            </button>
          </div>
          {formProvider === "telegram" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Bot Token</label>
                <TextInput type="password" placeholder="123456:ABC-DEF1234ghIkl" value={formBotToken} onChange={(e) => setFormBotToken(e.target.value)} className="bg-white dark:bg-zinc-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Chat ID</label>
                <TextInput type="text" placeholder="-1001234567890" value={formChatId} onChange={(e) => setFormChatId(e.target.value)} className="bg-white dark:bg-zinc-900" />
              </div>
              <button type="button" onClick={() => setGuideProvider("telegram")} className="w-full rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-semibold text-violet-600 transition hover:bg-violet-50 dark:border-zinc-700 dark:text-violet-400 dark:hover:bg-violet-500/5">
                See how to get a bot token &amp; chat ID →
              </button>
            </>
          ) : formProvider === "whatsapp" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Phone (international format)</label>
                <TextInput type="tel" placeholder="+447778727920" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="bg-white dark:bg-zinc-900" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">CallMeBot API Key</label>
                <TextInput type="password" placeholder="123456" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} className="bg-white dark:bg-zinc-900" />
              </div>
              <button type="button" onClick={() => setGuideProvider("whatsapp")} className="w-full rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-semibold text-violet-600 transition hover:bg-violet-50 dark:border-zinc-700 dark:text-violet-400 dark:hover:bg-violet-500/5">
                See how to get a phone &amp; API key →
              </button>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Webhook URL</label>
              <TextInput type="url" placeholder="https://hooks.example.com/notify" value={formWebhookUrl} onChange={(e) => setFormWebhookUrl(e.target.value)} className="bg-white dark:bg-zinc-900" />
              <button type="button" onClick={() => setGuideProvider("webhook")} className="mt-3 w-full rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-semibold text-violet-600 transition hover:bg-violet-50 dark:border-zinc-700 dark:text-violet-400 dark:hover:bg-violet-500/5">
                See how to get a webhook URL →
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void createChannel()} disabled={saving} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50">
              {saving ? "Adding..." : "Add"}
            </button>
            <button type="button" onClick={resetNotificationForm} className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {channels.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 dark:border-zinc-700 dark:bg-zinc-900/50">
          <Bell className="mb-4 h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No notification channels</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Add a Telegram bot or webhook to get push notifications.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => {
            const config = ch.config;
            return (
              <div key={ch.id} className="flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 capitalize">{ch.provider}</span>
                    <button type="button" onClick={() => toggleProp(ch.id, "enabled")} className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${ch.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                      {ch.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <button type="button" onClick={() => toggleProp(ch.id, "notifyMessages")} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${ch.notifyMessages ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                      <MessageSquare className="h-3 w-3" /> Messages
                    </button>
                    <button type="button" onClick={() => toggleProp(ch.id, "notifyApprovals")} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${ch.notifyApprovals ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                      <ShieldCheck className="h-3 w-3" /> Approvals
                    </button>
                  </div>
                  {ch.provider === "telegram" && config.chatId ? (
                    <p className="text-[10px] text-zinc-400 font-mono">Chat ID: {config.chatId}</p>
                  ) : ch.provider === "whatsapp" && config.phone ? (
                    <p className="text-[10px] text-zinc-400 font-mono">Phone: {config.phone}</p>
                  ) : config.webhookUrl ? (
                    <p className="truncate text-[10px] text-zinc-400 font-mono">{config.webhookUrl}</p>
                  ) : null}
                </div>
                {deleteConfirm === ch.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => void deleteChannel(ch.id)} className="rounded-lg bg-red-600 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-red-700">Confirm</button>
                    <button type="button" onClick={() => setDeleteConfirm(null)} className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">Cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setDeleteConfirm(ch.id)} title="Delete" className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <GuideModal provider={guideProvider} onClose={() => setGuideProvider(null)} />
    </div>
  );
}

function GuideModal({ provider, onClose }: { provider: "telegram" | "whatsapp" | "webhook" | null; onClose: () => void }) {
  if (!provider) return null;

  const guides: Record<string, { title: string; steps: ReactNode }> = {
    telegram: {
      title: "Telegram setup",
      steps: (
        <ol className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">1</span>
            <span>Open Telegram and search for <strong>@BotFather</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">2</span>
            <span>Send <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">/newbot</code> and follow the prompts to create a bot</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">3</span>
            <span>Copy the <strong>bot token</strong> BotFather gives you (looks like <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">123456:ABC-DEF1234ghIkl</code>)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">4</span>
            <span>Start a chat with your bot and send any message</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">5</span>
            <div>
              <p>Visit this URL in your browser (replace YOUR_TOKEN):</p>
              <code className="mt-1 block break-all rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-800">https://api.telegram.org/bot&lt;YOUR_TOKEN&gt;/getUpdates</code>
              <p className="mt-1">Look for <code className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800">&quot;chat&quot;:&#123;&quot;id&quot;:-10012345&#125;</code> — that number is your <strong>chat ID</strong></p>
            </div>
          </li>
        </ol>
      ),
    },
    whatsapp: {
      title: "WhatsApp setup (CallMeBot)",
      steps: (
        <ol className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">1</span>
            <span>Save the number <strong>+34 644 76 66 43</strong> in your phone contacts</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">2</span>
            <span>Open WhatsApp and send the following message to that number: <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-800">I allow callmebot to send me messages</code></span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">3</span>
            <span>Wait 1–2 minutes — you&apos;ll receive a reply with your <strong>API key</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">4</span>
            <span>Enter your phone number (digits only, e.g. <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800">1234567890</code>) and the API key in the fields above</span>
          </li>
        </ol>
      ),
    },
    webhook: {
      title: "Webhook setup",
      steps: (
        <ol className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">1</span>
            <span>Get a webhook URL from your service (Discord, Slack, n8n, Zapier, or any custom endpoint)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">2</span>
            <div>
              <p>The service will receive a POST request with this JSON body:</p>
              <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-800">{JSON.stringify({ text: "💬 Sender in #channel:\nMessage content here" }, null, 2)}</code>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">3</span>
            <div>
              <p><strong>Discord:</strong> Server Settings → Integrations → Webhooks → New Webhook</p>
              <p className="mt-1"><strong>Slack:</strong> Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer" className="text-violet-600 underline hover:text-violet-800 dark:text-violet-400">Incoming Webhook</a> app</p>
            </div>
          </li>
        </ol>
      ),
    },
  };

  const guide = guides[provider];
  return (
    <Modal isOpen onClose={onClose} title={guide.title}>
      <div className="space-y-4">
        {guide.steps}
        <p className="pt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Need help? Visit the{" "}
          <a
            href={provider === "telegram" ? "https://core.telegram.org/bots#6-botfather" : provider === "whatsapp" ? "https://www.callmebot.com/blog/free-api-whatsapp-messages/" : "https://en.wikipedia.org/wiki/Webhook"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-violet-600 underline hover:text-violet-800 dark:text-violet-400"
          >
            {provider} docs <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </Modal>
  );
}
