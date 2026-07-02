// ============================================================
// AI Chat Route — BYOK (Bring Your Own Key) + Q-CLI Tool Use
// Supports OpenAI and Anthropic APIs with SSE streaming
// Frontend chat AI can call Q-CLI internal tools (stocks,
// workspace analysis, CLI listing) via function calling.
// ============================================================
const express = require('express');

// ── Q-CLI Tool Definitions (OpenAI function calling format) ──
const QCLI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_data',
      description: '获取股票、基金、指数或加密货币的实时行情和历史走势数据（来自 东方财富）',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: '股票代码。示例：AAPL / GOOGL / MSFT / TSLA / AMZN / NVDA / BABA / TSM（美股），00700.HK / 9988.HK（港股），000300（沪深300），BTC / ETH（加密货币），SPY / QQQ（ETF）',
          },
          range: {
            type: 'string',
            enum: ['1D', '1W', '1M', '3M', '1Y'],
            description: '数据时间范围：1D（日内5分钟线）、1W、1M（日线）、3M、1Y',
            default: '1M',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_workspace',
      description: '扫描分析当前工作区（Q-CLI Hub 服务器所在目录）— 返回文件统计、项目类型检测、主要编程语言、目录结构和关键文件',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_clis',
      description: '列出 Q-CLI Hub 中所有已注册的 CLI 工具 — 包含名称、路径、版本、分类（Agent / Env / Tool）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_workflows',
      description: '列出所有预置的工作流 — Code Review、Test Suite、Build Verify 等，包含描述和执行方式',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_agents',
      description: '扫描 PATH 并列出所有已安装的 AI 编程 Agent（opencode、codebuff、aider、claude、codex 等）— 包含版本和安装路径',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exec_terminal',
      description: '在服务器上执行一个终端命令并返回输出。适用于查看文件、运行脚本、检查环境等操作。不适用于交互式命令（如 vim、top）。注意：命令默认在工作区目录执行。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的终端命令',
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），默认 30000，最大 60000',
          },
          cwd: {
            type: 'string',
            description: '工作目录（相对于项目根目录），默认根目录',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区内的一个文件。支持文本文件和常见代码文件。文件最大 1MB。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径（相对于项目根目录）',
          },
          encoding: {
            type: 'string',
            description: '编码，默认 utf8',
            default: 'utf8',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入或创建工作区内的一个文件。如果父目录不存在会自动创建。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径（相对于项目根目录）',
          },
          content: {
            type: 'string',
            description: '文件内容',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出工作区内某个目录的内容（包含文件大小和类型）。默认递归深度 1 级，最大 3 级。隐藏文件和 node_modules 被跳过。',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: '目录路径（相对于项目根目录），默认为根目录',
            default: '.',
          },
          depth: {
            type: 'number',
            description: '递归深度，默认 1，最大 3',
            default: 1,
          },
        },
      },
    },
  },
];

// ── Internal API URL (for tool execution) ──
function getApiBase() {
  return `http://127.0.0.1:${process.env.PORT || 3001}/api`;
}

/**
 * Execute a Q-CLI tool call by proxying to internal HTTP API.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<string>} Tool result as string
 */
