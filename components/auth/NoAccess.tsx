"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Spinner } from "@/components/ui";
import { useSsoSignIn } from "@/lib/auth/useSsoSignIn";

// Friendly label for the admin-only area the user was bounced from, so the copy
// names it ("You don’t have access to Users") instead of showing a raw path.
const AREA_LABELS: Array<[string, string]> = [
  ["/users", "Users"],
  ["/keys", "API keys"],
];

function labelFor(next: string): string {
  for (const [path, label] of AREA_LABELS) {
    if (next === path || next.startsWith(path + "/")) return label;
  }
  return "that area";
}

// Shown when a signed-in user lacks the role for an admin-only area. The retry is
// a genuine re-authorization (fresh /auth via useSsoSignIn), NOT a page reload —
// so a role just granted in AutoX is picked up on the next token, without the
// user having to sign out first (integration.md: do not cache authorization).
export function NoAccess({ next }: { next: string }) {
  const { pending, error, start } = useSsoSignIn();
  const area = labelFor(next);

  return (
    <div>
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-hair bg-danger-bg text-danger">
        <ShieldAlert size={18} />
      </div>

      <div className="eyebrow mb-3">Access required</div>
      <h1 className="text-[24px] font-bold leading-[1.15] tracking-[-0.02em]">
        You don’t have access to {area}
      </h1>
      <p className="mt-2 text-[13px] leading-[1.6] text-text3">
        This area is limited to administrators. If your access was just updated in
        AutoX, refresh it to pick up the change — since you’re already signed in,
        this is a silent round-trip, not a new sign-in.
      </p>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={() => start(next)}
          disabled={pending}
          className="btn-primary h-10 w-full text-[13px]"
        >
          {pending ? <Spinner label="Rechecking access…" /> : <><ShieldAlert size={14} /> Refresh access</>}
        </button>

        {error && (
          <div className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-hair pt-4">
        <p className="text-[11.5px] leading-[1.6] text-text3">
          Still blocked after refreshing?{" "}
          <Link href="/overview" className="text-text2 transition-colors hover:text-accent-fg">
            Back to overview
          </Link>{" "}
          — or ask an administrator to grant you access in AutoX.
        </p>
      </div>
    </div>
  );
}
