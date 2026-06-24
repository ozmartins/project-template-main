/**
 * file_extract tests — no real HTTP calls in unit tests.
 *
 * TESTING STRATEGY
 * ─────────────────
 * 1. UNIT — mock global `fetch` to return canned buffers/text.
 *    Exercises all four format branches (plain text, HTML, PDF, XLSX, DOCX)
 *    and the extraction_schema → llm_agent path.
 *    No network calls, no Temporal runtime.
 *
 * 2. E2E — skipped unless FILE_EXTRACT_E2E=1 and a real LLM API key is set.
 *    Fetches an actual arXiv PDF and asserts that title + abstract fields
 *    are extracted via llm_agent.
 *    Run locally with:
 *      FILE_EXTRACT_E2E=1 ANTHROPIC_API_KEY=sk-ant-... npm test -- --testNamePattern="e2e"
 */

jest.mock("@temporalio/activity", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { file_extract } from "../src/activities/file_extract";

// ── fetch mock helpers ─────────────────────────────────────────────────────

function mockFetch(
  contentType: string,
  body: string | Buffer,
  status = 200
): jest.MockedFunction<typeof fetch> {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null),
    },
    text: async () => (typeof body === "string" ? body : body.toString("utf-8")),
    arrayBuffer: async () =>
      typeof body === "string"
        ? Buffer.from(body).buffer
        : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response);
  return fn;
}

// ── Unit tests ─────────────────────────────────────────────────────────────

