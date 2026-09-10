import { env } from "cloudflare:workers";
import type {
  Activity,
  AuditLog,
  ClientState,
  CRMState,
  CRMUser,
  Lead,
  LeadDocument,
  LeadFilters,
  LoginHistory,
  Notification,
  NotificationEvent,
  Role,
  ViewerPermissions,
} from "./crm-types";

type D1Prepared = {
  bind: (...values: unknown[]) => D1Prepared;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Like = {
  prepare: (query: string) => D1Prepared;
  batch: (statements: D1Prepared[]) => Promise<unknown[]>;
};

type R2ObjectLike = {
  body: ReadableStream | null;
  httpMetadata?: {
    contentType?: string;
  };
  writeHttpMetadata?: (headers: Headers) => void;
};

type R2Like = {
  put: (
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectLike | null>;
  delete: (key: string) => Promise<unknown>;
};

type RuntimeEnv = {
  DB?: D1Like;
  DOCUMENTS?: R2Like;
};

type StateRow = {
  payload: string;
};

type SessionRow = {
  user_id: string;
  expires_at: string;
};

const STATE_ID = "loan-crm-primary";

export function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

export function getDb() {
  const db = getRuntimeEnv().DB;

  if (!db) {
    throw new Error("The CRM database binding is unavailable.");
  }

  return db;
}

export function getDocumentBucket() {
  const bucket = getRuntimeEnv().DOCUMENTS;

  if (!bucket) {
    throw new Error("The CRM document bucket is unavailable.");
  }

  return bucket;
}

export async function ensureDatabase() {
  const db = getDb();

  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS crm_state (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS crm_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_crm_sessions_user_id ON crm_sessions(user_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_crm_sessions_expires_at ON crm_sessions(expires_at)",
    ),
  ]);

  await db.prepare("PRAGMA optimize").run();

  const row = await db
    .prepare("SELECT payload FROM crm_state WHERE id = ?")
    .bind(STATE_ID)
    .first<StateRow>();

  if (!row) {
    await saveState(createSeedState());
  }
}

export async function loadState() {
  await ensureDatabase();

  const row = await getDb()
    .prepare("SELECT payload FROM crm_state WHERE id = ?")
    .bind(STATE_ID)
    .first<StateRow>();

  if (!row) {
    const seeded = createSeedState();
    await saveState(seeded);
    return seeded;
  }

  return normalizeState(JSON.parse(row.payload) as CRMState);
}

export async function saveState(state: CRMState) {
  const now = new Date().toISOString();
  const payload = JSON.stringify(normalizeState(state));

  await getDb()
    .prepare(
      "INSERT INTO crm_state (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    )
    .bind(STATE_ID, payload, now)
    .run();
}

export async function createSession(userId: string, rememberDevice: boolean) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (rememberDevice ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 8),
  ).toISOString();

  await getDb()
    .prepare(
      "INSERT INTO crm_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(token, userId, expiresAt, now.toISOString())
    .run();

  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await ensureDatabase();
  await getDb()
    .prepare("DELETE FROM crm_sessions WHERE token = ?")
    .bind(token)
    .run();
}

export async function getSessionUser(token: string | null) {
  if (!token) {
    return null;
  }

  await ensureDatabase();

  const session = await getDb()
    .prepare("SELECT user_id, expires_at FROM crm_sessions WHERE token = ?")
    .bind(token)
    .first<SessionRow>();

  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }

  const state = await loadState();
  const user = state.users.find((candidate) => candidate.id === session.user_id);

  if (!user || user.status !== "active") {
    return null;
  }

  return { user, state };
}

export function tokenFromRequest(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local-preview"
  );
}

export function roleLabel(role: Role) {
  const labels: Record<Role, string> = {
    admin: "Admin / Owner",
    manager: "Team Manager",
    agent: "Loan Officer / Agent",
    viewer: "Viewer / Auditor",
  };

  return labels[role];
}

export function permissionsFor(user: CRMUser): ViewerPermissions {
  return {
    canManageUsers: user.role === "admin",
    canManageSettings: user.role === "admin",
    canAssignLeads: user.role === "admin" || user.role === "manager",
    canEditLeads: user.role !== "viewer",
    canDeleteLeads: user.role === "admin",
    canExport: user.role !== "agent",
    canSeeAudit: user.role === "admin" || user.role === "viewer",
    canSeeAllReports: user.role !== "agent",
  };
}

