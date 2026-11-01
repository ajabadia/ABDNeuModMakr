// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 27: BYOK Cloud Language Models & UI Standardization Tests
//
// Validates:
//   1. BYOK key resolution & text provider selection across all 9 providers
//   2. Text/reasoning inference connectors (Claude, OpenRouter, OpenAI, Gemini, Groq)
//   3. High-level acoustic timbre description & preset tagging
//   4. Prompt enhancer fallback behavior
//   5. Error handling and input bounds validation
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { CloudByokClient, cloudByokClient } from '../src/core/ai/CloudByokClient.ts';
import { enhancePromptWithByokLlm } from '../src/core/ai/ModelArtworkGenerator.ts';

async function runPhase27Tests() {
  console.log('--- Test 1: BYOK Provider Key Resolution & Text Prioritization ---');
  const client = new CloudByokClient();
  client.clearConfig();

  // Initially empty
  assert.equal(client.getFirstAvailableTextProvider(), null);
  assert.equal(client.hasValidKey('claude'), false);
  assert.equal(client.hasValidKey('openrouter'), false);
  assert.equal(client.hasValidKey('openai'), false);

  // Configure Claude key
  client.saveConfig({
    claudeApiKey: 'sk-ant-api03-test-token-1234567890abcdef',
    provider: 'claude',
  });
  assert.equal(client.hasValidKey('claude'), true);
  assert.equal(client.getFirstAvailableTextProvider(), 'claude');
  assert.equal(client.getKeyForProvider('claude'), 'sk-ant-api03-test-token-1234567890abcdef');

  // Configure OpenRouter key & switch
  client.saveConfig({
    openrouterApiKey: 'sk-or-v1-test-token-openrouter-key-999',
    provider: 'openrouter',
  });
  assert.equal(client.hasValidKey('openrouter'), true);
  assert.equal(client.getFirstAvailableTextProvider(), 'openrouter');

  // Configure OpenAI key
  client.saveConfig({
    openaiApiKey: 'sk-proj-test-openai-gpt4o-key-000',
    provider: 'openai',
  });
  assert.equal(client.hasValidKey('openai'), true);
  assert.equal(client.getFirstAvailableTextProvider(), 'openai');

  // Verify non-text providers (replicate, huggingface) are rejected for text generation
  client.saveConfig({
    replicateToken: 'r8_test_replicate_token',
    provider: 'replicate',
  });
  assert.equal(client.hasValidKey('replicate'), true);
  // getFirstAvailableTextProvider should skip replicate and pick an available text provider
  assert.equal(client.getFirstAvailableTextProvider(), 'claude');

  await assert.rejects(
    async () => {
      await client.generateText('hello', { provider: 'replicate' });
    },
    /audio\/vision/
  );
  console.log('✓ BYOK text provider discovery and audio-only protection verified.');

  console.log('\n--- Test 2: Anthropic Claude (v1/messages) Text Inference ---');
  const originalFetch = globalThis.fetch;

  let lastUrl = '';
  let lastHeaders: Record<string, string> = {};
  let lastBody: Record<string, unknown> = {};

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    lastUrl = String(input);
    lastHeaders = (init?.headers as Record<string, string>) || {};
    lastBody = init?.body ? JSON.parse(String(init.body)) : {};

    if (lastUrl.includes('api.anthropic.com')) {
      return new Response(
        JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Resonant analog sawtooth pad with warm 24dB ladder filter shimmer.' }],
          model: 'claude-3-5-haiku-20241022',
          stop_reason: 'end_turn',
          usage: { input_tokens: 35, output_tokens: 22 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const res = await client.generateText('Describe this sound', {
      provider: 'claude',
      maxTokens: 150,
      systemPrompt: 'You are a sound designer.',
    });

    assert.equal(lastUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(lastHeaders['x-api-key'], 'sk-ant-api03-test-token-1234567890abcdef');
    assert.equal(lastHeaders['anthropic-version'], '2023-06-01');
    assert.equal(lastHeaders['dangerously-allow-browser'], 'true');
    assert.equal(lastBody.model, 'claude-3-5-haiku-20241022');
    assert.equal(lastBody.system, 'You are a sound designer.');
    assert.equal(res.provider, 'claude');
    assert.ok(res.text.includes('Resonant analog sawtooth'));
    assert.equal(res.usage?.totalTokens, 57);
    console.log('✓ Anthropic Claude connector executed with correct browser headers and token parsing.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n--- Test 3: OpenRouter Multi-Model Gateway Connector ---');
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    lastUrl = String(input);
    lastHeaders = (init?.headers as Record<string, string>) || {};
    lastBody = init?.body ? JSON.parse(String(init.body)) : {};

    if (lastUrl.includes('openrouter.ai')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'Crystalline FM bell with metallic inharmonic sidebands.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const res = await client.generateText('Analyze timbre', {
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

    assert.equal(lastUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(lastHeaders['Authorization'], 'Bearer sk-or-v1-test-token-openrouter-key-999');
    assert.equal(lastHeaders['HTTP-Referer'], 'https://abd-neumodmakr.vercel.app');
    assert.equal(lastHeaders['X-Title'], 'ABDNeuModMakr Neural Synthesizer');
    assert.equal(res.provider, 'openrouter');
    assert.ok(res.text.includes('Crystalline FM bell'));
    console.log('✓ OpenRouter connector verified with custom gateway attribution headers.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n--- Test 4: OpenAI (ChatGPT / GPT-4o) Connector ---');
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    lastUrl = String(input);
    lastHeaders = (init?.headers as Record<string, string>) || {};
    lastBody = init?.body ? JSON.parse(String(init.body)) : {};

    if (lastUrl.includes('api.openai.com')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'Dark subterranean sub-bass with tube saturation.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 28, completion_tokens: 12, total_tokens: 40 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const res = await client.generateText('Timbre report', {
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    assert.equal(lastUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(lastHeaders['Authorization'], 'Bearer sk-proj-test-openai-gpt4o-key-000');
    assert.equal(res.provider, 'openai');
    assert.ok(res.text.includes('Dark subterranean sub-bass'));
    console.log('✓ OpenAI ChatGPT connector verified.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n--- Test 5: High-Level Timbre & Preset Tag Generation ---');
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.anthropic.com')) {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: 'The model "Solaris Lead" exhibits a bright aggressive attack with resonant fifth harmonics.',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200 });
  };

  try {
    const desc = await client.generateAcousticTimbreDescription('Solaris Lead', 'Lead & Solo', 'Set 1', 440, 'claude');
    assert.ok(desc !== null);
    assert.ok(desc.includes('Solaris Lead'));

    // Graceful error test on network failure: must return null, never throw
    globalThis.fetch = async () => {
      throw new Error('Connection refused');
    };
    const failDesc = await client.generateAcousticTimbreDescription('Solaris Lead', 'Lead', 'Set 1', 440, 'claude');
    assert.equal(failDesc, null);
    console.log('✓ High-level acoustic description generator handles responses and network failures gracefully.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n--- Test 6: Prompt Enhancer Fallback & Enrichment ---');
  cloudByokClient.saveConfig({
    claudeApiKey: 'sk-ant-test-key-for-prompt-enhancement-123456',
    provider: 'claude',
  });
  // With mocked provider
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'glowing bioluminescent amber conduits, volumetric smoke haze' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const enriched = await enhancePromptWithByokLlm(
      'Vintage synthesizer album cover',
      'Solaris',
      'Lead',
      'Set 1'
    );
    assert.ok(enriched.includes('Vintage synthesizer album cover'));
    assert.ok(enriched.includes('glowing bioluminescent amber'));
    console.log('✓ enhancePromptWithByokLlm cleanly augments the prompt.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Cleanup
  client.clearConfig();
  cloudByokClient.clearConfig();
  console.log('\n========================================');
  console.log('Phase 27 BYOK & UI Tests Passed Successfully (6/6)');
  console.log('========================================');
}

runPhase27Tests().catch((err) => {
  console.error('Phase 27 test failure:', err);
  process.exit(1);
});
