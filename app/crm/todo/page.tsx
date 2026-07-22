import { createClient } from "@/lib/supabase/server";
import type { Todo, EmailDraft, Lead, DailyDigest } from "@/lib/types";
import TodoPageClient from "@/components/todo/TodoPageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "To-Do — Gulf Life CRM" };

export default async function TodoPage() {
  const supabase = await createClient();

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const [{ data: todos }, { data: drafts }, { data: followUps }, { data: digest }] = await Promise.all([
    supabase
      .from("todos")
      .select("*, lead:leads!todos_linked_lead_id_fkey(id, name)")
      .eq("is_archived", false)
      .order("is_completed", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("email_drafts")
      .select("*, lead:leads(id, name, status, lead_type)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("leads")
      .select("*")
      .eq("lead_type", "owner")
      .lte("next_follow_up_at", endOfToday.toISOString())
      .not("status", "in", '("closed_won","closed_lost")')
      .order("next_follow_up_at", { ascending: true })
      .limit(50),
    supabase
      .from("daily_digests")
      .select("*")
      .eq("digest_date", todayStr)
      .eq("digest_type", "sales_rep")
      .maybeSingle(),
  ]);

  return (
    <TodoPageClient
      todos={(todos ?? []) as Todo[]}
      drafts={(drafts ?? []) as EmailDraft[]}
      followUps={(followUps ?? []) as Lead[]}
      initialDigest={(digest as DailyDigest | null) ?? null}
    />
  );
}
