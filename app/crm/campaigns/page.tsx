import { createClient } from "@/lib/supabase/server";
import CampaignsClient from "@/components/campaigns/CampaignsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns — Gulf Life CRM" };

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <CampaignsClient userEmail={user?.email ?? ""} />;
}
