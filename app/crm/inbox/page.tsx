import { createClient } from "@/lib/supabase/server";
import InboxClient from "@/components/inbox/InboxClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox — Gulf Life CRM" };

// Inbox shows ALL conversations by default (texts + emails, prospects + clients).
// The in-page All / Leads / Clients filter narrows by the lead's relationship —
// it is intentionally independent of the global sidebar segment so you never
// land on an empty inbox.
export default async function InboxPage() {
  const supabase = await createClient();

  const [{ data: sms }, { data: emails }] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("id, lead_id, body, direction, status, created_at, lead:leads(id, name, phone, email, relationship)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("lead_activities")
      .select("id, lead_id, type, body, created_at, metadata, lead:leads(id, name, phone, email, relationship)")
      .in("type", ["email_sent", "email_received"])
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return <InboxClient sms={(sms ?? []) as any} emails={(emails ?? []) as any} />;
}
