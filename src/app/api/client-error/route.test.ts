import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const HOST = "fincore.example";

const report = (over: Record<string, unknown> = {}) => ({
  source: "window",
  message: "Cannot read properties of undefined (reading 'id')",
  stack: "TypeError: Cannot read properties of undefined\n    at onClick (chunk.js:1:2)",
  path: "/dashboard",
  ...over,
});

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`https://${HOST}/api/client-error`, {
    method: "POST",
    headers: { origin: `https://${HOST}`, host: HOST, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/client-error", () => {
  let logged: MockInstance<(...args: unknown[]) => void>;
  // A fresh module for each test: the per-minute cap is the module's own.
  let POST: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
    ({ POST } = await import("./route"));
  });
  afterEach(() => {
    logged.mockRestore();
  });

  const lines = (): Record<string, unknown>[] => logged.mock.calls.map((call) => JSON.parse(String(call[0])));

  it("logs a report from a page of the site as one JSON line, and answers 204", async () => {
    const response = await POST(post(report({ digest: "123456" }), { "user-agent": "Mozilla/5.0 (iPhone)" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      kind: "client-error",
      source: "window",
      message: "Cannot read properties of undefined (reading 'id')",
      path: "/dashboard",
      digest: "123456",
      userAgent: "Mozilla/5.0 (iPhone)",
    });
    // A stack has line breaks: in the log it is still one line.
    expect(String(logged.mock.calls[0]?.[0])).not.toContain("\n");
  });

  it("drops a report from anywhere else, with the same answer", async () => {
    const elsewhere = await POST(post(report(), { origin: "https://evil.example" }));
    const noOrigin = await POST(
      new Request(`https://${HOST}/api/client-error`, {
        method: "POST",
        headers: { host: HOST },
        body: JSON.stringify(report()),
      }),
    );
    const garbage = await POST(post(report(), { origin: "not a url" }));
    expect([elsewhere.status, noOrigin.status, garbage.status]).toEqual([204, 204, 204]);
    expect(lines()).toEqual([]);
  });

  it("drops what is not a report", async () => {
    await POST(post("{not json"));
    await POST(post(report({ source: "server" })));
    await POST(post(report({ message: "" })));
    await POST(post(report({ message: "x".repeat(501) })));
    await POST(post(report({ path: undefined })));
    await POST(post({ ...report(), stack: "y".repeat(4_001) }));
    expect(lines()).toEqual([]);
  });

  it("keeps only what a report is made of", async () => {
    await POST(post({ ...report(), cookie: "session=abc", extra: { deep: true } }));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).not.toHaveProperty("cookie");
    expect(lines()[0]).not.toHaveProperty("extra");
  });

  it("drops a body larger than a report can be", async () => {
    await POST(post(report({ stack: "z".repeat(3_000) }), { "content-length": "9000" }));
    await POST(post(`{"pad":"${"p".repeat(9_000)}"}`));
    expect(lines()).toEqual([]);
  });

  it("stops logging after thirty reports in a minute", async () => {
    for (let i = 0; i < 35; i++) await POST(post(report({ message: `failure ${i}` })));
    expect(lines()).toHaveLength(30);
  });
});