export function sanitizeUser(user: CRMUser) {
  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
}

export function stateForUser(state: CRMState, user: CRMUser): ClientState {
  const visibleLeads = state.leads.filter((lead) => canSeeLead(user, lead));
  const visibleLeadIds = new Set(visibleLeads.map((lead) => lead.id));
  const visibleUserIds = new Set([
    user.id,
    ...visibleLeads.flatMap((lead) => (lead.assignedTo ? [lead.assignedTo] : [])),
    ...state.users
      .filter((candidate) => candidate.team === user.team || user.role !== "agent")
      .map((candidate) => candidate.id),
  ]);

  return {
    ...state,
    users: state.users
      .filter((candidate) => visibleUserIds.has(candidate.id) || user.role !== "agent")
      .map(sanitizeUser),
    leads: visibleLeads,
    activities: state.activities.filter((activity) =>
      visibleLeadIds.has(activity.leadId),
    ),
    notifications: state.notifications.filter(
      (notification) => notification.userId === user.id,
    ),
    savedViews: state.savedViews.filter((view) => view.userId === user.id),
    audits:
      user.role === "admin" || user.role === "viewer"
        ? state.audits
        : state.audits.filter((audit) => audit.userId === user.id),
    loginHistory:
      user.role === "admin"
        ? state.loginHistory
        : state.loginHistory.filter((entry) => entry.userId === user.id),
  };
}

export function canSeeLead(user: CRMUser, lead: Lead) {
  if (user.role === "admin" || user.role === "viewer") {
    return true;
  }

  if (user.role === "manager") {
    return lead.team === user.team || !lead.assignedTo;
  }

  return lead.assignedTo === user.id;
}

export function canEditLead(user: CRMUser, lead: Lead) {
  if (user.role === "viewer") {
    return false;
  }

  if (user.role === "agent") {
    return lead.assignedTo === user.id;
  }

  return canSeeLead(user, lead);
}

export function addAudit(
  state: CRMState,
  user: CRMUser,
  action: string,
  entity: string,
  entityId: string,
  detail: string,
  ip: string,
) {
  state.audits.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    action,
    entity,
    entityId,
    detail,
    ip,
    createdAt: new Date().toISOString(),
  });
  state.audits = state.audits.slice(0, 400);
}

export function addLoginHistory(
  state: CRMState,
  email: string,
  status: LoginHistory["status"],
  ip: string,
  userId = "unknown",
) {
  state.loginHistory.unshift({
    id: crypto.randomUUID(),
    userId,
    email,
    status,
    ip,
    createdAt: new Date().toISOString(),
  });
  state.loginHistory = state.loginHistory.slice(0, 300);
}

export function addActivity(
  state: CRMState,
  leadId: string,
  userId: string,
  type: Activity["type"],
  title: string,
  body: string,
) {
  state.activities.unshift({
    id: crypto.randomUUID(),
    leadId,
    userId,
    type,
    title,
    body,
    createdAt: new Date().toISOString(),
  });
  state.activities = state.activities.slice(0, 800);
}

export function addNotification(
  state: CRMState,
  userIds: string[],
  event: NotificationEvent,
  title: string,
  body: string,
  leadId?: string,
) {
  const now = new Date().toISOString();
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);

  for (const userId of uniqueUserIds) {
    const recipient = state.users.find((user) => user.id === userId);

    if (!recipient?.notificationPreferences[event]) {
      continue;
    }

    state.notifications.unshift({
      id: crypto.randomUUID(),
      userId,
      event,
      title,
      body,
      leadId,
      createdAt: now,
    });
  }

  state.notifications = state.notifications.slice(0, 500);
}

export function buildDocumentProgress(lead: Lead, state: CRMState) {
  const product = state.products.find((candidate) => candidate.name === lead.loanType);
  const checklist = product?.checklist ?? [];
  const received = new Set(lead.documents.map((document) => document.checklistItem));

  return {
    total: checklist.length,
    received: checklist.filter((item) => received.has(item)).length,
    checklist,
  };
}

export function findDuplicates(state: CRMState, lead: Partial<Lead>, ignoreLeadId?: string) {
  const phone = normalizePhone(lead.phone ?? "");
  const email = (lead.email ?? "").trim().toLowerCase();
  const pan = (lead.pan ?? "").trim().toUpperCase();

  return state.leads.filter((candidate) => {
    if (candidate.id === ignoreLeadId || candidate.deletedAt) {
      return false;
    }

    return (
      (!!phone && normalizePhone(candidate.phone) === phone) ||
      (!!email && candidate.email.toLowerCase() === email) ||
      (!!pan && candidate.pan.toUpperCase() === pan)
    );
  });
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}

