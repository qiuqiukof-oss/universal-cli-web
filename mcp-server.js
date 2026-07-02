// ============================================================
// Q-CLI Hub MCP Server — Sidecar 模式
// 通过 HTTP 代理转发到 Express API
// 启动：node mcp-server.js
// ============================================================

// CommonJS 导入（项目使用 CommonJS，无 "type": "module"）
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

// ── 配置 ──
const API_BASE = process.env.QCLI_API_URL || "http://localhost:3001/api";
const QCLI_WS_URL = process.env.QCLI_WS_URL || "ws://localhost:3001";
const CMD_TIMEOUT = parseInt(process.env.QCLI_CMD_TIMEOUT, 10) || 15000;
const CMD_DRAIN_MS = parseInt(process.env.QCLI_CMD_DRAIN, 10) || 2000;

// ── HTTP 辅助函数 ──
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

// ── WebSocket 执行 CLI 命令 ──
function executeCommandViaWS(cliId, command) {
  return new Promise((resolve, reject) => {
    const WebSocket = require("ws");
    const ws = new WebSocket(QCLI_WS_URL);
    const tabId = `mcp-${Date.now()}`;
    let output = "";
    let launched = false;
    let timedOut = false;
    let drainTimer = null;

    function clearDrain() {
      if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    }

    function finish() {
      clearDrain(); clearTimeout(fatalTimer);
      try { ws.close(); } catch {}
      const result = timedOut
        ? `${output}\n[--output truncated: command timed out after ${CMD_TIMEOUT}ms--]`
        : output;
      resolve(result);
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "launch", cliId, cols: 80, rows: 24, tabId }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "launched" && msg.tabId === tabId) {
        launched = true;
        ws.send(JSON.stringify({ type: "input", data: command + "\n", tabId }));
        // 总超时保护
        setTimeout(() => {
          if (!timedOut) {
            timedOut = true;
            ws.send(JSON.stringify({ type: "kill", tabId }));
          }
        }, CMD_TIMEOUT);
      }
      if (msg.type === "output" && msg.tabId === tabId) {
        output += msg.data;
        // 只要有输出，重置 drain 定时器（静默 N ms 认为命令完成）
        clearDrain();
        if (launched) {
          drainTimer = setTimeout(() => {
            ws.send(JSON.stringify({ type: "kill", tabId }));
          }, CMD_DRAIN_MS);
        }
      }
      if (msg.type === "exit" && msg.tabId === tabId) {
        clearDrain();
        finish();
      }
    });

    ws.on("error", reject);

    // 30 秒致命超时（兜底保护）
    const fatalTimer = setTimeout(() => {
      timedOut = true;
      finish();
    }, 30000);
  });
}

