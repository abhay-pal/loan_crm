import type { LeadDocument } from "@/lib/crm-types";
import {
  applyDocumentToLead,
  canEditLead,
  canSeeLead,
  getDocumentBucket,
  getSessionUser,
  jsonResponse,
  loadState,
  requestIp,
  saveState,
  stateForUser,
  tokenFromRequest,
  sanitizeUser,
} from "@/lib/crm-store";

const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const maxSizeBytes = 10 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const session = await getSessionUser(token);

    if (!session) {
      return jsonResponse({ error: "Please sign in again." }, { status: 401 });
    }

    const documentId = new URL(request.url).searchParams.get("id") ?? "";
    const lead = session.state.leads.find((candidate) =>
      candidate.documents.some((document) => document.id === documentId),
    );

    if (!lead || !canSeeLead(session.user, lead)) {
      return jsonResponse({ error: "Document not found." }, { status: 404 });
    }

    const document = lead.documents.find((candidate) => candidate.id === documentId);

    if (!document) {
      return jsonResponse({ error: "Document not found." }, { status: 404 });
    }

    const object = await getDocumentBucket().get(document.storageKey);

    if (!object?.body) {
      return jsonResponse({ error: "Stored document is unavailable." }, { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata?.(headers);
    headers.set("content-type", document.contentType || "application/octet-stream");
    headers.set(
      "content-disposition",
      `inline; filename="${document.name.replace(/"/g, "")}"`,
    );
    headers.set("cache-control", "private, no-store");

    return new Response(object.body, { headers });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const token = tokenFromRequest(request);
    const session = await getSessionUser(token);

    if (!session) {
      return jsonResponse({ error: "Please sign in again." }, { status: 401 });
    }

    const form = await request.formData();
    const leadId = String(form.get("leadId") ?? "");
    const checklistItem = String(form.get("checklistItem") ?? "");
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "Choose a file to upload." }, { status: 400 });
    }

    if (!allowedTypes.has(file.type)) {
      return jsonResponse(
        { error: "Only PDF, JPG, PNG, DOC, and DOCX files are allowed." },
        { status: 400 },
      );
    }

    if (file.size > maxSizeBytes) {
      return jsonResponse(
        { error: "Document size must be 10 MB or less." },
        { status: 400 },
      );
    }

    const state = await loadState();
    const currentUser =
      state.users.find((user) => user.id === session.user.id) ?? session.user;
    const lead = state.leads.find((candidate) => candidate.id === leadId);

    if (!lead || !canEditLead(currentUser, lead)) {
      return jsonResponse(
        { error: "You do not have permission to upload for this lead." },
        { status: 403 },
      );
    }

    const existingVersions = lead.documents.filter(
      (document) => document.checklistItem === checklistItem,
    );
    const document: LeadDocument = {
      id: crypto.randomUUID(),
      name: file.name,
      checklistItem: checklistItem || "General",
      contentType: file.type,
      size: file.size,
      version: existingVersions.length + 1,
      uploadedBy: currentUser.id,
      uploadedAt: new Date().toISOString(),
      storageKey: `lead-documents/${lead.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`,
    };

    await getDocumentBucket().put(document.storageKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    applyDocumentToLead(state, lead.id, document, currentUser, requestIp(request));
    await saveState(state);

    return jsonResponse({
      ok: true,
      message: "Document uploaded.",
      user: sanitizeUser(currentUser),
      state: stateForUser(state, currentUser),
    });
  } catch (error) {
    return routeError(error);
  }
}

function safeFilename(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "document";
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected document error.";

  return jsonResponse({ error: message }, { status: 500 });
}
