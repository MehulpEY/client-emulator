import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { requireUser } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

// Authenticated app shell. requireUser() re-validates the session against the DB
// on every navigation and redirects to /login when there's no active account -
// so the chrome (and everything under it) is never rendered for a signed-out user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="bg-aurora flex h-screen overflow-hidden">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="emu-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
