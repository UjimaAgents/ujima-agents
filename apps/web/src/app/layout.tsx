import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Ujima Agents — Slack-like AI Agent Teams with Workspace-Bounded Execution",
  description: "Deploy collaborative multi-agent AI teams in your local workspace. Securely plug in Anthropic Claude, OpenAI, Gemini, local models, or bring Codex & Claude Code subscriptions with human-in-the-loop approvals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
