// ============================================================
// Q-CLI i18n Module — extracted from app.js
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

// ============================================================
  // Internationalisation (i18n) — 中文 / English
  // ============================================================
  export const _locale = {
    current: 'zh',
    _data: {
      zh: {
        'app.title': 'Q-CLI 集成器 — Universal CLI Bridge',
        'sidebar.toggle.expand': '展开侧边栏',
        'sidebar.toggle.collapse': '折叠侧边栏',
        'sidebar.resize': '拖动调整侧边栏宽度',
        'chat.resize': '拖动调整聊天面板高度',
        'chat.title': 'AI 对话',
        'chat.subtitle': '与 AI 助手交流',
        'chat.clear': '清空对话',
        'chat.close': '关闭聊天面板',
        'chat.sender.ai': 'AI 助手',
        'chat.sender.you': 'You',
        'chat.welcome': '你好！我是 Q-CLI 的 AI 助手。你可以问我关于 CLI 工具的问题，或者让我帮你分析终端输出。😊',
        'chat.input.placeholder': '输入消息… (Enter 发送, Shift+Enter 换行)',
        'chat.send': '发送消息',
        'chat.clearConfirm': '确定清空所有对话记录？',
        'welcome.title': 'Q-CLI 集成器',
        'welcome.subtitle': 'Universal CLI Bridge — 在浏览器中运行任意 CLI',
        'footer.title': 'Q-CLI 集成器 v0.1.0',
        'carousel.prev': '上一个',
        'carousel.next': '下一个',
        'carousel.dot0': '快速开始 + CLI 分类',
        'carousel.dot1': '快捷键 + 使用技巧',
        'carousel.dot2': '安装指南',
        'media.prev': '上一个',
        'media.next': '下一个',
        'media.download': '下载',
        'media.close': '关闭 (Esc)',
        'upload.drop': 'Drop files to upload',
        'palette.shortcutHint': 'Search commands and CLIs…',
        'status.connected': '已连接',
        'status.disconnected': '未连接',
        'status.reconnecting': '重新连接中…',
        'status.error': '连接错误',
        'cli.notRunning': '没有运行的 CLI',
        'cli.starting': '正在启动 %s…',
        'cli.noResults': '没有匹配 "%s" 的 CLI',
        'cli.empty': '没有找到 CLI，点击 + 添加',
        'cli.removed': '已删除 %s',
        'cli.moved': 'CLI 已移动',
        'cli.deleteConfirm': '删除文件夹 "%s"？CLI 不会被删除。',
        'cli.createdFolder': '已创建文件夹 "%s"',
        'cli.folderDeleted': '文件夹已删除',
        'cli.discovered': '发现了 %d 个新 CLI',
        'cli.discovered.one': '发现了 1 个新 CLI',
        'cli.added': '已添加 %s',
        'cli.addError': '添加 CLI 失败',
        'connLost.title': '连接断开 — 点击重新连接',
        'connLost.hint': '将自动重试 10 次（指数退避）',
        'theme.light': '切换到亮色主题',
        'theme.dark': '切换到深色主题',
        'lang.switch': '切换语言',
        'voice.title': '语音输入 — 说出终端命令 (Web Speech)',
        'voice.notSupported': '当前浏览器不支持语音识别，请使用 Chrome 或 Edge。',
        'voice.active': '语音输入已启用 — 说出你的命令',
        'voice.microphoneError': '无法启动麦克风，请检查权限。',
        'voice.listening': '正在聆听…',
        'voice.error': '语音识别错误: %s',
        'upload.uploading': '正在上传 %d 个文件…',
        'upload.uploading.one': '正在上传 1 个文件…',
        'upload.failed': '上传失败: %s',
        'upload.success': '已上传 %d 个文件',
        'upload.success.one': '已上传 1 个文件',
        'upload.clickPreview': '📷 %d 个文件已上传 — 点击预览',
        'upload.clickPreview.one': '📷 1 个文件已上传 — 点击预览',
        'upload.clickHint': '[点击上方路径或通知预览]',
        'upload.terminalPrefix': '[已上传: %s]',
        'upload.fileNotFound': '文件未找到: %s',
        'upload.notPreviewable': '不是可预览的文件: %s',
        'upload.couldNotOpen': '无法打开: %s',
        'exit.code': '[进程已退出，状态码 %d]',
        'exit.signal': '[进程被信号 %s 终止]',
        'palette.actionsLabel': '操作',
        'palette.footerHint': '↑↓ 导航 · ↵ 确认 · Esc 关闭',
        'palette.searchEmpty': '输入进行搜索…',
        'palette.noResults': '没有找到 "%s" 的结果',
        'palette.clisLabel': 'CLIs (%d)',
        'chat.response1': '这是一个很好的问题！让我想想… 🤔\n\n根据我的分析，您可能有以下选择：\n\n1. **使用 grep** — `grep -r "pattern" .` 可以递归搜索文件内容\n2. **使用 find** — `find . -name "*.js"` 可以按文件名查找\n3. **使用 ag (Silver Searcher)** — 比 grep 更快，语法类似',
        'chat.response2': '明白了！我来帮您梳理一下思路：\n\n- ✅ 方案 A：直接使用现有 CLI 工具\n- 🔄 方案 B：编写自定义脚本\n- 🚀 方案 C：结合多个工具形成工作流\n\n您倾向于哪种方案？我可以提供更具体的指导。',
        'chat.response3': '好的，让我查看一下当前终端的上下文环境…\n\n您当前连接到了 **Q-CLI 集成器**，这是一个浏览器的 CLI 管理平台。您可以：\n\n1. 点击左侧 CLI 列表启动任意工具\n2. 使用 **Ctrl+K** 打开命令面板\n3. 拖拽文件到终端区域上传文件\n4. 点击 **🎤** 按钮使用语音输入\n\n有什么具体需要帮助的吗？',
        'chat.response4': '我来帮您分析一下这个命令的效果：\n\n```\n$ your-command --option value\n```\n\n这个命令会：\n1. 加载配置文件\n2. 处理输入数据\n3. 输出结果到终端\n\n建议添加 `--help` 参数查看完整的选项列表。还有别的需要了解的吗？ 😊',
        'ai.needsKey': '请先在 AI 设置中配置 API Key',
        'ai.saved': '✅ AI 配置已保存',
        'modal.addTitle': '添加 CLI',
        'modal.nameLabel': '名称',
        'modal.execLabel': '可执行文件',
        'modal.browseBtn': '浏览…',
        'modal.pathLabel': '完整路径（留空则根据名称自动查找）',
        'modal.argsLabel': '参数（可选，空格分隔）',
        'modal.cancelBtn': '取消',
        'modal.submitBtn': '添加',
        'modal.adding': '添加中…',
        'modal.noFile': '未选择文件',
        'quickstart.title': '🚀 快速开始',
        'quickstart.step1': '选择 CLI',
        'quickstart.step1.desc': '点击左侧 CLIs 列表中的任意工具',
        'quickstart.step2': '开始使用',
        'quickstart.step2.desc': '终端自动启动，直接输入命令操作',
        'quickstart.step3': '随时切换',
        'quickstart.step3.desc': '点击其他 CLI 即可切换，运行状态互不干扰',
        'categories.title': '📊 CLI 分类',
        'categories.agent': '🤖 Agent',
        'categories.agent.desc': 'AI 编程助手 — OpenCode、Codebuff、CODEX 等',
        'categories.env': '📂 Env',
        'categories.env.desc': '开发环境 — Shell、编程语言运行时、WSL 等',
        'categories.tool': '🔧 Tool',
        'categories.tool.desc': '工具类 — Git、编辑器、数据库客户端、网络工具等',
        'shortcuts.title': '⌨️ 快捷键',
        'install.title': '📦 安装指南',
        'install.npm': 'npm 安装',
        'install.usage': '使用',
        'install.projectUrl': '项目地址',
        'install.note.codebuff': '💡 Codebuff 在您的本地机器上名为 %s（免费版），已自动注册。',
        'install.note.codex': '💡 安装后点击侧边栏 %s 刷新即可自动发现。也可通过 %s 手动添加。',
        'tips.title': '💡 使用技巧',
        'tips.1': '使用 **搜索框** 快速过滤 CLI 列表',
        'tips.2': '点击顶部分类标签切换 **Agent / Env / Tool** 视图',
        'tips.3': '创建 **文件夹** 分组管理你的 CLI 工具',
        'tips.4': '**拖拽** CLI 到文件夹中进行归类',
        'tips.5': '拖拽文件到终端区域可快速 **上传文件**',
        'tips.6': '点击 **⟳** 按钮从 PATH 自动发现新 CLI',
      },
      en: {
        'app.title': 'Q-CLI — Universal CLI Bridge',
        'sidebar.toggle.expand': 'Expand sidebar',
        'sidebar.toggle.collapse': 'Collapse sidebar',
        'sidebar.resize': 'Drag to resize sidebar',
        'chat.resize': 'Drag to resize chat panel',
        'chat.title': 'AI Chat',
        'chat.subtitle': 'Chat with AI Assistant',
        'chat.clear': 'Clear chat',
        'chat.close': 'Close chat',
        'chat.sender.ai': 'AI Assistant',
        'chat.sender.you': 'You',
        'chat.welcome': 'Hello! I\'m the Q-CLI AI assistant. Ask me about CLI tools or let me help analyze terminal output. 😊',
        'chat.input.placeholder': 'Type a message… (Enter to send, Shift+Enter new line)',
        'chat.send': 'Send message',
        'chat.clearConfirm': 'Clear all chat history?',
        'welcome.title': 'Q-CLI',
        'welcome.subtitle': 'Universal CLI Bridge — Run any CLI in your browser',
        'footer.title': 'Q-CLI v0.1.0',
        'carousel.prev': 'Previous',
        'carousel.next': 'Next',
        'carousel.dot0': 'Quick Start + CLI Categories',
        'carousel.dot1': 'Keyboard Shortcuts + Tips',
        'carousel.dot2': 'Installation Guide',
        'media.prev': 'Previous',
        'media.next': 'Next',
        'media.download': 'Download',
        'media.close': 'Close (Esc)',
        'upload.drop': 'Drop files to upload',
        'palette.shortcutHint': 'Search commands and CLIs…',
        'status.connected': 'Connected',
        'status.disconnected': 'Disconnected',
        'status.reconnecting': 'Reconnecting…',
        'status.error': 'Connection error',
        'cli.notRunning': 'No CLI running',
        'cli.starting': 'Starting %s…',
        'cli.noResults': 'No CLIs match "%s"',
        'cli.empty': 'No CLIs found. Click + to add.',
        'cli.removed': 'Removed %s',
        'cli.moved': 'CLI moved',
        'cli.deleteConfirm': 'Delete folder "%s"? CLIs will not be removed.',
        'cli.createdFolder': 'Created folder "%s"',
        'cli.folderDeleted': 'Folder deleted',
        'cli.discovered': 'Found %d new CLIs',
        'cli.discovered.one': 'Found 1 new CLI',
        'cli.added': 'Added %s',
        'cli.addError': 'Failed to add CLI',
        'connLost.title': 'Connection lost — click to reconnect',
        'connLost.hint': 'Auto-reconnect will attempt 10 times with exponential backoff',
        'theme.light': 'Switch to light theme',
        'theme.dark': 'Switch to dark theme',
        'lang.switch': 'Switch language',
        'voice.title': 'Voice Input — Speak terminal commands (Web Speech)',
        'voice.notSupported': 'Speech recognition not available in this browser. Try Chrome or Edge.',
        'voice.active': 'Voice input active — speak your command',
        'voice.microphoneError': 'Could not start microphone. Check permissions.',
        'voice.listening': 'Listening…',
        'voice.error': 'Voice error: %s',
        'upload.uploading': 'Uploading %d files…',
        'upload.uploading.one': 'Uploading 1 file…',
        'upload.failed': 'Upload failed: %s',
        'upload.success': 'Uploaded %d files',
        'upload.success.one': 'Uploaded 1 file',
        'upload.clickPreview': '📷 %d files uploaded — click to preview',
        'upload.clickPreview.one': '📷 1 file uploaded — click to preview',
        'upload.clickHint': '[Click paths above or toast to preview]',
        'upload.terminalPrefix': '[Uploaded: %s]',
        'upload.fileNotFound': 'File not found: %s',
        'upload.notPreviewable': 'Not a previewable file: %s',
        'upload.couldNotOpen': 'Could not open: %s',
        'exit.code': '[Process exited with code %d]',
        'exit.signal': '[Process killed by signal %s]',
        'palette.actionsLabel': 'Actions',
        'palette.footerHint': '↑↓ navigate · ↵ select · Esc close',
        'palette.searchEmpty': 'Type to search…',
        'palette.noResults': 'No results for "%s"',
        'palette.clisLabel': 'CLIs (%d)',
        'chat.response1': 'Great question! Let me think… 🤔\n\nBased on my analysis, you have several options:\n\n1. **Use grep** — `grep -r "pattern" .` recursively searches file content\n2. **Use find** — `find . -name "*.js"` finds files by name\n3. **Use ag (Silver Searcher)** — faster than grep, similar syntax',
        'chat.response2': 'Understood! Let me break it down:\n\n- ✅ Option A: Use existing CLI tools directly\n- 🔄 Option B: Write a custom script\n- 🚀 Option C: Combine multiple tools into a workflow\n\nWhich approach do you prefer? I can provide more specific guidance.',
        'chat.response3': 'Let me check the current terminal context…\n\nYou\'re connected to **Q-CLI**, a browser-based CLI management platform. You can:\n\n1. Click any CLI in the left sidebar to launch it\n2. Press **Ctrl+K** to open the command palette\n3. Drag files onto the terminal area to upload\n4. Click the **🎤** button to use voice input\n\nWhat would you like help with?',
        'chat.response4': 'Let me analyze this command for you:\n\n```\n$ your-command --option value\n```\n\nThis command will:\n1. Load configuration file\n2. Process input data\n3. Output results to terminal\n\nTry adding `--help` to see the full list of options. Anything else you\'d like to know? 😊',
        'ai.needsKey': 'Please configure an API Key in AI Settings',
        'ai.saved': '✅ AI configuration saved',
        'modal.addTitle': 'Add CLI',
        'modal.nameLabel': 'Name',
        'modal.execLabel': 'Executable',
        'modal.browseBtn': 'Browse…',
        'modal.pathLabel': 'Full path (or leave blank to auto-resolve from name)',
        'modal.argsLabel': 'Arguments (optional, space-separated)',
        'modal.cancelBtn': 'Cancel',
        'modal.submitBtn': 'Add',
        'modal.adding': 'Adding…',
        'modal.noFile': 'No file selected',
        'quickstart.title': '🚀 Quick Start',
        'quickstart.step1': 'Select CLI',
        'quickstart.step1.desc': 'Click any CLI in the left sidebar',
        'quickstart.step2': 'Start Using',
        'quickstart.step2.desc': 'Terminal starts automatically, type commands to operate',
        'quickstart.step3': 'Switch Anytime',
        'quickstart.step3.desc': 'Click another CLI to switch, sessions run independently',
        'categories.title': '📊 CLI Categories',
        'categories.agent': '🤖 Agent',
        'categories.agent.desc': 'AI Coding Assistants — OpenCode, Codebuff, CODEX',
        'categories.env': '📂 Env',
        'categories.env.desc': 'Development Environment — Shell, Runtimes, WSL',
        'categories.tool': '🔧 Tool',
        'categories.tool.desc': 'Tools — Git, Editors, Database Clients, Network Tools',
        'shortcuts.title': '⌨️ Keyboard Shortcuts',
        'install.title': '📦 Installation Guide',
        'install.npm': 'npm install',
        'install.usage': 'Usage',
        'install.projectUrl': 'Project URL',
        'install.note.codebuff': '💡 Codebuff is called %s on your machine (free version), already registered.',
        'install.note.codex': '💡 After installation, click %s in the sidebar to auto-discover. You can also add it via %s.',
        'tips.title': '💡 Tips & Tricks',
        'tips.1': 'Use the **search bar** to quickly filter CLIs',
        'tips.2': 'Click category chips to switch **Agent / Env / Tool** view',
        'tips.3': 'Create **folders** to organize your CLI tools',
        'tips.4': '**Drag** CLIs into folders to categorize them',
        'tips.5': 'Drag files onto the terminal area to **upload**',
        'tips.6': 'Click **⟳** to auto-discover new CLIs from PATH',
      }
    },
  };

  /** Translate key to current language, with optional printf-style arguments */
  export function __(key) {
    const lang = _locale.current;
    const dict = _locale._data[lang] || _locale._data.zh;
    let str = dict[key];
    if (str === undefined) {
      // Fallback to zh
      str = _locale._data.zh[key];
    }
    if (str === undefined) return key;

    // Handle %d and %s arguments
    const args = Array.prototype.slice.call(arguments, 1);
    if (args.length) {
      args.forEach(function(arg) {
        str = str.replace(/%[sd]/, String(arg));
      });
    }
    return str;
  }

  /** Plural helper: pick singular or plural key based on count */
  export function __n(singularKey, pluralKey, count) {
    const key = count === 1 ? singularKey : pluralKey;
    const args = Array.prototype.slice.call(arguments, 3);
    args.unshift(key);
    return __.apply(null, args);
  }

  export function getCurrentLang() {
    return _locale.current;
  }

  export function setLanguage(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    _locale.current = lang;
    try {
      localStorage.setItem('qcli-lang', lang);
    } catch (e) { /* ignore */ }
    applyLanguage();
    // Update toggle button text
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = lang === 'zh' ? '中' : 'EN';
  }

  /** Apply current language to all elements with data-i18n attributes */
  export function applyLanguage() {
    // Update doc title
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const key = titleEl.getAttribute('data-i18n');
      if (key) titleEl.textContent = __(key);
    }

    // data-i18n: sets textContent
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = __(key);
    });

    // data-i18n-title: sets title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = __(key);
    });

    // data-i18n-placeholder: sets placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = __(key);
    });

    // Update sidebar toggle button title based on collapsed state
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (sidebar && toggleBtn) {
      const isCollapsed = sidebar.classList.contains('collapsed');
      toggleBtn.title = isCollapsed ? __('sidebar.toggle.expand') : __('sidebar.toggle.collapse');
    }

    // Update connection lost text (generated in JS, not static HTML)
    const clBody = document.querySelector('#connection-lost .cl-body p');
    if (clBody) {
      // Only update if it's the default text (not a custom message)
      // The connection lost text is set by setConnectionStatus, skip here
    }

    // Update greeting in chat welcome message
    const welcomeMsg = document.querySelector('.welcome-msg .msg-sender');
    if (welcomeMsg && welcomeMsg.getAttribute('data-i18n') === 'chat.sender.ai') {
      welcomeMsg.textContent = __('chat.sender.ai');
    }
    const welcomeBubble = document.querySelector('.welcome-msg .msg-bubble');
    if (welcomeBubble && welcomeBubble.getAttribute('data-i18n') === 'chat.welcome') {
      welcomeBubble.textContent = __('chat.welcome');
    }

    // Re-render chat messages if any exist (to update sender names)
    const chatMsgs = document.querySelectorAll('#chat-messages .chat-message:not(.welcome-msg)');
    chatMsgs.forEach(function(msgEl) {
      const senderEl = msgEl.querySelector('.msg-sender');
      if (senderEl && !senderEl.getAttribute('data-i18n')) {
        // Update user/assistant labels based on message class
        if (msgEl.classList.contains('user-message')) {
          senderEl.textContent = __('chat.sender.you');
        } else {
          senderEl.textContent = __('chat.sender.ai');
        }
      }
    });

    // Update greeting text in the cached welcome HTML used by clearChatHistory
    // This is handled by re-applying on next render

    // Update theme toggle tooltip
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      themeBtn.title = isDark ? __('theme.dark') : __('theme.light');
    }

    // Update carousel dot titles
    document.querySelectorAll('.carousel-dot').forEach(function(dot) {
      const slideIdx = parseInt(dot.getAttribute('data-slide'), 10);
      const key = 'carousel.dot' + slideIdx;
      const t = __(key);
      if (t !== key) dot.title = t;
    });
  }

  // ============================================================

  // Expose helpers on QCLI namespace
  Q.__ = __;
  Q.__n = __n;
  Q.getCurrentLang = getCurrentLang;
  Q.setLanguage = setLanguage;
  Q.applyLanguage = applyLanguage;
  Q._locale = _locale;
