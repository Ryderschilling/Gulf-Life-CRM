import { createClient } from "@/lib/supabase/server";
import { todayStr, endOfTodayISO } from "@/lib/dates";
import type { Todo, EmailDraft, Lead, DailyDigest } from "@/lib/types";
import TodoPageClient, { type NeedsReplyItem } from "@/components/todo/TodoPageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "To-Do — Gulf Life CRM" };

export default async function TodoPage() {
  const supabase = await createClient();

  // "Due" = follow-up date is today or earlier, by the CRM-local calendar (lib/dates.ts).

  const [
    { data: todos },
    { data: drafts },
    { data: followUps },
    { data: digest },
    { data: recentSms },
    { data: recentEmailActs },
  ] = await Promise.all([
    supabase
      .from("todos")
      .select("*, lead:leads!todos_linked_lead_id_fkey(id, name)")
      .eq("is_archived", false)
      .order("is_completed", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("email_drafts")
      .select("*, lead:leads(id, name, status, lead_type, email, phone)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("leads")
      .select("*")
      .eq("lead_type", "owner")
      .lte("next_follow_up_at", endOfTodayISO())
      .not("status", "in", '("closed_won","closed_lost")')
      .order("next_follow_up_at", { ascending: true })
      .limit(50),
    supabase
      .from("daily_digests")
      .select("*")
      .eq("digest_date", todayStr())
      .eq("digest_type", "sales_rep")
      .maybeSingle(),
    // Conversation tails for "needs reply" — same rule as the Inbox:
    // if the newest message in a conversation is THEIRS, it needs an answer.
    supabase
      .from("sms_messages")
      .select("lead_id, body, direction, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("lead_activities")
      .select("lead_id, type, body, created_at")
      .in("type", ["email_sent", "email_received"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  // ── Needs reply: newest message per lead, both channels merged ──
  const stream = [
    ...(recentSms ?? []).map(m => ({
      lead_id: m.lead_id as string,
      at: m.created_at as string,
      inbound: m.direction === "inbound",
      channel: "sms" as const,
      body: (m.body as string) ?? "",
    })),
    ...(recentEmailActs ?? []).map(a => ({
      lead_id: a.lead_id as string,
      at: a.created_at as string,
      inbound: a.type === "email_received",
      channel: "email" as const,
      body: (a.body as string) ?? "",
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const latestSeen = new Set<string>();
  const needsReplyRaw: typeof stream = [];
  for (const s of stream) {
    if (latestSeen.has(s.lead_id)) continue;
    latestSeen.add(s.lead_id);
    if (s.inbound) needsReplyRaw.push(s);
  }

  // ── Fresh lead records: digest priority leads (live last_contacted_at +
  // contact info for the popups) and needs-reply leads, in one query. ──
  const priorityIds = ((digest as DailyDigest | null)?.content?.priority_leads ?? []).map(p => p.lead_id);
  const lookupIds = Array.from(new Set([...priorityIds, ...needsReplyRaw.map(s => s.lead_id)]));
  let leadRecords: Lead[] = [];
  if (lookupIds.length > 0) {
    const { data } = await supabase.from("leads").select("*").in("id", lookupIds);
    leadRecords = (data ?? []) as Lead[];
  }
  const recById = new Map(leadRecords.map(l => [l.id, l]));

  const needsReply: NeedsReplyItem[] = needsReplyRaw
    .map(s => {
      const lead = recById.get(s.lead_id);
      if (!lead || lead.lead_type !== "owner") return null;
      return { lead, channel: s.channel, body: s.body, at: s.at };
    })
    .filter((x): x is NeedsReplyItem => x !== null);

  return (
    <TodoPageClient
      todos={(todos ?? []) as Todo[]}
      drafts={(drafts ?? []) as EmailDraft[]}
      followUps={(followUps ?? []) as Lead[]}
      needsReply={needsReply}
      priorityLeadRecords={leadRecords}
      initialDigest={(digest as DailyDigest | null) ?? null}
    />
  );
}
