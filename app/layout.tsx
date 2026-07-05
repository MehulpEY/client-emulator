import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ConfirmProvider } from "@/components/ui";

// Self-hosted via next/font (no runtime CDN request). The CSS variables are
// consumed by globals.css / tailwind.config.ts as the sans + mono stacks.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Client Emulator - Tool Sandbox",
  description: "Emulate the cybersecurity tools a client runs, so agent workflows can be simulated end-to-end against realistic mock APIs.",
};

const noFlash = `(function(){try{var t=localStorage.getItem('emu-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
