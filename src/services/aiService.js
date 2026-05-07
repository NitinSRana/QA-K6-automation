const Groq = require('groq-sdk');
const logger = require('../utils/logger');

// Lazy-initialize so module load doesn't crash if GROQ_API_KEY is absent
let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY environment variable is not set');
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

// llama-3.3-70b-versatile: best balance of speed + code quality on Groq
const MODEL = 'llama-3.3-70b-versatile';

const ANALYZE_SYSTEM = `You are a QA automation expert specializing in API testing and K6 load testing.
Analyze test cases written in natural language or structured formats and extract
actionable API test cases suitable for K6 load testing.

For each test case extract or infer:
1. Test case name and description
2. HTTP method (GET, POST, PUT, DELETE, PATCH)
3. API endpoint URL (use placeholder https://api.example.com if not specified)
4. Request headers (Content-Type, Authorization, etc.)
5. Request body/payload (for POST/PUT)
6. Query parameters
7. Expected response status code
8. Assertions (response body checks, timing thresholds)
9. Load profile suggestion (virtual users, duration, ramp-up)
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
    "load_profile": {"vus": 10, "duration": "30s", "ramp_up": "10s"},
    "inferred_fields": ["url", "body"]
  }
]`;

const GENERATE_SYSTEM = `You are an expert K6 load testing script developer.
Generate production-quality K6 JavaScript scripts.

Rules:
- Use K6's built-in modules only: k6/http, k6, k6/metrics
- Include proper imports at the top
- Define 'export const options' with realistic load profiles using ramping-vus scenario
- Add meaningful checks() for each request using the assertions defined
- Add custom Trend metrics for response times per endpoint
- Include thresholds in options (http_req_duration p95, http_req_failed rate)
- Group related requests with group()
- Support base URL override: const BASE_URL = __ENV.BASE_URL || 'defaulturl'
- Add sleep() between requests (0.5-2s) to simulate real user behaviour
- Export a default function as the main test entry point
- Include handleSummary that prints a readable ASCII table via console.log and returns {}
- Output ONLY raw JavaScript. No markdown fences, no explanation.`;

/**
 * Analyze raw test case text and return structured array of test cases.
 */
async function analyzeTestCases(rawContent) {
  logger.info('Analyzing test cases with Groq AI...');

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.1,
    messages: [
      { role: 'system', content: ANALYZE_SYSTEM },
      { role: 'user', content: `Analyze the following test cases and extract all API/load test cases:\n\n${rawContent}` },
    ],
  });

  const text = response.choices[0].message.content.trim();
  const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonText);
    logger.info(`Extracted ${parsed.length} test cases`);
    return parsed;
  } catch (e) {
    logger.error('Failed to parse AI response as JSON:', e.message);
    throw new Error('AI returned invalid JSON. Raw: ' + text.slice(0, 300));
  }
}

/**
 * Generate a complete K6 script (non-streaming).
 */
async function generateK6Script(testCases, options = {}) {
  const { scriptName = 'generated_test', baseUrl = '', scenarioType = 'ramping-vus' } = options;
  logger.info(`Generating K6 script for ${testCases.length} test case(s)...`);

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    temperature: 0.1,
    messages: [
      { role: 'system', content: GENERATE_SYSTEM },
      {
        role: 'user',
        content: `Generate a complete K6 load test script.\nScript name: ${scriptName}\n${baseUrl ? `Base URL: ${baseUrl}` : ''}\nScenario: ${scenarioType}\n\nTest cases:\n${JSON.stringify(testCases, null, 2)}`,
      },
    ],
  });

  let script = response.choices[0].message.content.trim();
  script = script.replace(/^```(?:javascript|js)?\n?/, '').replace(/\n?```$/, '');
  logger.info('K6 script generated successfully');
  return script;
}

/**
 * Generate a K6 script with streaming — yields text chunks via onChunk callback.
 */
async function generateK6ScriptStream(testCases, options = {}, onChunk) {
  const { scriptName = 'generated_test', baseUrl = '', scenarioType = 'ramping-vus' } = options;
  logger.info(`Streaming K6 script generation for ${testCases.length} test case(s) via Groq...`);

  const stream = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    temperature: 0.1,
    stream: true,
    messages: [
      { role: 'system', content: GENERATE_SYSTEM },
      {
        role: 'user',
        content: `Generate a complete K6 load test script.\nScript name: ${scriptName}\n${baseUrl ? `Base URL: ${baseUrl}` : ''}\nScenario: ${scenarioType}\n\nTest cases:\n${JSON.stringify(testCases, null, 2)}`,
      },
    ],
  });

  let fullScript = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      fullScript += text;
      if (onChunk) onChunk(text);
    }
  }

  fullScript = fullScript.trim()
    .replace(/^```(?:javascript|js)?\n?/, '')
    .replace(/\n?```$/, '');

  logger.info('K6 script streaming complete');
  return fullScript;
}

module.exports = { analyzeTestCases, generateK6Script, generateK6ScriptStream };
