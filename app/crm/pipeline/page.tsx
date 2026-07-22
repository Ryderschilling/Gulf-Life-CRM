import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types";
import PipelineBoard from "@/components/pipeline/PipelineBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline — Gulf Life CRM" };

export default async function PipelinePage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("lead_type", "owner")
    .order("updated_at", { ascending: false })
    .limit(1000);

  return <PipelineBoard initialLeads={(leads ?? []) as Lead[]} />;
}
