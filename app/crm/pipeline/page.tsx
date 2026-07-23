import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segment";
import { getTeam } from "@/lib/auth";
import type { Lead } from "@/lib/types";
import PipelineBoard from "@/components/pipeline/PipelineBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline — Gulf Life CRM" };

export default async function PipelinePage() {
  const supabase = await createClient();
  const segment = await getSegment();

  // Clients (current homeowners) aren't worked through sales stages.
  // If somehow landed here in Client mode, point them to the directory.
  if (segment === "client") {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <h1 className="text-[19px] font-bold text-ink m-0">The pipeline is for prospects</h1>
        <p className="text-[14px] text-ink-2 mt-2 mb-5">
          Current homeowners aren&apos;t moved through sales stages. Switch back to
          Prospects to use the pipeline, or view your homeowners on the Overview.
        </p>
        <Link
          href="/crm"
          className="inline-block px-4 py-2 rounded-xl bg-accent text-white text-[13.5px] font-semibold no-underline"
        >
          Go to Homeowners
        </Link>
      </div>
    );
  }

  const [{ data: { user } }, { data: leads }, team] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("leads")
      .select("*")
      .eq("lead_type", "owner")
      .eq("relationship", "prospect")
      .order("updated_at", { ascending: false })
      .limit(1000),
    getTeam(),
  ]);

  return <PipelineBoard initialLeads={(leads ?? []) as Lead[]} team={team} meId={user?.id ?? ""} />;
}
