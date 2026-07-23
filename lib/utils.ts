import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";
import type { LeadStatus, LeadType, Relationship, KanbanColumn, Lead } from "./types";
import type { PillTone } from "@/components/ui/kit";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Dates ───────────────────────────────────────────────────
export function timeAgo(date: string | null): string {
  if (!date) return "Never";
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDate(date: string | null): string {
  if (!date) return "—";
  return format(new Date(date), "MMM d, yyyy");
}

export function formatDateTime(date: string | null): string {
  if (!date) return "—";
  return format(new Date(date), "MMM d, yyyy 'at' h:mm a");
}

// ── Money ───────────────────────────────────────────────────
export function formatMoney(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ── Status config (soft pill palette, WhiteUI style) ────────
export const STATUS_CONFIG: Record<LeadStatus, { label: string; tone: PillTone; hex: string }> = {
  new:         { label: "New",       tone: "blue",   hex: "#2e90fa" },
  contacted:   { label: "Contacted", tone: "indigo", hex: "#6366f1" },
  nurturing:   { label: "Nurturing", tone: "yellow", hex: "#f79009" },
  proposal:    { label: "Proposal",  tone: "violet", hex: "#875bf7" },
  closed_won:  { label: "Won",       tone: "green",  hex: "#12b76a" },
  closed_lost: { label: "Lost",      tone: "gray",   hex: "#98a2b3" },
};

export const TYPE_CONFIG: Record<LeadType, { label: string; tone: PillTone }> = {
  owner: { label: "Owner Lead", tone: "indigo" },
  guest: { label: "Guest",      tone: "green" },
};

// Owner sub-segment pills — prospect (in the pipeline) vs client (current homeowner)
export const RELATIONSHIP_CONFIG: Record<Relationship, { label: string; tone: PillTone }> = {
  prospect: { label: "Prospect", tone: "indigo" },
  client:   { label: "Client",   tone: "green" },
};

export const ORDERED_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "nurturing",
  "proposal",
  "closed_won",
  "closed_lost",
];

export const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  referral: "Referral",
  cold_call: "Cold Call",
  social: "Social Media",
  email: "Email",
  streamline: "Streamline",
  csv_import: "CSV Import",
  other: "Other",
};

export function sourceLabel(source: string | null): string {
  if (!source) return "—";
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return phone;
}

/** Normalize to E.164 (assumes US when 10 digits) */
export function toE164(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+")) return `+${digits}`;
  return null;
}

export function buildKanbanColumns(leads: Lead[]): KanbanColumn[] {
  return ORDERED_STATUSES.map((status) => ({
    status,
    label: STATUS_CONFIG[status].label,
    leads: leads.filter((l) => l.status === status),
  }));
}

/** Follow-up urgency for a lead */
export function followUpState(lead: Lead): "overdue" | "today" | "upcoming" | null {
  if (!lead.next_follow_up_at) return null;
  const due = new Date(lead.next_follow_up_at);
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  if (due < now) return "overdue";
  if (due <= endOfDay) return "today";
  return "upcoming";
}
