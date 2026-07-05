import { getUserByResetHash } from "@/lib/auth/users";
import { hashResetToken } from "@/lib/auth/reset";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const dynamic = "force-dynamic";

// The token is validated server-side so the form renders either the reset
// fields or a clear invalid/expired state (mirrors accept-invite).
export default async function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = (searchParams.token || "").trim();
  let valid = false;
  let email = "";
  if (token) {
    try {
      const user = await getUserByResetHash(hashResetToken(token));
      if (
        user &&
        user.status === "active" &&
        user.reset_expires_at &&
        new Date(user.reset_expires_at).getTime() >= Date.now()
      ) {
        valid = true;
        email = user.email;
      }
    } catch {
      // DB unreachable -> treat as invalid; the form shows the retry path.
    }
  }
  return <ResetPasswordForm token={token} valid={valid} email={email} />;
}
