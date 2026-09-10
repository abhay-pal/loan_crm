import bcrypt from "bcryptjs";
import type {
  CRMState,
  CRMUser,
  EmploymentType,
  Lead,
  LeadFilters,
  Role,
} from "@/lib/crm-types";
import {
  addActivity,
  addAudit,
  addLoginHistory,
  addNotification,
  assignLeadAutomatically,
  canEditLead,
  canSeeLead,
  createSession,
  destroySession,
  findDuplicates,
  getDocumentBucket,
  getSessionUser,
  jsonResponse,
  loadState,
  makeLeadId,
  permissionsFor,
  requestIp,
  roleLabel,
  sanitizeUser,
  saveState,
  stateForUser,
  tokenFromRequest,
} from "@/lib/crm-store";

type ActionPayload = {
  action?: string;
  [key: string]: unknown;
};

type ActorContext = {
  user: CRMUser;
  state: CRMState;
  token: string;
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

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);

    if (actor instanceof Response) {
      return actor;
    }

    return respondWithState(actor.state, actor.user);
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ActionPayload;
    const action = String(payload.action ?? "");

    if (action === "login") {
      return login(request, payload);
    }

    if (action === "requestPasswordReset") {
      return requestPasswordReset(request, payload);
    }

    if (action === "externalLead") {
      return externalLead(request, payload);
    }

    const actor = await requireActor(request);

    if (actor instanceof Response) {
      return actor;
    }

    switch (action) {
      case "logout":
        await destroySession(actor.token);
        return jsonResponse({ ok: true });
      case "getState":
        return respondWithState(actor.state, actor.user);
      case "createLead":
        return createLead(request, actor, payload);
      case "bulkUpload":
        return bulkUpload(request, actor, payload);
      case "updateLead":
        return updateLead(request, actor, payload);
      case "changeStage":
        return changeStage(request, actor, payload);
      case "assignLeads":
        return assignLeads(request, actor, payload);
      case "addNote":
        return addNote(request, actor, payload);
      case "logCall":
        return logCall(request, actor, payload);
      case "scheduleFollowUp":
        return scheduleFollowUp(request, actor, payload);
      case "addTask":
        return addTask(request, actor, payload);
      case "toggleTask":
        return toggleTask(request, actor, payload);
      case "saveView":
        return saveView(request, actor, payload);
      case "deleteSavedView":
        return deleteSavedView(request, actor, payload);
      case "markNotification":
        return markNotification(actor, payload);
      case "markAllNotifications":
        return markAllNotifications(actor);
      case "updateNotificationPreferences":
        return updateNotificationPreferences(request, actor, payload);
      case "createUser":
        return createUser(request, actor, payload);
      case "updateUser":
        return updateUser(request, actor, payload);
      case "deactivateUser":
        return deactivateUser(request, actor, payload);
      case "updateSettings":
        return updateSettings(request, actor, payload);
      case "softDeleteLead":
        return softDeleteLead(request, actor, payload);
      case "restoreLead":
        return restoreLead(request, actor, payload);
      case "permanentlyDeleteLead":
        return permanentlyDeleteLead(request, actor, payload);
      case "deleteDocument":
        return deleteDocument(request, actor, payload);
      default:
        return jsonResponse({ error: "Unknown CRM action." }, { status: 400 });
    }
  } catch (error) {
    return routeError(error);
  }
}

async function requireActor(request: Request): Promise<ActorContext | Response> {
  const token = tokenFromRequest(request);
  const session = await getSessionUser(token);

  if (!token || !session) {
    return jsonResponse({ error: "Please sign in again." }, { status: 401 });
  }

  return {
    token,
    user: session.user,
    state: session.state,
  };
}

