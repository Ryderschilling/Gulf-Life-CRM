import { createClient } from "@/lib/supabase/server";
import SettingsClient from "@/components/settings/SettingsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings — Gulf Life CRM" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  const isAdmin = profile?.role === "owner";

  return <SettingsClient email={user?.email ?? ""} profile={profile} isAdmin={isAdmin} />;
}
