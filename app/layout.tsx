import "./globals.css";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { ConfirmProvider } from "@/components/ui";

// Fonts are self-hosted from bundled files (app/fonts) via next/font/local, so
// neither dev nor build ever reaches out to Google Fonts. This avoids the
// "Retrying.../The user aborted a request." download failures on networks that
// block or throttle fonts.gstatic.com. Both are latin variable fonts (one file
// covers the full weight range). The CSS variables are consumed by globals.css /
// tailwind.config.ts as the sans + mono stacks.
const inter = localFont({
  src: "./fonts/Inter-latin-var.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});
const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin-var.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
});

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
