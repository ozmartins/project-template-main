import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger } from '@temporalio/worker';
import type { DSLInput, DSLWorkflow } from '../src/workflows/dsl/interpreter';
import { validateDefinition } from '../src/workflows/dsl/schema';

interface ActivitySpec {
  name: string;
  outputSchema?: Record<string, unknown>;
}

interface ValidationRuntime {
  installRuntime: () => void;
  createTestEnvironment: () => Promise<TestWorkflowEnvironment>;
  createWorker: (
    testEnv: TestWorkflowEnvironment,
    definitions: Record<string, unknown>[],
  ) => Promise<Worker>;
  executeWorkflow: (
    testEnv: TestWorkflowEnvironment,
    definitionPath: string,
    definition: Record<string, unknown>,
    index: number,
  ) => Promise<unknown>;
}

const VALIDATION_NAMESPACE = 'default';
const VALIDATION_TASK_QUEUE = 'dsl-definition-validation';
const VALIDATION_LOG_LEVEL: 'WARN' = 'WARN';

function pickType(schema: Record<string, unknown>): string | undefined {
  const value = schema.type;
  if (Array.isArray(value)) {
    const firstNonNull = value.find((item) => typeof item === 'string' && item !== 'null');
    return typeof firstNonNull === 'string' ? firstNonNull : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function sampleFromSchema(schema: Record<string, unknown>): unknown {
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return sampleFromSchema(schema.anyOf[0] as Record<string, unknown>);
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return sampleFromSchema(schema.oneOf[0] as Record<string, unknown>);
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) return sampleFromSchema(schema.allOf[0] as Record<string, unknown>);

  const type = pickType(schema);
  if (type === 'object') {
    const out: Record<string, unknown> = {};
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === 'string') {
        const propSchema = properties[key] ?? { type: 'string' };
        out[key] = sampleFromSchema(propSchema);
      }
    }
    return out;
  }
  if (type === 'array') {
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    const itemSchema = (schema.items as Record<string, unknown> | undefined) ?? { type: 'string' };
    const count = Math.max(1, minItems);
    return Array.from({ length: count }, () => sampleFromSchema(itemSchema));
  }
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'null') return null;
  return 'sample';
}

function collectActivitySpecs(step: unknown, output: ActivitySpec[]): void {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return;
  if ('activity' in step && step.activity && typeof step.activity === 'object') {
    const activity = step.activity as Record<string, unknown>;
    if (typeof activity.name === 'string') {
      output.push({
        name: activity.name,
        outputSchema:
          activity.output_schema && typeof activity.output_schema === 'object'
            ? (activity.output_schema as Record<string, unknown>)
            : undefined,
      });
    }
    return;
  }
  if ('sequence' in step && step.sequence && typeof step.sequence === 'object') {
    const sequence = step.sequence as Record<string, unknown>;
    if (Array.isArray(sequence.steps)) {
      for (const child of sequence.steps) collectActivitySpecs(child, output);
    }
    return;
  }
  if ('parallel' in step && step.parallel && typeof step.parallel === 'object') {
    const parallel = step.parallel as Record<string, unknown>;
    if (Array.isArray(parallel.branches)) {
      for (const child of parallel.branches) collectActivitySpecs(child, output);
    }
    return;
  }
  if ('condition' in step && step.condition && typeof step.condition === 'object') {
    const condition = step.condition as Record<string, unknown>;
    if (condition.then) collectActivitySpecs(condition.then, output);
    if (condition.else) collectActivitySpecs(condition.else, output);
    return;
  }
  if ('wait_signal' in step && step.wait_signal && typeof step.wait_signal === 'object') {
    const waitSignal = step.wait_signal as Record<string, unknown>;
    if (waitSignal.on_timeout) collectActivitySpecs(waitSignal.on_timeout, output);
    return;
  }
  if ('for_each' in step && step.for_each && typeof step.for_each === 'object') {
    const forEach = step.for_each as Record<string, unknown>;
    if (forEach.body) collectActivitySpecs(forEach.body, output);
    return;
  }
  if ('try_catch' in step && step.try_catch && typeof step.try_catch === 'object') {
    const tryCatch = step.try_catch as Record<string, unknown>;
    if (tryCatch.try) collectActivitySpecs(tryCatch.try, output);
    if (tryCatch.catch && typeof tryCatch.catch === 'object') {
      const catchBlock = tryCatch.catch as Record<string, unknown>;
      if (catchBlock.body) collectActivitySpecs(catchBlock.body, output);
    }
    if (tryCatch.finally) collectActivitySpecs(tryCatch.finally, output);
  }
}

