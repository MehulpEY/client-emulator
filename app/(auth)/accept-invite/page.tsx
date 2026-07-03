import { hashInviteToken } from "@/lib/auth/invite";
import { getUserByInviteHash } from "@/lib/auth/users";
import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import type { Role } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  let valid = false;
  let email = "";
  let name = "";
  let role: Role = "consumer";

  if (token) {
    const user = await getUserByInviteHash(hashInviteToken(token));
    if (
      user &&
      user.status === "invited" &&
      user.invite_expires_at &&
      new Date(user.invite_expires_at).getTime() > Date.now()
    ) {
      valid = true;
      email = user.email;
      name = user.name;
      role = user.role;
    }
  }

  return <AcceptInviteForm token={token} valid={valid} email={email} name={name} role={role} />;
}
