import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { countUsers } from "@/lib/auth/users";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/overview");
  if ((await countUsers()) === 0) redirect("/setup");
  return <LoginForm />;
}
