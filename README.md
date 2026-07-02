# Q-CLI Hub \| Universal CLI Bridge

<p align="center">
  <strong>浏览器中的终端中枢 · 运行任何 CLI，连接任何 Agent</strong><br>
  <em>Terminal hub in browser — run any CLI, connect any agent</em>
</p>
<img width="2549" height="1191" alt="d31f5083-4920-4280-ab54-c63e369f7b75" src="https://github.com/user-attachments/assets/ba2ce74d-7f0c-4dd3-9559-b93f826bc5b3" />

## 概述 | Overview

**Q-CLI Hub** 是一个基于 Web 的通用终端桥接平台。它将 `node-pty` + `xterm.js` 与 WebSocket 实时通信相结合，让你在浏览器中获得原生终端体验，并在此基础上集成了 AI 对话、Agent 管理、可视化面板等能力。

**Q-CLI Hub** is a web-based universal terminal bridge. It combines `node-pty` + `xterm.js` with WebSocket real-time communication, delivering a native terminal experience in the browser — enriched with AI chat, agent management, and visual panels.

---

## 主要功能 | Features

### 🖥️ 多会话终端 | Multi-Session Terminal

| 中文 | English |
|------|---------|
| 基于 xterm.js + WebGL 渲染，支持多标签页管理 | xterm.js with WebGL renderer, multi-tab session management |
| 实时终端输出，无延迟感知 | Real-time terminal I/O via WebSocket, latency-free |
| 终端内搜索、链接识别、自适应宽高 | In-terminal search, web links, auto-fit sizing |
| 每个标签独立 PTY 进程，互不干扰 | Isolated PTY process per tab, zero crosstalk |

### 🔍 CLI 自动发现与预设 | CLI Auto-Discovery & Presets

| 中文 | English |
|------|---------|
| 自动扫描系统中的 CLI 工具并生成快捷启动列表 | Auto-scan local system for installed CLIs and generate launch list |
| 内置预设配置：开发者、系统管理员、数据科学家、媒体工程师 | Built-in presets: Developer, Sysadmin, Data Scientist, Media Engineer |
| 支持 CLI 分类管理（Shell / 工具 / AI Agent） | CLI categorization (Shell / Tools / AI Agents) |
| 文件夹组织与自定义分组 | Folder-based organization with custom grouping |

### 🤖 AI 集成 | AI Integration

| 中文 | English |
|------|---------|
| AI 对话面板，支持连续对话与上下文记忆 | AI chat panel with continuous conversation and context memory |
| 自动检测本地 AI Agent：OpenCode、Aider、Claude、Codex、Copilot 等 | Auto-detect local AI agents: OpenCode, Aider, Claude, Codex, Copilot, etc. |
| Agent 工作台：图形化管理 AI CLI 工具会话 | Agent workbench: GUI management of AI CLI agent sessions |
| 可视化工作流引擎：多步骤 Agent 编排 | Visual workflow engine: multi-step agent orchestration |
| AI 工具 API：终端命令执行 + 文件 I/O 供 Agent 调用 | AI Tools API: terminal command execution + file I/O for agent invocation |

### 🔌 MCP 服务器 | MCP Server

| 中文 | English |
|------|---------|
| 基于 Model Context Protocol 的 sidecar 模式服务 | Sidecar-mode server based on Model Context Protocol |
| 将 Q-CLI Hub 的 API 以标准 MCP 接口暴露 | Exposes Q-CLI Hub APIs as standard MCP interfaces |
| 支持 AI 助手直接调用终端命令、管理文件 | Enables AI assistants to execute commands and manage files directly |

### 📊 可视化面板 | Visual Panels

| 中文 | English |
|------|---------|
| 右侧面板：仪表盘 / 股票分析 / 量化交易 / 多媒体 / 图表 | Right panel: Dashboard / Stock Analysis / Quant Trading / Media / Charts |
| 自研 Canvas 图表引擎（ChartCore） | Custom Canvas chart engine (ChartCore) |
| 股票与基金数据分析可视化 | Stock & fund data analysis with visualizations |
| 模拟量化交易策略回测 | Simulated quant trading strategy backtesting |
| 图像/视频预览与画廊 | Image/Video preview gallery |

### 🎙️ 交互体验 | User Experience

| 中文 | English |
------|---------|
| 命令面板（Ctrl+K）快速搜索 CLI | Command palette (Ctrl+K) for quick CLI search |
| 语音输入（Web Speech API） | Voice input via Web Speech API |
| 快捷键系统（可配置） | Customizable keyboard shortcuts |
| 多语言界面（中文 / English） | i18n support (中文 / English) |
| 自定义 CSS 注入 | Custom CSS injection for UI personalization |
| 文件拖拽上传 | Drag-and-drop file upload |
| 浏览器预览面板（iframe） | Browser preview panel (iframe) |

### 💾 数据管理 | Data Management

| 中文 | English |
|------|---------|
| 会话持久化（IndexedDB） | Session persistence via IndexedDB |
| 工作区配置导入导出 | Workspace profile export/import |
| 终端输出固定与代码片段保存 | Pin terminal output & save code snippets |

---

## 快速开始 | Quick Start

### 系统要求 | Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **操作系统**: Windows / macOS / Linux
- 部分 CLI 预设需要对应的 CLI 工具安装在本地

### 安装 | Install

