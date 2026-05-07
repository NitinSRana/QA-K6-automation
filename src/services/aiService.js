const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

// When running inside Claude Code's environment, ANTHROPIC_BASE_URL is set to
// a local proxy that handles auth. The SDK still requires apiKey to be non-empty,
// so use a placeholder if no real key is configured.
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'proxy-handled',
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
});
const MODEL = 'claude-sonnet-4-6';

/**
 * Analyze raw test case text and extract structured API test cases.
 * Returns JSON array of test case objects.
 */
async function analyzeTestCases(rawContent) {
  logger.info('Analyzing test cases with AI...');

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a QA automation expert specializing in API testing and K6 load testing.
Your job is to analyze test cases written in natural language or structured formats and extract
actionable API test cases suitable for K6 load testing.

For each test case you identify, extract or infer:
1. Test case name and description
2. HTTP method (GET, POST, PUT, DELETE, PATCH)
3. API endpoint URL (infer base URL pattern if not specified, use placeholder like https://api.example.com)
4. Request headers (Content-Type, Authorization, etc.)
5. Request body/payload (for POST/PUT)
6. Query parameters
7. Expected response status code
8. Assertions (response body checks, timing thresholds)
9. Load profile suggestion (virtual users, duration)
10. Whether this is suitable for load testing (boolean)

Respond ONLY with a valid JSON array. No markdown, no explanation. Example format:
[
  {
    "id": "tc_001",
    "name": "Login API Test",
    "description": "Test user authentication endpoint",
    "suitable_for_load_test": true,
    "method": "POST",
    "url": "https://api.example.com/auth/login",
    "headers": {"Content-Type": "application/json"},
    "body": {"username": "testuser", "password": "testpass"},
    "query_params": {},
    "expected_status": 200,
    "assertions": [
      {"type": "status", "value": 200},
      {"type": "response_time_ms", "value": 500},
      {"type": "body_contains", "value": "token"}
    ],
    "load_profile": {
      "vus": 10,
      "duration": "30s",
      "ramp_up": "10s"
    },
    "inferred_fields": ["url", "body"]
  }
]`,
    messages: [
      {
        role: 'user',
        content: `Analyze the following test cases and extract all API/load test cases:\n\n${rawContent}`,
      },
    ],
  });

  const text = message.content[0].text.trim();

  // Strip markdown code fences if present
  const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonText);
    logger.info(`Extracted ${parsed.length} test cases`);
    return parsed;
  } catch (e) {
    logger.error('Failed to parse AI response as JSON', e.message);
    throw new Error('AI returned invalid JSON. Raw: ' + text.slice(0, 200));
  }
}

/**
 * Generate a complete K6 script for the given test cases.
 * Returns the K6 JavaScript source code string.
 */
async function generateK6Script(testCases, options = {}) {
  const {
    scriptName = 'generated_test',
    baseUrl = '',
    scenarioType = 'ramping-vus',
  } = options;

  logger.info(`Generating K6 script for ${testCases.length} test case(s)...`);

  const testCasesJson = JSON.stringify(testCases, null, 2);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: `You are an expert K6 load testing script developer.
Generate production-quality K6 JavaScript scripts.

Rules:
- Use K6's built-in modules: k6/http, k6, k6/metrics
- Include proper imports at the top
- Define 'export const options' with realistic load profiles based on test case load_profile hints
- Use ramping-vus scenario type for gradual load
- Add meaningful checks() for each request using the assertions defined
- Add custom Trend metrics for response times
- Include thresholds in options
- Group related requests with group()
- Handle authentication: if a login test exists, use its response to extract tokens for subsequent tests
- Add __ENV variables for baseUrl override: const BASE_URL = __ENV.BASE_URL || 'defaulturl'
- Add sleep() between requests (0.5-2s) to simulate real user behavior
- Export a default function as the main test function
- Include a summary handler using handleSummary
- Script must be valid JavaScript that K6 can execute
- Output ONLY the raw JavaScript code. No markdown fences, no explanation.`,
    messages: [
      {
        role: 'user',
        content: `Generate a complete K6 load test script for these test cases.
Script name: ${scriptName}
${baseUrl ? `Base URL override: ${baseUrl}` : ''}
Scenario type: ${scenarioType}

Test cases:
${testCasesJson}`,
      },
    ],
  });

  let script = message.content[0].text.trim();

  // Strip markdown fences if model adds them despite instructions
  script = script.replace(/^```(?:javascript|js)?\n?/, '').replace(/\n?```$/, '');

  logger.info('K6 script generated successfully');
  return script;
}

/**
 * Streaming version of generateK6Script — yields chunks via callback.
 */
async function generateK6ScriptStream(testCases, options = {}, onChunk) {
  const {
    scriptName = 'generated_test',
    baseUrl = '',
    scenarioType = 'ramping-vus',
  } = options;

  logger.info(`Streaming K6 script generation for ${testCases.length} test case(s)...`);
  const testCasesJson = JSON.stringify(testCases, null, 2);

  let fullScript = '';

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 8192,
    system: `You are an expert K6 load testing script developer.
Generate production-quality K6 JavaScript scripts.

Rules:
- Use K6's built-in modules: k6/http, k6, k6/metrics
- Include proper imports at the top
- Define 'export const options' with realistic load profiles
- Use ramping-vus scenario for gradual load
- Add meaningful checks() for each request
- Add custom Trend metrics for response times
- Include thresholds in options
- Group related requests with group()
- Add __ENV.BASE_URL support: const BASE_URL = __ENV.BASE_URL || 'defaulturl'
- Add sleep() between requests (0.5-2s)
- Export default function as main test
- Include handleSummary for custom reports
- Output ONLY raw JavaScript. No markdown, no explanation.`,
    messages: [
      {
        role: 'user',
        content: `Generate a complete K6 load test script.
Script name: ${scriptName}
${baseUrl ? `Base URL: ${baseUrl}` : ''}
Scenario: ${scenarioType}

Test cases:
${testCasesJson}`,
      },
    ],
  });

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      const text = chunk.delta.text;
      fullScript += text;
      if (onChunk) onChunk(text);
    }
  }

  // Strip any markdown fences
  fullScript = fullScript.trim()
    .replace(/^```(?:javascript|js)?\n?/, '')
    .replace(/\n?```$/, '');

  return fullScript;
}

module.exports = { analyzeTestCases, generateK6Script, generateK6ScriptStream };
