const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

/**
 * Parse a duration string like "30s", "5m", "24h", "2d" into milliseconds.
 * Also accepts ms integer strings like "5000".
 */
export function parseDuration(s: string): number {
  if (!s) throw new Error("Empty duration string");
  const trimmed = s.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!match) {
    const ms = Number(trimmed);
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`Invalid duration: "${s}"`);
    return ms;
  }
  const [, value, unit] = match;
  const multiplier = UNITS[unit];
  if (!multiplier) throw new Error(`Unknown duration unit "${unit}" in "${s}"`);
  return Math.round(Number(value) * multiplier);
}