function buildStubs(definitions: Record<string, unknown>[]): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const allSpecs: ActivitySpec[] = [];
  for (const definition of definitions) {
    const rootStep = (definition as { steps?: unknown }).steps;
    collectActivitySpecs(rootStep, allSpecs);
  }

  const activitySpecsByName = new Map<string, ActivitySpec>();
  for (const spec of allSpecs) {
    if (!activitySpecsByName.has(spec.name)) activitySpecsByName.set(spec.name, spec);
  }

  const stubs: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  for (const [name, spec] of activitySpecsByName) {
    stubs[name] = async (_args: Record<string, unknown>) => {
      if (spec.outputSchema) {
        return sampleFromSchema(spec.outputSchema);
      }
      return {};
    };
  }
  return stubs;
}

async function gatherDefinitionFiles(paths: string[]): Promise<string[]> {
  const walk = async (dirPath: string): Promise<string[]> => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = resolve(dirPath, entry.name);
        if (entry.isDirectory()) return walk(fullPath);
        return entry.isFile() && extname(entry.name) === '.json' ? [fullPath] : [];
      }),
    );
    return nested.flat();
  };

  const targets = paths.length === 0 ? [resolve(process.cwd(), 'definitions')] : paths.map((path) => resolve(process.cwd(), path));
  const files: string[] = [];

  for (const targetPath of targets) {
    try {
      files.push(...(await walk(targetPath)));
    } catch {
      if (extname(targetPath) === '.json') files.push(targetPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function buildSyntheticInput(definition: Record<string, unknown>): Record<string, unknown> {
  const baseInput: Record<string, unknown> = {
    company_name: 'Example Company',
    domain: 'example.com',
    run_at: new Date().toISOString(),
    names: ['alpha', 'beta'],
  };

  const inputSchema = definition.input_schema;
  if (inputSchema && typeof inputSchema === 'object') {
    const sampled = sampleFromSchema(inputSchema as Record<string, unknown>);
    if (sampled && typeof sampled === 'object' && !Array.isArray(sampled)) {
      return { ...baseInput, ...(sampled as Record<string, unknown>) };
    }
  }

  return baseInput;
}

const defaultRuntime: ValidationRuntime = {
  installRuntime: () => Runtime.install({ logger: new DefaultLogger(VALIDATION_LOG_LEVEL) }),
  createTestEnvironment: () => TestWorkflowEnvironment.createLocal(),
  createWorker: (testEnv, definitions) =>
    Worker.create({
      connection: testEnv.nativeConnection,
      namespace: VALIDATION_NAMESPACE,
      taskQueue: VALIDATION_TASK_QUEUE,
      workflowsPath: require.resolve('../src/workflows'),
      activities: buildStubs(definitions),
    }),
  executeWorkflow: (testEnv, definitionPath, definition, index) =>
    testEnv.client.workflow.execute<typeof DSLWorkflow>('DSLWorkflow', {
      args: [
        {
          definition,
          input: buildSyntheticInput(definition),
        } as DSLInput,
      ],
      taskQueue: VALIDATION_TASK_QUEUE,
      workflowId: `validate-${basename(definitionPath, '.json')}-${index}-${randomUUID()}`,
    }),
};

export async function validateDefinitions(
  args = process.argv.slice(2),
  runtime: ValidationRuntime = defaultRuntime,
): Promise<number> {
  const targetPaths = await gatherDefinitionFiles(args);
  if (targetPaths.length === 0) {
    console.error('No definition JSON files found to validate.');
    return 1;
  }

  const validDefinitions: Array<{ path: string; definition: Record<string, unknown> }> = [];
  let failed = false;

  for (const definitionPath of targetPaths) {
    try {
      const raw = await readFile(definitionPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      validateDefinition(parsed);
      if (!parsed.input_schema) {
        console.warn(`⚠ ${basename(definitionPath)} is missing top-level input_schema — add one to enable JSON Forms rendering and DB-layer validation`);
      }
      validDefinitions.push({ path: definitionPath, definition: parsed });
    } catch (error) {
      failed = true;
      console.error(`✗ ${basename(definitionPath)} failed parse/schema validation: ${(error as Error).message}`);
    }
  }

  if (validDefinitions.length === 0) {
    return failed ? 1 : 0;
  }

  runtime.installRuntime();
  const testEnv = await runtime.createTestEnvironment();
  const worker = await runtime.createWorker(
    testEnv,
    validDefinitions.map((item) => item.definition),
  );
  const workerRun = worker.run();

  try {
    for (let i = 0; i < validDefinitions.length; i++) {
      const { path: definitionPath, definition } = validDefinitions[i];
      try {
        await runtime.executeWorkflow(testEnv, definitionPath, definition, i);
        console.log(`✓ ${basename(definitionPath)} passed`);
      } catch (error) {
        failed = true;
        console.error(`✗ ${basename(definitionPath)} failed interpreter execution: ${(error as Error).message}`);
      }
    }
  } finally {
    await worker.shutdown();
    await workerRun;
    await testEnv.teardown();
  }

  return failed ? 1 : 0;
}

async function main(): Promise<void> {
  const exitCode = await validateDefinitions();
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Validation run failed: ${(error as Error).message}`);
    process.exit(1);
  });
}
