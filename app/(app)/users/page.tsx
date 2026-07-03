import { requireAdmin } from "@/lib/auth/current";
import { listUsers, toPublicUser } from "@/lib/auth/users";
import { PageHeader } from "@/components/PageHeader";
import { UsersClient } from "@/components/users/UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = (await listUsers()).map(toPublicUser);
  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Onboard teammates and manage access. Administrators have full control (API keys, seeding, onboarding); consumers can observe the emulator and configure pub/sub."
      />
      <UsersClient initialUsers={users} meId={me.sub} />
    </div>
  );
}
