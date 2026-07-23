import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isAdmin } from "@/lib/auth";
import CampaignsClient from "@/components/campaigns/CampaignsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns — Gulf Life CRM" };

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Mass sends are admin-only (nav is hidden for members; this covers direct URLs)
  const profile = await getCurrentProfile();
  if (!isAdmin(profile)) redirect("/crm");

  return <CampaignsClient userEmail={user?.email ?? ""} />;
}
