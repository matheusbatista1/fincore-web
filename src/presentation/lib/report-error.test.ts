// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport, describeError } from "./report-error";

describe("describeError", () => {
  it("reads an Error's message and stack", () => {
    const error = new TypeError("x is undefined");
    expect(describeError(error)).toEqual({ message: "x is undefined", stack: error.stack });
  });

  it("falls back to the name of an Error that says nothing", () => {
    const silent = new RangeError("");
    expect(describeError(silent).message).toBe("RangeError");
  });

  it("makes do with whatever else was thrown", () => {
    expect(describeError("plain text")).toEqual({ message: "plain text" });
    expect(describeError("")).toEqual({ message: "Error" });
    expect(describeError({ code: 42 })).toEqual({ message: '{"code":42}' });
    expect(describeError(null)).toEqual({ message: "null" });
    expect(describeError(undefined)).toEqual({ message: "undefined" });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(describeError(loop)).toEqual({ message: "[object Object]" });
  });
});

describe("buildReport", () => {
  it("cuts a report to what the endpoint accepts", () => {
    const error = new Error("m".repeat(900));
    error.stack = "s".repeat(9_000);
    const report = buildReport("boundary", error, `/${"p".repeat(400)}`, "d".repeat(300));
    expect(report.source).toBe("boundary");
    expect(report.message).toHaveLength(500);
    expect(report.stack).toHaveLength(4_000);
    expect(report.digest).toHaveLength(100);
    expect(report.path).toHaveLength(200);
  });

  it("leaves out what there is none of", () => {
    expect(buildReport("promise", "boom", "/wallets")).toEqual({
      source: "promise",
      message: "boom",
      path: "/wallets",
    });
    expect(buildReport("window", "   ", "/")).toEqual({ source: "window", message: "Error", path: "/" });
  });
});

describe("reportClientError", () => {
  let beacon: ReturnType<typeof vi.fn>;
  // A fresh module for each test: what was already reported is the module's own.
  let reportClientError: typeof import("./report-error").reportClientError;

  const sent = async (): Promise<Record<string, unknown>[]> =>
    Promise.all(beacon.mock.calls.map(async ([, blob]) => JSON.parse(await (blob as Blob).text())));

  beforeEach(async () => {
    vi.resetModules();
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    window.history.replaceState(null, "", "/dashboard?m=2026-11");
    ({ reportClientError } = await import("./report-error"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends what broke and where — the path, never the query", async () => {
    reportClientError("window", new Error("boom"), "abc");
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0]).toBe("/api/client-error");
    expect(await sent()).toEqual([
      expect.objectContaining({ source: "window", message: "boom", digest: "abc", path: "/dashboard" }),
    ]);
  });

  it("reports one failure once, however often it repeats", () => {
    for (let i = 0; i < 10; i++) reportClientError("window", new Error("same again"));
    expect(beacon).toHaveBeenCalledTimes(1);
    // The same message caught somewhere else is another report.
    reportClientError("promise", new Error("same again"));
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it("stops after a handful of different failures", () => {
    for (let i = 0; i < 12; i++) reportClientError("window", new Error(`failure ${i}`));
    expect(beacon).toHaveBeenCalledTimes(5);
  });

  it("says nothing of what is nobody's bug", () => {
    reportClientError("window", "ResizeObserver loop completed with undelivered notifications.");
    reportClientError("window", "Script error.");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("falls back to a request when the beacon is refused, and never throws", async () => {
    beacon.mockReturnValue(false);
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    reportClientError("boundary", new Error("no beacon"));
    expect(fetched).toHaveBeenCalledWith(
      "/api/client-error",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    // A network that fails, or a browser that throws: the caller never knows.
    fetched.mockRejectedValue(new Error("offline"));
    expect(() => reportClientError("boundary", new Error("offline too"))).not.toThrow();
    beacon.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => reportClientError("boundary", new Error("blocked beacon"))).not.toThrow();
  });
});