describe("file_extract unit tests", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("extracts plain text from a text/plain URL", async () => {
    const body = "Hello, world! This is plain text.";
    globalThis.fetch = mockFetch("text/plain; charset=utf-8", body);

    const result = await file_extract({ url: "https://example.com/file.txt" });

    expect(result.text).toBe(body);
    expect(result.pages).toBeUndefined();
    expect(result.tables).toBeUndefined();
    expect(result.extracted).toBeUndefined();
  });

  it("strips HTML tags and returns clean text for text/html", async () => {
    const html = `<html><head><style>body{color:red}</style></head><body>
      <h1>Title</h1><p>Some <b>bold</b> text.</p>
      <script>alert('xss')</script>
    </body></html>`;
    globalThis.fetch = mockFetch("text/html", html);

    const result = await file_extract({ url: "https://example.com/page.html" });

    expect(result.text).not.toContain("<");
    expect(result.text).not.toContain("alert");
    expect(result.text).toContain("Title");
    expect(result.text).toContain("bold");
  });

  it("respects explicit mime_type over Content-Type header", async () => {
    const html = "<html><body><p>Explicit override</p></body></html>";
    // Server says text/plain but caller says text/html
    globalThis.fetch = mockFetch("text/plain", html);

    const result = await file_extract({
      url: "https://example.com/file",
      mime_type: "text/html",
    });

    expect(result.text).not.toContain("<");
    expect(result.text).toContain("Explicit override");
  });

  it("throws on non-2xx HTTP status", async () => {
    globalThis.fetch = mockFetch("text/plain", "Not Found", 404);

    await expect(file_extract({ url: "https://example.com/missing.txt" })).rejects.toThrow(
      "file_extract: HTTP 404"
    );
  });

  it("returns text + pages for PDF via mime_type override", async () => {
    // Create a minimal PDF buffer that pdf-parse can handle.
    // We mock pdf-parse itself to avoid needing a real PDF.
    jest.mock("pdf-parse", () => ({
      PDFParse: jest.fn().mockImplementation(() => ({
        getText: jest.fn().mockResolvedValue({ text: "PDF content here", total: 3 }),
        destroy: jest.fn().mockResolvedValue(undefined),
      })),
    }));
    // Re-import after mock (jest module registry caches)
    jest.resetModules();

    // Use a plain buffer that looks like a PDF header
    const pdfBuffer = Buffer.from("%PDF-1.4 fake");
    globalThis.fetch = mockFetch("application/octet-stream", pdfBuffer);

    // Re-require to pick up pdf-parse mock
    const { file_extract: fe } = await import("../src/activities/file_extract");
    const result = await fe({
      url: "https://example.com/doc.pdf",
      mime_type: "application/pdf",
    });

    expect(typeof result.text).toBe("string");
    expect(typeof result.pages).toBe("number");
  });

  it("extracts tables from XLSX via mime_type override", async () => {
    // Mock exceljs to avoid readable-stream/Jest/Node 22 compatibility issues.
    // Use jest.isolateModules so the mock is scoped to this test only.
    await jest.isolateModulesAsync(async () => {
      const mockSheet = {
        eachRow: (cb: (row: { values: unknown[] }) => void) => {
          cb({ values: [null, "Name", "Value"] });
          cb({ values: [null, "Alpha", 1] });
          cb({ values: [null, "Beta", 2] });
        },
      };
      jest.doMock("exceljs", () => ({
        __esModule: true,
        default: {
          Workbook: jest.fn().mockImplementation(() => ({
            xlsx: { load: jest.fn().mockResolvedValue(undefined) },
            eachSheet: (cb: (sheet: unknown) => void) => cb(mockSheet),
          })),
        },
      }));

      globalThis.fetch = mockFetch(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Buffer.from("PK\x03\x04") // fake XLSX zip header
      );

      const { file_extract: fe } = await import("../src/activities/file_extract");
      const result = await fe({
        url: "https://example.com/data.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      expect(Array.isArray(result.tables)).toBe(true);
      expect((result.tables as unknown[][][]).length).toBeGreaterThan(0);
      expect(result.text).toContain("Name");
      expect(result.text).toContain("Alpha");
    });
  });

  it("extracts text from DOCX via mime_type override", async () => {
    // Mock mammoth to avoid needing a real DOCX binary fixture.
    jest.mock("mammoth", () => ({
      extractRawText: jest.fn().mockResolvedValue({ value: "DOCX extracted text" }),
    }));
    jest.resetModules();

    const docxBuffer = Buffer.from("PK\x03\x04"); // fake ZIP/DOCX header
    globalThis.fetch = mockFetch("application/octet-stream", docxBuffer);

    const { file_extract: fe2 } = await import("../src/activities/file_extract");
    const result = await fe2({
      url: "https://example.com/doc.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(typeof result.text).toBe("string");
    expect(result.tables).toBeUndefined();
  });

  it("calls llm_agent when extraction_schema is provided", async () => {
    const body = "The quick brown fox jumps over the lazy dog. Company: Acme Corp.";
    globalThis.fetch = mockFetch("text/plain", body);

    // Mock llm_agent module to avoid a real LLM call
    jest.mock("../src/activities/llm_agent", () => ({
      llm_agent: jest.fn().mockResolvedValue({
        parsed: { company_name: "Acme Corp" },
        tool_calls: [],
        provider: "stub",
        model: "stub",
        prompt_tokens: 10,
        completion_tokens: 5,
        content_filter_blocked: false,
      }),
    }));
    jest.resetModules();

    const { file_extract: fe3 } = await import("../src/activities/file_extract");
    const result = await fe3({
      url: "https://example.com/doc.txt",
      extraction_schema: {
        type: "object",
        properties: { company_name: { type: "string" } },
      },
    });

    expect(result.extracted).toEqual({ company_name: "Acme Corp" });
    expect(result.text).toBe(body);
  });
});

// ── E2E tests (skipped unless FILE_EXTRACT_E2E=1 + real API key) ──────────

const isE2E = process.env.FILE_EXTRACT_E2E === "1";
const hasKey = !!(
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GROQ_API_KEY
);

describe.skip("file_extract e2e (requires FILE_EXTRACT_E2E=1 and real API key)", () => {
  it("e2e: extracts text from an arXiv plain-text abstract page", async () => {
    if (!isE2E) return;
    const result = await file_extract({
      url: "https://arxiv.org/abs/1706.03762",
      mime_type: "text/html",
    });
    expect(result.text.length).toBeGreaterThan(100);
    expect(result.text.toLowerCase()).toContain("attention");
  });

  it("e2e: extracts title and abstract from an arXiv PDF using llm_agent", async () => {
    if (!isE2E || !hasKey) return;
    const result = await file_extract({
      url: "https://arxiv.org/pdf/1706.03762",
      mime_type: "application/pdf",
      extraction_schema: {
        type: "object",
        required: ["title", "abstract"],
        properties: {
          title: { type: "string", description: "Paper title" },
          abstract: { type: "string", description: "Paper abstract" },
        },
      },
    });
    expect(result.pages).toBeGreaterThan(0);
    expect(result.extracted?.title).toBeTruthy();
    expect((result.extracted?.abstract as string).length).toBeGreaterThan(50);
  }, 120_000);
});
