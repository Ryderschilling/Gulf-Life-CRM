import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/layout/Sidebar";
import AIDrawer from "@/components/ai/AIDrawer";
import { Toaster } from "react-hot-toast";
import { getSegment } from "@/lib/segment";
import { countPendingTodoItems } from "@/lib/badge";
import { DeactivatedScreen } from "@/components/auth/PasswordGate";
import type { Profile } from "@/lib/types";

export default async function CRMLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const segment = await getSegment();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const rawName = profile?.full_name ?? "";
  const displayName = rawName && !rawName.includes("@")
    ? rawName
    : user.email?.split("@")[0] ?? "User";

  const profileWithName: Profile | null = profile
    ? { ...profile, full_name: displayName }
    : null;

  // Deactivated: the auth ban stops new sign-ins; this ends live sessions.
  if (profileWithName?.active === false) {
    return <DeactivatedScreen />;
  }

  // Pending to-do badge: open todos + pending drafts + due follow-ups.
  // Shared with /api/todos/count (which the Sidebar refetches on navigation,
  // since layouts don't re-run on soft navigation and the badge went stale).
  let pendingTodoCount = 0;
  try {
    pendingTodoCount = await countPendingTodoItems(supabase);
  } catch {
    // Schema not applied yet — badge shows 0
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar profile={profileWithName} pendingTodoCount={pendingTodoCount} segment={segment} />
      <main className="flex-1 min-w-0">
        <div className="max-w-[1240px] mx-auto px-5 md:px-8 py-7 pb-24 md:pb-10">
          {children}
        </div>
      </main>
      <AIDrawer />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            color: "#1f2941",
            border: "1px solid #ebe6da",
            borderRadius: "12px",
            fontSize: "13.5px",
            fontFamily: "Inter, system-ui, sans-serif",
            boxShadow: "0 12px 32px rgba(16,24,40,0.14)",
          },
          success: { iconTheme: { primary: "#12b76a", secondary: "#ffffff" } },
          error: { iconTheme: { primary: "#f04438", secondary: "#ffffff" } },
        }}
      />
    </div>
  );
}
