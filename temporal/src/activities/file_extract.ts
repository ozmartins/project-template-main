/**
 * file_extract — fetch a file from a URL and extract text or structured data.
 *
 * Supported formats:
 *   PDF   — pdf-parse (returns text + page count)
 *   HTML  — cheerio strips tags and returns clean text
 *   DOCX  — mammoth extracts raw text
 *   XLSX  — exceljs extracts tables per sheet
 *   text/*  — returned as-is
 *
 * Optional field extraction:
 *   When `extraction_schema` is provided, the extracted text is passed to
 *   `llm_agent` with the schema as `response_schema`, and the structured
 *   result is returned in the `extracted` field.
 */
import { log } from "@temporalio/activity";
import * as cheerio from "cheerio";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import { llm_agent } from "./llm_agent";

// mammoth has no @types package; load via require and cast.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth") as {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

export interface FileExtractArgs {
  /** URL to fetch (http/https). */
  url: string;
  /**
   * MIME type hint. When omitted the activity infers from the Content-Type
   * response header. Accepted values include:
   *   application/pdf
   *   text/html
   *   application/vnd.openxmlformats-officedocument.wordprocessingml.document
   *   application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
   *   text/plain (and any other text/* — treated as plain text)
   */
  mime_type?: string;
  /**
   * JSON Schema for optional field extraction.
   * When present, the extracted text is sent to `llm_agent` and the
   * structured result is returned in `extracted`.
   */
  extraction_schema?: Record<string, unknown>;
  /**
   * Maximum characters of extracted text to send to `llm_agent` for field
   * extraction. Defaults to 12 000 — roughly 3 000 tokens, staying well
   * within the context window of common models.
   */
  max_extraction_chars?: number;
  _idempotency_key?: string;
}

export interface FileExtractResult {
  /** Full extracted text content. */
  text: string;
  /** Number of pages (PDF only). */
  pages?: number;
  /** Row arrays per sheet (XLSX only). Each element is a sheet's rows. */
  tables?: unknown[];
  /** Structured fields extracted by llm_agent when extraction_schema was given. */
  extracted?: Record<string, unknown>;
}

// ── XLSX helper ───────────────────────────────────────────────────────────────

async function extractXlsx(raw: ArrayBuffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  const buf = Buffer.from(new Uint8Array(raw));
  await (workbook.xlsx as unknown as { load(b: unknown): Promise<unknown> }).load(buf);
  const tables: unknown[][] = [];
  workbook.eachSheet((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow((row) => {
      rows.push((row.values as unknown[]).slice(1)); // row.values[0] is always null
    });
    tables.push(rows);
  });
  return tables;
}

// ── Main activity ─────────────────────────────────────────────────────────────

export async function file_extract(args: FileExtractArgs): Promise<FileExtractResult> {
  log.info("file_extract", { url: args.url, mime_type: args.mime_type ?? "auto" });

  // 1. Fetch the file
  const response = await fetch(args.url);
  if (!response.ok) {
    throw new Error(`file_extract: HTTP ${response.status} fetching ${args.url}`);
  }

  // 2. Resolve MIME type (arg takes priority over Content-Type header)
  const rawContentType = response.headers.get("content-type") ?? "text/plain";
  const resolvedMime = (args.mime_type ?? rawContentType).split(";")[0].trim().toLowerCase();

  log.info("file_extract: resolved mime", { mime: resolvedMime });

  // 3. Extract text (and optional tables/pages) based on format
  let text = "";
  let pages: number | undefined;
  let tables: unknown[] | undefined;

  if (resolvedMime === "application/pdf") {
    const buffer = Buffer.from(await response.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    try {
      const data = await parser.getText();
      text = data.text;
      pages = data.total;
    } finally {
      await parser.destroy();
    }
  } else if (resolvedMime === "text/html") {
    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, head").remove();
    text = $("body").text().replace(/\s+/g, " ").trim();
  } else if (
    resolvedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (resolvedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const arrayBuf = await response.arrayBuffer();
    tables = await extractXlsx(arrayBuf);
    text = tables
      .map((sheet) => (sheet as unknown[][]).map((row) => row.join("\t")).join("\n"))
      .join("\n\n");
  } else {
    // Plain text and any other text/* types
    text = await response.text();
  }

  // 4. Optional LLM field extraction
  let extracted: Record<string, unknown> | undefined;
  if (args.extraction_schema) {
    log.info("file_extract: running llm_agent for field extraction");
    const maxChars = args.max_extraction_chars ?? 12_000;
    const llmResult = await llm_agent({
      system_prompt:
        "You are a document data extractor. Extract structured fields from the provided document text according to the given schema. Be precise and factual.",
      user_prompt: `Document text:\n\n${text.slice(0, maxChars)}`,
      response_schema: args.extraction_schema,
      schema_name: "extracted_data",
      temperature: 0,
    });
    extracted = llmResult.parsed;
  }

  return {
    text,
    ...(pages !== undefined && { pages }),
    ...(tables !== undefined && { tables }),
    ...(extracted !== undefined && { extracted }),
  };
}
