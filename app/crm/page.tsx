import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types";
import LeadsOverview from "@/components/leads/LeadsOverview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview — Gulf Life CRM" };

export default async function OverviewPage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("lead_type", "owner")
    .order("updated_at", { ascending: false })
    .limit(2000);

  return <LeadsOverview leads={(leads ?? []) as Lead[]} />;
}