async function login(request: Request, payload: ActionPayload) {
  const email = asString(payload.email).toLowerCase();
  const password = asString(payload.password);
  const otp = asString(payload.otp);
  const rememberDevice = Boolean(payload.rememberDevice);
  const ip = requestIp(request);
  const state = await loadState();
  const user = state.users.find((candidate) => candidate.email.toLowerCase() === email);

  if (!user || user.status !== "active") {
    addLoginHistory(state, email, "failed", ip);
    await saveState(state);
    return jsonResponse({ error: "Invalid email or password." }, { status: 401 });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash ?? "");

  if (!passwordMatches) {
    addLoginHistory(state, email, "failed", ip, user.id);
    await saveState(state);
    return jsonResponse({ error: "Invalid email or password." }, { status: 401 });
  }

  if (user.twoFactorEnabled && otp !== "246810") {
    return jsonResponse({
      requiresOtp: true,
      message:
        "Email OTP is enabled for this account. Use demo OTP 246810 in this preview.",
    });
  }

  const { token, expiresAt } = await createSession(user.id, rememberDevice);
  const loggedInAt = new Date().toISOString();
  user.lastLoginAt = loggedInAt;
  user.rememberDevice = rememberDevice;
  addLoginHistory(state, user.email, "success", ip, user.id);
  addAudit(
    state,
    user,
    "login",
    "user",
    user.id,
    `${user.name} signed in as ${roleLabel(user.role)}.`,
    ip,
  );
  await saveState(state);

  return respondWithState(state, user, {
    token,
    expiresAt,
    message: "Signed in successfully.",
  });
}

async function requestPasswordReset(request: Request, payload: ActionPayload) {
  const email = asString(payload.email).toLowerCase();
  const ip = requestIp(request);
  const state = await loadState();
  const user = state.users.find((candidate) => candidate.email.toLowerCase() === email);

  if (user) {
    const admins = state.users.filter((candidate) => candidate.role === "admin");
    addNotification(
      state,
      admins.map((admin) => admin.id),
      "digest",
      "Password reset requested",
      `${user.name} requested a reset link. The preview records the request instead of sending email.`,
    );
    addAudit(
      state,
      user,
      "request_password_reset",
      "user",
      user.id,
      "Password reset link requested from login screen.",
      ip,
    );
    await saveState(state);
  }

  return jsonResponse({
    ok: true,
    message:
      "If that email exists, a reset request has been recorded. In production this sends a secure email link.",
  });
}

async function externalLead(request: Request, payload: ActionPayload) {
  const secret = request.headers.get("x-crm-webhook-secret");

  if (secret !== "demo-secret") {
    return jsonResponse({ error: "Invalid webhook secret." }, { status: 401 });
  }

  const state = await loadState();
  const systemUser =
    state.users.find((user) => user.role === "admin") ?? state.users[0];
  const leadPayload = normalizeLeadInput(payload.lead);
  const lead = buildNewLead(state, leadPayload, "Webhook/API", systemUser);
  const duplicates = findDuplicates(state, lead);

  if (duplicates.length) {
    return jsonResponse(
      {
        error: "Duplicate lead detected.",
        duplicates: duplicates.map(minimalLead),
      },
      { status: 409 },
    );
  }

  assignLeadAutomatically(state, lead);
  state.leads.unshift(lead);
  addActivity(
    state,
    lead.id,
    systemUser.id,
    "create",
    "Lead captured by webhook",
    `${lead.borrowerName} entered through the external API endpoint.`,
  );
  addAudit(
    state,
    systemUser,
    "webhook_lead_created",
    "lead",
    lead.id,
    `External API created ${lead.borrowerName}.`,
    requestIp(request),
  );
  notifyAssignment(state, lead);
  await saveState(state);

  return jsonResponse({ ok: true, lead: minimalLead(lead) }, { status: 201 });
}

async function createLead(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  ensureCanEdit(user);
  const leadPayload = normalizeLeadInput(payload.lead);
  const errors = validateLeadInput(leadPayload);

  if (errors.length) {
    return jsonResponse({ error: "Lead validation failed.", errors }, { status: 400 });
  }

  const lead = buildNewLead(state, leadPayload, leadPayload.source, user);
  const duplicates = findDuplicates(state, lead);
  const duplicateMode = asString(payload.duplicateMode);

  if (duplicates.length && !duplicateMode) {
    return jsonResponse(
      {
        error: "Duplicate lead detected.",
        duplicates: duplicates.map(minimalLead),
      },
      { status: 409 },
    );
  }

  if (duplicates.length && duplicateMode === "skip") {
    return jsonResponse({
      ok: true,
      skipped: true,
      message: "Lead skipped because a duplicate exists.",
      duplicates: duplicates.map(minimalLead),
    });
  }

  if (duplicates.length && duplicateMode === "merge") {
    const target = duplicates[0];
    applyLeadUpdates(target, leadPayload);
    target.updatedAt = new Date().toISOString();
    target.lastTouchedAt = target.updatedAt;
    addActivity(
      state,
      target.id,
      user.id,
      "edit",
      "Duplicate merged",
      `${lead.borrowerName} details were merged into existing lead ${target.id}.`,
    );
    addAudit(
      state,
      user,
      "merge_duplicate_lead",
      "lead",
      target.id,
      `${lead.borrowerName} merged into ${target.id}.`,
      requestIp(request),
    );
    await saveState(state);
    return respondWithState(state, user, {
      message: "Duplicate details merged into the existing lead.",
      leadId: target.id,
    });
  }

  assignLeadAutomatically(state, lead);
  state.leads.unshift(lead);
  addActivity(
    state,
    lead.id,
    user.id,
    "create",
    "Lead created",
    `${lead.borrowerName} was added from ${lead.source}.`,
  );
  addAudit(
    state,
    user,
    "create_lead",
    "lead",
    lead.id,
    `${lead.borrowerName} created.`,
    requestIp(request),
  );
  notifyAssignment(state, lead);
  await saveState(state);

  return respondWithState(state, user, {
    message: "Lead created successfully.",
    leadId: lead.id,
  });
}

