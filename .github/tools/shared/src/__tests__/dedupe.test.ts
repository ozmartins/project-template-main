import { describe, it, expect } from "vitest";
import {
  fingerprint,
  fingerprintId,
  fingerprintComment,
  fingerprintSearchToken,
  extractFingerprint,
  normalizeFingerprintPart,
  deployFamilyFingerprintId,
} from "../dedupe.js";

describe("fingerprint", () => {
  it("returns a 12-char hex string", () => {
    const fp = fingerprint(["ci-failure", "pr-validation"]);
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    expect(fingerprint(["a", "b"])).toBe(fingerprint(["a", "b"]));
  });

  it("differs for different inputs", () => {
    expect(fingerprint(["a"])).not.toBe(fingerprint(["b"]));
  });
});

describe("fingerprintComment / extractFingerprint", () => {
  it("round-trips", () => {
    const comment = fingerprintComment("ci-failure-pr-validation");
    expect(extractFingerprint(comment)).toBe("ci-failure-pr-validation");
  });

  it("extracts from a larger string", () => {
    const text = `Some issue body\n\n<!-- fingerprint:alert-123 -->\n\nMore text`;
    expect(extractFingerprint(text)).toBe("alert-123");
  });

  it("returns null when absent", () => {
    expect(extractFingerprint("no fingerprint here")).toBeNull();
  });
});

describe("fingerprintId / fingerprintSearchToken", () => {
  it("builds a stable prefixed fingerprint id", () => {
    const id = fingerprintId("cluster", ["<DEV_NAMESPACE>", "deployment/rental-app", "CrashLoopBackOff"]);
    expect(id).toMatch(/^cluster-[0-9a-f]{12}$/);
    expect(id).toBe(fingerprintId("cluster", ["<DEV_NAMESPACE>", "deployment/rental-app", "CrashLoopBackOff"]));
  });

  it("builds a search token for issue body scans", () => {
    expect(fingerprintSearchToken("cluster-a1b2c3d4e5f6")).toBe("fingerprint:cluster-a1b2c3d4e5f6");
  });
});

describe("normalizeFingerprintPart", () => {
  it("lowercases the input", () => {
    expect(normalizeFingerprintPart("Bootstrap")).toBe("bootstrap");
    expect(normalizeFingerprintPart("DEPLOY")).toBe("deploy");
  });

  it("replaces slashes with hyphens", () => {
    expect(normalizeFingerprintPart("bootstrap/secret")).toBe("bootstrap-secret");
    expect(normalizeFingerprintPart("a/b/c")).toBe("a-b-c");
  });

  it("replaces underscores and spaces with hyphens", () => {
    expect(normalizeFingerprintPart("bootstrap_secret")).toBe("bootstrap-secret");
    expect(normalizeFingerprintPart("bootstrap secret")).toBe("bootstrap-secret");
  });

  it("collapses consecutive non-alphanumeric characters to a single hyphen", () => {
    expect(normalizeFingerprintPart("bootstrap//secret")).toBe("bootstrap-secret");
    expect(normalizeFingerprintPart("a--b")).toBe("a-b");
    expect(normalizeFingerprintPart("a._/b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(normalizeFingerprintPart("/bootstrap/")).toBe("bootstrap");
    expect(normalizeFingerprintPart("-leading")).toBe("leading");
  });

  it("produces the same result for slash and hyphen variants of a deploy step name", () => {
    // This is the core regression case from the duplicate-incident bug:
    // "bootstrap-secret" and "bootstrap/secret" must produce the same slug
    expect(normalizeFingerprintPart("bootstrap-secret")).toBe("bootstrap-secret");
    expect(normalizeFingerprintPart("bootstrap/secret")).toBe("bootstrap-secret");
  });

  it("passes alphanumeric-only strings unchanged", () => {
    expect(normalizeFingerprintPart("abc123")).toBe("abc123");
  });
});

describe("deployFamilyFingerprintId", () => {
  it("returns the canonical id for Deploy - Dev workflow", () => {
    expect(deployFamilyFingerprintId("Deploy - Dev")).toBe("deploy-dev-failure");
    expect(deployFamilyFingerprintId("deploy - dev")).toBe("deploy-dev-failure");
    expect(deployFamilyFingerprintId("Deploy Dev")).toBe("deploy-dev-failure");
  });

  it("returns the canonical id for Test - E2E Dev workflow", () => {
    expect(deployFamilyFingerprintId("Test - E2E Dev")).toBe("e2e-dev-failure");
    expect(deployFamilyFingerprintId("test - e2e dev")).toBe("e2e-dev-failure");
    expect(deployFamilyFingerprintId("Test E2E Dev")).toBe("e2e-dev-failure");
  });

  it("falls back to a normalised slug for unknown workflow names", () => {
    const id = deployFamilyFingerprintId("Deploy - Test");
    expect(id).toBe("deploy-deploy-test-failure");
  });

  it("is stable across calls for the same workflow name", () => {
    expect(deployFamilyFingerprintId("Deploy - Dev")).toBe(deployFamilyFingerprintId("Deploy - Dev"));
  });
});

