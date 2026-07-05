import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/overview");
  return <ForgotPasswordForm />;
}