// ── 创建 MCP Server ──
const server = new Server(
  {
    name: "qcli-hub",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ══════════════════════════════════════════════════
// Tool 定义和处理器
// ══════════════════════════════════════════════════

const TOOL_DEFINITIONS = [
  {
    name: "list_clis",
    description: "列出 Q-CLI Hub 中所有已注册的 CLI 工具（名称、路径、版本、分类）",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "execute_cli",
    description: "在指定 CLI 中执行一条命令，返回终端输出。示例：execute_cli({ cliId: 'bash', command: 'ls -la' })",
    inputSchema: {
      type: "object",
      properties: {
        cliId: {
          type: "string",
          description: "CLI 标识符（如 'bash'、'node'、'git'），通过 list_clis 获取",
        },
        command: {
          type: "string",
          description: "要执行的命令",
        },
      },
      required: ["cliId", "command"],
    },
  },
  {
    name: "analyze_workspace",
    description: "扫描 Q-CLI Hub 的工作区，返回完整的文件统计、项目类型检测、主要编程语言、目录结构",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
name: "get_stock_data",
description: "获取股票、基金或加密货币的 OHLCV 历史数据和统计指标。数据来自东方财富实时行情（A股/港股/美股/基金）",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "股票代码。支持：美股 AAPL/GOOGL/MSFT/TSLA/AMZN/NVDA/BABA/TSM，港股 00700.HK/9988.HK，A股 600519/000858/300750/601318/000333，指数 000300，基金 FUND_110011/FUND_001632，加密货币 BTC/ETH，ETF SPY/QQQ/510050",
        },
        range: {
          type: "string",
          enum: ["1D", "1W", "1M", "3M", "1Y"],
          description: "时间范围：1D（日内5分钟线）、1W（周线）、1M（日线）、3M、1Y",
          default: "1M",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "list_agents",
    description: "扫描 PATH 并列出所有已安装的 AI 编程 Agent（opencode、codebuff、aider、claude、codex 等），包含版本信息和安装路径",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_workflows",
    description: "列出 Q-CLI Hub 中所有预置的工作流（Code Review、Test Suite、Build Verify 等）",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_presets",
    description: "列出所有可用的 CLI 预设配置（developer、media-engineer 等），包含预设的分类定义和欢迎页配置",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "switch_preset",
    description: "切换 Q-CLI Hub 的 CLI 预设配置，改变可用 CLI 的分类和欢迎页",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "预设名称（如 'developer'、'media-engineer'），通过 list_presets 获取",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "ai_chat",
    description: "通过 Q-CLI Hub 内置的 AI 聊天代理发送多轮对话消息并获取回复。AI 可自动调用内部工具（查股票、分析工作区、列出 CLI 等）。messages 应包含完整对话历史以保持上下文（需要配置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY）",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant", "system"] },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
          description: "对话消息数组，包含完整历史以保持上下文。示例：[{ role: 'system', content: 'You are a helpful assistant' }, { role: 'user', content: 'Hello' }]",
        },
        model: {
          type: "string",
          description: "模型名称（可选，默认 gpt-4o-mini 或 claude-3-haiku）",
        },
      },
      required: ["messages"],
    },
  },
  {
    name: "export_settings",
    description: "导出 Q-CLI Hub 的完整配置（注册表 + 文件夹分组），用于备份",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── CLI 管理 ──
      case "list_clis": {
        const data = await apiGet("/clis");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "execute_cli": {
        const output = await executeCommandViaWS(args.cliId, args.command);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      // ── 工作区 ──
      case "analyze_workspace": {
        const data = await apiGet("/project/analyze");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // ── 股票 ──
      case "get_stock_data": {
        const data = await apiGet(`/stocks/${args.symbol}?range=${args.range || "1M"}`);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // ── Agent ──
      case "list_agents": {
        const data = await apiGet("/agents");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // ── 工作流 ──
      case "list_workflows": {
        const data = await apiGet("/workflows");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // ── 预设 ──
      case "list_presets": {
        const data = await apiGet("/presets");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "switch_preset": {
        const data = await apiPost("/presets/activate", { name: args.name });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // ── AI 聊天 ──
      case "ai_chat": {
        const data = await apiPost("/chat/tools", {
          messages: args.messages,
          model: args.model || undefined,
        });
        return {
          content: [{ type: "text", text: data.content || JSON.stringify(data, null, 2) }],
        };
      }

      // ── 设置 ──
      case "export_settings": {
        const data = await apiGet("/settings");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ══════════════════════════════════════════════════
// Resource 定义
// ══════════════════════════════════════════════════

const STATIC_RESOURCES = [
  {
    uri: "qcli://clis",
    name: "所有已注册 CLI",
    description: "Q-CLI Hub 中已注册的所有 CLI 工具列表",
    mimeType: "application/json",
  },
  {
    uri: "qcli://stocks",
    name: "可跟踪的股票/基金/加密货币",
    description: "所有可查询的金融资产列表（数据来自东方财富实时行情）",
    mimeType: "application/json",
  },
  {
    uri: "qcli://project/analyze",
    name: "工作区分析报告",
    description: "当前工作区的完整分析：文件统计、项目类型、语言分布、关键文件",
    mimeType: "application/json",
  },
  {
    uri: "qcli://project/path",
    name: "服务器项目路径",
    description: "Q-CLI Hub 服务器的工作目录路径",
    mimeType: "application/json",
  },
  {
    uri: "qcli://uploads",
    name: "已上传文件列表",
    description: "所有已上传的文件（图片、视频、PDF 等）",
    mimeType: "application/json",
  },
  {
    uri: "qcli://workflows",
    name: "预置工作流定义",
    description: "所有内置和自定义的工作流定义",
    mimeType: "application/json",
  },
  {
    uri: "qcli://settings/env",
    name: "安全环境变量",
    description: "非敏感环境变量列表（密钥和令牌已过滤）",
    mimeType: "application/json",
  },
  {
    uri: "qcli://ws-types",
    name: "WebSocket 消息覆盖率",
    description: "后端发送和前端处理的 WebSocket 消息类型交叉引用",
    mimeType: "application/json",
  },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: STATIC_RESOURCES,
}));

// 动态资源模板（如 qcli://stocks/AAPL）
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "qcli://stocks/{symbol}",
      name: "个股行情数据",
      description: "指定股票/基金/加密货币的 OHLCV 数据和统计指标（东方财富实时行情）。symbol 支持 AAPL、BTC、000300 等",
      mimeType: "application/json",
    },
    {
      uriTemplate: "qcli://stocks/{symbol}/price",
      name: "个股当前价格",
      description: "指定股票的当前实时价格和涨跌幅（东方财富）",
      mimeType: "application/json",
    },
    {
      uriTemplate: "qcli://clis/{id}",
      name: "单个 CLI 详情",
      description: "按 ID 查询单个 CLI 的详细信息",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  try {
    // ── 静态资源 ──
    if (uri === "qcli://clis") {
      const data = await apiGet("/clis");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://stocks") {
      const data = await apiGet("/stocks");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://project/analyze") {
      const data = await apiGet("/project/analyze");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://project/path") {
      const data = await apiGet("/project/path");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://uploads") {
      const data = await apiGet("/uploads");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://workflows") {
      const data = await apiGet("/workflows");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://settings/env") {
      const data = await apiGet("/settings/env");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
    if (uri === "qcli://ws-types") {
      const data = await apiGet("/ws-types");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    // ── 动态资源 ──
    const stockMatch = uri.match(/^qcli:\/\/stocks\/([^/]+)$/);
    if (stockMatch) {
      const symbol = stockMatch[1];
      const data = await apiGet(`/stocks/${symbol}?range=1M`);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    const priceMatch = uri.match(/^qcli:\/\/stocks\/([^/]+)\/price$/);
    if (priceMatch) {
      const symbol = priceMatch[1];
      const data = await apiGet(`/stocks/${symbol}/price`);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }

    const cliMatch = uri.match(/^qcli:\/\/clis\/([^/]+)$/);
    if (cliMatch) {
      const all = await apiGet("/clis");
      const cli = all.clis?.find((c) => c.id === cliMatch[1]);
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(cli || { error: "CLI not found" }, null, 2),
        }],
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  } catch (err) {
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ══════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Q-CLI MCP] Server started via stdio");
}

main().catch((err) => {
  console.error("[Q-CLI MCP] Fatal:", err);
  process.exit(1);
});
