// ============================================================
// lib/types.ts — shared types (v2: owner leads + guests)
// ============================================================

// ----------------------------------------
// AUTH / PROFILES
// ----------------------------------------
export interface Profile {
  id: string
  email?: string
  full_name: string | null
  role: 'owner' | 'sales_rep'
  avatar_url?: string | null
  created_at: string
  updated_at: string
}

// ----------------------------------------
// LEADS
// ----------------------------------------
export type LeadType = 'owner' | 'guest'

/** Owner sub-segment: sales prospect vs current managed homeowner. Guests ignore this. */
export type Relationship = 'prospect' | 'client'

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'nurturing'
  | 'proposal'
  | 'closed_won'
  | 'closed_lost'

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'contacted',
  'nurturing',
  'proposal',
  'closed_won',
  'closed_lost',
]

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  nurturing: 'Nurturing',
  proposal: 'Proposal',
  closed_won: 'Won',
  closed_lost: 'Lost',
}

export interface Lead {
  id: string
  lead_type: LeadType
  relationship: Relationship
  name: string
  email: string | null
  phone: string | null
  company: string | null
  status: LeadStatus
  source: string | null
  assigned_to: string | null
  property_interest: string | null
  budget_range: string | null
  move_in_timeline: string | null
  // Guest fields (Streamline)
  first_stay_at: string | null
  last_stay_at: string | null
  stay_count: number
  total_spent: number
  last_property: string | null
  // Import / sync
  extra: Record<string, string>
  import_id: string | null
  mailchimp_synced_at: string | null
  mailchimp_status: string | null
  tags: string[]
  // Tracking
  last_contacted_at: string | null
  next_follow_up_at: string | null
  created_at: string
  updated_at: string
  // Joined relations (optional)
  addresses?: LeadAddress[]
  notes?: LeadNote[]
  activities?: LeadActivity[]
}

export interface KanbanColumn {
  status: LeadStatus
  label: string
  leads: Lead[]
}

// ----------------------------------------
// ADDRESSES
// ----------------------------------------
export interface LeadAddress {
  id: string
  lead_id: string
  label: string
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
}

export type LeadAddressInsert = Omit<LeadAddress, 'id' | 'created_at' | 'updated_at'>

// ----------------------------------------
// NOTES & ACTIVITIES
// ----------------------------------------
export interface LeadNote {
  id: string
  lead_id: string
  user_id: string | null
  body: string
  created_at: string
}

export type ActivityType =
  | 'note'
  | 'email_sent'
  | 'email_received'
  | 'sms_sent'
  | 'sms_received'
  | 'call'
  | 'status_change'
  | 'ai_draft'
  | 'ai_action'
  | 'created'
  | 'imported'
  | 'mailchimp_sync'

export interface LeadActivity {
  id: string
  lead_id: string
  user_id: string | null
  type: ActivityType
  body: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

// ----------------------------------------
// IMPORTS
// ----------------------------------------
export interface ImportRun {
  id: string
  filename: string
  lead_type: LeadType
  row_count: number
  imported_count: number
  updated_count: number
  skipped_count: number
  error_count: number
  column_mapping: Record<string, string | null> | null
  errors: { row: number; message: string }[] | null
  created_by: string | null
  created_at: string
}

// ----------------------------------------
// EMAIL DRAFTS
// ----------------------------------------
export type EmailDraftStatus = 'pending' | 'sent' | 'dismissed'
export type EmailDraftTrigger = 'follow_up_due' | 'stage_change' | 'manual' | 'sequence' | 'ai_chat'

export interface EmailDraft {
  id: string
  lead_id: string
  to_email: string
  to_name: string | null
  subject: string
  body: string
  original_body?: string | null
  original_subject?: string | null
  edit_learned?: boolean
  trigger_type: EmailDraftTrigger | null
  trigger_context: Record<string, unknown> | null
  status: EmailDraftStatus
  ai_generated: boolean
  created_at: string
  updated_at: string
  sent_at: string | null
  sent_by: string | null
  dismissed_at: string | null
  dismissed_by: string | null
  lead?: Lead
}

// ----------------------------------------
// SMS
// ----------------------------------------
export type SmsStatus = 'pending' | 'sent' | 'delivered' | 'failed'

export interface SmsMessage {
  id: string
  lead_id: string
  to_phone: string
  body: string
  status: SmsStatus
  provider: string
  provider_id: string | null
  direction: 'outbound' | 'inbound'
  created_at: string
  sent_at: string | null
  created_by: string | null
  lead?: Lead
}

// ----------------------------------------
// DAILY DIGEST
// ----------------------------------------
export interface PriorityLead {
  lead_id: string
  lead_name: string
  lead_email: string | null
  lead_phone: string | null
  current_status: LeadStatus
  reason: string
  suggested_action: string
  suggested_message: string
  urgency: 'high' | 'medium' | 'low'
  days_since_contact: number | null
}

export interface DigestStats {
  total_leads: number
  new_this_week: number
  pending_follow_ups: number
  pending_email_drafts: number
  proposals_out: number
  won_this_month: number
}

export interface DigestContent {
  greeting: string
  summary: string
  priority_leads: PriorityLead[]
  stats: DigestStats
  action_items: string[]
}

export interface DailyDigest {
  id: string
  digest_date: string
  digest_type: 'sales_rep' | 'owner'
  content: DigestContent
  generated_at: string
}

// ----------------------------------------
// TODOS
// ----------------------------------------
export type TodoType = 'manual' | 'digest_action' | 'email_task' | 'follow_up_task' | 'ai_created'

export type TodoInsert = Partial<Omit<Todo, 'id' | 'created_at' | 'updated_at' | 'lead' | 'draft'>> & { title: string }

export interface Todo {
  id: string
  title: string
  description: string | null
  type: TodoType
  linked_lead_id: string | null
  linked_draft_id: string | null
  is_completed: boolean
  completed_at: string | null
  is_archived: boolean
  archived_at: string | null
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
  lead?: Lead
  draft?: EmailDraft
}

// ----------------------------------------
// AI
// ----------------------------------------
export interface AIContextFile {
  id: string
  name: string
  description: string | null
  content: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type AIMemoryType = 'style_correction' | 'lead_fact' | 'company_knowledge' | 'pattern'

export interface AIMemory {
  id: string
  type: AIMemoryType
  title: string
  content: string
  lead_id: string | null
  source: string | null
  is_active: boolean
  created_at: string
}

export interface AIChatMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: AIActionResult[]
}

export interface AIConversation {
  id: string
  title: string | null
  messages: AIChatMessage[]
  created_at: string
  updated_at: string
}

/** Record of a tool the AI executed during a chat turn (shown as chips in UI) */
export interface AIActionResult {
  tool: string
  summary: string
  ok: boolean
  lead_id?: string
}