async function bulkUpload(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  ensureCanEdit(user);
  const rows = Array.isArray(payload.leads) ? payload.leads : [];
  const duplicateMode = asString(payload.duplicateMode) || "skip";
  const inserted: string[] = [];
  const skipped: { row: number; reason: string; duplicate?: ReturnType<typeof minimalLead> }[] = [];
  const errors: { row: number; errors: string[] }[] = [];

  rows.forEach((row, index) => {
    const leadPayload = normalizeLeadInput(row);
    const rowErrors = validateLeadInput(leadPayload);

    if (rowErrors.length) {
      errors.push({ row: index + 2, errors: rowErrors });
      return;
    }

    const lead = buildNewLead(state, leadPayload, leadPayload.source, user);
    const duplicates = findDuplicates(state, lead);

    if (duplicates.length && duplicateMode === "skip") {
      skipped.push({
        row: index + 2,
        reason: "Duplicate phone, email, or PAN.",
        duplicate: minimalLead(duplicates[0]),
      });
      return;
    }

    if (duplicates.length && duplicateMode === "merge") {
      const target = duplicates[0];
      applyLeadUpdates(target, leadPayload);
      target.updatedAt = new Date().toISOString();
      target.lastTouchedAt = target.updatedAt;
      inserted.push(target.id);
      addActivity(
        state,
        target.id,
        user.id,
        "edit",
        "Bulk upload merged duplicate",
        `Row ${index + 2} was merged into this lead.`,
      );
      return;
    }

    assignLeadAutomatically(state, lead);
    state.leads.unshift(lead);
    inserted.push(lead.id);
    addActivity(
      state,
      lead.id,
      user.id,
      "create",
      "Lead imported",
      `Imported from row ${index + 2} of the upload.`,
    );
    notifyAssignment(state, lead);
  });

  addAudit(
    state,
    user,
    "bulk_upload",
    "lead",
    "csv-import",
    `${inserted.length} inserted, ${skipped.length} skipped, ${errors.length} invalid.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, {
    message: `Upload finished: ${inserted.length} saved, ${skipped.length} skipped, ${errors.length} invalid.`,
    uploadReport: { inserted, skipped, errors },
  });
}

async function updateLead(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const updates = normalizeLeadInput(payload.updates);
  const duplicates = findDuplicates(state, { ...lead, ...updates }, lead.id);
  const duplicateMode = asString(payload.duplicateMode);

  if (duplicates.length && !duplicateMode) {
    return jsonResponse(
      {
        error: "Duplicate lead detected.",
        duplicates: duplicates.map(minimalLead),
      },
      { status: 409 },
    );
  }

  applyLeadUpdates(lead, updates);
  const assignee = state.users.find((candidate) => candidate.id === lead.assignedTo);
  if (assignee) {
    lead.team = assignee.team;
  }
  lead.updatedAt = new Date().toISOString();
  lead.lastTouchedAt = lead.updatedAt;
  addActivity(
    state,
    lead.id,
    user.id,
    "edit",
    "Lead details updated",
    `${user.name} updated lead fields.`,
  );
  addAudit(
    state,
    user,
    "update_lead",
    "lead",
    lead.id,
    `${lead.borrowerName} details updated.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, {
    message: "Lead updated.",
    leadId: lead.id,
  });
}

