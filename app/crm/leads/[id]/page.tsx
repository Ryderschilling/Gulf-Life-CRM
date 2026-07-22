import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Lead, LeadActivity, LeadAddress, LeadNote, SmsMessage, EmailDraft } from "@/lib/types";
import LeadDetail from "@/components/leads/LeadDetail";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: lead }, { data: activities }, { data: notes }, { data: addresses }, { data: sms }, { data: drafts }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("lead_addresses").select("*").eq("lead_id", id).order("is_primary", { ascending: false }),
    supabase.from("sms_messages").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("email_drafts").select("*").eq("lead_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
  ]);

  if (!lead) notFound();

  return (
    <LeadDetail
      lead={lead as Lead}
      activities={(activities ?? []) as LeadActivity[]}
      notes={(notes ?? []) as LeadNote[]}
      addresses={(addresses ?? []) as LeadAddress[]}
      smsMessages={(sms ?? []) as SmsMessage[]}
      pendingDrafts={(drafts ?? []) as EmailDraft[]}
    />
  );
}
