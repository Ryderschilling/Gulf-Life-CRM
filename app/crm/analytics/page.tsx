import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segment";
import type { Lead } from "@/lib/types";
import AnalyticsClient from "@/components/analytics/AnalyticsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics — Gulf Life CRM" };

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const segment = await getSegment();

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

  const [{ data: leads }, { data: activities }] = await Promise.all([
    supabase.from("leads").select("id, lead_type, status, source, created_at, updated_at, last_contacted_at, next_follow_up_at").eq("lead_type", "owner").eq("relationship", segment).limit(5000),
    supabase.from("lead_activities").select("type, created_at").gte("created_at", sixtyDaysAgo).limit(5000),
  ]);

  return (
    <AnalyticsClient
      leads={(leads ?? []) as Lead[]}
      activities={(activities ?? []) as { type: string; created_at: string }[]}
    />
  );
}