async function changeStage(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const nextStage = asString(payload.stage);
  const remark = asString(payload.remark);
  const stage = state.stages.find((candidate) => candidate.name === nextStage);

  if (!stage) {
    return jsonResponse({ error: "Unknown pipeline stage." }, { status: 400 });
  }

  if (!remark) {
    return jsonResponse(
      { error: "A stage-change remark is required." },
      { status: 400 },
    );
  }

  const previousStage = lead.stage;
  lead.stage = stage.name;
  lead.remarks = remark;
  lead.updatedAt = new Date().toISOString();
  lead.lastTouchedAt = lead.updatedAt;

  if (stage.name === "Rejected") {
    lead.rejectionReason = asString(payload.reason) || "Not specified";
  }

  if (stage.name === "Lost / Not Interested") {
    lead.lostReason = asString(payload.reason) || "Not specified";
  }

  addActivity(
    state,
    lead.id,
    user.id,
    "stage",
    `${previousStage} to ${stage.name}`,
    remark,
  );
  addAudit(
    state,
    user,
    "change_stage",
    "lead",
    lead.id,
    `${lead.borrowerName}: ${previousStage} to ${stage.name}.`,
    requestIp(request),
  );

  const recipients = leadStakeholders(state, lead);
  addNotification(
    state,
    recipients,
    stage.kind === "won" || stage.kind === "lost" ? "decision" : "stage",
    `${lead.borrowerName} moved to ${stage.name}`,
    remark,
    lead.id,
  );
  await saveState(state);

  return respondWithState(state, user, {
    message: `Lead moved to ${stage.name}.`,
    leadId: lead.id,
  });
}

async function assignLeads(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canAssignLeads) {
    return forbidden();
  }

  const leadIds = asStringArray(payload.leadIds);
  const assignedTo = asString(payload.assignedTo);
  const reason = asString(payload.reason) || "Manager assignment";
  const assignee = state.users.find(
    (candidate) => candidate.id === assignedTo && candidate.status === "active",
  );

  if (!leadIds.length || !assignee) {
    return jsonResponse(
      { error: "Choose at least one lead and an active assignee." },
      { status: 400 },
    );
  }

  const openAssignments = state.leads.filter(
    (lead) =>
      lead.assignedTo === assignedTo &&
      !lead.deletedAt &&
      !["Disbursed", "Rejected", "Lost / Not Interested"].includes(lead.stage),
  ).length;

  if (openAssignments + leadIds.length > assignee.capacityMonthly) {
    return jsonResponse(
      {
        error: `${assignee.name} is over the monthly capacity limit of ${assignee.capacityMonthly}.`,
      },
      { status: 400 },
    );
  }

  let changed = 0;

  for (const leadId of leadIds) {
    const lead = state.leads.find((candidate) => candidate.id === leadId);

    if (!lead || !canSeeLead(user, lead)) {
      continue;
    }

    lead.assignedTo = assignee.id;
    lead.team = assignee.team;
    lead.updatedAt = new Date().toISOString();
    lead.lastTouchedAt = lead.updatedAt;
    changed += 1;

    addActivity(
      state,
      lead.id,
      user.id,
      "assign",
      `Assigned to ${assignee.name}`,
      reason,
    );
    addNotification(
      state,
      [assignee.id],
      "assignment",
      "New lead assigned to you",
      `${lead.borrowerName} is now in your queue.`,
      lead.id,
    );
  }

  addAudit(
    state,
    user,
    "assign_leads",
    "lead",
    leadIds.join(","),
    `${changed} lead(s) assigned to ${assignee.name}. Reason: ${reason}`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, {
    message: `${changed} lead(s) assigned to ${assignee.name}.`,
  });
}

async function addNote(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const body = asString(payload.body);

  if (!body) {
    return jsonResponse({ error: "Write a note first." }, { status: 400 });
  }

  lead.updatedAt = new Date().toISOString();
  lead.lastTouchedAt = lead.updatedAt;
  addActivity(state, lead.id, user.id, "note", "Internal note", body);
  addAudit(
    state,
    user,
    "add_note",
    "lead",
    lead.id,
    `Note added to ${lead.borrowerName}.`,
    requestIp(request),
  );

  const mentioned = findMentionedUsers(state, body).filter(
    (mentionedUser) => mentionedUser.id !== user.id,
  );
  addNotification(
    state,
    mentioned.map((mentionedUser) => mentionedUser.id),
    "mention",
    `${user.name} mentioned you`,
    `${lead.borrowerName}: ${body.slice(0, 120)}`,
    lead.id,
  );
  await saveState(state);

  return respondWithState(state, user, {
    message: mentioned.length ? "Note added and mention sent." : "Note added.",
  });
}

