import { afterAll, describe, expect, it } from 'vitest';
import { adminClient } from './helpers.js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_ERROR_MESSAGE_LENGTH = 400;

if (typeof supabaseUrl !== 'string' || supabaseUrl.length === 0) {
  throw new Error('SUPABASE_URL is required for workflow_classifications integration tests');
}

if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length === 0) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for workflow_classifications integration tests');
}

const touchedDomains: string[] = [];

async function upsertClassification(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const authorization = ['Bearer', serviceRoleKey].join(' ');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: serviceRoleKey,
    Authorization: authorization,
    Prefer: 'resolution=merge-duplicates,return=representation',
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/workflow_classifications?on_conflict=domain`, {
    method: 'POST',
    headers,
    body: JSON.stringify(values),
  });

  if (!res.ok) {
    throw new Error(
      `Upsert failed with HTTP ${res.status}: ${(await res.text()).slice(0, MAX_ERROR_MESSAGE_LENGTH)}`,
    );
  }

  const rows = (await res.json()) as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  return rows[0];
}

afterAll(async () => {
  for (const domain of touchedDomains) {
    await adminClient.from('workflow_classifications').delete().eq('domain', domain);
  }
});

describe('workflow_classifications PostgREST upsert contract', () => {
  it('upserts by domain and returns the updated representation', async () => {
    const domain = `reset-contract-${Date.now()}.example`;
    touchedDomains.push(domain);

    const first = await upsertClassification({
      domain,
      name: 'Reset Contract Co',
      domain_active: true,
      lifecycle_stage: 'growth',
      vertical: 'fintech',
      sub_vertical: 'payments',
      confidence: 0.51,
      classified_at: new Date().toISOString(),
    });

    expect(first.id).toEqual(expect.any(String));
    expect(first.domain).toBe(domain);

    const firstId = first.id as string;
    const firstUpdatedAt = Date.parse(first.updated_at as string);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await upsertClassification({
      domain,
      name: 'Reset Contract Co Updated',
      domain_active: true,
      lifecycle_stage: 'growth',
      vertical: 'fintech',
      sub_vertical: 'billing',
      confidence: 0.88,
      classified_at: new Date().toISOString(),
    });

    expect(second.id).toBe(firstId);
    expect(second.sub_vertical).toBe('billing');
    expect(second.confidence).toBe(0.88);
    expect(Date.parse(second.updated_at as string)).toBeGreaterThan(firstUpdatedAt);

    const { data, error } = await adminClient
      .from('workflow_classifications')
      .select('id, domain, sub_vertical, confidence')
      .eq('domain', domain);

    if (error) throw new Error(`Failed to fetch persisted row: ${error.message}`);
    expect(data).toEqual([
      expect.objectContaining({
        id: firstId,
        domain,
        sub_vertical: 'billing',
        confidence: 0.88,
      }),
    ]);
  });
});
