import { describe, it, expect } from "vitest";
import {
  deployFamilyFingerprintId,
  fingerprintComment,
  normalizeFingerprintPart,
} from "../dedupe.js";
import {
  titleKeywordsForWorkflow,
  findOldestMatch,
  type Issue,
} from "../upsert-deploy-incident.js";

// ---------------------------------------------------------------------------
// Unit tests for upsert-deploy-incident helpers.
// Pure functions are imported directly from the source so these tests exercise
// the real implementation rather than duplicated copies.
// ---------------------------------------------------------------------------

describe("upsert-deploy-incident helpers", () => {
  describe("titleKeywordsForWorkflow", () => {
    it("returns Deploy Dev keywords for the dev deploy workflow", () => {
      const kw = titleKeywordsForWorkflow("Deploy - Dev");
      expect(kw).toContain("Deploy Dev");
      expect(kw).toContain("Deploy - Dev");
    });

    it("returns E2E keywords for the E2E dev workflow", () => {
      const kw = titleKeywordsForWorkflow("Test - E2E Dev");
      expect(kw).toContain("E2E dev");
      expect(kw).toContain("Test - E2E");
    });

    it("falls back to the raw workflow name for unknown workflows", () => {
      const kw = titleKeywordsForWorkflow("Deploy - Test");
      expect(kw).toContain("Deploy - Test");
    });
  });

  describe("findOldestMatch — fingerprint matching", () => {
    it("returns null when no issues match", () => {
      const fp = fingerprintComment("deploy-dev-failure");
      expect(findOldestMatch([], fp, ["Deploy Dev"])).toBeNull();
    });

    it("finds an existing issue by stable fingerprint in body", () => {
      const fp = fingerprintComment("deploy-dev-failure");
      const issues: Issue[] = [
        { number: 10, title: "Deploy Dev failing", body: `some body\n${fp}\n` },
      ];
      const found = findOldestMatch(issues, fp, ["Deploy Dev"]);
      expect(found?.number).toBe(10);
    });

    it("returns the oldest issue when multiple match by fingerprint", () => {
      const fp = fingerprintComment("deploy-dev-failure");
      const issues: Issue[] = [
        { number: 20, title: "Deploy Dev failing", body: fp },
        { number: 10, title: "Deploy Dev failing", body: fp },
        { number: 30, title: "Deploy Dev failing", body: fp },
      ];
      const found = findOldestMatch(issues, fp, ["Deploy Dev"]);
      expect(found?.number).toBe(10);
    });
  });

  describe("findOldestMatch — title keyword fallback", () => {
    it("finds an issue by title keyword when fingerprint is absent", () => {
      const fp = fingerprintComment("deploy-dev-failure");
      const issues: Issue[] = [
        { number: 5, title: "Deploy Dev failing — bootstrap secret missing", body: "no fp here" },
      ];
      const found = findOldestMatch(issues, fp, ["Deploy Dev"]);
      expect(found?.number).toBe(5);
    });

    it("prefers fingerprint match over title match", () => {
      const fp = fingerprintComment("deploy-dev-failure");
      const issues: Issue[] = [
        { number: 3, title: "Deploy Dev failing — title only", body: "no fp" },
        { number: 7, title: "Deploy Dev failing — has fingerprint", body: fp },
      ];
      // fingerprint match wins even though #3 is older
      const found = findOldestMatch(issues, fp, ["Deploy Dev"]);
      expect(found?.number).toBe(7);
    });

    it("is case-insensitive for title matching", () => {
      const fp = fingerprintComment("e2e-dev-failure");
      const issues: Issue[] = [
        { number: 15, title: "e2e dev smoke failing", body: "no fp" },
      ];
      const found = findOldestMatch(issues, fp, ["E2E dev", "e2e dev"]);
      expect(found?.number).toBe(15);
    });
  });

  describe("fingerprint normalization and family ID stability", () => {
    it("normalizes slash and hyphen variants to the same slug", () => {
      expect(normalizeFingerprintPart("bootstrap/secret")).toBe(
        normalizeFingerprintPart("bootstrap-secret"),
      );
    });

    it("fingerprint IDs are stable for known deploy workflows", () => {
      expect(deployFamilyFingerprintId("Deploy - Dev")).toBe("deploy-dev-failure");
      expect(deployFamilyFingerprintId("Test - E2E Dev")).toBe("e2e-dev-failure");
    });

    it("fingerprintComment embeds the family ID in HTML comment form", () => {
      const comment = fingerprintComment(deployFamilyFingerprintId("Deploy - Dev"));
      expect(comment).toBe("<!-- fingerprint:deploy-dev-failure -->");
    });

    it("no duplicate incidents when two triggers share the same family fingerprint", () => {
      const fp = fingerprintComment("deploy-dev-failure");
      // Simulate an existing issue already created by a previous run
      const issues: Issue[] = [
        { number: 100, title: "Deploy Dev failing for dev-ns (publish outage)", body: fp },
      ];
      // A second trigger should find the existing issue, not create a new one
      const found = findOldestMatch(issues, fp, ["Deploy Dev"]);
      expect(found).not.toBeNull();
      expect(found?.number).toBe(100);
    });
  });
});

