#!/usr/bin/env node
import { fingerprintComment, fingerprintId, fingerprintSearchToken, normalizeFingerprintPart } from "./dedupe.js";

const [prefix, ...parts] = process.argv.slice(2);

if (!prefix || parts.length === 0) {
  console.error("Usage: fingerprint-cli.ts <prefix> <part1> [part2 ...]");
  process.exit(1);
}

const normalizedParts = parts.map(normalizeFingerprintPart);
const id = fingerprintId(prefix, normalizedParts);
console.log(`id=${id}`);
console.log(`search=${fingerprintSearchToken(id)}`);
console.log(`comment=${fingerprintComment(id)}`);
