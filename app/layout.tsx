import "./globals.css";
import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export const metadata: Metadata = {
  title: "Client Emulator — Tool Sandbox",
  description: "Emulate the cybersecurity tools a client runs, so agent workflows can be simulated end-to-end against realistic mock APIs.",
};

const noFlash = `(function(){try{var t=localStorage.getItem('emu-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body>
        <div className="bg-aurora flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="emu-scroll min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
