import { normalizeAzureOpenAiEnv, resolveAzureDeploymentName } from '../src/azure_openai';

/**
 * Directly call llm_agent (bypassing Temporal) to see the raw return value.
 * Run: npx ts-node --skip-project --compiler-options '{"module":"commonjs","esModuleInterop":true,"skipLibCheck":true}' scripts/probe-llm.ts
 */

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<Record<string,unknown>>;

normalizeAzureOpenAiEnv();

async function main() {
  console.log('Loading pi-ai...');
  const piAi = await importEsm('@earendil-works/pi-ai') as typeof import('@earendil-works/pi-ai');
  const { getModel, complete, Type } = piAi;

  const isAzure = !!(process.env.AZURE_OPENAI_BASE_URL || process.env.AZURE_OPENAI_API_KEY);
  const provider = isAzure ? 'azure-openai-responses' : (process.env.PIAGENT_PROVIDER ?? 'openai');
  const modelId  = isAzure
    ? resolveAzureDeploymentName(process.env)
    : (process.env.PIAGENT_MODEL_ID ?? 'gpt-4o-mini');
  console.log(`Using provider: ${provider}, model: ${modelId}`);

  // For Azure, use openai-completions (Chat API) — azure-openai-responses needs the Responses API
  // which many Azure deployments do not support.
  let model: ReturnType<typeof getModel>;
  if (isAzure) {
    const azureBaseUrl = process.env.AZURE_OPENAI_BASE_URL ?? '';
    const azureApiKey  = process.env.AZURE_OPENAI_API_KEY  ?? '';
    const azureVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2025-03-01-preview';
    model = {
      id:            modelId,
      name:          `Azure ${modelId}`,
      api:           'openai-completions' as never,
      provider:      'openai' as never,
      baseUrl:       azureBaseUrl.replace(/\/$/, '') + '/openai/v1',
      reasoning:     false,
      input:         ['text'] as never,
      cost:          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens:     16384,
      headers: {
        'api-key':     azureApiKey,
        'api-version': azureVersion,
      },
    } as ReturnType<typeof getModel>;
    console.log(`Azure baseUrl: ${(model as {baseUrl: string}).baseUrl}`);
  } else {
    model = getModel(provider as never, modelId as never);
  }
  console.log('Model:', model);

  const submitTool = {
    name: 'submit_response',
    description: 'Submit the final structured response. You MUST call this tool.',
    parameters: Type.Unsafe({
      type: 'object',
      required: ['vertical', 'sub_vertical', 'reasoning', 'confidence'],
      properties: {
        vertical:     { type: 'string' },
        sub_vertical: { type: 'string' },
        reasoning:    { type: 'string' },
        confidence:   { type: 'number', minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    }),
  };

  const context = {
    systemPrompt: 'You are a company industry analyst. Always call submit_response to return your answer.',
    messages: [
      { role: 'user' as const, content: 'Classify Stripe Inc (stripe.com) into an industry vertical.', timestamp: 0 },
    ],
    tools: [submitTool],
  };

  console.log('\nCalling complete()...');
  const msg = await complete(model, context, { temperature: 0, maxTokens: 400 });
  console.log('\n--- Raw AssistantMessage ---');
  console.log(JSON.stringify(msg, null, 2));

  // Now simulate what llm_agent does with this
  const toolCalls = msg.content.filter(b => b.type === 'toolCall');
  const submitCall = toolCalls.find(tc => (tc as {name:string}).name === 'submit_response');

  console.log('\n--- Tool calls detected ---');
  console.log(JSON.stringify(toolCalls, null, 2));

  if (submitCall) {
    console.log('\n✓ submit_response called — parsed output:');
    console.log(JSON.stringify((submitCall as {arguments: unknown}).arguments, null, 2));
  } else {
    console.log('\n✗ submit_response NOT called');
    console.log('stop_reason:', msg.stopReason);
    const textBlocks = msg.content.filter(b => b.type === 'text');
    console.log('text output:', textBlocks.map(b => (b as {text:string}).text).join(''));
  }
}

main().catch(console.error);