async function logCall(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const outcome = asString(payload.outcome) || "connected";
  const duration = Math.max(0, Number(payload.duration ?? 0));
  const nextAction = asString(payload.nextAction);
  const followUpAt = asString(payload.followUpAt);
  const body = [
    `Outcome: ${outcome}`,
    `Duration: ${duration} min`,
    nextAction ? `Next action: ${nextAction}` : "",
    followUpAt ? `Follow-up: ${formatDateTime(followUpAt)}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  if (followUpAt) {
    lead.followUpAt = new Date(followUpAt).toISOString();
  }

  lead.updatedAt = new Date().toISOString();
  lead.lastTouchedAt = lead.updatedAt;
  addActivity(state, lead.id, user.id, "call", "Call logged", body);
  addAudit(
    state,
    user,
    "log_call",
    "lead",
    lead.id,
    `${outcome} call logged for ${lead.borrowerName}.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Call logged." });
}

async function scheduleFollowUp(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const followUpAt = asString(payload.followUpAt);

  if (!followUpAt) {
    return jsonResponse({ error: "Choose a follow-up time." }, { status: 400 });
  }

  lead.followUpAt = new Date(followUpAt).toISOString();
  lead.updatedAt = new Date().toISOString();
  lead.lastTouchedAt = lead.updatedAt;
  addActivity(
    state,
    lead.id,
    user.id,
    "task",
    "Follow-up scheduled",
    `Reminder set for ${formatDateTime(lead.followUpAt)}.`,
  );
  addNotification(
    state,
    lead.assignedTo ? [lead.assignedTo] : [],
    "followup",
    "Follow-up scheduled",
    `${lead.borrowerName} is due on ${formatDateTime(lead.followUpAt)}.`,
    lead.id,
  );
  addAudit(
    state,
    user,
    "schedule_followup",
    "lead",
    lead.id,
    `${lead.borrowerName} follow-up scheduled.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Follow-up scheduled." });
}

async function addTask(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const title = asString(payload.title);

  if (!title) {
    return jsonResponse({ error: "Task title is required." }, { status: 400 });
  }

  const task: Lead["tasks"][number] = {
    id: crypto.randomUUID(),
    title,
    done: false,
    dueAt: asString(payload.dueAt) || undefined,
    ownerId: asString(payload.ownerId) || lead.assignedTo || user.id,
    createdAt: new Date().toISOString(),
  };
  lead.tasks.unshift(task);
  lead.updatedAt = task.createdAt;
  addActivity(state, lead.id, user.id, "task", "Task added", title);
  addAudit(
    state,
    user,
    "add_task",
    "lead_task",
    task.id,
    `${title} added to ${lead.borrowerName}.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Task added." });
}

async function toggleTask(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const taskId = asString(payload.taskId);
  const task = lead.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    return jsonResponse({ error: "Task not found." }, { status: 404 });
  }

  task.done = Boolean(payload.done);
  lead.updatedAt = new Date().toISOString();
  addActivity(
    state,
    lead.id,
    user.id,
    "task",
    task.done ? "Task completed" : "Task reopened",
    task.title,
  );
  addAudit(
    state,
    user,
    "toggle_task",
    "lead_task",
    task.id,
    `${task.title} marked ${task.done ? "done" : "open"}.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Task updated." });
}

async function saveView(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const name = asString(payload.name);

  if (!name) {
    return jsonResponse({ error: "Saved view name is required." }, { status: 400 });
  }

  const view = {
    id: crypto.randomUUID(),
    userId: user.id,
    name,
    filters: (payload.filters ?? {}) as LeadFilters,
    createdAt: new Date().toISOString(),
  };
  state.savedViews = state.savedViews.filter(
    (candidate) =>
      !(candidate.userId === user.id && candidate.name.toLowerCase() === name.toLowerCase()),
  );
  state.savedViews.unshift(view);
  addAudit(
    state,
    user,
    "save_view",
    "saved_view",
    view.id,
    `${name} filter saved.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "View saved." });
}

