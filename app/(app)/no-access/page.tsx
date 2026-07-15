import { NoAccess } from "@/components/auth/NoAccess";

export const dynamic = "force-dynamic";

// The admin-only middleware branch bounces non-admins here with ?next=<blocked
// path>. Signed-in (the (app) layout's requireUser gate guarantees it) but
// under-privileged — so we offer a real re-authorization, not a dead end.
function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/overview";
}

export default function NoAccessPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNext(searchParams?.next);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-[440px]">
        <NoAccess next={next} />
      </div>
    </div>
  );
}
