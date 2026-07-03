import { redirect } from "next/navigation";
import { countUsers } from "@/lib/auth/users";
import { SetupForm } from "@/components/auth/SetupForm";

export const dynamic = "force-dynamic";

// First-run only: create the initial administrator. Once any user exists this
// redirects to /login, so it can never be used to mint a second admin.
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  return <SetupForm />;
}