async function deleteSavedView(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const id = asString(payload.id);
  state.savedViews = state.savedViews.filter(
    (view) => !(view.id === id && view.userId === user.id),
  );
  addAudit(
    state,
    user,
    "delete_view",
    "saved_view",
    id,
    "Saved view deleted.",
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Saved view removed." });
}

async function markNotification({ state, user }: ActorContext, payload: ActionPayload) {
  const id = asString(payload.id);
  const notification = state.notifications.find(
    (candidate) => candidate.id === id && candidate.userId === user.id,
  );

  if (notification) {
    notification.readAt = new Date().toISOString();
  }

  await saveState(state);
  return respondWithState(state, user);
}

async function markAllNotifications({ state, user }: ActorContext) {
  const now = new Date().toISOString();
  state.notifications.forEach((notification) => {
    if (notification.userId === user.id && !notification.readAt) {
      notification.readAt = now;
    }
  });
  await saveState(state);

  return respondWithState(state, user, { message: "Notifications cleared." });
}

async function updateNotificationPreferences(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const target = state.users.find((candidate) => candidate.id === user.id);

  if (!target) {
    return forbidden();
  }

  target.notificationPreferences = {
    ...target.notificationPreferences,
    ...((payload.preferences ?? {}) as CRMUser["notificationPreferences"]),
  };
  addAudit(
    state,
    user,
    "update_notification_preferences",
    "user",
    user.id,
    "Notification preferences updated.",
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, target, { message: "Preferences saved." });
}

async function createUser(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canManageUsers) {
    return forbidden();
  }

  const nextUser = normalizeUserInput(payload.user);
  const errors = validateUserInput(nextUser);

  if (errors.length) {
    return jsonResponse({ error: "User validation failed.", errors }, { status: 400 });
  }

  if (
    state.users.some(
      (candidate) => candidate.email.toLowerCase() === nextUser.email.toLowerCase(),
    )
  ) {
    return jsonResponse({ error: "A user with this email already exists." }, { status: 400 });
  }

  const created: CRMUser = {
    id: crypto.randomUUID(),
    name: nextUser.name,
    email: nextUser.email.toLowerCase(),
    role: nextUser.role,
    team: nextUser.team,
    managerId: nextUser.managerId,
    phone: nextUser.phone,
    status: "active",
    capacityDaily: nextUser.capacityDaily,
    capacityMonthly: nextUser.capacityMonthly,
    twoFactorEnabled: nextUser.twoFactorEnabled,
    rememberDevice: false,
    notificationPreferences: {
      assignment: true,
      stage: true,
      mention: true,
      followup: true,
      document: true,
      sla: true,
      decision: true,
      digest: true,
    },
    passwordHash: await bcrypt.hash(nextUser.password || "Welcome@123", 10),
    createdAt: new Date().toISOString(),
  };
  state.users.push(created);
  addAudit(
    state,
    user,
    "create_user",
    "user",
    created.id,
    `${created.name} created as ${roleLabel(created.role)}.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "User created." });
}

async function updateUser(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canManageUsers) {
    return forbidden();
  }

  const id = asString(payload.userId);
  const target = state.users.find((candidate) => candidate.id === id);

  if (!target) {
    return jsonResponse({ error: "User not found." }, { status: 404 });
  }

  const updates = normalizeUserInput(payload.updates);
  target.name = updates.name || target.name;
  target.email = updates.email ? updates.email.toLowerCase() : target.email;
  target.role = updates.role;
  target.team = updates.team || target.team;
  target.managerId = updates.managerId || undefined;
  target.phone = updates.phone || undefined;
  target.capacityDaily = updates.capacityDaily;
  target.capacityMonthly = updates.capacityMonthly;
  target.twoFactorEnabled = updates.twoFactorEnabled;
  target.status = updates.status;

  if (updates.password) {
    target.passwordHash = await bcrypt.hash(updates.password, 10);
  }

  addAudit(
    state,
    user,
    "update_user",
    "user",
    target.id,
    `${target.name} profile updated.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "User updated." });
}

