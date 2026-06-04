import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Ujima Agents",
  description: "Ujima Agents landing page",
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
          <div className="min-h-screen scroll-smooth overflow-y-auto bg-white text-zinc-950 dark:bg-[#09090b] dark:text-zinc-100">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
