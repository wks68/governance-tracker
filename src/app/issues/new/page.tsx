import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/auth";
import NewIssueForm from "@/components/NewIssueForm";

export const dynamic = "force-dynamic";

export default async function NewIssuePage() {
  const currentUser = await requireCurrentUser();
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  return <NewIssueForm users={users} currentUserId={currentUser.id} />;
}