async function executeToolCall(name, args) {
  const API = getApiBase();

  switch (name) {
    case 'get_stock_data': {
      const symbol = encodeURIComponent(args.symbol || 'AAPL');
      const range = args.range || '1M';
      const resp = await fetch(`${API}/stocks/${symbol}?range=${range}`);
      if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`;
      const data = await resp.json();
      return JSON.stringify(data, null, 2);
    }

    case 'analyze_workspace': {
      const resp = await fetch(`${API}/project/analyze`);
      if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`;
      const data = await resp.json();
      return JSON.stringify(data, null, 2);
    }

    case 'list_clis': {
      const resp = await fetch(`${API}/clis`);
      if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`;
      const data = await resp.json();
      return JSON.stringify(data, null, 2);
    }

    case 'list_workflows': {
      const resp = await fetch(`${API}/workflows`);
      if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`;
      const data = await resp.json();
      return JSON.stringify(data, null, 2);
    }

    case 'list_agents': {
      const resp = await fetch(`${API}/agents`);
      if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`;
      const data = await resp.json();
      return JSON.stringify(data, null, 2);
    }

    case 'exec_terminal': {
      const resp = await fetch(`${API}/tools/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: args.command,
          timeout: args.timeout || 30000,
          cwd: args.cwd || undefined,
        }),
      });
      if (!resp.ok) return `Error: ${resp.status} ${resp.statusText}`;
      const execResult = await resp.json();
      let output = '';
      if (execResult.stdout) output += `STDOUT:\n${execResult.stdout}\n`;
      if (execResult.stderr) output += `STDERR:\n${execResult.stderr}\n`;
      output += `\nExit code: ${execResult.exitCode} | Duration: ${execResult.duration}ms`;
      if (execResult.truncated) output += '\n[Output truncated]';
      return output;
    }

    case 'read_file': {
      const path = encodeURIComponent(args.path);
      const encoding = args.encoding || 'utf8';
      const resp = await fetch(`${API}/tools/read-file?path=${path}&encoding=${encoding}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        return `Error: ${err.error || resp.statusText}`;
      }
      const fileData = await resp.json();
      return `File: ${fileData.path}\nLanguage: ${fileData.language}\nSize: ${fileData.size} bytes\n\n${fileData.content}`;
    }

    case 'write_file': {
      const resp = await fetch(`${API}/tools/write-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: args.path, content: args.content }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        return `Error: ${err.error || resp.statusText}`;
      }
      const writeResult = await resp.json();
      return `Written ${writeResult.size} bytes to ${writeResult.path}`;
    }

    case 'list_directory': {
      const dir = encodeURIComponent(args.dir || '.');
      const depth = args.depth || 1;
      const resp = await fetch(`${API}/tools/list-dir?dir=${dir}&depth=${depth}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        return `Error: ${err.error || resp.statusText}`;
      }
      const dirData = await resp.json();
      const lines = dirData.entries.map(e => {
        if (e.type === 'directory') return `📁 ${e.path}/`;
        return `📄 ${e.path} (${e.size || 0} bytes)`;
      });
      return `Directory: ${dirData.path}\nTotal: ${dirData.total} entries\n\n${lines.join('\n')}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Create an Express router for AI chat.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/chat — Send a message to the AI
  // Body: { messages, model?, apiKey?, provider?, baseUrl?, disableTools? }
  //   disableTools: if true, skip Q-CLI tool injection (plain chat)
  // Response: SSE stream of tokens
  // ──────────────────────────────────────────────
  router.post('/chat', async (req, res) => {
    const { messages, model, apiKey: clientKey, provider: clientProvider, baseUrl: clientBaseUrl, disableTools } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Determine provider and API key
    const provider = clientProvider ||
      (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

    const apiKey = clientKey ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '';

    if (!apiKey) {
      // If user provided a custom baseUrl, try it without auth
      // (supports self-hosted / proxy endpoints that don't require keys)
      if (clientBaseUrl) {
        const tools = disableTools ? undefined : QCLI_TOOLS;
        try {
          await streamOpenAIWithTools(res, messages, '', model || 'local-model', clientBaseUrl, tools);
          return;
        } catch (_) {
          // Custom base URL failed — continue to fallbacks
        }
      }

      // No API key — try local LM Studio as fallback (OpenAI-compatible on :1234)
      const lmStudioBase = 'http://127.0.0.1:1234';
      try {
        // Test if LM Studio is running (it responds at /v1/models)
        const healthResp = await fetch(`${lmStudioBase}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (healthResp.ok) {
          const tools = disableTools ? undefined : QCLI_TOOLS;
          await streamOpenAIWithTools(res, messages, '', model || 'local-model', lmStudioBase, tools);
          return;
        }
      } catch (_) { /* LM Studio not available */ }
      return res.status(400).json({
        error: 'No API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in environment, '
          + 'or provide one in the request, or start LM Studio (localhost:1234).',
        needsKey: true,
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      if (provider === 'anthropic') {
        // Anthropic: basic streaming (no tool use support yet)
        await streamAnthropic(res, messages, apiKey, model, clientBaseUrl);
      } else {
        // OpenAI: streaming with optional Q-CLI tool use
        const tools = disableTools ? undefined : QCLI_TOOLS;
        await streamOpenAIWithTools(res, messages, apiKey, model, clientBaseUrl, tools);
      }
    } catch (err) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/chat/status — Check if AI is configured
  // ──────────────────────────────────────────────
  router.get('/chat/status', (req, res) => {
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    res.json({
      configured: hasOpenAI || hasAnthropic,
      providers: {
        openai: hasOpenAI,
        anthropic: hasAnthropic,
      },
    });
  });

  // ──────────────────────────────────────────────
  // POST /api/chat/tools — Non-streaming tool execution
  // Used by MCP's ai_chat tool (avoids SSE parsing issues)
  // Body: { messages, model?, apiKey?, provider? }
  // Returns: JSON with final text + any tool calls made
  // ──────────────────────────────────────────────
  router.post('/chat/tools', async (req, res) => {
    const { messages, model, apiKey: clientKey, provider: clientProvider, baseUrl: clientBaseUrl } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const provider = clientProvider ||
      (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

    const apiKey = clientKey ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '';

    if (!apiKey) {
      // If user provided a custom baseUrl, try it without auth
      if (clientBaseUrl) {
        try {
          const result = await nonStreamingChat(messages, '', model || 'local-model', 'openai', clientBaseUrl);
          return res.json({ success: true, ...result });
        } catch (_) { /* custom base URL failed */ }
      }

      // No API key — try local LM Studio as fallback (OpenAI-compatible on :1234)
      const lmStudioBase = 'http://127.0.0.1:1234';
      try {
        const healthResp = await fetch(`${lmStudioBase}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (healthResp.ok) {
          const result = await nonStreamingChat(messages, '', model || 'local-model', 'openai', lmStudioBase);
          return res.json({ success: true, ...result });
        }
      } catch (_) { /* LM Studio not available */ }
      return res.status(400).json({
        error: 'No API key configured.',
        needsKey: true,
      });
    }

    try {
      const result = await nonStreamingChat(messages, apiKey, model, provider, clientBaseUrl);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// ============================================================
// Non-streaming chat with tool support (for MCP ai_chat)
// ============================================================

async function nonStreamingChat(messages, apiKey, model, provider, baseUrl) {
  if (provider === 'anthropic') {
    return nonStreamingAnthropic(messages, apiKey, model, baseUrl);
  }
  return nonStreamingOpenAI(messages, apiKey, model, baseUrl);
}

async function nonStreamingOpenAI(messages, apiKey, model, baseUrl) {
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');

  let currentMessages = [...messages];
  let toolCallCount = 0;
  const maxToolRounds = 5;

  while (toolCallCount < maxToolRounds) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: currentMessages,
        tools: QCLI_TOOLS,
        tool_choice: 'auto',
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      let errMsg;
      try {
        const parsed = JSON.parse(errBody);
        errMsg = parsed.error?.message || `OpenAI API error (${response.status})`;
      } catch {
        errMsg = `OpenAI API error (${response.status}): ${errBody.slice(0, 200)}`;
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from OpenAI');

    const msg = choice.message;

    // Add assistant message to conversation
    currentMessages.push(msg);

    // Check for tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      toolCallCount++;
      for (const toolCall of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch { /* use empty args */ }

        const result = await executeToolCall(toolCall.function.name, args);

        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    } else {
      // No tool calls — return the text response
      return {
        content: msg.content || '',
        toolCalls: toolCallCount,
      };
    }
  }

  return {
    content: 'Maximum tool call rounds reached.',
    toolCalls: toolCallCount,
  };
}

async function nonStreamingAnthropic(messages, apiKey, model, baseUrl) {
  const modelName = model || 'claude-3-haiku-20240307';
  const systemMsg = messages.find(m => m.role === 'system');
  const conversation = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelName,
      messages: conversation,
      system: systemMsg?.content || undefined,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg;
    try {
      const parsed = JSON.parse(errBody);
      errMsg = parsed.error?.message || `Anthropic API error (${response.status})`;
    } catch {
      errMsg = `Anthropic API error (${response.status}): ${errBody.slice(0, 200)}`;
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  return {
    content: data.content?.[0]?.text || '',
    toolCalls: 0,
  };
}

// ============================================================
// OpenAI Streaming with Tool Support
// ============================================================

/**
 * Stream OpenAI completion with optional Q-CLI tool use.
 * When the model calls a tool, the function executes it,
 * sends a status event, then recursively calls itself
 * (without tools) to get the final response.
 */
async function streamOpenAIWithTools(res, messages, apiKey, model, baseUrl, tools) {
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');

  // We may do up to 5 rounds of tool calling
  let currentMessages = [...messages];
  let toolCallCount = 0;
  const maxToolRounds = 5;

  while (toolCallCount <= maxToolRounds) {
    const body = {
      model: modelName,
      messages: currentMessages,
      stream: true,
      max_tokens: 8192,
    };

    // Only pass tools on the first round, or if tools are available
    // (after tool calls, we don't want more tool calls)
    if (tools && toolCallCount === 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      let errMsg;
      try {
        const parsed = JSON.parse(errBody);
        errMsg = parsed.error?.message || `OpenAI API error (${response.status})`;
      } catch {
        errMsg = `OpenAI API error (${response.status}): ${errBody.slice(0, 200)}`;
      }
      throw new Error(errMsg);
    }

    // Parse the streaming response
    const { toolCalls, assistantContent } = await parseStreamAndCollectTools(response, res);

    if (toolCalls.length === 0) {
      // No tool calls — we're done streaming
      return;
    }

    // ── Tool calls detected — execute them ──
    toolCallCount++;

    // Build assistant message
    const assistantMsg = { role: 'assistant', content: assistantContent || null };
    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    currentMessages.push(assistantMsg);

    // Send status event to client
    res.write(`data: ${JSON.stringify({ type: 'status', message: `正在查询 ${toolCalls.map(t => t.name).join(', ')}...` })}\n\n`);

    // Execute each tool
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.arguments); } catch { /* use empty */ }
      const result = await executeToolCall(tc.name, args);

      currentMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }

    // Send "continuing" status
    res.write(`data: ${JSON.stringify({ type: 'status', message: '正在生成回答...' })}\n\n`);

    // Recursive call WITHOUT tools to get final text
    // This passes currentMessages (which now includes assistant + tool messages)
    // and toolCallCount > 0 ensures no more tools are passed
  }

  // If we exceed max rounds
  res.write(`data: ${JSON.stringify({ type: 'token', content: '\n\n[已达到最大工具调用次数，部分结果可能不完整]' })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Parse an OpenAI SSE stream, sending text tokens to the client
 * and collecting tool_calls. Returns when the stream ends or
 * when finish_reason is 'tool_calls'.
 */
async function parseStreamAndCollectTools(response, res) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Accumulated state
  let assistantContent = '';
  const toolCalls = [];        // { id, name, arguments }
  let finishReason = null;
  let streamEnded = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) { streamEnded = true; break; }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') { streamEnded = true; break; }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        finishReason = parsed.choices?.[0]?.finish_reason;

        if (delta) {
          // Accumulate content
          if (delta.content) {
            assistantContent += delta.content;
            // Only stream text if we haven't seen tool_calls yet in this response
            // (OpenAI may send content before tool_calls in some cases)
            res.write(`data: ${JSON.stringify({ type: 'token', content: delta.content })}\n\n`);
          }

          // Accumulate tool_calls
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tcDelta.id || '', name: '', arguments: '' };
              }
              if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
              if (tcDelta.function?.name) toolCalls[idx].name += tcDelta.function.name;
              if (tcDelta.function?.arguments) toolCalls[idx].arguments += tcDelta.function.arguments;
            }
          }
        }

        if (finishReason === 'tool_calls') {
          // We have tool calls to execute — stop streaming this response
          // (content has already been streamed above)
          streamEnded = true;
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }
    if (streamEnded) break;
  }

  // Reached end of stream without tool_calls
  if (finishReason !== 'tool_calls') {
    res.write('data: [DONE]\n\n');
    res.end();
    return { toolCalls: [], assistantContent };
  }

  return { toolCalls: toolCalls.filter(Boolean), assistantContent };
}

// ============================================================
// Original OpenAI streaming (legacy, no tools)
// ============================================================

async function streamOpenAI(res, messages, apiKey, model, baseUrl) {
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: true,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg;
    try {
      const parsed = JSON.parse(errBody);
      errMsg = parsed.error?.message || `OpenAI API error (${response.status})`;
    } catch {
      errMsg = `OpenAI API error (${response.status}): ${errBody.slice(0, 200)}`;
    }
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ============================================================
// Anthropic streaming (no tool use support yet)
// ============================================================

async function streamAnthropic(res, messages, apiKey, model, baseUrl) {
  const modelName = model || 'claude-3-haiku-20240307';

  const systemMsg = messages.find(m => m.role === 'system');
  const conversation = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelName,
      messages: conversation,
      system: systemMsg?.content || undefined,
      max_tokens: 8192,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg;
    try {
      const parsed = JSON.parse(errBody);
      errMsg = parsed.error?.message || `Anthropic API error (${response.status})`;
    } catch {
      errMsg = `Anthropic API error (${response.status}): ${errBody.slice(0, 200)}`;
    }
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          res.write(`data: ${JSON.stringify({ type: 'token', content: parsed.delta.text })}\n\n`);
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ============================================================
// URL Helpers (unchanged from original)
// ============================================================

function normalizeBaseUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    return 'http://localhost:11434' + url;
  }
  const isHostname = (
    /^localhost(?::\d+)?(\/|$)/i.test(url) ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(\/|$)/.test(url) ||
    /^[\w-]+(?:\.\w{2,})+(?::\d+)?(\/|$)/.test(url) ||
    /^[\w.-]+:\d+(\/|$)/.test(url)
  );
  if (isHostname) {
    return 'http://' + url;
  }
  return 'http://localhost:11434/' + url;
}

function buildApiUrl(baseUrl, defaultUrl, endpoint) {
  const normalized = normalizeBaseUrl(baseUrl) || defaultUrl;
  const clean = normalized.replace(/\/+$/, '');
  if (/\/v1(\/|$)/i.test(clean)) {
    return clean + endpoint;
  }
  return clean + '/v1' + endpoint;
}

module.exports = { createRouter };
