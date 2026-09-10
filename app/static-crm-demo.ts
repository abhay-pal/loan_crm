import type {
  ClientState,
  CRMSettings,
  EmploymentType,
  Lead,
  LeadFilters,
  LoanProduct,
  PipelineStage,
  Role,
  ViewerPermissions,
} from "@/lib/crm-types";

type SafeUser = ClientState["users"][number];

type MinimalLead = {
  id: string;
  borrowerName: string;
  phone: string;
  email: string;
  pan: string;
  stage: string;
  assignedTo?: string;
};

type UploadReport = {
  inserted: string[];
  skipped: { row: number; reason: string; duplicate?: MinimalLead }[];
  errors: { row: number; errors: string[] }[];
};

type StaticApiPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  requiresOtp?: boolean;
  token?: string;
  expiresAt?: string;
  user?: SafeUser;
  permissions?: ViewerPermissions;
  state?: ClientState;
  duplicates?: MinimalLead[];
  uploadReport?: UploadReport;
  skipped?: boolean;
  leadId?: string;
};

const staticStateKey = "loan-crm-static-state-v2";
const staticTokenPrefix = "static-crm";
const adminOtp = "246810";
const defaultSettings: CRMSettings = {
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
};

const demoPasswords: Record<string, string> = {
  "admin@apsloancrm.com": "Preeti@123",
  "manager@apsloancrm.com": "Team@123",
  "agent@apsloancrm.com": "Agent@123",
  "auditor@apsloancrm.com": "Audit@123",
};

const editableLeadFields = [
  "borrowerName",
  "phone",
  "email",
  "pan",
  "city",
  "state",
  "loanType",
  "amount",
  "tenureMonths",
  "income",
  "employmentType",
  "source",
  "priority",
  "assignedTo",
  "team",
  "lender",
  "remarks",
  "tags",
] as const;

const roles: Role[] = ["admin", "manager", "agent", "viewer"];
const employmentTypes: EmploymentType[] = [
  "Salaried",
  "Self-employed",
  "Business owner",
  "Retired",
  "Other",
];

export function isStaticPagesRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.location.hostname.endsWith("github.io") ||
    window.location.protocol === "file:" ||
    window.location.search.includes("staticCrm=1")
  );
}

export async function staticApiRequest(
  token: string | null,
  action: string,
  body: Record<string, unknown> = {},
): Promise<StaticApiPayload> {
  const state = readStaticState();

  if (action === "login") {
    return staticLogin(state, body);
  }

  if (action === "requestPasswordReset") {
    return {
      ok: true,
      message: "Reset request recorded for the demo workspace.",
    };
  }

  const user = staticUserFromToken(token, state);

  if (!user) {
    throw staticApiError("Please sign in again.", 401);
  }

  switch (action) {
    case "logout":
      window.sessionStorage.removeItem("loan-crm-static-user-id");
      return { ok: true };
    case "getState":
      return withStaticState(state, user);
    case "createLead":
      return createStaticLead(state, user, body);
    case "bulkUpload":
      return bulkUploadStaticLeads(state, user, body);
    case "updateLead":
      return updateStaticLead(state, user, body);
    case "changeStage":
      return changeStaticStage(state, user, body);
    case "assignLeads":
      return assignStaticLeads(state, user, body);
    case "addNote":
      return addStaticNote(state, user, body);
    case "logCall":
      return logStaticCall(state, user, body);
    case "scheduleFollowUp":
      return scheduleStaticFollowUp(state, user, body);
    case "addTask":
      return addStaticTask(state, user, body);
    case "toggleTask":
      return toggleStaticTask(state, user, body);
    case "saveView":
      return saveStaticView(state, user, body);
    case "deleteSavedView":
      return deleteStaticSavedView(state, user, body);
    case "markNotification":
      return markStaticNotification(state, user, body);
    case "markAllNotifications":
      return markAllStaticNotifications(state, user);
    case "updateNotificationPreferences":
      return updateStaticNotificationPreferences(state, user, body);
    case "createUser":
      return createStaticUser(state, user, body);
    case "updateUser":
      return updateStaticUser(state, user, body);
    case "deactivateUser":
      return deactivateStaticUser(state, user, body);
    case "updateSettings":
      return updateStaticSettings(state, user, body);
    case "softDeleteLead":
      return softDeleteStaticLead(state, user, body);
    case "restoreLead":
      return restoreStaticLead(state, user, body);
    case "permanentlyDeleteLead":
      return permanentlyDeleteStaticLead(state, user, body);
    case "addDocument":
      return addStaticDocument(state, user, body);
    case "deleteDocument":
      return deleteStaticDocument(state, user, body);
    default:
      throw staticApiError("Unknown CRM action.", 400);
  }
}

