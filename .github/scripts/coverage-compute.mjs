#!/usr/bin/env node
// Compute the test-COVERAGE picture for the factory and emit it as one JSON object.
//
// Two complementary axes, both serving the QA Manager's "good coverage" mandate:
//
//   e2e.screens   — of the app's directly-navigable routes (frontend/src/routes/**),
//                   how many are visited by an e2e spec (any goto('<route>')).
//   e2e.journeys  — of the canonical rental lifecycle steps, how many have a journey
//                   test that exercises them (detected from spec titles + bodies).
//   unit          — line/branch/func/stmt % from vitest's coverage-summary.json, if
//                   one is passed via --unit-coverage (optional; null when absent).
//
// Coverage is a static property of the source + specs (it changes when code/specs
// change), so this runs on push-to-main inside pr-validation and is recorded to the
// ci-history branch as a `coverage` record. It is deliberately dependency-free.
//
// Usage:
//   node coverage-compute.mjs --frontend frontend [--unit-coverage path/to/coverage-summary.json]
// Emits the coverage object (pretty JSON) to stdout.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const FRONTEND = arg('frontend', 'frontend');
const ROUTES_DIR = join(FRONTEND, 'src', 'routes');
const E2E_DIR = join(FRONTEND, 'e2e');

// ---------------------------------------------------------------- route discovery
// Map a TanStack file-based route file to its URL path. We only count routes a user
// can navigate to directly as "screens"; dynamic/detail routes (a `$param` segment)
// are reached through journeys, not as standalone screens, so they're excluded from
// the screens denominator (but still reported for visibility).
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function fileToRoute(file) {
  let rel = file.slice(ROUTES_DIR.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
  rel = rel.replace(/\.tsx$/, '').replace(/\.lazy$/, '');
  if (rel === '__root') return null;
  rel = rel.replace(/(^|\/)index$/, '$1'); // index -> parent path
  const path = '/' + rel.replace(/\/+$/, '');
  return path === '/' ? '/' : path.replace(/\/$/, '');
}

const routeFiles = walk(ROUTES_DIR);
const allRoutes = [...new Set(routeFiles.map(fileToRoute).filter(Boolean))];
const dynamicRoutes = allRoutes.filter((r) => r.includes('$'));
const screens = allRoutes.filter((r) => !r.includes('$') && r !== '/login');

// ---------------------------------------------------------------- spec navigation
function readSpecs() {
  if (!existsSync(E2E_DIR)) return '';
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => readFileSync(join(E2E_DIR, f), 'utf8'))
    .join('\n');
}
const specText = readSpecs();

const gotoTargets = new Set(
  [...specText.matchAll(/goto\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => {
    // strip query/hash and template-literal interpolation tails
    let t = m[1].split('?')[0].split('#')[0].replace(/\$\{[^}]*\}.*$/, '');
    return t.replace(/\/$/, '') || '/';
  }),
);

const coveredScreens = screens.filter((route) =>
  [...gotoTargets].some((t) => t === route || t.startsWith(route + '/')),
);

// ---------------------------------------------------------------- canonical journeys
// The product's reason to exist (docs/specs/equipment-rental-domain-model.md):
// order -> contract -> checkout -> return/check-in -> inspection -> invoice.
// A journey is "covered" if a spec title/body exercises it. Detection is intentionally
// loose (presence of a test that drives the step), not a guarantee of depth.
const JOURNEYS = [
  { key: 'rental_order_create', re: /new rental order|create .*rental order|rental order .*create/i },
  { key: 'order_to_contract', re: /convert .*(reservation|contract)|order .*contract/i },
  { key: 'checkout', re: /checkout/i },
  { key: 'return_checkin', re: /return|check[- ]?in/i },
  { key: 'inspection', re: /inspection/i },
  { key: 'invoice', re: /invoice/i },
  { key: 'payment', re: /payment|portal-financials/i },
];
const journeysCovered = JOURNEYS.filter((j) => j.re.test(specText));

// ---------------------------------------------------------------- unit code coverage
let unit = null;
const unitPath = arg('unit-coverage');
if (unitPath && existsSync(unitPath)) {
  try {
    const summary = JSON.parse(readFileSync(unitPath, 'utf8'));
    const t = summary.total || {};
    const pct = (k) => (t[k] && typeof t[k].pct === 'number' ? t[k].pct / 100 : null);
    unit = { lines: pct('lines'), branches: pct('branches'), funcs: pct('functions'), stmts: pct('statements') };
  } catch {
    unit = null;
  }
}

const pct = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);

const out = {
  e2e: {
    screens_total: screens.length,
    screens_covered: coveredScreens.length,
    screens_pct: pct(coveredScreens.length, screens.length),
    screens_uncovered: screens.filter((r) => !coveredScreens.includes(r)),
    dynamic_routes: dynamicRoutes.length,
    journeys_total: JOURNEYS.length,
    journeys_covered: journeysCovered.length,
    journeys_pct: pct(journeysCovered.length, JOURNEYS.length),
    journeys_missing: JOURNEYS.filter((j) => !journeysCovered.includes(j)).map((j) => j.key),
  },
  unit,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
