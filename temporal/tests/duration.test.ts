import { parseDuration } from "../src/workflows/dsl/duration";

describe("parseDuration", () => {
  it("parses seconds", () => expect(parseDuration("30s")).toBe(30_000));
  it("parses minutes", () => expect(parseDuration("5m")).toBe(300_000));
  it("parses hours", () => expect(parseDuration("2h")).toBe(7_200_000));
  it("parses days", () => expect(parseDuration("1d")).toBe(86_400_000));
  it("parses with space", () => expect(parseDuration("30 seconds")).toBe(30_000));
  it("parses ms string", () => expect(parseDuration("5000")).toBe(5000));
  it("parses decimals", () => expect(parseDuration("1.5m")).toBe(90_000));
  it("throws on invalid", () => expect(() => parseDuration("5x")).toThrow());
  it("throws on empty", () => expect(() => parseDuration("")).toThrow());
});