export function makeLeadId(state: CRMState) {
  const year = new Date().getFullYear();
  const existing = state.leads
    .map((lead) => Number(lead.id.replace(`LD-${year}-`, "")))
    .filter(Number.isFinite);
  const next = Math.max(0, ...existing) + 1;

  return `LD-${year}-${String(next).padStart(4, "0")}`;
}

export function assignLeadAutomatically(state: CRMState, lead: Lead) {
  if (lead.assignedTo || state.settings.autoAssignmentMode === "manual") {
    return;
  }

  const agents = state.users.filter(
    (user) => user.role === "agent" && user.status === "active",
  );

  if (!agents.length) {
    return;
  }

  let candidates = agents;

  if (state.settings.autoAssignmentMode === "loan-type") {
    candidates = agents.filter((agent) =>
      lead.loanType === "Business Loan"
        ? agent.team === "Business Desk"
        : agent.team === lead.team,
    );
  }

  if (state.settings.autoAssignmentMode === "city") {
    candidates = agents.filter((agent) =>
      ["Mumbai", "Pune", "Thane"].includes(lead.city) ? agent.team === "West" : true,
    );
  }

  if (!candidates.length) {
    candidates = agents;
  }

  const nextIndex = (state.settings.lastAssignmentIndex + 1) % candidates.length;
  const selected = candidates[nextIndex];
  lead.assignedTo = selected.id;
  lead.team = selected.team;
  state.settings.lastAssignmentIndex = nextIndex;
}

