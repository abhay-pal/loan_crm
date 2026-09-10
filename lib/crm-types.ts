export type Role = "admin" | "manager" | "agent" | "viewer";

export type StageKind = "open" | "won" | "lost";

export type UserStatus = "active" | "inactive";

export type EmploymentType =
  | "Salaried"
  | "Self-employed"
  | "Business owner"
  | "Retired"
  | "Other";

export type NotificationEvent =
  | "assignment"
  | "stage"
  | "mention"
  | "followup"
  | "document"
  | "sla"
  | "decision"
  | "digest";

export interface CRMUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  managerId?: string;
  phone?: string;
  status: UserStatus;
  capacityDaily: number;
  capacityMonthly: number;
  twoFactorEnabled: boolean;
  rememberDevice: boolean;
  notificationPreferences: Record<NotificationEvent, boolean>;
  passwordHash?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface LoanProduct {
  id: string;
  name: string;
  fields: string[];
  checklist: string[];
}

export interface PipelineStage {
  id: string;
  name: string;
  color: string;
  order: number;
  kind: StageKind;
  approvalRequired: boolean;
}

export interface Team {
  id: string;
  name: string;
  managerId: string;
  targetMonthly: number;
}

export interface LeadDocument {
  id: string;
  name: string;
  checklistItem: string;
  contentType: string;
  size: number;
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  storageKey: string;
}

export interface LeadTask {
  id: string;
  title: string;
  done: boolean;
  dueAt?: string;
  ownerId: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  borrowerName: string;
  phone: string;
  email: string;
  pan: string;
  city: string;
  state: string;
  loanType: string;
  amount: number;
  tenureMonths: number;
  income: number;
  employmentType: EmploymentType;
  source: string;
  stage: string;
  priority: "Hot" | "Warm" | "Normal";
  assignedTo?: string;
  team: string;
  lender?: string;
  remarks: string;
  tags: string[];
  followUpAt?: string;
  lastTouchedAt: string;
  createdAt: string;
  updatedAt: string;
  lostReason?: string;
  rejectionReason?: string;
  deletedAt?: string;
  documents: LeadDocument[];
  tasks: LeadTask[];
}

export interface Activity {
  id: string;
  leadId: string;
  userId: string;
  type: "create" | "edit" | "stage" | "assign" | "note" | "call" | "document" | "task";
  title: string;
  body: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  event: NotificationEvent;
  title: string;
  body: string;
  leadId?: string;
  createdAt: string;
  readAt?: string;
}

export interface SavedView {
  id: string;
  userId: string;
  name: string;
  filters: LeadFilters;
  createdAt: string;
}

export interface LeadFilters {
  query?: string;
  stage?: string;
  agent?: string;
  team?: string;
  source?: string;
  loanType?: string;
  priority?: string;
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  overdueOnly?: boolean;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
  ip: string;
  createdAt: string;
}

export interface LoginHistory {
  id: string;
  userId: string;
  email: string;
  ip: string;
  status: "success" | "failed";
  createdAt: string;
}

export interface CRMSettings {
  companyName: string;
  brandInitials: string;
  primaryColor: string;
  accentColor: string;
  slaDays: number;
  autoAssignmentMode: "round-robin" | "loan-type" | "city" | "manual";
  dailyDigestTime: string;
  emailEnabled: boolean;
  browserPushEnabled: boolean;
  lastAssignmentIndex: number;
}

export interface EmailTemplate {
  id: string;
  event: NotificationEvent;
  subject: string;
  body: string;
}

export interface CRMState {
  users: CRMUser[];
  teams: Team[];
  products: LoanProduct[];
  stages: PipelineStage[];
  sources: string[];
  lenders: string[];
  rejectionReasons: string[];
  lostReasons: string[];
  settings: CRMSettings;
  emailTemplates: EmailTemplate[];
  leads: Lead[];
  activities: Activity[];
  notifications: Notification[];
  savedViews: SavedView[];
  audits: AuditLog[];
  loginHistory: LoginHistory[];
}

export interface ViewerPermissions {
  canManageUsers: boolean;
  canManageSettings: boolean;
  canAssignLeads: boolean;
  canEditLeads: boolean;
  canDeleteLeads: boolean;
  canExport: boolean;
  canSeeAudit: boolean;
  canSeeAllReports: boolean;
}

export interface ClientState extends Omit<CRMState, "users"> {
  users: Omit<CRMUser, "passwordHash">[];
}