```bash
# 克隆仓库 | Clone
git clone https://github.com/qiuqiukof-oss/universal-cli-web.git
cd universal-cli-web

# 安装依赖 | Install dependencies
npm install

# 构建前端（可选，开发模式可跳过）
# Build frontend (optional, skip for dev mode)
npm run build        # 生产构建 | production build
# OR
npm run build:dev    # 开发构建（含 sourcemap）| dev build with sourcemap
```

### 启动 | Start

```bash
npm start
# → 默认监听 http://127.0.0.1:3001
```

**开发模式**（文件修改自动重启）:

```bash
npm run dev
```

**启动 MCP 服务器**（可选）:

```bash
node mcp-server.js
```

### 环境变量 | Environment Variables

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | HTTP 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `QCLI_API_URL` | `http://localhost:3001/api` | MCP 服务器 API 地址 |
| `QCLI_WS_URL` | `ws://localhost:3001` | MCP 服务器 WebSocket 地址 |

---

## 项目结构 | Project Structure

```
├── server.js              # Express 入口 + 静态文件服务
├── ws-handler.js          # WebSocket + PTY 管理（核心终端逻辑）
├── cli-discovery.js       # CLI 自动发现引擎
├── preset-loader.js       # 预设加载器
├── rate-limiter.js        # API 限流
├── mcp-server.js          # MCP 协议 sidecar 服务
├── routes/                # RESTful API 路由
│   ├── index.js           # 路由聚合
│   ├── chat.js            # AI 对话（Agnes AI 集成）
│   ├── agents.js          # AI Agent 检测与管理
│   ├── workflows.js       # 多步骤工作流引擎
│   ├── tools.js           # AI 工具（命令执行 + 文件 I/O）
│   ├── clis.js            # CLI 列表与管理
│   ├── folders.js         # 文件夹分组
│   ├── presets.js         # CLI 预设
│   ├── settings.js        # 设置配置
│   ├── upload.js          # 文件上传
│   ├── project.js         # 项目管理
│   ├── stocks.js          # 股票数据
│   ├── quant.js           # 量化交易
│   ├── ws-types.js        # WebSocket 类型定义
│   └── agents/            # Agent 辅助逻辑
├── cli-presets/           # CLI 预设配置（JSON）
│   ├── shared.json        # 通用工具
│   ├── developer.json     # 开发者环境
│   ├── sysadmin.json      # 系统管理员
│   ├── data-scientist.json # 数据科学
│   └── media-engineer.json # 媒体工程
├── public/                # 前端静态资源
│   ├── index.html         # 主页面
│   ├── main.js            # ESBuild 入口（ESM 模块）
│   ├── app.js             # 应用初始化与 UI 绑定
│   ├── i18n.js            # 国际化（中文 / English）
│   ├── style.css          # 全局样式
│   └── *.js               # 各 UI 模块（见下方）
```

### 前端模块 | Frontend Modules

| 模块 | 功能 |
|------|------|
| `state.js` | 全局状态与 DOM 工具 |
| `tabs.js` | 多标签终端管理 |
| `sidebar.js` | 侧边栏 CLI 列表与文件夹 |
| `palette.js` | 命令面板 |
| `chat-api.js` + `chat-ui.js` | AI 对话 |
| `agents.js` | Agent 工作台 |
| `workflows.js` | 工作流编排 |
| `settings.js` | 设置面板 |
| `shortcuts.js` | 快捷键 |
| `voice-input.js` | 语音输入 |
| `right-panel.js` | 右侧面板控制器 |
| `chart-core.js` | Canvas 图表引擎 |
| `stock-analysis.js` | 股票分析 |
| `quant-trading.js` | 量化交易 |
| `multi-media.js` | 多媒体预览 |
| `dashboard.js` | 系统仪表盘 |
| `browser-panel.js` | 浏览器预览 |
| `session-store.js` | 会话持久化（IndexedDB） |
| `stores.js` | 历史/固定/代码片段存储 |
| `workspace-store.js` | 工作区配置 |
| `upload.js` | 文件上传 |
| `media-preview.js` | 媒体预览浮层 |
| `terminal-search.js` | 终端搜索 |
| `toast.js` | 通知提示 |
| `custom-css.js` | 自定义 CSS |
| `pin-report.js` | 固定报告 |

---

## 脚本命令 | Scripts

| 命令 | 说明 |
|------|------|
| `npm start` | 启动生产服务 |
| `npm run dev` | 开发模式（`--watch` 热重载） |
| `npm run build` | 构建前端（esbuild 压缩） |
| `npm run build:dev` | 构建前端（含 sourcemap） |
| `npm run watch` | 前端开发监听模式 |
| `npm test` | 运行测试 |

---

## 技术栈 | Tech Stack

| 层 | 技术 |
|----|------|
| **后端** | Node.js + Express |
| **终端** | node-pty + xterm.js + WebGL |
| **通信** | WebSocket (ws) |
| **前端构建** | esbuild |
| **AI 集成** | Agnes AI API、MCP SDK |
| **存储** | IndexedDB (localStorage fallback) |
| **语音** | Web Speech API |
| **图表** | 自研 Canvas 引擎 (ChartCore) |

---

## 许可证 | License

MIT License — see [package.json](./package.json)

---

<p align="center">
  <sub>Built with ❤️ by Q-CLI Hub Contributors</sub>
</p>
