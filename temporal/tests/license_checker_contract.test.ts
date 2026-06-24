import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageManifest = {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

function readPackageJson(pathFromRepoRoot: string): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(__dirname, "..", "..", pathFromRepoRoot), "utf8")
  ) as PackageManifest;
}

function readLefthookConfig() {
  return readFileSync(resolve(__dirname, "..", "..", "lefthook.yml"), "utf8");
}

const EXPECTED_LICENSES_CHECK_SCRIPT =
  "license-checker --summary --onlyAllow 'MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;0BSD;Unlicense;CC0-1.0;Python-2.0;BlueOak-1.0.0;MIT OR Apache-2.0;MIT-0;MPL-2.0;CC-BY-4.0;CC-BY-3.0;(MIT AND CC-BY-3.0);(MIT OR CC0-1.0);Apache-2.0 AND MIT;MIT*;BSD*;Public Domain;Custom: http://github.com/substack/node-bufferlist;(MIT OR GPL-3.0-or-later);(MIT AND Zlib)' --excludePrivatePackages";

describe("License-checker integration contracts", () => {
  it("keeps license-checker scripts and dependency in both Node workspaces", () => {
    const frontendPackage = readPackageJson("frontend/package.json");
    const temporalPackage = readPackageJson("temporal/package.json");

    for (const packageJson of [frontendPackage, temporalPackage]) {
      expect(packageJson.scripts).toEqual(
        expect.objectContaining({
          licenses: "license-checker --summary",
          "licenses:check": EXPECTED_LICENSES_CHECK_SCRIPT,
        })
      );
      expect(packageJson.devDependencies).toEqual(
        expect.objectContaining({
          "license-checker": expect.any(String),
        })
      );
    }
  });

  it("runs license checks from the pre-push hook", () => {
    const lefthook = readLefthookConfig();

    expect(lefthook).toContain("pre-push:");
    expect(lefthook).toContain("licenses:");
    expect(lefthook).toContain('glob: "frontend/package*.json temporal/package*.json"');
    expect(lefthook).toContain("cd {root}/frontend && npm run licenses:check");
    expect(lefthook).toContain("cd {root}/temporal && npm run licenses:check");
  });
});
