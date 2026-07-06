import type { Metadata } from "next";
import "./globals.css";
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
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <body className="antialiased bg-white text-zinc-950 dark:bg-[#09090b] dark:text-zinc-100" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
