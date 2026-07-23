import { redirect } from "next/navigation";
import { getCurrentProfile, isAdmin } from "@/lib/auth";
import ImportWizard from "@/components/import/ImportWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import — Gulf Life CRM" };

export default async function ImportPage() {
  // Bulk imports are admin-only (nav is hidden for members; this covers direct URLs)
  const profile = await getCurrentProfile();
  if (!isAdmin(profile)) redirect("/crm");

  return <ImportWizard />;
}
