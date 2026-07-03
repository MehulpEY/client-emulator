import Link from "next/link";
import { Brand } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

// Bare shell for the signed-out screens (login / setup / accept-invite). No app
// chrome; just the brand + theme toggle over the ambient background, so both
// dark and light themes are supported here too.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-aurora flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
        <Link href="/"><Brand /></Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-[400px] pb-14">{children}</div>
      </main>
    </div>
  );
}