async function deactivateUser(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canManageUsers) {
    return forbidden();
  }

  const target = state.users.find((candidate) => candidate.id === asString(payload.userId));

  if (!target) {
    return jsonResponse({ error: "User not found." }, { status: 404 });
  }

  target.status = target.status === "active" ? "inactive" : "active";
  addAudit(
    state,
    user,
    "toggle_user_status",
    "user",
    target.id,
    `${target.name} marked ${target.status}.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "User status updated." });
}

async function updateSettings(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canManageSettings) {
    return forbidden();
  }

  state.settings = {
    ...state.settings,
    ...((payload.settings ?? {}) as CRMState["settings"]),
  };

  if (Array.isArray(payload.sources)) {
    state.sources = asStringArray(payload.sources);
  }

  if (Array.isArray(payload.lenders)) {
    state.lenders = asStringArray(payload.lenders);
  }

  if (Array.isArray(payload.rejectionReasons)) {
    state.rejectionReasons = asStringArray(payload.rejectionReasons);
  }

  if (Array.isArray(payload.lostReasons)) {
    state.lostReasons = asStringArray(payload.lostReasons);
  }

  if (Array.isArray(payload.products)) {
    state.products = payload.products as CRMState["products"];
  }

  if (Array.isArray(payload.stages)) {
    state.stages = (payload.stages as CRMState["stages"]).sort(
      (a, b) => a.order - b.order,
    );
  }

  if (Array.isArray(payload.teams)) {
    state.teams = payload.teams as CRMState["teams"];
  }

  if (Array.isArray(payload.emailTemplates)) {
    state.emailTemplates = payload.emailTemplates as CRMState["emailTemplates"];
  }

  addAudit(
    state,
    user,
    "update_settings",
    "settings",
    "crm",
    "CRM settings and masters updated.",
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Settings saved." });
}

async function softDeleteLead(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canDeleteLeads) {
    return forbidden();
  }

  const lead = getLeadOrThrow(state, asString(payload.leadId));
  lead.deletedAt = new Date().toISOString();
  addAudit(
    state,
    user,
    "soft_delete_lead",
    "lead",
    lead.id,
    `${lead.borrowerName} moved to recycle bin.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Lead moved to recycle bin." });
}

async function restoreLead(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canDeleteLeads) {
    return forbidden();
  }

  const lead = getLeadOrThrow(state, asString(payload.leadId), true);
  lead.deletedAt = undefined;
  addAudit(
    state,
    user,
    "restore_lead",
    "lead",
    lead.id,
    `${lead.borrowerName} restored from recycle bin.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Lead restored." });
}

async function permanentlyDeleteLead(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  if (!permissionsFor(user).canDeleteLeads) {
    return forbidden();
  }

  const leadId = asString(payload.leadId);
  const lead = getLeadOrThrow(state, leadId, true);
  state.leads = state.leads.filter((candidate) => candidate.id !== leadId);
  state.activities = state.activities.filter((activity) => activity.leadId !== leadId);
  state.notifications = state.notifications.filter(
    (notification) => notification.leadId !== leadId,
  );
  addAudit(
    state,
    user,
    "permanent_delete_lead",
    "lead",
    leadId,
    `${lead.borrowerName} permanently deleted.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Lead permanently deleted." });
}

async function deleteDocument(
  request: Request,
  { state, user }: ActorContext,
  payload: ActionPayload,
) {
  const lead = getLeadOrThrow(state, asString(payload.leadId));

  if (!canEditLead(user, lead)) {
    return forbidden();
  }

  const documentId = asString(payload.documentId);
  const document = lead.documents.find((candidate) => candidate.id === documentId);

  if (!document) {
    return jsonResponse({ error: "Document not found." }, { status: 404 });
  }

  lead.documents = lead.documents.filter((candidate) => candidate.id !== documentId);
  lead.updatedAt = new Date().toISOString();
  lead.lastTouchedAt = lead.updatedAt;

  if (document.storageKey) {
    await getDocumentBucket().delete(document.storageKey);
  }

  addActivity(
    state,
    lead.id,
    user.id,
    "document",
    "Document deleted",
    `${document.name} was deleted from ${document.checklistItem}.`,
  );
  addAudit(
    state,
    user,
    "delete_document",
    "lead_document",
    document.id,
    `${document.name} deleted from ${lead.borrowerName}.`,
    requestIp(request),
  );
  await saveState(state);

  return respondWithState(state, user, { message: "Document deleted." });
}

function respondWithState(
  state: CRMState,
  user: CRMUser,
  extras: Record<string, unknown> = {},
) {
  const freshUser = state.users.find((candidate) => candidate.id === user.id) ?? user;

  return jsonResponse({
    ok: true,
    user: sanitizeUser(freshUser),
    permissions: permissionsFor(freshUser),
    state: stateForUser(state, freshUser),
    ...extras,
  });
}

function ensureCanEdit(user: CRMUser) {
  if (user.role === "viewer") {
    throw new Error("Viewer accounts are read-only.");
  }
}

