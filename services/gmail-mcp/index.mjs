/**
 * Gmail MCP / HTTP-tool server for the `email-order-import` Temporal workflow.
 *
 * Tools (POST {url}/tools/<name>) — the repo's HTTP tool convention, the same
 * shape `llm_agent` MCP dispatch uses (POST {url}/tools/{name}) and callable
 * directly from the DSL `http_request` activity:
 *
 *   search_pending      { gmail_account, label_exclude, require_pdf, max }
 *                         -> { messages: [{ message_id, subject, has_pdf }], count }
 *   download_attachment  { gmail_account, message_id }
 *                         -> { has_pdf, filename, signed_url }
 *   mark_imported        { gmail_account, message_id }            -> { success }
 *   mark_ignored         { gmail_account, message_id, reason }    -> { success }
 *
 * Auth (real mode): either OAuth2 refresh token
 *   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
 * or Workspace service-account domain-wide delegation
 *   GOOGLE_APPLICATION_CREDENTIALS (path) + impersonate the requested gmail_account.
 *
 * PDF storage: each downloaded attachment is uploaded to the Supabase Storage
 * bucket `order-pdfs` (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and a signed URL
 * (valid SIGNED_URL_TTL seconds) is returned for file_extract to fetch.
 *
 * STUB MODE: set GMAIL_MCP_STUB=true to run without Gmail/Storage credentials.
 * search_pending returns two fixtures (one PO-with-PDF, one without); the server
 * serves the bundled sample PDF at GET /fixtures/<name> and returns that URL as
 * `signed_url`. Useful for wiring up and manual integration testing.
 *
 * SECURITY NOTE: this server holds Gmail credentials and a Supabase service-role
 * key. Credential handling + the googleapis dependency require Security/Compliance
 * and license review before production use (per org policy). All secrets come from
 * env; nothing is embedded.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build a minimal, valid single-page PDF (correct xref offsets) containing the
// given lines of text. Used in STUB mode so file_extract has a real PDF to parse
// without committing a binary fixture.
function buildSamplePdf(lines) {
  const content =
    "BT /F1 11 Tf 50 760 Td 14 TL " +
    lines.map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj T*`).join(" ") +
    " ET";
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const SAMPLE_PDF = buildSamplePdf([
  "PURCHASE ORDER  PO-1001",
  "Customer: Acme Components Ltda",
  "Document: 12.345.678/0001-90",
  "Address: Rua das Flores 100, Sao Paulo, SP, 01000-000, BR",
  "Order date: 2026-06-20",
  "",
  "SKU        Description            Qty   Unit price   Total",
  "WID-001    Widget, blue, large     10        12.50   125.00",
  "GZM-220    Gizmo mounting kit       4        30.00   120.00",
  "Grand total: 245.00",
]);

const PORT = Number(process.env.PORT ?? 8080);
const STUB = String(process.env.GMAIL_MCP_STUB ?? "").toLowerCase() === "true";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const STORAGE_BUCKET = process.env.ORDER_PDF_BUCKET ?? "order-pdfs";
const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL ?? 600);
const PUBLIC_BASE_URL = process.env.GMAIL_MCP_PUBLIC_URL ?? `http://localhost:${PORT}`;

// ── tiny helpers ────────────────────────────────────────────────────────────

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function log(label, data) {
  console.log(`[gmail-mcp] ${label}${data ? " " + JSON.stringify(data) : ""}`);
}

// ── Supabase Storage upload + signed URL ──────────────────────────────────────

async function uploadAndSign(objectPath, bytes, contentType) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to upload attachments");
  }
  const headers = {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
  };
  // Upsert the object.
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
    body: bytes,
  });
  if (!up.ok) {
    throw new Error(`storage upload failed: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  }
  // Create a signed URL.
  const sign = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${STORAGE_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
  });
  if (!sign.ok) {
    throw new Error(`storage sign failed: HTTP ${sign.status} ${(await sign.text()).slice(0, 200)}`);
  }
  const { signedURL } = await sign.json();
  // signedURL is relative ("/object/sign/..."); make it absolute.
  return `${SUPABASE_URL}/storage/v1${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
}

// ── Gmail client (real mode) ──────────────────────────────────────────────────

let _gmailModule = null;
async function gmailFor(account) {
  if (!_gmailModule) _gmailModule = await import("googleapis");
  const { google } = _gmailModule;
  let auth;
  if (process.env.GMAIL_REFRESH_TOKEN) {
    auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  } else {
    // Service-account domain-wide delegation: impersonate the requested mailbox.
    auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      clientOptions: { subject: account },
    });
  }
  return google.gmail({ version: "v1", auth });
}

async function ensureLabel(gmail, name) {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = (data.labels ?? []).find((l) => l.name === name);
  if (existing) return existing.id;
  const created = await gmail.users.labels.create({ userId: "me", requestBody: { name } });
  return created.data.id;
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function searchPending({ gmail_account, label_exclude = "imported", require_pdf = true, max = 20 }) {
  if (STUB) {
    return {
      messages: [
        { message_id: "stub-with-pdf", subject: "PO #1001", has_pdf: true },
        { message_id: "stub-no-pdf", subject: "Hello (no attachment)", has_pdf: false },
      ],
      count: 2,
    };
  }
  const gmail = await gmailFor(gmail_account);
  const q = `-label:${label_exclude}${require_pdf ? " has:attachment filename:pdf" : ""}`;
  const { data } = await gmail.users.messages.list({ userId: "me", q, maxResults: max });
  const ids = (data.messages ?? []).map((m) => m.id);
  const messages = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject"] });
    const subject = (msg.data.payload?.headers ?? []).find((h) => h.name === "Subject")?.value ?? null;
    const has_pdf = hasPdfPart(msg.data.payload);
    messages.push({ message_id: id, subject, has_pdf });
  }
  return { messages, count: messages.length };
}

function hasPdfPart(payload) {
  if (!payload) return false;
  const parts = [payload, ...(payload.parts ?? [])];
  return parts.some(
    (p) => (p.mimeType === "application/pdf") || /\.pdf$/i.test(p.filename ?? "")
  );
}

function findPdfPart(payload) {
  const stack = [payload];
  while (stack.length) {
    const p = stack.pop();
    if (!p) continue;
    if ((p.mimeType === "application/pdf" || /\.pdf$/i.test(p.filename ?? "")) && p.body?.attachmentId) {
      return p;
    }
    for (const child of p.parts ?? []) stack.push(child);
  }
  return null;
}

async function downloadAttachment({ gmail_account, message_id }) {
  if (STUB) {
    return {
      has_pdf: message_id !== "stub-no-pdf",
      filename: "sample-order.pdf",
      signed_url: message_id !== "stub-no-pdf" ? `${PUBLIC_BASE_URL}/fixtures/sample-order.pdf` : null,
    };
  }
  const gmail = await gmailFor(gmail_account);
  const msg = await gmail.users.messages.get({ userId: "me", id: message_id, format: "full" });
  const part = findPdfPart(msg.data.payload);
  if (!part) return { has_pdf: false, filename: null, signed_url: null };
  const att = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: message_id,
    id: part.body.attachmentId,
  });
  const bytes = Buffer.from(att.data.data, "base64url");
  const objectPath = `${gmail_account}/${message_id}.pdf`;
  const signed_url = await uploadAndSign(objectPath, bytes, "application/pdf");
  return { has_pdf: true, filename: part.filename ?? "attachment.pdf", signed_url };
}

async function modifyLabels({ gmail_account, message_id, add = [], remove = [] }) {
  if (STUB) return { success: true };
  const gmail = await gmailFor(gmail_account);
  const addLabelIds = [];
  for (const name of add) addLabelIds.push(await ensureLabel(gmail, name));
  const removeLabelIds = [];
  for (const name of remove) removeLabelIds.push(await ensureLabel(gmail, name));
  await gmail.users.messages.modify({ userId: "me", id: message_id, requestBody: { addLabelIds, removeLabelIds } });
  return { success: true };
}

// ── HTTP routing ──────────────────────────────────────────────────────────────

const TOOLS = {
  search_pending: searchPending,
  download_attachment: downloadAttachment,
  mark_imported: (a) => modifyLabels({ ...a, add: ["imported"] }),
  mark_ignored: (a) => modifyLabels({ ...a, add: ["ignored"] }),
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, stub: STUB });

    // Stub fixture server: serve a generated sample PDF so file_extract can fetch it.
    if (req.method === "GET" && req.url?.startsWith("/fixtures/")) {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      return res.end(SAMPLE_PDF);
    }

    const m = req.method === "POST" && req.url?.match(/^\/tools\/([a-z_]+)$/);
    if (m) {
      const tool = TOOLS[m[1]];
      if (!tool) return json(res, 404, { error: `unknown tool: ${m[1]}` });
      const args = await readJsonBody(req);
      log(`tool ${m[1]}`, { gmail_account: args.gmail_account, message_id: args.message_id });
      const result = await tool(args);
      return json(res, 200, result);
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    log("error", { message: String(err?.message ?? err) });
    return json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, () => log(`listening on ${PORT}`, { stub: STUB, bucket: STORAGE_BUCKET }));
