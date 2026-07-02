// Test buildApiUrl with defaultUrl parameter
function normalizeBaseUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return 'http://localhost:11434' + url;
  const isHostname = (
    /^localhost(?::\d+)?(\/|$)/i.test(url) ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(\/|$)/.test(url) ||
    /^[\w-]+(?:\.\w{2,})+(?::\d+)?(\/|$)/.test(url) ||
    /^[\w.-]+:\d+(\/|$)/.test(url)
  );
  if (isHostname) return 'http://' + url;
  return 'http://localhost:11434/' + url;
}

function buildApiUrl(baseUrl, defaultUrl, endpoint) {
  const normalized = normalizeBaseUrl(baseUrl) || defaultUrl;
  const clean = normalized.replace(/\/+$/, '');
  if (/\/v1(\/|$)/i.test(clean)) return clean + endpoint;
  return clean + '/v1' + endpoint;
}

const OPENAI_DEFAULT = 'https://api.openai.com/v1';
const ANTHROPIC_DEFAULT = 'https://api.anthropic.com/v1';

const tests = [
  // OpenAI tests
  ['OpenAI standard',    'https://api.openai.com/v1',      OPENAI_DEFAULT, '/chat/completions', 'https://api.openai.com/v1/chat/completions'],
  ['apihub with /v1',    'https://apihub.agnes-ai.com/v1', OPENAI_DEFAULT, '/chat/completions', 'https://apihub.agnes-ai.com/v1/chat/completions'],
  ['LM Studio with /v1', 'http://localhost:1234/v1',        OPENAI_DEFAULT, '/chat/completions', 'http://localhost:1234/v1/chat/completions'],
  ['LM Studio bare',     'http://localhost:1234',           OPENAI_DEFAULT, '/chat/completions', 'http://localhost:1234/v1/chat/completions'],
  ['Ollama bare',        'http://localhost:11434',          OPENAI_DEFAULT, '/chat/completions', 'http://localhost:11434/v1/chat/completions'],
  ['no baseUrl (openai)', '',                               OPENAI_DEFAULT, '/chat/completions', 'https://api.openai.com/v1/chat/completions'],
  
  // Anthropic tests
  ['Anthropic standard', 'https://api.anthropic.com/v1',    ANTHROPIC_DEFAULT, '/messages', 'https://api.anthropic.com/v1/messages'],
  ['Anthropic bare',     'http://localhost:1234',           ANTHROPIC_DEFAULT, '/messages', 'http://localhost:1234/v1/messages'],
  ['no baseUrl (anthropic)', '',                            ANTHROPIC_DEFAULT, '/messages', 'https://api.anthropic.com/v1/messages'],
  
  // Edge cases
  ['localhost:1234',     'localhost:1234',                   OPENAI_DEFAULT, '/chat/completions', 'http://localhost:1234/v1/chat/completions'],
  ['127.0.0.1:1234/v1', '127.0.0.1:1234/v1',                OPENAI_DEFAULT, '/chat/completions', 'http://127.0.0.1:1234/v1/chat/completions'],
  ['bare v1 path',       'v1',                               OPENAI_DEFAULT, '/chat/completions', 'http://localhost:11434/v1/chat/completions'],
];

let pass = 0;
for (const [name, baseUrl, defaultUrl, endpoint, expected] of tests) {
  const b = baseUrl || undefined;
  const result = buildApiUrl(b, defaultUrl, endpoint);
  const ok = result === expected;
  if (ok) {
    console.log('PASS: ' + name);
    pass++;
  } else {
    console.log('FAIL: ' + name + ' -> got "' + result + '", expected "' + expected + '"');
  }
}
console.log('\n' + pass + '/' + tests.length + ' passed');
process.exit(pass === tests.length ? 0 : 1);
