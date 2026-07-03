import "./globals.css";
import type { Metadata } from "next";
import { ConfirmProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Client Emulator - Tool Sandbox",
  description: "Emulate the cybersecurity tools a client runs, so agent workflows can be simulated end-to-end against realistic mock APIs.",
};

const noFlash = `(function(){try{var t=localStorage.getItem('emu-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
