'use strict';
/**
 * TinyFish Client – thin adapter module
 *
 * All TinyFish API calls go through here. The rest of the app
 * depends only on the functions exported below, not on the raw HTTP details.
 *
 * Official API (as documented at https://docs.tinyfish.ai):
 *   Search : GET  https://api.search.tinyfish.ai?query=...
 *   Fetch  : POST https://api.fetch.tinyfish.ai
 *   Agent  : POST https://agent.tinyfish.ai/v1/automation/run
 *            POST https://agent.tinyfish.ai/v1/automation/run-async
 *            POST https://agent.tinyfish.ai/v1/automation/run-sse
 *
 * Auth: X-API-Key header (from TINYFISH_API_KEY env var — NEVER hardcoded)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const API_KEY = process.env.TINYFISH_API_KEY;
if (!API_KEY) {
  console.warn('[tinyfish_client] WARNING: TINYFISH_API_KEY is not set. Calls will fail.');
}

const ENDPOINTS = {
  search : 'https://api.search.tinyfish.ai',
  fetch  : 'https://api.fetch.tinyfish.ai',
  agent  : 'https://agent.tinyfish.ai/v1/automation/run',
  agentAsync: 'https://agent.tinyfish.ai/v1/automation/run-async',
  agentSse:   'https://agent.tinyfish.ai/v1/automation/run-sse',
};

/**
 * Low-level helper: make an HTTPS/HTTP JSON request.
 * Returns parsed JSON body.
 */
function request(method, rawUrl, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(rawUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'X-API-Key': API_KEY || '',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...extraHeaders,
      },
    };
    const serialized = body ? JSON.stringify(body) : null;
    if (serialized) options.headers['Content-Length'] = Buffer.byteLength(serialized);

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            reject(new Error(`TinyFish ${method} ${rawUrl} → HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        } catch (e) {
          reject(new Error(`TinyFish parse error: ${e.message}. Body: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (serialized) req.write(serialized);
    req.end();
  });
}

/**
 * Search the web.
 * @param {string} query
 * @param {object} opts  – { location, language }
 * @returns {object}     – { results: [{title, url, snippet}] }
 */
async function search(query, opts = {}) {
  const params = new URLSearchParams({ query, ...opts });
  return request('GET', `${ENDPOINTS.search}?${params}`);
}

/**
 * Fetch one or more URLs and return clean content.
 * @param {string[]} urls – up to 10 URLs
 * @returns {object}      – { results: [{url, content, success}] }
 */
async function fetchUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) throw new Error('fetchUrls requires a non-empty array');
  return request('POST', ENDPOINTS.fetch, { urls });
}

/**
 * Run a TinyFish web agent (synchronous).
 * Navigates to `url`, executes `goal`, and returns structured data.
 *
 * @param {string} url
 * @param {string} goal          – plain-language task description
 * @param {object} outputSchema  – JSON Schema for structured output (optional)
 * @param {object} opts          – extra options (browser_profile, proxy_config, etc.)
 * @returns {object}             – { data, run_id, status, logs }
 */
async function agentRun(url, goal, outputSchema = null, opts = {}) {
  const body = { url, goal, ...opts };
  if (outputSchema) body.output_schema = outputSchema;
  return request('POST', ENDPOINTS.agent, body);
}

/**
 * Run a TinyFish web agent (asynchronous – returns run_id, you poll).
 */
async function agentRunAsync(url, goal, outputSchema = null, opts = {}) {
  const body = { url, goal, ...opts };
  if (outputSchema) body.output_schema = outputSchema;
  return request('POST', ENDPOINTS.agentAsync, body);
}

/**
 * Poll the status of an async run.
 * @param {string} runId
 */
async function agentStatus(runId) {
  return request('GET', `https://agent.tinyfish.ai/v1/automation/runs/${runId}`);
}

/**
 * Convenience: extract structured opportunity data from a page.
 * Uses agentRun with a predefined schema that matches our DB model.
 *
 * @param {string} pageUrl  – the opportunity page to scrape
 * @returns {{ opportunities: OpportunityExtraction[] }}
 */
async function extractOpportunities(pageUrl) {
  // If this is a local mock portal (not accessible to TinyFish cloud servers) or no API key is set
  if (pageUrl.includes('mock-portal') || pageUrl.includes('localhost:4000') || !API_KEY) {
    console.log(`[tinyfish_client] Using local direct parser for: ${pageUrl} (local container / offline demo mode)`);
    try {
      const parsedUrl = new URL(pageUrl);
      const host = parsedUrl.hostname;
      const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
      const isMock = host === 'mock-portal' || host === 'localhost';

      // If mock-portal, query its JSON API endpoint directly
      const apiUrl = `${parsedUrl.protocol}//${host}:${port}/api/opportunities`;
      const jsonRes = await request('GET', apiUrl).catch(() => null);

      if (jsonRes && Array.isArray(jsonRes.opportunities)) {
        return {
          opportunities: jsonRes.opportunities.map(o => ({
            title: o.title,
            organizer: o.organizer,
            type: o.type,
            eligibility: o.eligibility,
            deadline: o.deadline,
            reward: o.reward,
            apply_link: o.apply_link,
            status: o.status || 'open',
            confidence: 0.95,
            evidence: {
              eligibility: o.eligibility,
              deadline: o.deadline,
              reward: o.reward,
            },
          })),
        };
      }
    } catch (localErr) {
      console.warn('[tinyfish_client] Local extraction attempt warning:', localErr.message);
    }
  }

  const goal = `
You are extracting student opportunity listings from this page.
Find ALL internships, hackathons, and scholarships listed.
For each one, extract the following fields exactly as they appear on the page.
Include the exact text snippet from the page that supports each field (evidence).
Return ONLY a JSON object matching the schema — no commentary.
  `.trim();

  const outputSchema = {
    type: 'object',
    required: ['opportunities'],
    properties: {
      opportunities: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title'],
          properties: {
            title:       { type: 'string', description: 'Name of the opportunity' },
            organizer:   { type: 'string', description: 'Organization running this' },
            type:        { type: 'string', enum: ['internship', 'hackathon', 'scholarship', 'other'] },
            eligibility: { type: 'string', description: 'Who can apply – exact text' },
            deadline:    { type: 'string', description: 'Application deadline, ISO 8601 or human-readable' },
            reward:      { type: 'string', description: 'Stipend, prize, or grant amount' },
            apply_link:  { type: 'string', description: 'Direct application URL' },
            status:      { type: 'string', enum: ['open', 'closed', 'unknown'] },
            confidence:  { type: 'number', description: 'Extraction confidence 0-1' },
            evidence: {
              type: 'object',
              description: 'Exact source text snippet per field',
              properties: {
                eligibility: { type: 'string' },
                deadline:    { type: 'string' },
                reward:      { type: 'string' },
              },
            },
          },
        },
      },
    },
  };

  try {
    const result = await agentRun(pageUrl, goal, outputSchema);
    return result.data || result;
  } catch (err) {
    console.error('[tinyfish_client] extractOpportunities failed:', err.message);
    throw err;
  }
}

module.exports = {
  search,
  fetchUrls,
  agentRun,
  agentRunAsync,
  agentStatus,
  extractOpportunities,
  ENDPOINTS,
};