export function applyLeadFilters(
  leads: Lead[],
  filters: LeadFilters,
  state: CRMState | ClientState,
) {
  const query = filters.query?.trim().toLowerCase();
  const now = Date.now();
  const slaMs = state.settings.slaDays * 24 * 60 * 60 * 1000;

  return leads.filter((lead) => {
    if (lead.deletedAt) {
      return false;
    }

    if (query) {
      const haystack = [
        lead.id,
        lead.borrowerName,
        lead.phone,
        lead.email,
        lead.pan,
        lead.city,
        lead.state,
        lead.loanType,
        lead.source,
        lead.stage,
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    if (filters.stage && lead.stage !== filters.stage) {
      return false;
    }

    if (filters.agent && lead.assignedTo !== filters.agent) {
      return false;
    }

    if (filters.team && lead.team !== filters.team) {
      return false;
    }

    if (filters.source && lead.source !== filters.source) {
      return false;
    }

    if (filters.loanType && lead.loanType !== filters.loanType) {
      return false;
    }

    if (filters.priority && lead.priority !== filters.priority) {
      return false;
    }

    if (filters.amountMin && lead.amount < filters.amountMin) {
      return false;
    }

    if (filters.amountMax && lead.amount > filters.amountMax) {
      return false;
    }

    if (filters.dateFrom && lead.createdAt < `${filters.dateFrom}T00:00:00.000Z`) {
      return false;
    }

    if (filters.dateTo && lead.createdAt > `${filters.dateTo}T23:59:59.999Z`) {
      return false;
    }

    if (
      filters.overdueOnly &&
      !(
        (lead.followUpAt && new Date(lead.followUpAt).getTime() < now) ||
        now - new Date(lead.lastTouchedAt).getTime() > slaMs
      )
    ) {
      return false;
    }

    return true;
  });
}

export function normalizeState(state: CRMState): CRMState {
  return {
    users: state.users ?? [],
    teams: state.teams ?? [],
    products: state.products ?? [],
    stages: state.stages ?? [],
    sources: state.sources ?? [],
    lenders: state.lenders ?? [],
    rejectionReasons: state.rejectionReasons ?? [],
    lostReasons: state.lostReasons ?? [],
    settings: {
      companyName: "APS Loan CRM",
      brandInitials: "APS",
      primaryColor: "#075985",
      accentColor: "#0f766e",
      slaDays: 3,
      autoAssignmentMode: "round-robin",
      dailyDigestTime: "08:30",
      emailEnabled: true,
      browserPushEnabled: false,
      lastAssignmentIndex: 0,
      ...(state.settings ?? {}),
    },
    emailTemplates: state.emailTemplates ?? [],
    leads: (state.leads ?? []).map((lead) => ({
      ...lead,
      documents: lead.documents ?? [],
      tasks: lead.tasks ?? [],
      tags: lead.tags ?? [],
    })),
    activities: state.activities ?? [],
    notifications: state.notifications ?? [],
    savedViews: state.savedViews ?? [],
    audits: state.audits ?? [],
    loginHistory: state.loginHistory ?? [],
  };
}

export function jsonResponse(payload: unknown, init?: ResponseInit) {
  return Response.json(payload, {
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
    status: init?.status,
    statusText: init?.statusText,
  });
}

function daysFromNow(days: number, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function daysAgo(days: number, hour = 10) {
  return daysFromNow(-days, hour);
}

function everyNotificationPreference(enabled = true) {
  return {
    assignment: enabled,
    stage: enabled,
    mention: enabled,
    followup: enabled,
    document: enabled,
    sla: enabled,
    decision: enabled,
    digest: enabled,
  };
}

function seedLead(
  id: string,
  borrowerName: string,
  phone: string,
  email: string,
  pan: string,
  city: string,
  stateName: string,
  loanType: string,
  amount: number,
  stage: string,
  assignedTo: string | undefined,
  team: string,
  source: string,
  daysOld: number,
  priority: Lead["priority"] = "Normal",
): Lead {
  return {
    id,
    borrowerName,
    phone,
    email,
    pan,
    city,
    state: stateName,
    loanType,
    amount,
    tenureMonths: loanType === "Home Loan" ? 240 : 60,
    income: amount > 5000000 ? 220000 : 90000,
    employmentType: loanType === "Business Loan" ? "Business owner" : "Salaried",
    source,
    stage,
    assignedTo,
    team,
    lender: stage === "Submitted to Lender" ? "HDFC Bank" : undefined,
    remarks: "Imported from September campaign review.",
    tags: priority === "Hot" ? ["high-intent", "call-today"] : [],
    priority,
    followUpAt:
      stage === "Documents Pending"
        ? daysFromNow(0, 15)
        : stage === "Contacted"
          ? daysFromNow(1, 11)
          : undefined,
    lastTouchedAt: daysAgo(Math.max(0, daysOld - 1), 16),
    createdAt: daysAgo(daysOld, 9),
    updatedAt: daysAgo(Math.max(0, daysOld - 1), 16),
    documents: [],
    tasks: [
      {
        id: crypto.randomUUID(),
        title:
          stage === "Documents Pending"
            ? "Collect pending checklist documents"
            : "Confirm borrower availability",
        done: stage === "Submitted to Lender" || stage === "Approved",
        dueAt: daysFromNow(1, 17),
        ownerId: assignedTo ?? "usr-admin",
        createdAt: daysAgo(daysOld, 12),
      },
    ],
  };
}

export function createSeedState(): CRMState {
  const now = new Date().toISOString();
  const users: CRMUser[] = [
    {
      id: "usr-admin",
      name: "Preeti Sharma",
      email: "admin@apsloancrm.com",
      role: "admin",
      team: "Leadership",
      phone: "+91 98765 10000",
      status: "active",
      capacityDaily: 50,
      capacityMonthly: 800,
      twoFactorEnabled: true,
      rememberDevice: true,
      notificationPreferences: everyNotificationPreference(),
      passwordHash: "$2b$10$qbSnk/F4N8FtgqYF5RXABeQI/vLTBN35YWowdolkeYhgDshY5uj46",
      createdAt: daysAgo(32),
    },
    {
      id: "usr-manager",
      name: "Arjun Mehta",
      email: "manager@apsloancrm.com",
      role: "manager",
      team: "West",
      phone: "+91 98765 10001",
      status: "active",
      capacityDaily: 35,
      capacityMonthly: 550,
      twoFactorEnabled: false,
      rememberDevice: true,
      notificationPreferences: everyNotificationPreference(),
      passwordHash: "$2b$10$hPzPFigVZsss6/o7I2E9zu0IhY5Ahkmeb2URU5qf3mYs5yo00GK1C",
      createdAt: daysAgo(25),
    },
    {
      id: "usr-agent",
      name: "Riya Patel",
      email: "agent@apsloancrm.com",
      role: "agent",
      team: "West",
      managerId: "usr-manager",
      phone: "+91 98765 10002",
      status: "active",
      capacityDaily: 18,
      capacityMonthly: 280,
      twoFactorEnabled: false,
      rememberDevice: false,
      notificationPreferences: everyNotificationPreference(),
      passwordHash: "$2b$10$Cy2BjWykqAnbXrOW2nxXo.e9yuB2qXRdgTOl99rA2QVwq51vvT1QW",
      createdAt: daysAgo(21),
    },
    {
      id: "usr-nisha",
      name: "Nisha Rao",
      email: "nisha@apsloancrm.com",
      role: "agent",
      team: "West",
      managerId: "usr-manager",
      phone: "+91 98765 10003",
      status: "active",
      capacityDaily: 16,
      capacityMonthly: 260,
      twoFactorEnabled: false,
      rememberDevice: false,
      notificationPreferences: everyNotificationPreference(),
      passwordHash: "$2b$10$jY8VOlI/93gGilmqweJ4CORapqEWKB7U9RqImqKJi01wkhV4l.nvS",
      createdAt: daysAgo(16),
    },
    {
      id: "usr-viewer",
      name: "Meera Iyer",
      email: "auditor@apsloancrm.com",
      role: "viewer",
      team: "Compliance",
      phone: "+91 98765 10004",
      status: "active",
      capacityDaily: 0,
      capacityMonthly: 0,
      twoFactorEnabled: false,
      rememberDevice: true,
      notificationPreferences: everyNotificationPreference(false),
      passwordHash: "$2b$10$GOhJgYClQNqm.JFgEK460u3qiCvqrUc2Z44HoviADpU41andh5VLW",
      createdAt: daysAgo(13),
    },
  ];

  const leads: Lead[] = [
    seedLead(
      "LD-2026-0001",
      "Sanjay Verma",
      "9822011100",
      "sanjay.verma@example.com",
      "ABCDE1234F",
      "Mumbai",
      "Maharashtra",
      "Home Loan",
      7400000,
      "Documents Pending",
      "usr-agent",
      "West",
      "Website",
      9,
      "Hot",
    ),
    seedLead(
      "LD-2026-0002",
      "Farah Khan",
      "9822011101",
      "farah.khan@example.com",
      "BCDEF2345G",
      "Pune",
      "Maharashtra",
      "Personal Loan",
      650000,
      "Contacted",
      "usr-nisha",
      "West",
      "Referral",
      4,
      "Warm",
    ),
    seedLead(
      "LD-2026-0003",
      "Karan Shah",
      "9822011102",
      "karan.shah@example.com",
      "CDEFG3456H",
      "Ahmedabad",
      "Gujarat",
      "Business Loan",
      2800000,
      "Submitted to Lender",
      "usr-agent",
      "West",
      "Google",
      12,
      "Hot",
    ),
    seedLead(
      "LD-2026-0004",
      "Anita Desai",
      "9822011103",
      "anita.desai@example.com",
      "DEFGH4567J",
      "Thane",
      "Maharashtra",
      "Vehicle Loan",
      920000,
      "Approved",
      "usr-nisha",
      "West",
      "Facebook",
      11,
    ),
    seedLead(
      "LD-2026-0005",
      "Harsh Gupta",
      "9822011104",
      "harsh.gupta@example.com",
      "EFGHI5678K",
      "Delhi",
      "Delhi",
      "LAP",
      5500000,
      "New",
      undefined,
      "North",
      "Purchased list",
      1,
      "Warm",
    ),
    seedLead(
      "LD-2026-0006",
      "Neelam Batra",
      "9822011105",
      "neelam.batra@example.com",
      "FGHIJ6789L",
      "Nashik",
      "Maharashtra",
      "Home Loan",
      5100000,
      "Disbursed",
      "usr-agent",
      "West",
      "Walk-in",
      18,
    ),
    seedLead(
      "LD-2026-0007",
      "Vivek Joshi",
      "9822011106",
      "vivek.joshi@example.com",
      "GHIJK7890M",
      "Surat",
      "Gujarat",
      "Business Loan",
      1800000,
      "Rejected",
      "usr-nisha",
      "West",
      "Cold call",
      15,
    ),
    seedLead(
      "LD-2026-0008",
      "Roshni Menon",
      "9822011107",
      "roshni.menon@example.com",
      "HIJKL8901N",
      "Mumbai",
      "Maharashtra",
      "Personal Loan",
      480000,
      "Interested",
      "usr-agent",
      "West",
      "Website",
      2,
      "Hot",
    ),
  ];

  leads[6].rejectionReason = "Low credit score";

  const activities: Activity[] = leads.flatMap((lead) => [
    {
      id: crypto.randomUUID(),
      leadId: lead.id,
      userId: lead.assignedTo ?? "usr-manager",
      type: "create",
      title: "Lead captured",
      body: `${lead.borrowerName} came from ${lead.source}.`,
      createdAt: lead.createdAt,
    },
    {
      id: crypto.randomUUID(),
      leadId: lead.id,
      userId: lead.assignedTo ?? "usr-manager",
      type: "stage",
      title: `Moved to ${lead.stage}`,
      body: "Initial pipeline review completed.",
      createdAt: lead.updatedAt,
    },
  ]);

  const notifications: Notification[] = [
    {
      id: crypto.randomUUID(),
      userId: "usr-agent",
      event: "followup",
      title: "Follow-up due today",
      body: "Sanjay Verma is waiting for a document reminder.",
      leadId: "LD-2026-0001",
      createdAt: daysFromNow(0, 9),
    },
    {
      id: crypto.randomUUID(),
      userId: "usr-manager",
      event: "sla",
      title: "SLA watchlist",
      body: "2 West team leads have not moved in over 3 days.",
      createdAt: daysAgo(0, 8),
    },
    {
      id: crypto.randomUUID(),
      userId: "usr-admin",
      event: "decision",
      title: "Disbursement recorded",
      body: "Neelam Batra was marked disbursed.",
      leadId: "LD-2026-0006",
      createdAt: daysAgo(1, 17),
    },
  ];

  const audits: AuditLog[] = [
    {
      id: crypto.randomUUID(),
      userId: "usr-admin",
      action: "seed",
      entity: "system",
      entityId: "bootstrap",
      detail: "Loan CRM seeded with sample users, stages, and leads.",
      ip: "local-preview",
      createdAt: now,
    },
  ];

  return {
    users,
    teams: [
      {
        id: "team-west",
        name: "West",
        managerId: "usr-manager",
        targetMonthly: 35000000,
      },
      {
        id: "team-north",
        name: "North",
        managerId: "usr-manager",
        targetMonthly: 20000000,
      },
      {
        id: "team-business",
        name: "Business Desk",
        managerId: "usr-manager",
        targetMonthly: 28000000,
      },
    ],
    products: [
      {
        id: "prod-home",
        name: "Home Loan",
        fields: ["Property value", "Property type", "Builder name"],
        checklist: [
          "PAN card",
          "Aadhaar card",
          "Address proof",
          "Salary slips",
          "Bank statement",
          "Property papers",
          "Photograph",
        ],
      },
      {
        id: "prod-personal",
        name: "Personal Loan",
        fields: ["Company name", "Net salary", "Existing EMI"],
        checklist: ["PAN card", "Aadhaar card", "Salary slips", "Bank statement"],
      },
      {
        id: "prod-business",
        name: "Business Loan",
        fields: ["Business vintage", "GST turnover", "Ownership type"],
        checklist: [
          "PAN card",
          "GST certificate",
          "ITR",
          "Bank statement",
          "Business proof",
        ],
      },
      {
        id: "prod-vehicle",
        name: "Vehicle Loan",
        fields: ["Vehicle type", "Dealer", "Quotation amount"],
        checklist: ["PAN card", "Aadhaar card", "Income proof", "Vehicle quotation"],
      },
      {
        id: "prod-lap",
        name: "LAP",
        fields: ["Property value", "Existing loan", "Mortgage status"],
        checklist: [
          "PAN card",
          "Aadhaar card",
          "Property papers",
          "Income proof",
          "Bank statement",
        ],
      },
    ],
    stages: [
      {
        id: "stage-new",
        name: "New",
        color: "#0369a1",
        order: 1,
        kind: "open",
        approvalRequired: false,
      },
      {
        id: "stage-contacted",
        name: "Contacted",
        color: "#0f766e",
        order: 2,
        kind: "open",
        approvalRequired: false,
      },
      {
        id: "stage-review",
        name: "Under Review",
        color: "#7c3aed",
        order: 3,
        kind: "open",
        approvalRequired: true,
      },
      {
        id: "stage-interested",
        name: "Interested",
        color: "#c2410c",
        order: 4,
        kind: "open",
        approvalRequired: false,
      },
      {
        id: "stage-docs-pending",
        name: "Documents Pending",
        color: "#b45309",
        order: 5,
        kind: "open",
        approvalRequired: false,
      },
      {
        id: "stage-docs-received",
        name: "Documents Received",
        color: "#047857",
        order: 6,
        kind: "open",
        approvalRequired: false,
      },
      {
        id: "stage-submitted",
        name: "Submitted to Lender",
        color: "#4338ca",
        order: 7,
        kind: "open",
        approvalRequired: true,
      },
      {
        id: "stage-approved",
        name: "Approved",
        color: "#15803d",
        order: 8,
        kind: "open",
        approvalRequired: true,
      },
      {
        id: "stage-disbursed",
        name: "Disbursed",
        color: "#166534",
        order: 9,
        kind: "won",
        approvalRequired: true,
      },
      {
        id: "stage-rejected",
        name: "Rejected",
        color: "#be123c",
        order: 10,
        kind: "lost",
        approvalRequired: true,
      },
      {
        id: "stage-lost",
        name: "Lost / Not Interested",
        color: "#475569",
        order: 11,
        kind: "lost",
        approvalRequired: false,
      },
    ],
    sources: [
      "Website",
      "Facebook",
      "Google",
      "Referral",
      "Walk-in",
      "Purchased list",
      "Cold call",
      "Webhook/API",
    ],
    lenders: [
      "HDFC Bank",
      "ICICI Bank",
      "Axis Bank",
      "State Bank of India",
      "Bajaj Finance",
      "Tata Capital",
    ],
    rejectionReasons: [
      "Low credit score",
      "Income mismatch",
      "Documents incomplete",
      "Policy mismatch",
      "Borrower withdrew",
    ],
    lostReasons: [
      "Rate not suitable",
      "Not reachable",
      "Chose competitor",
      "Requirement postponed",
      "Not interested",
    ],
    settings: {
      companyName: "APS Loan CRM",
      brandInitials: "APS",
      primaryColor: "#075985",
      accentColor: "#0f766e",
      slaDays: 3,
      autoAssignmentMode: "round-robin",
      dailyDigestTime: "08:30",
      emailEnabled: true,
      browserPushEnabled: false,
      lastAssignmentIndex: 1,
    },
    emailTemplates: [
      {
        id: "tpl-assignment",
        event: "assignment",
        subject: "New lead assigned: {{lead_name}}",
        body: "Please review {{lead_name}} and schedule the first follow-up.",
      },
      {
        id: "tpl-stage",
        event: "stage",
        subject: "Lead moved to {{stage}}",
        body: "{{lead_name}} has moved to {{stage}} with the latest remark.",
      },
      {
        id: "tpl-digest",
        event: "digest",
        subject: "Daily loan desk digest",
        body: "Your open leads, today's follow-ups, and overdue items are ready.",
      },
    ],
    leads,
    activities,
    notifications,
    savedViews: [
      {
        id: crypto.randomUUID(),
        userId: "usr-agent",
        name: "My hot leads",
        filters: { priority: "Hot" },
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId: "usr-manager",
        name: "Docs pending > 3 days",
        filters: { stage: "Documents Pending", overdueOnly: true },
        createdAt: now,
      },
    ],
    audits,
    loginHistory: [],
  };
}

export function applyDocumentToLead(
  state: CRMState,
  leadId: string,
  document: LeadDocument,
  user: CRMUser,
  ip: string,
) {
  const lead = state.leads.find((candidate) => candidate.id === leadId);

  if (!lead) {
    throw new Error("Lead not found.");
  }

  lead.documents.unshift(document);
  lead.lastTouchedAt = document.uploadedAt;
  lead.updatedAt = document.uploadedAt;

  addActivity(
    state,
    leadId,
    user.id,
    "document",
    "Document uploaded",
    `${document.name} was uploaded for ${document.checklistItem}.`,
  );
  addAudit(
    state,
    user,
    "upload_document",
    "lead_document",
    document.id,
    `${document.name} uploaded for ${lead.borrowerName}.`,
    ip,
  );

  const manager = state.users.find((candidate) => candidate.id === user.managerId);
  const recipients = [lead.assignedTo, manager?.id].filter(Boolean) as string[];
  addNotification(
    state,
    recipients,
    "document",
    "Document uploaded",
    `${document.checklistItem} received for ${lead.borrowerName}.`,
    lead.id,
  );
}