function getLeadOrThrow(state: CRMState, leadId: string, includeDeleted = false) {
  const lead = state.leads.find(
    (candidate) => candidate.id === leadId && (includeDeleted || !candidate.deletedAt),
  );

  if (!lead) {
    throw new Error("Lead not found.");
  }

  return lead;
}

function buildNewLead(
  state: CRMState,
  leadPayload: Partial<Lead>,
  sourceFallback: string,
  user: CRMUser,
): Lead {
  const now = new Date().toISOString();
  const assignedTo = leadPayload.assignedTo || (user.role === "agent" ? user.id : undefined);
  const assignee = state.users.find((candidate) => candidate.id === assignedTo);
  const team = leadPayload.team || assignee?.team || user.team || state.teams[0]?.name || "General";

  return {
    id: makeLeadId(state),
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
    source: leadPayload.source || sourceFallback || state.sources[0] || "Website",
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

function normalizeLeadInput(input: unknown): Partial<Lead> {
  const source = (input ?? {}) as Record<string, unknown>;
  const normalized: Partial<Lead> = {};

  for (const field of editableLeadFields) {
    if (source[field] === undefined) {
      continue;
    }

    if (field === "amount" || field === "tenureMonths" || field === "income") {
      normalized[field] = Number(source[field] ?? 0) as never;
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

function applyLeadUpdates(lead: Lead, updates: Partial<Lead>) {
  for (const field of editableLeadFields) {
    const nextValue = updates[field];

    if (nextValue !== undefined) {
      lead[field] = nextValue as never;
    }
  }
}

function validateLeadInput(lead: Partial<Lead>) {
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

function normalizeUserInput(input: unknown) {
  const source = (input ?? {}) as Record<string, unknown>;
  const role = roles.includes(source.role as Role) ? (source.role as Role) : "agent";

  return {
    id: asString(source.id),
    name: asString(source.name),
    email: asString(source.email),
    role,
    team: asString(source.team) || "West",
    managerId: asString(source.managerId),
    phone: asString(source.phone),
    status: asString(source.status) === "inactive" ? "inactive" : "active",
    capacityDaily: Math.max(0, Number(source.capacityDaily ?? 15)),
    capacityMonthly: Math.max(0, Number(source.capacityMonthly ?? 250)),
    twoFactorEnabled: Boolean(source.twoFactorEnabled),
    password: asString(source.password),
  };
}

function validateUserInput(user: ReturnType<typeof normalizeUserInput>) {
  const errors: string[] = [];

  if (!user.name) {
    errors.push("Name is required.");
  }

  if (!user.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
    errors.push("A valid email is required.");
  }

  if (!roles.includes(user.role)) {
    errors.push("Choose a valid role.");
  }

  return errors;
}

function notifyAssignment(state: CRMState, lead: Lead) {
  if (!lead.assignedTo) {
    return;
  }

  addNotification(
    state,
    [lead.assignedTo],
    "assignment",
    "New lead assigned to you",
    `${lead.borrowerName} is ready for follow-up.`,
    lead.id,
  );
}

function leadStakeholders(state: CRMState, lead: Lead) {
  const assignee = state.users.find((candidate) => candidate.id === lead.assignedTo);
  const manager = state.users.find((candidate) => candidate.id === assignee?.managerId);
  const admins = state.users.filter((candidate) => candidate.role === "admin");

  return [
    lead.assignedTo,
    manager?.id,
    ...admins.map((admin) => admin.id),
  ].filter(Boolean) as string[];
}

function findMentionedUsers(state: CRMState, body: string) {
  const lowerBody = body.toLowerCase();

  return state.users.filter((user) => {
    const first = user.name.split(" ")[0]?.toLowerCase();
    const compact = user.name.toLowerCase().replace(/\s+/g, "");
    const emailHandle = user.email.split("@")[0]?.toLowerCase();

    return (
      (first && lowerBody.includes(`@${first}`)) ||
      lowerBody.includes(`@${compact}`) ||
      (emailHandle && lowerBody.includes(`@${emailHandle}`))
    );
  });
}

function minimalLead(lead: Lead) {
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

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter(Boolean)
    : asString(value)
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function forbidden() {
  return jsonResponse({ error: "You do not have permission for that action." }, { status: 403 });
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected CRM error.";
  const status = message.includes("not found") ? 404 : message.includes("read-only") ? 403 : 500;

  return jsonResponse({ error: message }, { status });
}