function staticLogin(state: ClientState, body: Record<string, unknown>) {
  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);
  const otp = asString(body.otp);
  const expectedPassword = demoPasswords[email];
  const user = state.users.find((candidate) => candidate.email.toLowerCase() === email);

  if (!user || user.status !== "active" || !expectedPassword || expectedPassword !== password) {
    throw staticApiError("Invalid email or password.", 401);
  }

  if (user.twoFactorEnabled && otp !== adminOtp) {
    return {
      requiresOtp: true,
      message: "Email OTP is enabled for this account. Use demo OTP 246810 in this preview.",
    };
  }

  const token = `${staticTokenPrefix}:${user.id}:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const userIndex = state.users.findIndex((candidate) => candidate.id === user.id);

  state.users[userIndex] = {
    ...user,
    lastLoginAt: now,
    rememberDevice: Boolean(body.rememberDevice),
  };
  state.loginHistory.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    email: user.email,
    ip: "github-pages-demo",
    status: "success",
    createdAt: now,
  });
  persistStaticState(state);
  window.sessionStorage.setItem("loan-crm-static-user-id", user.id);

  return withStaticState(state, state.users[userIndex], {
    token,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString(),
    message: "Signed in successfully.",
  });
}

function createStaticLead(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const leadPayload = normalizeStaticLeadInput(body.lead);
  const errors = validateStaticLeadInput(leadPayload);

  if (errors.length) {
    throw staticApiError("Lead validation failed.", 400, { errors });
  }

  const lead = buildStaticLead(state, leadPayload, user);
  const duplicate = findStaticDuplicate(state, lead);
  const duplicateMode = asString(body.duplicateMode);

  if (duplicate && !duplicateMode) {
    throw staticApiError("Duplicate lead detected.", 409, {
      duplicates: [minimalLead(duplicate)],
    });
  }

  if (duplicate && duplicateMode === "skip") {
    return {
      ok: true,
      skipped: true,
      message: "Lead skipped because a duplicate exists.",
      duplicates: [minimalLead(duplicate)],
    };
  }

  if (duplicate && duplicateMode === "merge") {
    applyStaticLeadUpdates(duplicate, leadPayload);
    touchStaticLead(duplicate);
    addStaticActivity(state, duplicate.id, user.id, "edit", "Duplicate merged", "Details merged into this existing lead.");
    persistStaticState(state);
    return withStaticState(state, user, {
      message: "Duplicate details merged into the existing lead.",
      leadId: duplicate.id,
    });
  }

  assignStaticLeadAutomatically(state, lead, user);
  state.leads.unshift(lead);
  addStaticActivity(state, lead.id, user.id, "create", "Lead created", `${lead.borrowerName} was added from ${lead.source}.`);
  addStaticAudit(state, user, "create_lead", "lead", lead.id, `${lead.borrowerName} created.`);
  persistStaticState(state);

  return withStaticState(state, user, {
    message: "Lead created successfully.",
    leadId: lead.id,
  });
}

function bulkUploadStaticLeads(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const rows = Array.isArray(body.leads) ? body.leads : [];
  const duplicateMode = asString(body.duplicateMode) || "skip";
  const inserted: string[] = [];
  const skipped: UploadReport["skipped"] = [];
  const errors: UploadReport["errors"] = [];

  rows.forEach((row, index) => {
    const leadPayload = normalizeStaticLeadInput(row);
    const rowErrors = validateStaticLeadInput(leadPayload);

    if (rowErrors.length) {
      errors.push({ row: index + 2, errors: rowErrors });
      return;
    }

    const lead = buildStaticLead(state, leadPayload, user);
    const duplicate = findStaticDuplicate(state, lead);

    if (duplicate && duplicateMode === "skip") {
      skipped.push({
        row: index + 2,
        reason: "Duplicate phone, email, or PAN.",
        duplicate: minimalLead(duplicate),
      });
      return;
    }

    if (duplicate && duplicateMode === "merge") {
      applyStaticLeadUpdates(duplicate, leadPayload);
      touchStaticLead(duplicate);
      inserted.push(duplicate.id);
      addStaticActivity(state, duplicate.id, user.id, "edit", "Bulk upload merged duplicate", `Row ${index + 2} was merged into this lead.`);
      return;
    }

    assignStaticLeadAutomatically(state, lead, user);
    state.leads.unshift(lead);
    inserted.push(lead.id);
    addStaticActivity(state, lead.id, user.id, "create", "Bulk upload lead created", `Row ${index + 2} created this lead.`);
  });

  addStaticAudit(state, user, "bulk_upload", "lead", "bulk", `${inserted.length} rows inserted or merged; ${skipped.length} skipped.`);
  persistStaticState(state);

  return withStaticState(state, user, {
    message: "Bulk upload processed.",
    uploadReport: { inserted, skipped, errors },
  });
}

function updateStaticLead(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const updates = normalizeStaticLeadInput(body.updates);

  applyStaticLeadUpdates(lead, updates);
  touchStaticLead(lead);
  addStaticActivity(state, lead.id, user.id, "edit", "Lead updated", "Borrower and loan details were updated.");
  addStaticAudit(state, user, "update_lead", "lead", lead.id, `${lead.borrowerName} updated.`);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Lead updated." });
}

function changeStaticStage(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const stage = asString(body.stage);
  const remark = asString(body.remark);

  if (!remark) {
    throw staticApiError("Stage-change remark is required.", 400);
  }

  if (!state.stages.some((candidate) => candidate.name === stage)) {
    throw staticApiError("Choose a valid stage.", 400);
  }

  lead.stage = stage;
  if (stage === "Rejected") {
    lead.rejectionReason = asString(body.reason) || lead.rejectionReason;
  }
  if (stage === "Lost / Not Interested") {
    lead.lostReason = asString(body.reason) || lead.lostReason;
  }
  touchStaticLead(lead);
  addStaticActivity(state, lead.id, user.id, "stage", `Moved to ${stage}`, remark);
  addStaticAudit(state, user, "change_stage", "lead", lead.id, `${lead.borrowerName} moved to ${stage}.`);
  persistStaticState(state);

  return withStaticState(state, user, { message: `Lead moved to ${stage}.` });
}

function assignStaticLeads(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canAssignLeads) {
    throw staticApiError("You do not have permission to assign leads.", 403);
  }

  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map(String) : [];
  const assignedTo = asString(body.assignedTo);
  const assignee = state.users.find((candidate) => candidate.id === assignedTo);

  if (!assignee || assignee.status !== "active" || assignee.role === "viewer") {
    throw staticApiError("Choose an active assignee.", 400);
  }

  leadIds.forEach((leadId) => {
    const lead = getStaticLead(state, leadId);
    lead.assignedTo = assignee.id;
    lead.team = assignee.team || lead.team;
    touchStaticLead(lead);
    addStaticActivity(state, lead.id, user.id, "assign", "Lead assigned", `${lead.borrowerName} assigned to ${assignee.name}.`);
  });
  addStaticAudit(state, user, "assign_leads", "lead", "bulk", `${leadIds.length} leads assigned to ${assignee.name}.`);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Leads assigned." });
}

function addStaticNote(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const note = asString(body.body);

  if (!note) {
    throw staticApiError("Note cannot be empty.", 400);
  }

  touchStaticLead(lead);
  addStaticActivity(state, lead.id, user.id, "note", "Note added", note);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Note added." });
}

function logStaticCall(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const outcome = asString(body.outcome) || "connected";
  const duration = asNumber(body.duration, 0);
  const nextAction = asString(body.nextAction);
  const followUpAt = asString(body.followUpAt);

  if (followUpAt) {
    lead.followUpAt = followUpAt;
  }

  touchStaticLead(lead);
  addStaticActivity(
    state,
    lead.id,
    user.id,
    "call",
    `Call ${outcome}`,
    `${duration} min call. ${nextAction || "No next action recorded."}`,
  );
  persistStaticState(state);

  return withStaticState(state, user, { message: "Call logged." });
}

function scheduleStaticFollowUp(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  lead.followUpAt = asString(body.followUpAt) || undefined;
  touchStaticLead(lead);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Follow-up scheduled." });
}

function addStaticTask(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const title = asString(body.title);

  if (!title) {
    throw staticApiError("Task title is required.", 400);
  }

  lead.tasks.unshift({
    id: crypto.randomUUID(),
    title,
    done: false,
    ownerId: lead.assignedTo ?? user.id,
    createdAt: new Date().toISOString(),
  });
  touchStaticLead(lead);
  addStaticActivity(state, lead.id, user.id, "task", "Task added", title);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Task added." });
}

function toggleStaticTask(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const task = lead.tasks.find((candidate) => candidate.id === asString(body.taskId));

  if (!task) {
    throw staticApiError("Task not found.", 404);
  }

  task.done = Boolean(body.done);
  touchStaticLead(lead);
  persistStaticState(state);

  return withStaticState(state, user, { message: task.done ? "Task completed." : "Task reopened." });
}

function saveStaticView(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  const name = asString(body.name);

  if (!name) {
    throw staticApiError("Saved view name is required.", 400);
  }

  state.savedViews.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    name,
    filters: normalizeStaticFilters(body.filters),
    createdAt: new Date().toISOString(),
  });
  persistStaticState(state);

  return withStaticState(state, user, { message: "View saved." });
}

function deleteStaticSavedView(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  const viewId = asString(body.viewId);
  state.savedViews = state.savedViews.filter(
    (view) => view.id !== viewId || view.userId !== user.id,
  );
  persistStaticState(state);

  return withStaticState(state, user, { message: "View deleted." });
}

function markStaticNotification(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  const notification = state.notifications.find(
    (candidate) => candidate.id === asString(body.id) && candidate.userId === user.id,
  );

  if (notification) {
    notification.readAt = new Date().toISOString();
    persistStaticState(state);
  }

  return withStaticState(state, user);
}

function markAllStaticNotifications(state: ClientState, user: SafeUser) {
  const now = new Date().toISOString();
  state.notifications = state.notifications.map((notification) =>
    notification.userId === user.id ? { ...notification, readAt: notification.readAt ?? now } : notification,
  );
  persistStaticState(state);

  return withStaticState(state, user, { message: "Notifications cleared." });
}

function updateStaticNotificationPreferences(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  const index = state.users.findIndex((candidate) => candidate.id === user.id);

  if (index >= 0) {
    state.users[index] = {
      ...state.users[index],
      notificationPreferences: {
        ...state.users[index].notificationPreferences,
        ...asRecord(body.preferences),
      },
    };
    persistStaticState(state);
  }

  return withStaticState(state, state.users[index] ?? user, {
    message: "Notification preferences updated.",
  });
}

function createStaticUser(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canManageUsers) {
    throw staticApiError("You do not have permission to manage users.", 403);
  }

  const source = asRecord(body.user);
  const email = asString(source.email).toLowerCase();

  if (!asString(source.name) || !email) {
    throw staticApiError("Name and email are required.", 400);
  }

  if (state.users.some((candidate) => candidate.email.toLowerCase() === email)) {
    throw staticApiError("A user with this email already exists.", 409);
  }

  const role = roles.includes(source.role as Role) ? (source.role as Role) : "agent";
  state.users.push({
    id: `usr-${Date.now()}`,
    name: asString(source.name),
    email,
    role,
    team: asString(source.team) || "West",
    managerId: asString(source.managerId) || undefined,
    phone: asString(source.phone) || undefined,
    status: "active",
    capacityDaily: asNumber(source.capacityDaily, 15),
    capacityMonthly: asNumber(source.capacityMonthly, 250),
    twoFactorEnabled: Boolean(source.twoFactorEnabled),
    rememberDevice: false,
    notificationPreferences: everyStaticNotificationPreference(),
    createdAt: new Date().toISOString(),
  });
  addStaticAudit(state, user, "create_user", "user", email, `${email} created.`);
  persistStaticState(state);

  return withStaticState(state, user, { message: "User created." });
}

function updateStaticUser(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canManageUsers) {
    throw staticApiError("You do not have permission to manage users.", 403);
  }

  const target = state.users.find((candidate) => candidate.id === asString(body.userId));
  const updates = asRecord(body.updates);

  if (!target) {
    throw staticApiError("User not found.", 404);
  }

  const role = roles.includes(updates.role as Role) ? (updates.role as Role) : target.role;
  target.name = asString(updates.name) || target.name;
  target.email = asString(updates.email).toLowerCase() || target.email;
  target.role = role;
  target.team = asString(updates.team) || target.team;
  target.managerId = asString(updates.managerId) || undefined;
  target.phone = asString(updates.phone) || undefined;
  target.capacityDaily = asNumber(updates.capacityDaily, target.capacityDaily);
  target.capacityMonthly = asNumber(updates.capacityMonthly, target.capacityMonthly);
  target.twoFactorEnabled = Boolean(updates.twoFactorEnabled);
  target.status = asString(updates.status) === "inactive" ? "inactive" : "active";
  addStaticAudit(state, user, "update_user", "user", target.id, `${target.name} updated.`);
  persistStaticState(state);

  return withStaticState(state, user, { message: "User updated." });
}

function deactivateStaticUser(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canManageUsers) {
    throw staticApiError("You do not have permission to manage users.", 403);
  }

  const target = state.users.find((candidate) => candidate.id === asString(body.userId));

  if (!target) {
    throw staticApiError("User not found.", 404);
  }

  target.status = target.status === "active" ? "inactive" : "active";
  addStaticAudit(state, user, "toggle_user_status", "user", target.id, `${target.name} marked ${target.status}.`);
  persistStaticState(state);

  return withStaticState(state, user, { message: "User status updated." });
}

function updateStaticSettings(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canManageSettings) {
    throw staticApiError("You do not have permission to manage settings.", 403);
  }

  const settings = asRecord(body.settings);
  state.settings = {
    ...state.settings,
    ...settings,
    slaDays: asNumber(settings.slaDays, state.settings.slaDays),
    emailEnabled: Boolean(settings.emailEnabled),
    browserPushEnabled: Boolean(settings.browserPushEnabled),
  } as CRMSettings;
  state.sources = asStringArray(body.sources, state.sources);
  state.lenders = asStringArray(body.lenders, state.lenders);
  state.rejectionReasons = asStringArray(body.rejectionReasons, state.rejectionReasons);
  state.lostReasons = asStringArray(body.lostReasons, state.lostReasons);
  state.products = asTypedArray<LoanProduct>(body.products, state.products);
  state.stages = asTypedArray<PipelineStage>(body.stages, state.stages);
  addStaticAudit(state, user, "update_settings", "settings", "workspace", "Settings updated.");
  persistStaticState(state);

  return withStaticState(state, user, { message: "Settings saved." });
}

function softDeleteStaticLead(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canDeleteLeads) {
    throw staticApiError("You do not have permission to delete leads.", 403);
  }

  const lead = getStaticLead(state, asString(body.leadId));
  lead.deletedAt = new Date().toISOString();
  touchStaticLead(lead);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Lead moved to recycle bin." });
}

function restoreStaticLead(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canDeleteLeads) {
    throw staticApiError("You do not have permission to restore leads.", 403);
  }

  const lead = getStaticLead(state, asString(body.leadId), true);
  delete lead.deletedAt;
  touchStaticLead(lead);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Lead restored." });
}

function permanentlyDeleteStaticLead(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  if (!staticPermissionsFor(user).canDeleteLeads) {
    throw staticApiError("You do not have permission to delete leads.", 403);
  }

  const leadId = asString(body.leadId);
  state.leads = state.leads.filter((lead) => lead.id !== leadId);
  state.activities = state.activities.filter((activity) => activity.leadId !== leadId);
  state.notifications = state.notifications.filter((notification) => notification.leadId !== leadId);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Lead permanently deleted." });
}

function addStaticDocument(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const checklistItem = asString(body.checklistItem) || "General";
  const existingVersions = lead.documents.filter(
    (document) => document.checklistItem === checklistItem,
  );

  lead.documents.unshift({
    id: crypto.randomUUID(),
    name: asString(body.fileName) || "document",
    checklistItem,
    contentType: asString(body.contentType) || "application/octet-stream",
    size: asNumber(body.size, 0),
    version: existingVersions.length + 1,
    uploadedBy: user.id,
    uploadedAt: new Date().toISOString(),
    storageKey: "github-pages-demo",
  });
  touchStaticLead(lead);
  addStaticActivity(state, lead.id, user.id, "document", "Document metadata added", `${checklistItem} marked received.`);
  persistStaticState(state);

  return withStaticState(state, user, {
    message: "Document checklist updated. File storage is unavailable on GitHub Pages.",
  });
}

function deleteStaticDocument(
  state: ClientState,
  user: SafeUser,
  body: Record<string, unknown>,
) {
  ensureStaticCanEdit(user);
  const lead = getStaticLead(state, asString(body.leadId));
  const documentId = asString(body.documentId);
  lead.documents = lead.documents.filter((document) => document.id !== documentId);
  touchStaticLead(lead);
  persistStaticState(state);

  return withStaticState(state, user, { message: "Document removed." });
}

function withStaticState(
  state: ClientState,
  user: SafeUser,
  extras: StaticApiPayload = {},
): StaticApiPayload {
  return {
    ok: true,
    user,
    permissions: staticPermissionsFor(user),
    state: staticStateForUser(state, user),
    ...extras,
  };
}

function staticPermissionsFor(user: SafeUser): ViewerPermissions {
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

function staticStateForUser(state: ClientState, user: SafeUser): ClientState {
  if (user.role !== "agent") {
    return {
      ...state,
      savedViews: state.savedViews.filter(
        (view) => view.userId === user.id || user.role === "admin",
      ),
    };
  }

  return {
    ...state,
    leads: state.leads.filter((lead) => lead.assignedTo === user.id),
    activities: state.activities.filter((activity) =>
      state.leads.some((lead) => lead.assignedTo === user.id && lead.id === activity.leadId),
    ),
    notifications: state.notifications.filter(
      (notification) => notification.userId === user.id,
    ),
    savedViews: state.savedViews.filter((view) => view.userId === user.id),
  };
}

function readStaticState(): ClientState {
  try {
    const stored = window.localStorage.getItem(staticStateKey);
    if (stored) {
      return normalizeStaticState(JSON.parse(stored) as ClientState);
    }
  } catch {
    window.localStorage.removeItem(staticStateKey);
  }

  const seeded = createStaticSeedState();
  persistStaticState(seeded);
  return seeded;
}

function persistStaticState(state: ClientState) {
  window.localStorage.setItem(staticStateKey, JSON.stringify(normalizeStaticState(state)));
}

function normalizeStaticState(state: ClientState): ClientState {
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
      ...defaultSettings,
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

function staticUserFromToken(token: string | null, state: ClientState) {
  const tokenUserId = token?.startsWith(`${staticTokenPrefix}:`)
    ? token.split(":")[1]
    : null;
  const userId = tokenUserId || window.sessionStorage.getItem("loan-crm-static-user-id");

  return state.users.find(
    (candidate) => candidate.id === userId && candidate.status === "active",
  );
}

function buildStaticLead(
  state: ClientState,
  leadPayload: Partial<Lead>,
  user: SafeUser,
): Lead {
  const now = new Date().toISOString();
  const assignedTo = leadPayload.assignedTo || (user.role === "agent" ? user.id : undefined);
  const assignee = state.users.find((candidate) => candidate.id === assignedTo);
  const team = leadPayload.team || assignee?.team || user.team || state.teams[0]?.name || "General";

  return {
    id: nextLeadId(state),
    borrowerName: leadPayload.borrowerName ?? "",
    phone: leadPayload.phone ?? "",
    email: leadPayload.email ?? "",
    pan: leadPayload.pan ?? "",
    city: leadPayload.city ?? "",
    state: leadPayload.state ?? "",
    loanType: leadPayload.loanType || state.products[0]?.name || "Home Loan",
    amount: Number(leadPayload.amount ?? 0),
    tenureMonths: Number(leadPayload.tenureMonths ?? 60),
    income: Number(leadPayload.income ?? 0),
    employmentType: employmentTypes.includes(leadPayload.employmentType as EmploymentType)
      ? (leadPayload.employmentType as EmploymentType)
      : "Salaried",
    source: leadPayload.source || state.sources[0] || "Website",
    stage: leadPayload.stage || "New",
    priority: leadPayload.priority ?? "Normal",
    assignedTo,
    team,
    lender: leadPayload.lender,
    remarks: leadPayload.remarks ?? "",
    tags: leadPayload.tags ?? [],
    followUpAt: leadPayload.followUpAt,
    lastTouchedAt: now,
    createdAt: now,
    updatedAt: now,
    documents: [],
    tasks: [],
  };
}

function normalizeStaticLeadInput(input: unknown): Partial<Lead> {
  const source = asRecord(input);
  const normalized: Partial<Lead> = {};

  for (const field of editableLeadFields) {
    if (source[field] === undefined) {
      continue;
    }

    if (field === "amount" || field === "tenureMonths" || field === "income") {
      normalized[field] = asNumber(source[field], 0) as never;
      continue;
    }

    if (field === "tags") {
      normalized.tags = Array.isArray(source.tags)
        ? source.tags.map(String).filter(Boolean)
        : asString(source.tags)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean);
      continue;
    }

    normalized[field] = asString(source[field]) as never;
  }

  if (source.followUpAt !== undefined) {
    normalized.followUpAt = asString(source.followUpAt) || undefined;
  }

  if (source.stage !== undefined) {
    normalized.stage = asString(source.stage);
  }

  return normalized;
}

function applyStaticLeadUpdates(lead: Lead, updates: Partial<Lead>) {
  for (const field of editableLeadFields) {
    const nextValue = updates[field];

    if (nextValue !== undefined) {
      lead[field] = nextValue as never;
    }
  }
}

function validateStaticLeadInput(lead: Partial<Lead>) {
  const errors: string[] = [];

  if (!lead.borrowerName) {
    errors.push("Borrower name is required.");
  }

  if (!lead.phone || lead.phone.replace(/\D/g, "").length < 10) {
    errors.push("A valid phone number is required.");
  }

  if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    errors.push("A valid email address is required.");
  }

  if (!lead.loanType) {
    errors.push("Loan type is required.");
  }

  if (!lead.amount || Number(lead.amount) <= 0) {
    errors.push("Loan amount must be greater than zero.");
  }

  return errors;
}

function assignStaticLeadAutomatically(
  state: ClientState,
  lead: Lead,
  user: SafeUser,
) {
  if (lead.assignedTo || state.settings.autoAssignmentMode === "manual") {
    return;
  }

  const assignableUsers = state.users.filter(
    (candidate) => candidate.status === "active" && candidate.role === "agent",
  );

  if (!assignableUsers.length || user.role === "agent") {
    return;
  }

  const nextIndex = (state.settings.lastAssignmentIndex + 1) % assignableUsers.length;
  const assignee = assignableUsers[nextIndex];
  lead.assignedTo = assignee.id;
  lead.team = assignee.team;
  state.settings.lastAssignmentIndex = nextIndex;
}

function findStaticDuplicate(state: ClientState, lead: Lead, ignoreId?: string) {
  const phone = lead.phone.replace(/\D/g, "");
  const email = lead.email.toLowerCase();
  const pan = lead.pan.toUpperCase();

  return state.leads.find((candidate) => {
    if (candidate.id === ignoreId || candidate.deletedAt) {
      return false;
    }

    return (
      (phone && candidate.phone.replace(/\D/g, "") === phone) ||
      (email && candidate.email.toLowerCase() === email) ||
      (pan && candidate.pan.toUpperCase() === pan)
    );
  });
}

function getStaticLead(state: ClientState, leadId: string, includeDeleted = false) {
  const lead = state.leads.find(
    (candidate) => candidate.id === leadId && (includeDeleted || !candidate.deletedAt),
  );

  if (!lead) {
    throw staticApiError("Lead not found.", 404);
  }

  return lead;
}

function touchStaticLead(lead: Lead) {
  const now = new Date().toISOString();
  lead.updatedAt = now;
  lead.lastTouchedAt = now;
}

function addStaticActivity(
  state: ClientState,
  leadId: string,
  userId: string,
  type: ClientState["activities"][number]["type"],
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
}

function addStaticAudit(
  state: ClientState,
  user: SafeUser,
  action: string,
  entity: string,
  entityId: string,
  detail: string,
) {
  state.audits.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    action,
    entity,
    entityId,
    detail,
    ip: "github-pages-demo",
    createdAt: new Date().toISOString(),
  });
}

function nextLeadId(state: ClientState) {
  const next =
    Math.max(
      0,
      ...state.leads.map((lead) => Number(lead.id.match(/(\d+)$/)?.[1] ?? 0)),
    ) + 1;

  return `LD-2026-${String(next).padStart(4, "0")}`;
}

function minimalLead(lead: Lead): MinimalLead {
  return {
    id: lead.id,
    borrowerName: lead.borrowerName,
    phone: lead.phone,
    email: lead.email,
    pan: lead.pan,
    stage: lead.stage,
    assignedTo: lead.assignedTo,
  };
}

function normalizeStaticFilters(input: unknown): LeadFilters {
  const filters = asRecord(input);

  return {
    query: asString(filters.query) || undefined,
    stage: asString(filters.stage) || undefined,
    agent: asString(filters.agent) || undefined,
    team: asString(filters.team) || undefined,
    source: asString(filters.source) || undefined,
    loanType: asString(filters.loanType) || undefined,
    priority: asString(filters.priority) || undefined,
    amountMin: filters.amountMin === undefined ? undefined : asNumber(filters.amountMin, 0),
    amountMax: filters.amountMax === undefined ? undefined : asNumber(filters.amountMax, 0),
    dateFrom: asString(filters.dateFrom) || undefined,
    dateTo: asString(filters.dateTo) || undefined,
    overdueOnly: Boolean(filters.overdueOnly),
  };
}

function ensureStaticCanEdit(user: SafeUser) {
  if (user.role === "viewer") {
    throw staticApiError("Viewer accounts are read-only.", 403);
  }
}

function staticApiError(
  message: string,
  status: number,
  data: Record<string, unknown> = {},
) {
  const error = new Error(message) as Error & {
    data?: Record<string, unknown>;
    status?: number;
  };
  error.status = status;
  error.data = { error: message, ...data };
  return error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const next = value.map(String).map((item) => item.trim()).filter(Boolean);
  return next.length ? next : fallback;
}

function asTypedArray<T>(value: unknown, fallback: T[]) {
  return Array.isArray(value) ? (value as T[]) : fallback;
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

function everyStaticNotificationPreference(enabled = true) {
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
        id: `task-${id}`,
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

function createStaticSeedState(): ClientState {
  const now = new Date().toISOString();
  const users: SafeUser[] = [
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
      notificationPreferences: everyStaticNotificationPreference(),
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
      notificationPreferences: everyStaticNotificationPreference(),
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
      notificationPreferences: everyStaticNotificationPreference(),
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
      notificationPreferences: everyStaticNotificationPreference(),
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
      notificationPreferences: everyStaticNotificationPreference(false),
      createdAt: daysAgo(13),
    },
  ];

  const leads = [
    seedLead("LD-2026-0001", "Sanjay Verma", "9822011100", "sanjay.verma@example.com", "ABCDE1234F", "Mumbai", "Maharashtra", "Home Loan", 7400000, "Documents Pending", "usr-agent", "West", "Website", 9, "Hot"),
    seedLead("LD-2026-0002", "Farah Khan", "9822011101", "farah.khan@example.com", "BCDEF2345G", "Pune", "Maharashtra", "Personal Loan", 650000, "Contacted", "usr-nisha", "West", "Referral", 4, "Warm"),
    seedLead("LD-2026-0003", "Karan Shah", "9822011102", "karan.shah@example.com", "CDEFG3456H", "Ahmedabad", "Gujarat", "Business Loan", 2800000, "Submitted to Lender", "usr-agent", "West", "Google", 12, "Hot"),
    seedLead("LD-2026-0004", "Anita Desai", "9822011103", "anita.desai@example.com", "DEFGH4567J", "Thane", "Maharashtra", "Vehicle Loan", 920000, "Approved", "usr-nisha", "West", "Facebook", 11),
    seedLead("LD-2026-0005", "Harsh Gupta", "9822011104", "harsh.gupta@example.com", "EFGHI5678K", "Delhi", "Delhi", "LAP", 5500000, "New", undefined, "North", "Purchased list", 1, "Warm"),
    seedLead("LD-2026-0006", "Neelam Batra", "9822011105", "neelam.batra@example.com", "FGHIJ6789L", "Nashik", "Maharashtra", "Home Loan", 5100000, "Disbursed", "usr-agent", "West", "Walk-in", 18),
    seedLead("LD-2026-0007", "Vivek Joshi", "9822011106", "vivek.joshi@example.com", "GHIJK7890M", "Surat", "Gujarat", "Business Loan", 1800000, "Rejected", "usr-nisha", "West", "Cold call", 15),
    seedLead("LD-2026-0008", "Roshni Menon", "9822011107", "roshni.menon@example.com", "HIJKL8901N", "Mumbai", "Maharashtra", "Personal Loan", 480000, "Interested", "usr-agent", "West", "Website", 2, "Hot"),
  ];

  leads[6].rejectionReason = "Low credit score";

  return {
    users,
    teams: [
      { id: "team-west", name: "West", managerId: "usr-manager", targetMonthly: 35000000 },
      { id: "team-north", name: "North", managerId: "usr-manager", targetMonthly: 20000000 },
      { id: "team-business", name: "Business Desk", managerId: "usr-manager", targetMonthly: 28000000 },
    ],
    products: [
      {
        id: "prod-home",
        name: "Home Loan",
        fields: ["Property value", "Property type", "Builder name"],
        checklist: ["PAN card", "Aadhaar card", "Address proof", "Salary slips", "Bank statement", "Property papers", "Photograph"],
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
        checklist: ["PAN card", "GST certificate", "ITR", "Bank statement", "Business proof"],
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
        checklist: ["PAN card", "Aadhaar card", "Property papers", "Income proof", "Bank statement"],
      },
    ],
    stages: [
      { id: "stage-new", name: "New", color: "#0369a1", order: 1, kind: "open", approvalRequired: false },
      { id: "stage-contacted", name: "Contacted", color: "#0f766e", order: 2, kind: "open", approvalRequired: false },
      { id: "stage-review", name: "Under Review", color: "#7c3aed", order: 3, kind: "open", approvalRequired: true },
      { id: "stage-interested", name: "Interested", color: "#c2410c", order: 4, kind: "open", approvalRequired: false },
      { id: "stage-docs-pending", name: "Documents Pending", color: "#b45309", order: 5, kind: "open", approvalRequired: false },
      { id: "stage-docs-received", name: "Documents Received", color: "#047857", order: 6, kind: "open", approvalRequired: false },
      { id: "stage-submitted", name: "Submitted to Lender", color: "#4338ca", order: 7, kind: "open", approvalRequired: true },
      { id: "stage-approved", name: "Approved", color: "#15803d", order: 8, kind: "open", approvalRequired: true },
      { id: "stage-disbursed", name: "Disbursed", color: "#166534", order: 9, kind: "won", approvalRequired: true },
      { id: "stage-rejected", name: "Rejected", color: "#be123c", order: 10, kind: "lost", approvalRequired: true },
      { id: "stage-lost", name: "Lost / Not Interested", color: "#475569", order: 11, kind: "lost", approvalRequired: false },
    ],
    sources: ["Website", "Facebook", "Google", "Referral", "Walk-in", "Purchased list", "Cold call", "Webhook/API"],
    lenders: ["HDFC Bank", "ICICI Bank", "Axis Bank", "State Bank of India", "Bajaj Finance", "Tata Capital"],
    rejectionReasons: ["Low credit score", "Income mismatch", "Documents incomplete", "Policy mismatch", "Borrower withdrew"],
    lostReasons: ["Rate not suitable", "Not reachable", "Chose competitor", "Requirement postponed", "Not interested"],
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
      { id: "tpl-assignment", event: "assignment", subject: "New lead assigned: {{lead_name}}", body: "Please review {{lead_name}} and schedule the first follow-up." },
      { id: "tpl-stage", event: "stage", subject: "Lead moved to {{stage}}", body: "{{lead_name}} has moved to {{stage}} with the latest remark." },
      { id: "tpl-digest", event: "digest", subject: "Daily loan desk digest", body: "Your open leads, today's follow-ups, and overdue items are ready." },
    ],
    leads,
    activities: leads.flatMap((lead) => [
      {
        id: `activity-create-${lead.id}`,
        leadId: lead.id,
        userId: lead.assignedTo ?? "usr-manager",
        type: "create",
        title: "Lead captured",
        body: `${lead.borrowerName} came from ${lead.source}.`,
        createdAt: lead.createdAt,
      },
      {
        id: `activity-stage-${lead.id}`,
        leadId: lead.id,
        userId: lead.assignedTo ?? "usr-manager",
        type: "stage",
        title: `Moved to ${lead.stage}`,
        body: "Initial pipeline review completed.",
        createdAt: lead.updatedAt,
      },
    ]),
    notifications: [
      {
        id: "note-followup-sanjay",
        userId: "usr-agent",
        event: "followup",
        title: "Follow-up due today",
        body: "Sanjay Verma is waiting for a document reminder.",
        leadId: "LD-2026-0001",
        createdAt: daysFromNow(0, 9),
      },
      {
        id: "note-sla-west",
        userId: "usr-manager",
        event: "sla",
        title: "SLA watchlist",
        body: "2 West team leads have not moved in over 3 days.",
        createdAt: daysAgo(0, 8),
      },
      {
        id: "note-disbursement",
        userId: "usr-admin",
        event: "decision",
        title: "Disbursement recorded",
        body: "Neelam Batra was marked disbursed.",
        leadId: "LD-2026-0006",
        createdAt: daysAgo(1, 17),
      },
    ],
    savedViews: [
      {
        id: "view-hot-leads",
        userId: "usr-agent",
        name: "My hot leads",
        filters: { priority: "Hot" },
        createdAt: now,
      },
      {
        id: "view-docs-pending",
        userId: "usr-manager",
        name: "Docs pending > 3 days",
        filters: { stage: "Documents Pending", overdueOnly: true },
        createdAt: now,
      },
    ],
    audits: [
      {
        id: "audit-seed",
        userId: "usr-admin",
        action: "seed",
        entity: "system",
        entityId: "bootstrap",
        detail: "Loan CRM seeded with sample users, stages, and leads.",
        ip: "github-pages-demo",
        createdAt: now,
      },
    ],
    loginHistory: [],
  };
}
