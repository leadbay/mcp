// All interfaces use snake_case to match the Leadbay API (JsonNamingStrategy.SnakeCase)

export interface LeadbayError {
  error: true;
  code: string;
  message: string;
  hint: string;
}

export interface LensPayload {
  id: number;
  name: string;
  description: string | null;
  is_last_active: boolean;
  is_default?: boolean;
}

export interface LocationPayload {
  city: string | null;
  state: string | null;
  country: string | null;
  full: string | null;
  pos: [number, number] | null;
}

export interface SizePayload {
  low: number | null;
  high: number | null;
  label: string | null;
}

export interface SplitAiSummary {
  worth_pursuing: string | null;
  approach_angle: string | null;
  next_step: string | null;
}

export interface LeadTag {
  score: number;
  tag: string;
}

export interface RecommendedContactPayload {
  contact_id?: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email?: string | null;
  phone_number?: string | null;
}

export interface LeadPayload {
  id: string;
  name: string;
  score: number | null;
  ai_agent_lead_score: number | null;
  location: LocationPayload | null;
  description: string | null;
  short_description: string | null;
  size: SizePayload | null;
  website: string | null;
  logo: string | null;
  contacts_count: number;
  org_contacts_count: number;
  ai_summary: string | null;
  split_ai_summary: SplitAiSummary | null;
  liked: boolean;
  disliked: boolean;
  tags: LeadTag[];
  phone_numbers: string[];
  keywords: Array<{ keyword: string; score: number }>;
  recommended_contact_title?: string | null;
  recommended_contact?: RecommendedContactPayload | null;
  web_fetch_in_progress?: boolean;
}

export interface PaginationPayload {
  page: number;
  pages: number;
  total: number;
}

export interface WishlistResponse {
  items: LeadPayload[];
  pagination: PaginationPayload;
  computing_wishlist: boolean;
  computing_scores: boolean;
}

export interface AiAgentResponse {
  question: string;
  question_created_at: string;
  lead_id: string;
  score: number | null;
  response: string | null;
  computed_at: string | null;
  outdated_at: string | null;
}

export interface ContactEnrichment {
  done: boolean;
  credits_used: number;
  email_requested: boolean;
  phone_requested: boolean;
}

export interface ContactPayload {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  linkedin_page: string | null;
  job_title: string | null;
  recommended: boolean;
  enrichment: ContactEnrichment | null;
}

export interface BillingStatePayload {
  status: string;
  ai_credits: number | null;
  ai_credits_quota: number | null;
}

export interface OrgPayload {
  id: string;
  name: string;
  billing: BillingStatePayload | null;
}

export interface NotePayload {
  id: string;
  note: string;
  created_at: string;
}

export interface LoginResponse {
  token: string;
  verified: boolean;
}

export interface LeadWebFetchPayload {
  lead_id: string;
  content: Record<string, unknown> | null;
  fetch_at: string | null;
  in_progress: boolean;
}

export interface IdealBuyerProfilePayload {
  summary: string;
  key_characteristics: string[];
  anti_patterns: string[];
}

export interface PurchaseIntentTagPayload {
  id: number;
  display_name: string;
  tag: string;
  description: string | null;
  score: number | null;
  reasoning: string | null;
}

export interface AiAgentQuestionPayload {
  question: string;
  created_at: string;
  lang: string;
}

export interface UserMePayload {
  id: string;
  organization: OrgPayload;
}

export interface PaidContactPayload {
  id: string;
  first_name: string | null;
  last_name: string | null;
  linkedin_page: string | null;
  job_title: string | null;
  enrichment: ContactEnrichment | null;
  recommended: boolean;
}

export interface ActivityItem {
  lead_id: string;
  type: string;
  date: string;
}

export interface PaginatedActivities {
  items: ActivityItem[];
  pagination: PaginationPayload;
}
