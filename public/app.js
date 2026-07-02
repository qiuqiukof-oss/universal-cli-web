// ============================================================
// Universal CLI Bridge — Frontend
// ============================================================
// ESM imports from Q-CLI modules — each provides its own fallback
import { __ as _i18n__, __n, getCurrentLang, setLanguage, applyLanguage, _locale } from './i18n.js';
import { state, dom, scrollbackBuffer, historyViewer, stripAnsi, captureToScrollback, getCategoryIcon, getCategoryLabel, $, setupCategoryFilters } from './state.js';

// Legacy Q namespace reference for cross-module coordination
const Q = window.QCLI = window.QCLI || {};

// ── Local aliases (with safe defaults) ──
const __ = _i18n__ || function(k) { return k; };

// ── Command history input buffer ──
  // Buffers user input characters to capture complete commands on Enter
  let _inputBuffer = '';
  let _inputTabId = null;
  let _inputClk = null;

  // ── Reset input buffer when switching tabs ──
  Q.resetInputBuffer = function() { _inputBuffer = ''; _inputTabId = null; _inputClk = null; };

  // ── Pending init commands (workspace restore) ──
  /** @type {Map<string, string>} cliId → init command pending after launch */
  const _pendingInit = new Map();

  // ── CLI Favorites & Hidden (localStorage) ──
  const FAV_KEY = 'qcli-favorites';
  const HIDE_KEY = 'qcli-hidden';

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
    catch (e) { return []; }
  }
  function setFavorites(ids) {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  }
  function isFavorite(cliId) {
    return getFavorites().includes(cliId);
  }
  function toggleFavorite(cliId) {
    const favs = getFavorites();
    const idx = favs.indexOf(cliId);
    if (idx === -1) favs.push(cliId); else favs.splice(idx, 1);
    setFavorites(favs);
    renderCLIList();
  }

  function getHidden() {
    try { return JSON.parse(localStorage.getItem(HIDE_KEY)) || []; }
    catch (e) { return []; }
  }
  function isHidden(cliId) {
    return getHidden().includes(cliId);
  }
  function toggleHidden(cliId) {
    const hidden = getHidden();
    const idx = hidden.indexOf(cliId);
    if (idx === -1) hidden.push(cliId); else hidden.splice(idx, 1);
    localStorage.setItem(HIDE_KEY, JSON.stringify(hidden));
    renderCLIList();
  }

  // xterm.js
  // ============================================================
  let term, fitAddon, webglAddon;

  // The font chain prioritises fonts with good terminal glyph coverage
  // (Powerline, Nerd Font symbols). xterm.js renders each char individually,
  // so ligatures never form even if the font supports them.
  function getBestFontFamily() {
    return "'Cascadia Code','Cascadia Mono','Consolas','Courier New',monospace";
  }

  // Update the terminal dimension display in the status bar
  function updateTerminalDims() {
    if (!dom.terminalDims) return;
    if (term && state.launched) {
      dom.terminalDims.textContent = `${term.cols}×${term.rows}`;
      dom.terminalDims.classList.remove('hidden');
    } else {
      dom.terminalDims.classList.add('hidden');
    }
  }

  // Font zoom — adjust terminal font size and persist
  const FONT_SIZE_MIN = 8;
  const FONT_SIZE_MAX = 32;
  const FONT_SIZE_STEP = 1;

  function updateFontSizeDisplay() {
    if (!dom.terminalFontSize || !term) return;
    dom.terminalFontSize.textContent = `${term.options.fontSize}px`;
    dom.terminalFontSize.classList.remove('hidden');
  }

  function changeFontSize(delta) {
    if (!term) return;
    const current = term.options.fontSize;
    let newSize = delta === 0 ? 14 : current + delta * FONT_SIZE_STEP;
    newSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, newSize));
    if (newSize === current) return;
    term.options.fontSize = newSize;
    updateFontSizeDisplay();
    try {
      localStorage.setItem('qcli-font-size', String(newSize));
    } catch (e) { /* ignore */ }
    // Trigger re-fit so the terminal recomputes cols/rows
    if (fitAddon) {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
        updateTerminalDims();
        if (state.launched) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
          }
        }
      });
    }
  }

  function initTerminal() {
    fitAddon = new FitAddon.FitAddon();

    // Try to create the WebGL addon (catches constructor + load failures)
    webglAddon = null;
    if (typeof WebglAddon !== 'undefined') {
      try {
        webglAddon = new WebglAddon.WebglAddon();
      } catch (e) {
        console.warn('[xterm] WebGL addon unavailable, using canvas:', e.message);
        webglAddon = null;
      }
    }

    term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: getBestFontFamily(),
      fontSize: 14,
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: '#0d0e10',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        cursorAccent: '#0d0e10',
        selection: 'rgba(99,102,241,0.3)',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#6366f1',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#e4e4e7',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#818cf8',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
      allowTransparency: false,
      scrollback: 5000,
      allowProposedApi: true,
      // Mouse tracking for vim/nano/htop
      mouseEvents: true,
      macOptionIsMeta: true,
      // Rendering quality improvements
      customGlyphs: true,                    // Custom box-drawing & block glyphs (default)
      rescaleOverlappingGlyphs: true,        // Fit ambiguous-width chars into a single cell
      minimumContrastRatio: 4.5,             // WCAG AA minimum contrast
      smoothScrollDuration: 200,             // Smooth scrolling (ms)
    });

    term.loadAddon(fitAddon);
    // Share terminal with Tab Manager
    Q.Tabs.term = term;
    Q.Tabs.fitAddon = fitAddon;


    // WebLinksAddon for standard HTTP(S) URLs
    term.loadAddon(new WebLinksAddon.WebLinksAddon());

    // SearchAddon — terminal search (Ctrl+Shift+F)
    /** @type {SearchAddon|null} */
    window.QCLI.searchAddon = null;
    if (typeof SearchAddon !== 'undefined') {
      try {
        window.QCLI.searchAddon = new SearchAddon.SearchAddon();
        term.loadAddon(window.QCLI.searchAddon);
      } catch (e) {
        console.warn('[xterm] SearchAddon unavailable:', e.message);
      }
    }

    // Custom ILinkProvider: clickable media file paths in terminal output
    class MediaFileLinkProvider {
      constructor(terminal, handler) {
        this._terminal = terminal;
        this._handler = handler;
        // Match paths ending with common media extensions (requires at least one / or \\)
        this._regex = /[\w\-.\/\\]*[/\\][\w\-.\/\\]+[\.](jpe?g|png|gif|webp|svg|avif|bmp|mp4|webm|ogg|mov)\b/gi;
      }

      provideLinks(y, callback) {
        // y is 1-based absolute buffer line number
        const lineIndex = y - 1;
        const line = this._terminal.buffer.active.getLine(lineIndex);
        if (!line) {
          callback(undefined);
          return;
        }

        const text = line.translateToString();
        const links = [];
        // Create a fresh regex instance to reset lastIndex
        const rex = new RegExp(this._regex.source, this._regex.flags);
        let match;

        while ((match = rex.exec(text)) !== null) {
          const uri = match[0];
          const startX = match.index;
          const endX = match.index + uri.length;

          links.push({
            range: {
              start: { x: startX + 1, y: y },
              end: { x: endX, y: y }
            },
            text: uri,
            activate: this._handler
          });
        }

        callback(links.length > 0 ? links : undefined);
      }
    }

    // Register the custom media file link provider
    try {
      term.registerLinkProvider(new MediaFileLinkProvider(term, (event, uri) => {
        event.preventDefault();
        const filename = uri.split('/').pop().split('\\').pop();
        handleMediaClick(filename);
      }));
    } catch (e) {
      console.warn('[MediaLink] Failed to register link provider:', e.message);
    }

    // Load WebGL addon for GPU-accelerated rendering
    if (webglAddon) {
      try {
        term.loadAddon(webglAddon);
      } catch (e) {
        console.warn('[xterm] WebGL addon load failed, using canvas:', e.message);
        webglAddon = null;
      }
    }

    term.open(dom.terminal);

    requestAnimationFrame(() => {
      fitAddon.fit();
      restoreFontSize();
    });

    term.onData((data) => {
      if (state.launched || window.QCLI?.Tabs?.activeTabId) {
        const tabId = window.QCLI?.Tabs?.activeTabId;
        wsSend({ type: 'input', data, tabId });

        // ── Command history capture ──
        // Buffer characters until newline, then save to HistoryStore
        if (data === '\r' || data === '\n') {
          // Enter pressed — save the buffered command
          if (_inputBuffer.trim() && window.QCLI?.HistoryStore) {
            const activeTab = tabId ? window.QCLI?.Tabs?.getTab(tabId) : null;
            window.QCLI.HistoryStore.add(
              _inputBuffer.trim(),
              tabId,
              activeTab?.name || ''
            );
          }
          _inputBuffer = '';
          _inputTabId = null;
        } else if (data === '\x7f') {
          // Backspace — remove last character
          _inputBuffer = _inputBuffer.slice(0, -1);
          _inputTabId = tabId;
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
          // Printable character
          _inputBuffer += data;
          _inputTabId = tabId;
        } else {
          // Control characters (Ctrl+C, etc.) — reset buffer
          _inputBuffer = '';
          _inputTabId = null;
        }
      }
    });

    // ──────────────────────────────────────────────
    // Clipboard: Ctrl+Shift+C copy, Ctrl+Shift+V paste
    // ──────────────────────────────────────────────
    // xterm.js already handles native Ctrl+V paste via its hidden textarea.
    // We only intercept Ctrl+Shift variants to avoid double-input.

    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C → copy selection to system clipboard
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'c' && !e.repeat) {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(err => {
            console.warn('[Clipboard] Copy failed:', err.message);
          });
          term.clearSelection();
        }
        return false;
      }

      // Ctrl+Shift+V → paste from system clipboard
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'v' && !e.repeat) {
        navigator.clipboard.readText().then(text => {
          if (text && state.launched) {
            wsSend({ type: 'input', data: text });
          }
        }).catch(err => {
          console.warn('[Clipboard] Paste failed:', err.message);
          // Fallback: let the browser's native paste handle it via xterm.js
        });
        return false;
      }

      return true;
    });

    // Middle-click → copy selection to system clipboard
    dom.terminal.addEventListener('auxclick', (e) => {
      // e.button === 1  is the middle mouse button
      if (e.button === 1) {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).then(() => {
            term.clearSelection(); // visual feedback: highlight disappears
          }).catch(err => {
            console.warn('[Clipboard] Middle-click copy failed:', err.message);
          });
        }
      }
    });

    // Right-click on terminal: show unified context menu
    dom.terminal.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.xterm-screen') || !state.launched) return;
      e.preventDefault();

      const selection = term.getSelection ? term.getSelection() : '';
      showContextMenu(e.clientX, e.clientY, selection);
    });

    // ──────────────────────────────────────────────
    // Resize handling — re-fit terminal when container
    // or window changes size (sidebar toggle, window resize, etc.)
    // ──────────────────────────────────────────────
    let resizeTimer = null;

    function handleResize() {
      if (resizeTimer) return;
      resizeTimer = requestAnimationFrame(() => {
        resizeTimer = null;
        try {
          fitAddon.fit();
        } catch (e) { /* ignore */ }
        // Update the dims display using the existing outer function
        updateTerminalDims();
        if (state.launched) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
          }
        }
      });
    }

    // Observe both the terminal and its container for reliable size tracking
    const ro = new ResizeObserver(handleResize);
    ro.observe(dom.terminal);
    const container = dom.terminal.parentElement;
    if (container) ro.observe(container);

    // Window resize backup (handles cases where ResizeObserver misses events)
    window.addEventListener('resize', handleResize);

    // ──────────────────────────────────────────────
    // Force viewport scroll — override xterm.js runtime
    // inline style changes (e.g., alternate screen buffer)
    // ──────────────────────────────────────────────
    function forceViewportScroll() {
      const vp = dom.terminal.querySelector('.xterm-viewport');
      if (vp) {
        vp.style.setProperty('overflow-y', 'scroll', 'important');
      }
    }

    // Force immediately and after DOM settles
    forceViewportScroll();
    requestAnimationFrame(forceViewportScroll);

    // Lightweight: periodically ensure viewport stays scrollable (every 2s).
    // Avoids a heavy MutationObserver that would fire on every terminal render.
    const scrollInterval = setInterval(forceViewportScroll, 1000);

    // Clean up interval on page unload
    window.addEventListener('beforeunload', () => {
      clearInterval(scrollInterval);
    });
  }

  // ============================================================
  // Global Progress Bar
  // ============================================================
  let progressCount = 0;

  function showProgressBar() {
    progressCount++;
    if (progressCount > 0) {
      document.getElementById('global-progress')?.classList.add('active');
    }
  }

  function hideProgressBar() {
    progressCount = Math.max(0, progressCount - 1);
    if (progressCount === 0) {
      const el = document.getElementById('global-progress');
      if (el) el.classList.remove('active');
    }
  }

  // ============================================================
  // WebSocket
  // ============================================================
  let ws = null;
  let heartbeatInterval = null;

  function getWSURL() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Expose wsSend for modules (tabs.js, etc.)
  Q.wsSend = wsSend;

  // Expose the WebSocket instance itself for sub-modules (agents.js, workflows.js)
  // that need to check readyState and send raw messages
  Q.ws = null;

  function connectWS() {
    if (ws) {
      try { ws.close(); } catch (e) { /* ignore */ }
    }

    ws = new WebSocket(getWSURL());
    Q.ws = ws;

    // Wire WebSocket to sub-modules
    if (window.QCLI?.Agents?.agents) {
      window.QCLI.Agents.agents.ws = ws;
    }
    if (window.QCLI?.Workflows?.workflows) {
      window.QCLI.Workflows.workflows.ws = ws;
    }

    ws.onopen = () => {
      console.log('[WS] Connected');
      state.connected = true;
      state.reconnectAttempts = 0;
      setConnectionStatus('connected');
      hideProgressBar();
    // Load preset selector
      if (window.QCLI?.Presets?.loadPresets) {
        window.QCLI.Presets.loadPresets();
      }
      if (!heartbeatInterval) {
        heartbeatInterval = setInterval(() => {
          wsSend({ type: 'ping' });
        }, 30000);
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'output':
          // Route output through Tab Manager (buffer + write to active tab)
          if (window.QCLI?.Tabs) {
            window.QCLI.Tabs.appendOutput(msg.data, msg.tabId);
          } else if (term) {
            term.write(msg.data);
          }
          break;

        case 'launched':
          state.launched = true;
          state.launching = false;
          dom.activeLabel.className = '';
          dom.welcomeOverlay.classList.add('hidden');
          dom.activeLabel.textContent = msg.cli.name;
          dom.activeVersion.textContent = msg.cli.version || '';
          updateCLIState(msg.cli.id, 'running');
          updateTerminalDims();
          // Power-on animation for terminal
          const termContainer = document.getElementById('terminal-container');
          if (termContainer) {
            termContainer.classList.remove('terminal-power-on');
            void termContainer.offsetWidth;
            termContainer.classList.add('terminal-power-on');
            setTimeout(() => termContainer.classList.remove('terminal-power-on'), 1000);
          }
          // Create tab for multi-session support
          if (window.QCLI?.Tabs && msg.tabId) {
            const cliObj = state.clis?.find(c => c.id === msg.cli?.id);
            // Check pending init (from workspace restore) first, then cliObj
            const pendingInit = _pendingInit.get(msg.cli?.id);
            const initCmd = pendingInit || cliObj?.init || '';
            window.QCLI.Tabs.create(msg.tabId, msg.cli?.id, msg.cli?.name,
              window.QCLI.Tabs.getCLIIcon ? window.QCLI.Tabs.getCLIIcon(msg.cli?.name || '') : '▶',
              initCmd);
            if (pendingInit) _pendingInit.delete(msg.cli?.id);
            // Auto-execute init command if present
            if (initCmd) {
              setTimeout(() => wsSend({ type: 'input', data: initCmd + '\n' }), 100);
            }
          }
          break;

        case 'exit':
          state.launched = false;
          state.launching = false;
          // If tabId is present, show exit message and close tab after a delay
          if (msg.tabId && window.QCLI?.Tabs) {
            if (msg.code === 0) {
              if (term) term.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
            } else if (msg.code !== null) {
              if (term) term.write(`\r\n\x1b[31m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
            } else if (msg.signal) {
              if (term) term.write(`\r\n\x1b[33m[Process killed by signal ${msg.signal}]\x1b[0m\r\n`);
            }
            state.activeCliId = null;
            updateTerminalDims();
            // Close tab after 2s delay so user can see the exit message
            setTimeout(() => {
              if (window.QCLI?.Tabs) window.QCLI.Tabs.close(msg.tabId);
            }, 2000);
            break;
          }
          if (msg.code === 0) {
            if (term) term.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
          } else if (msg.code !== null) {
            if (term) term.write(`\r\n\x1b[31m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
          } else if (msg.signal) {
            if (term) term.write(`\r\n\x1b[33m[Process killed by signal ${msg.signal}]\x1b[0m\r\n`);
          }
          dom.activeLabel.className = '';
          dom.activeLabel.textContent = __('cli.notRunning');
          dom.activeVersion.textContent = '';
          updateCLIState(msg.cli || state.activeCliId, null);
          state.activeCliId = null;
          updateTerminalDims();
          break;

        case 'error':
          state.launching = false;
          dom.activeLabel.className = '';
          if (term) term.write(`\r\n\x1b[31m[Error] ${msg.message}\x1b[0m\r\n`);
          break;

        case 'killed':
          state.launched = false;
          state.launching = false;
          // If tabId is specified, let Tabs handle the UI
          if (msg.tabId && window.QCLI?.Tabs) {
            // Don't double-close: tabs.close() already called kill on backend
            // But if kill came from backend, just remove the tab
            state.activeCliId = null;
            updateTerminalDims();
            break;
          }
          dom.activeLabel.className = '';
          dom.activeLabel.textContent = __('cli.notRunning');
          dom.activeVersion.textContent = '';
          if (state.activeCliId) {
            updateCLIState(state.activeCliId, null);
            state.activeCliId = null;
          }
          updateTerminalDims();
          break;

        case 'command:complete':
          // Show browser notification for long-running / errored commands
          if ('Notification' in window && Notification.permission === 'granted') {
            const dur = msg.duration > 60
              ? Math.round(msg.duration / 60) + 'm ' + (msg.duration % 60) + 's'
              : msg.duration + 's';
            const title = msg.isError ? '⚠️ 命令出错' : '✅ 命令完成';
            const body = msg.cliName
              ? `[${msg.cliName}] 用时 ${dur}，退出码 ${msg.exitCode}`
              : `用时 ${dur}，退出码 ${msg.exitCode}`;
            try {
              new Notification(title, { body, tag: 'cmd-complete' });
            } catch (e) { /* ignore */ }
          }
          // Also show in-app toast
          const notifMsg = msg.isError
            ? `⚠️ [${msg.cliName || 'CLI'}] 退出码 ${msg.exitCode} (${msg.duration}s)`
            : `✅ [${msg.cliName || 'CLI'}] 完成 (${msg.duration}s)`;
          showToast(notifMsg, msg.isError ? 'error' : 'success');
          break;

        case 'pong':
          break;

        default:
          console.log('[WS] Routed message type:', msg.type, JSON.stringify(msg).substring(0, 200));
          // Forward agent and workflow messages to their handlers
          if (window.QCLI?.Agents?.handleWSMessage) {
            window.QCLI.Agents.handleWSMessage(msg);
          }
          if (window.QCLI?.Workflows?.handleWSMessage) {
            window.QCLI.Workflows.handleWSMessage(msg);
          }
          break;
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      state.connected = false;
      state.launched = false;

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      // Close all tabs on disconnect
      if (window.QCLI?.Tabs) {
        window.QCLI.Tabs.closeAll();
      }

      // Notify workflows of disconnect (mark active workflow as failed)
      if (window.QCLI?.Workflows?.handleDisconnect) {
        window.QCLI.Workflows.handleDisconnect();
      }

      if (state.reconnectAttempts < state.maxReconnectAttempts) {
        // Add reconnecting animation class for pulsing dot
        setConnectionStatus('reconnecting', 'Reconnecting...');
        state.reconnectAttempts++;
        setTimeout(connectWS, Math.min(1000 * Math.pow(2, state.reconnectAttempts), 15000));
      } else {
        setConnectionStatus('error', 'Connection lost');
        // Smooth fade-in for connection-lost overlay
        dom.connectionLost.classList.add('visible');
      }
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  function setConnectionStatus(status, customText) {
    dom.statusIndicator.className = 'status-indicator ' + status;
    const labels = {
      connected: 'Connected',
      disconnected: customText || 'Disconnected',
      reconnecting: customText || 'Reconnecting',
      error: customText || 'Error',
    };
    dom.statusText.textContent = labels[status] || status;
  }

  // ============================================================
  // CLI & Folder Management
  // ============================================================
  async function loadCLIs() {
    // Keep skeleton visible until data arrives — don't clear dom.cliList here
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch('/api/clis', { signal: controller.signal });
      if (resp.ok) {
        const data = await resp.json();
        state.clis = data.clis || [];
        state.folders = data.folders || [];
      } else {
        state.clis = [];
        state.folders = [];
        console.warn('Failed to load CLIs:', resp.status);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('loadCLIs timed out after 10s');
      } else {
        console.error('Failed to load CLIs:', err);
      }
      state.clis = [];
      state.folders = [];
    } finally {
      clearTimeout(timeoutId);
    }
    // Always render CLI list — replaces skeleton placeholder with real/empty state
    renderCLIList();
    hideProgressBar();
    // Reveal welcome page real content (skeleton state ends)
    dom.welcomeOverlay.classList.add('welcome-loaded');
  }

  // ============================================================
  // Folder CRUD
  // ============================================================
  async function createFolder(name) {
    try {
      const resp = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (resp.ok) {
        const folder = await resp.json();
        state.folders.push(folder);
        renderCLIList();
        showUploadStatus(`Created folder "${folder.name}"`);
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  }

  async function updateFolderOnServer(folderId, changes) {
    try {
      await fetch(`/api/folders/${folderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
    } catch (err) {
      console.error('Failed to update folder:', err);
    }
  }

  async function deleteFolderOnServer(folderId) {
    try {
      const resp = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      if (resp.ok) {
        state.folders = state.folders.filter(f => f.id !== folderId);
        renderCLIList();
        showUploadStatus('Folder deleted');
      }
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  }

  // ============================================================
  // Search + Category Filter
  // ============================================================
  function filterCLIs(clis) {
    let result = clis;

    // Filter out hidden CLIs (unless a search query is active)
    if (!state.searchQuery) {
      result = result.filter(cli => !isHidden(cli.id));
    }

    // Search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(cli =>
        cli.name.toLowerCase().includes(q) ||
        (cli.version && cli.version.toLowerCase().includes(q))
      );
    }

    // Category / favorites filter
    if (state.categoryFilter !== 'all') {
      if (state.categoryFilter === 'favorites') {
        const favs = getFavorites();
        result = result.filter(cli => favs.includes(cli.id));
      } else {
        result = result.filter(cli => (cli.category || 'tool') === state.categoryFilter);
      }
    }

    return result;
  }

  // ============================================================
  // Category Statistics — update chip labels with counts
  // ============================================================
  function updateCategoryCounts() {
    if (!dom.categoryFilters) return;
    const total = state.clis.length;
    const counts = { agent: 0, directory: 0, tool: 0, favorites: 0 };
    const favs = getFavorites();
    for (const cli of state.clis) {
      const cat = cli.category || 'tool';
      if (counts[cat] !== undefined) counts[cat]++;
      if (favs.includes(cli.id)) counts.favorites++;
    }
    const chips = dom.categoryFilters.querySelectorAll('.category-chip');
    chips.forEach(chip => {
      const cat = chip.dataset.category;
      if (cat === 'all') {
        chip.textContent = `All (${total})`;
      } else if (cat === 'favorites') {
        chip.textContent = `⭐ Favorites (${counts.favorites})`;
      } else if (counts[cat] !== undefined) {
        chip.textContent = `${getCategoryIcon(cat)} ${getCategoryLabel(cat)} (${counts[cat]})`;
      }
    });
  }

  // ============================================================
  // Render CLI List with Folders
  // ============================================================
  /**
   * Sort CLIs: favorites first, then by name.
   * @param {Array} clis
   * @returns {Array}
   */
  function sortCLIs(clis) {
    const favs = getFavorites();
    return [...clis].sort((a, b) => {
      const aFav = favs.includes(a.id) ? 0 : 1;
      const bFav = favs.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
  }

  function renderCLIList() {
    dom.cliList.innerHTML = '';
    updateCategoryCounts();
    // Track if this is the first render (for entrance animations)
    const isFirstRender = !dom.cliList._hasRendered;
    dom.cliList._hasRendered = true;

    const filteredCLIs = filterCLIs(state.clis);
    const cliMap = {};
    for (const cli of filteredCLIs) {
      cliMap[cli.id] = cli;
    }

    if (filteredCLIs.length === 0) {
      const msg = state.searchQuery
        ? `No CLIs match "${state.searchQuery}"`
        : 'No CLIs found. Click + to add.';
      const empty = document.createElement('div');
      empty.className = 'cli-item';
      empty.style.cursor = 'default';
      empty.style.color = 'var(--text-tertiary)';
      empty.textContent = msg;
      dom.cliList.appendChild(empty);
      return;
    }

    // Track which CLI IDs are already assigned to folders
    const assignedIds = new Set();

    // --- Render folders (sorted: favorites first) ---
    for (const folder of state.folders) {
      const folderCLIs = sortCLIs(folder.cliIds.filter(id => cliMap[id]).map(id => cliMap[id]));
      if (folderCLIs.length === 0 && state.searchQuery) continue;

      const folderEl = renderFolder(folder, folderCLIs, isFirstRender);
      dom.cliList.appendChild(folderEl);

      for (const cli of folderCLIs) {
        assignedIds.add(cli.id);
      }
    }

    // --- Render uncategorized CLIs (sorted: favorites first) ---
    const uncategorizedCLIs = sortCLIs(filteredCLIs.filter(cli => !assignedIds.has(cli.id)));
    if (uncategorizedCLIs.length > 0) {
      const section = document.createElement('div');
      section.className = 'folder-item';

      const header = document.createElement('div');
      header.className = 'folder-header';
      header.style.cursor = 'default';
      header.style.textTransform = 'none';
      header.style.fontWeight = '500';
      header.style.letterSpacing = '0';
      header.style.fontSize = '11px';
      header.style.color = 'var(--text-tertiary)';
      header.style.padding = '4px 8px';
      header.textContent = `Others  (${uncategorizedCLIs.length})`;

      // Make Others header a drop target for uncategorizing
      header.addEventListener('dragover', (e) => {
        e.preventDefault();
        header.style.background = 'rgba(99, 102, 241, 0.15)';
        header.style.borderRadius = '6px';
      });
      header.addEventListener('dragleave', () => {
        header.style.background = '';
      });
      header.addEventListener('drop', async (e) => {
        e.preventDefault();
        header.style.background = '';
        const cliId = e.dataTransfer.getData('text/cli-id');
        if (cliId) {
          await removeCLIFromAllFolders(cliId);
        }
      });

      section.appendChild(header);

      const clisWrap = document.createElement('div');
      clisWrap.className = 'folder-clis';
      for (const cli of uncategorizedCLIs) {
        const el = createCLIElement(cli);
        if (isFirstRender) el.classList.add('entering');
        clisWrap.appendChild(el);
      }
      section.appendChild(clisWrap);
      dom.cliList.appendChild(section);
    }
  }

  // ============================================================
  // Render a single folder
  // ============================================================
  function renderFolder(folder, folderCLIs, isFirstRender) {
    const folderEl = document.createElement('div');
    folderEl.className = 'folder-item';
    folderEl.dataset.folderId = folder.id;

    // Folder header (clickable)
    const header = document.createElement('div');
    header.className = 'folder-header';
    header.draggable = false;

    // Toggle arrow
    const toggle = document.createElement('span');
    toggle.className = 'folder-toggle' + (folder.collapsed ? ' collapsed' : '');
    toggle.textContent = '\u25bc'; // ▼
    header.appendChild(toggle);

    // Folder name (text or input)
    if (state.renamingFolderId === folder.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'folder-name-input';
      input.value = folder.name;
      input.autofocus = true;
      input.addEventListener('blur', () => finishRename(folder.id, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finishRename(folder.id, input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          state.renamingFolderId = null;
          renderCLIList();
        }
        e.stopPropagation();
      });
      // Delay focus to next tick so the element is in DOM
      setTimeout(() => input.focus(), 0);
      header.appendChild(input);
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'folder-name-text';
      nameSpan.textContent = folder.name;
      header.appendChild(nameSpan);
    }

    // Folder action buttons
    const actions = document.createElement('span');
    actions.className = 'folder-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-action-btn';
    renameBtn.textContent = '\u270f'; // ✏
    renameBtn.title = 'Rename folder';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.renamingFolderId = folder.id;
      renderCLIList();
    });
    actions.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'folder-action-btn danger';
    delBtn.textContent = '\u00d7'; // ×
    delBtn.title = 'Delete folder (CLIs will be uncategorized)';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(__('cli.deleteConfirm', folder.name))) {
        deleteFolderOnServer(folder.id);
      }
    });
    actions.appendChild(delBtn);

    header.appendChild(actions);

    // Toggle collapse on header click (except when interacting with input/buttons)
    header.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.closest('.folder-actions')) return;
      folder.collapsed = !folder.collapsed;
      updateFolderOnServer(folder.id, { collapsed: folder.collapsed });
      renderCLIList();
    });

    // Drop target for drag-and-drop
    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.add('drag-over');
    });

    header.addEventListener('dragleave', (e) => {
      header.classList.remove('drag-over');
    });

    header.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove('drag-over');
      const cliId = e.dataTransfer.getData('text/cli-id');
      if (cliId) {
        moveCLIToFolder(cliId, folder.id);
      }
    });

    folderEl.appendChild(header);

    // Folder CLI container
    const clisWrap = document.createElement('div');
    clisWrap.className = 'folder-clis' + (folder.collapsed ? ' collapsed' : '');

    // If collapsed and searching, still show matching CLIs
    const showCLIs = !folder.collapsed || state.searchQuery;
    if (showCLIs) {
      for (const cli of folderCLIs) {
        const el = createCLIElement(cli);
        if (isFirstRender) el.classList.add('entering');
        clisWrap.appendChild(el);
      }
    }

    // Drop target on the CLI list area too
    clisWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      clisWrap.classList.add('drag-over');
    });

    clisWrap.addEventListener('dragleave', () => {
      clisWrap.classList.remove('drag-over');
    });

    clisWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      clisWrap.classList.remove('drag-over');
      const cliId = e.dataTransfer.getData('text/cli-id');
      if (cliId) {
        moveCLIToFolder(cliId, folder.id);
      }
    });

    folderEl.appendChild(clisWrap);

    return folderEl;
  }

  // ============================================================
  // Create a single CLI element
  // ============================================================
  function createCLIElement(cli) {
    const item = document.createElement('div');
    item.className = 'cli-item';
    item.dataset.cliId = cli.id;
    item.draggable = true;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');

    if (cli.id === state.activeCliId) {
      item.classList.add('active');
      item.setAttribute('aria-selected', 'true');
    }

    // Drag start: store CLI id
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/cli-id', cli.id);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      // Remove drag-over from all drop targets
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    // Allow dropping on CLI items to move between folders
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = e.dataTransfer.getData('text/cli-id');
      if (draggedId && draggedId !== cli.id) {
        item.classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/cli-id');
      if (draggedId && draggedId !== cli.id) {
        // Move dragged CLI to the same folder as this CLI
        const targetFolder = findFolderForCLI(cli.id);
        if (targetFolder) {
          moveCLIToFolder(draggedId, targetFolder.id);
        } else {
          // Move to uncategorized by removing from its current folder
          removeCLIFromAllFolders(draggedId);
        }
      }
    });

    // Icon
    const icon = document.createElement('span');
    icon.className = 'cli-icon';
    icon.textContent = getCLIIcon(cli.name);
    item.appendChild(icon);

    // Info block
    const info = document.createElement('div');
    info.className = 'cli-info';

    const name = document.createElement('div');
    name.className = 'cli-name';
    name.textContent = cli.name;
    info.appendChild(name);

    if (cli.version && cli.version !== 'unknown') {
      const ver = document.createElement('div');
      ver.className = 'cli-version';
      ver.textContent = cli.version;
      info.appendChild(ver);
    }

    item.appendChild(info);

    // Category badge
    const cat = cli.category || 'tool';
    const catBadge = document.createElement('span');
    catBadge.className = `cli-category-badge ${cat}`;
    catBadge.textContent = getCategoryIcon(cat) + ' ' + getCategoryLabel(cat);
    item.appendChild(catBadge);

    // Type badge
    const badge = document.createElement('span');
    badge.className = 'cli-type-badge';
    badge.textContent = cli.type || 'batch';
    item.appendChild(badge);

    // Favorite star button
    const fav = document.createElement('button');
    const isFav = isFavorite(cli.id);
    fav.className = 'cli-fav-btn' + (isFav ? ' favorited' : '');
    fav.textContent = isFav ? '⭐' : '☆';
    fav.title = isFav ? 'Remove from favorites' : 'Add to favorites';
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(cli.id);
    });
    item.appendChild(fav);

    // Delete button
    const del = document.createElement('button');
    del.className = 'delete-cli-btn';
    del.textContent = '\u00d7';
    del.title = 'Remove CLI';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCLI(cli.id);
    });
    item.appendChild(del);

    // Click to launch
    item.addEventListener('click', () => {
      launchCLI(cli.id);
    });

    return item;
  }

  // ============================================================
  // Folder helpers
  // ============================================================
  function findFolderForCLI(cliId) {
    return state.folders.find(f => f.cliIds.includes(cliId)) || null;
  }

  async function moveCLIToFolder(cliId, targetFolderId) {
    // Remove from all folders first
    for (const folder of state.folders) {
      const idx = folder.cliIds.indexOf(cliId);
      if (idx !== -1) {
        folder.cliIds.splice(idx, 1);
        await updateFolderOnServer(folder.id, { cliIds: folder.cliIds });
      }
    }

    // Add to target folder
    const target = state.folders.find(f => f.id === targetFolderId);
    if (target) {
      if (!target.cliIds.includes(cliId)) {
        target.cliIds.push(cliId);
        await updateFolderOnServer(target.id, { cliIds: target.cliIds });
      }
    }

    renderCLIList();
    showUploadStatus('CLI moved');
  }

  async function removeCLIFromAllFolders(cliId) {
    for (const folder of state.folders) {
      const idx = folder.cliIds.indexOf(cliId);
      if (idx !== -1) {
        folder.cliIds.splice(idx, 1);
        await updateFolderOnServer(folder.id, { cliIds: folder.cliIds });
      }
    }
    renderCLIList();
  }

  async function finishRename(folderId, newName) {
    state.renamingFolderId = null;
    const name = newName.trim();
    if (name) {
      const folder = state.folders.find(f => f.id === folderId);
      if (folder) {
        folder.name = name;
        await updateFolderOnServer(folderId, { name });
      }
    }
    renderCLIList();
  }

  // ============================================================
  // CLI State
  // ============================================================
  function updateCLIState(cliId, activeState) {
    const items = dom.cliList.querySelectorAll('.cli-item');
    for (const item of items) {
      item.classList.remove('active', 'running');
      item.setAttribute('aria-selected', 'false');
      if (item.dataset.cliId === cliId) {
        if (activeState === 'running') {
          item.classList.add('active', 'running');
          item.setAttribute('aria-selected', 'true');
        }
      }
    }
  }

  function getCLIIcon(name) {
    const icons = {
      opencode: '\u26a1',
      node: '\ud83d\udfe2',
      python: '\ud83d\udc0d',
      python3: '\ud83d\udc0d',
      git: '\u2387',
      docker: '\ud83d\udc33',
      kubectl: '\u2638',
      npm: '\ud83d\udce6',
      npx: '\ud83d\udce6',
      pnpm: '\ud83d\udce6',
      yarn: '\ud83d\udce6',
      bun: '\ud83e\udd5f',
      bash: '>_',
      zsh: '%',
      powershell: '\ud83e\ude9f',
      pwsh: '\ud83e\ude9f',
      cmd: '>',
      ssh: '\ud83d\udd10',
      mysql: '\ud83d\udc2c',
      redis: '\ud83d\udd34',
      mongosh: '\ud83c\udf43',
      cargo: '\ud83e\udd80',
      go: '\ud83d\udd37',
      deno: '\ud83e\udd95',
      vim: '\u270f\ufe0f',
      nvim: '\u270f\ufe0f',
      nano: '\u270f\ufe0f',
      tmux: '\u229e',
      lazygit: '\u2387',
      gh: '\ud83d\udc19',
      code: '\ud83d\udcbb',
      curl: '\ud83c\udf10',
      wget: '\u2b07',
      htop: '\ud83d\udcca',
      btop: '\ud83d\udcca',
      neofetch: '\ud83d\udda5',
      fastfetch: '\ud83d\udda5',
    };
    return icons[name] || '\u25b8';
  }

  // ============================================================
  // Launch / Switch CLI
  // ============================================================
  function launchCLI(cliId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Not connected');
      return;
    }

    // Check if a tab already exists for this CLI — switch to it instead
    const existingTab = window.QCLI?.Tabs?.tabs?.find(t => t.cliId === cliId);
    if (existingTab && window.QCLI?.Tabs?.switch) {
      window.QCLI.Tabs.switch(existingTab.tabId);
      state.activeCliId = cliId;
      dom.activeLabel.textContent = existingTab.name || cliId;
      dom.welcomeOverlay.classList.add('hidden');
      updateCLIState(cliId, null);
      return;
    }

    const dims = fitAddon ? fitAddon.proposeDimensions() : null;
    const cols = dims ? dims.cols : 80;
    const rows = dims ? dims.rows : 24;

    const cli = state.clis.find(c => c.id === cliId);

    state.launching = true;
    dom.activeLabel.className = 'starting';
    dom.activeLabel.textContent = `Starting ${cli ? cli.name : cliId}...`;
    dom.activeVersion.textContent = '';

    state.activeCliId = cliId;

    // Generate a tabId for multi-session support
    const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
    
    // Reset terminal if no Tab Manager, otherwise Tab Manager handles it
    if (!window.QCLI?.Tabs && term) term.reset();

    wsSend({ type: 'launch', cliId, cols, rows, tabId });
  }

  // ============================================================
  // Delete CLI
  // ============================================================
  async function deleteCLI(cliId) {
    if (state.activeCliId === cliId) {
      if (state.launched) wsSend({ type: 'kill' });
      state.activeCliId = null;
    }

    try {
      const resp = await fetch(`/api/clis/${cliId}`, { method: 'DELETE' });
      if (resp.ok) {
        // Remove from folders too
        for (const folder of state.folders) {
          const idx = folder.cliIds.indexOf(cliId);
          if (idx !== -1) {
            folder.cliIds.splice(idx, 1);
            await updateFolderOnServer(folder.id, { cliIds: folder.cliIds });
          }
        }
        state.clis = state.clis.filter(c => c.id !== cliId);
        renderCLIList();
        showUploadStatus(`Removed ${cliId}`);
      } else {
        showUploadStatus(`Failed to remove ${cliId}`);
      }
    } catch (err) {
      console.error('Failed to delete CLI:', err);
      showUploadStatus('Network error — could not remove CLI');
    }
  }

  // ============================================================
  // Discover CLIs
  // ============================================================
  async function discoverCLIs() {
    showProgressBar();
    dom.discoverBtn.textContent = '\u27f3';
    dom.discoverBtn.style.animation = 'spin 1s linear infinite';
    try {
      const resp = await fetch('/api/discover', { method: 'POST' });
      if (!resp.ok) {
        showUploadStatus(`Discovery failed (${resp.status})`);
        state.clis = [];
        state.folders = [];
        renderCLIList();
        hideProgressBar();
        return;
      }
      const data = await resp.json();
      state.clis = data.registry.clis || [];
      renderCLIList();
      if (data.discovered && data.discovered.length > 0) {
        showUploadStatus(`Found ${data.discovered.length} new CLI${data.discovered.length > 1 ? 's' : ''}`);
      }
    } catch (err) {
      console.error('Discovery failed:', err);
      showUploadStatus('Discovery failed — network error');
    }
    hideProgressBar();
    dom.discoverBtn.style.animation = '';
    dom.discoverBtn.textContent = '\u27f3';
  }

  // ============================================================
  // Add CLI Modal
  // ============================================================
  let selectedFilePath = null;

  function showAddModal() {
    selectedFilePath = null;
    dom.addOverlay.classList.remove('hidden');
    dom.addName.value = '';
    dom.addPath.value = '';
    dom.addArgs.value = '';
    dom.addError.classList.add('hidden');
    dom.selectedFile.classList.add('hidden');
    dom.manualPathGroup.classList.add('hidden');
    dom.addName.focus();
  }

  function hideAddModal() {
    dom.addOverlay.classList.add('hidden');
  }

  dom.addBtn.addEventListener('click', showAddModal);
  dom.addCancel.addEventListener('click', hideAddModal);

  dom.browseBtn.addEventListener('click', () => dom.fileInput.click());

  dom.fileInput.addEventListener('change', () => {
    const file = dom.fileInput.files[0];
    if (!file) return;

    let name = file.name.replace(/\.[^.]+$/, '');
    dom.addName.value = name;

    dom.selectedFile.textContent = `\u2714 ${file.name}`;
    dom.selectedFile.classList.remove('hidden');

    selectedFilePath = file.name;
    dom.manualPathGroup.classList.add('hidden');
    dom.addPath.value = '';
  });

  dom.addName.addEventListener('input', () => {
    if (!selectedFilePath && dom.addName.value.trim()) {
      dom.manualPathGroup.classList.remove('hidden');
    }
  });

  function parseArgs(str) {
    const args = [];
    const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match;
    while ((match = re.exec(str)) !== null) {
      args.push(match[1] || match[2] || match[0]);
    }
    return args;
  }

  dom.addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = dom.addName.value.trim();
    if (!name) return;

    const body = { name };
    const customPath = dom.addPath.value.trim();
    if (customPath) body.path = customPath;
    const args = dom.addArgs.value.trim();
    if (args) body.args = parseArgs(args);
    const init = dom.addInit?.value.trim();
    if (init) body.init = init;

    dom.addSubmit.disabled = true;
    dom.addSubmit.textContent = 'Adding\u2026';

    try {
      const resp = await fetch('/api/clis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        const entry = await resp.json();
        state.clis.push(entry);
        renderCLIList();
        hideAddModal();
        showUploadStatus(`Added ${entry.name}`);
      } else {
        const err = await resp.json();
        dom.addError.textContent = err.error || 'Failed to add CLI';
        dom.addError.classList.remove('hidden');
      }
    } catch (err) {
      dom.addError.textContent = 'Network error';
      dom.addError.classList.remove('hidden');
    }

    dom.addSubmit.disabled = false;
    dom.addSubmit.textContent = 'Add';
  });

  dom.addOverlay.addEventListener('click', (e) => {
    if (e.target === dom.addOverlay) hideAddModal();
  });

  // ============================================================
  // Search Input
  // ============================================================
  dom.searchInput.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value.trim();
    renderCLIList();
  });

  // Focus search with Ctrl+F
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !dom.searchInput.matches(':focus')) {
      e.preventDefault();
      dom.searchInput.focus();
    }
  });

  // ============================================================
  // Add Folder
  // ============================================================
  dom.addFolderBtn.addEventListener('click', async () => {
    const name = prompt('Folder name:');
    if (name && name.trim()) {
      await createFolder(name.trim());
    }
  });

  // ============================================================
  // Discover Button
  // ============================================================
  dom.discoverBtn.addEventListener('click', discoverCLIs);

  // ============================================================
  // Toast Notifications — Glassmorphism + Auto-Stack
  // ============================================================
  const TOAST_ICONS = {
    success: '\u2714\ufe0f',
    error:   '\u2716\ufe0f',
    info:    '\u2139\ufe0f',
  };

  function showToast(msg, type) {
    const container = document.getElementById('toast-container') || (() => {
      const el = document.createElement('div');
      el.id = 'toast-container';
      document.body.appendChild(el);
      return el;
    })();

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');

    // Icon
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;
    toast.appendChild(icon);

    // Body — avoid `[object Object]` flicker for object messages
    const body = document.createElement('span');
    body.className = 'toast-body';
    body.textContent = (typeof msg === 'object' && msg !== null && typeof msg.toString === 'function')
      ? msg.toString()
      : msg;
    toast.appendChild(body);

    // Dismiss button
    const dismiss = document.createElement('button');
    dismiss.className = 'toast-dismiss';
    dismiss.textContent = '\u00d7';
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      exitToast(toast);
    });
    toast.appendChild(dismiss);

    // Trigger entrance animation BEFORE adding to DOM to avoid flash
    toast.classList.add('entering');
    container.appendChild(toast);

    // Make toast clickable if msg has _onClick handler
    if (msg && typeof msg === 'object' && msg._onClick) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', (e) => {
        if (e.target.closest('.toast-dismiss')) return;
        msg._onClick(e);
      });
    }

    // Auto-remove after delay
    toast._exitTimer = setTimeout(() => {
      exitToast(toast);
    }, 3500);

    return toast;
  }

  function exitToast(toast) {
    if (!toast || toast._exiting) return;
    toast._exiting = true;

    // Clear auto-exit timer
    if (toast._exitTimer) {
      clearTimeout(toast._exitTimer);
      toast._exitTimer = null;
    }

    // Remove entrance animation, add exit animation
    toast.classList.remove('entering');
    toast.classList.add('exiting');

    // Remove from DOM after animation completes
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 350);
  }

  function showUploadStatus(msg, type) {
    return showToast(msg, type || 'info');
  }

  // ============================================================
  // Media Preview Overlay
  // ============================================================
  const mediaState = {
    files: [],
    currentIndex: 0,
    open: false,
  };

  const mediaPreview = document.getElementById('media-preview');
  const mediaContent = document.getElementById('media-preview-content');
  const mediaName = document.getElementById('media-preview-name');
  const mediaMeta = document.getElementById('media-preview-meta');
  const mediaCounter = document.getElementById('media-preview-counter');
  const mediaCloseBtn = document.getElementById('media-close-btn');
  const mediaPrevBtn = document.getElementById('media-prev-btn');
  const mediaNextBtn = document.getElementById('media-next-btn');
  const mediaDownloadBtn = document.getElementById('media-download-btn');

  /**
   * Open media preview with the given file list, starting at index.
   * @param {Array<{name:string,path:string,mime:string,size:number}>} files
   * @param {number} index
   */
  function openMediaPreview(files, index = 0) {
    if (!files || files.length === 0) return;
    mediaState.files = files;
    mediaState.currentIndex = Math.max(0, Math.min(index, files.length - 1));
    mediaState.open = true;
    mediaPreview.classList.remove('hidden');
    renderMediaPreview();
  }

  function closeMediaPreview() {
    mediaState.open = false;
    mediaState.files = [];
    mediaPreview.classList.add('hidden');
    mediaContent.innerHTML = '';
    if (term) term.focus();
  }

  function navigateMedia(delta) {
    if (mediaState.files.length <= 1) return;
    mediaState.currentIndex += delta;
    if (mediaState.currentIndex < 0) mediaState.currentIndex = mediaState.files.length - 1;
    if (mediaState.currentIndex >= mediaState.files.length) mediaState.currentIndex = 0;
    renderMediaPreview();
  }

  function renderMediaPreview() {
    const files = mediaState.files;
    const idx = mediaState.currentIndex;
    if (!files[idx]) { closeMediaPreview(); return; }

    const file = files[idx];
    const url = `/api/uploads/${encodeURIComponent(path.basename(file.path))}?mime=${encodeURIComponent(file.mime || '')}`;

    // Name
    mediaName.textContent = file.name;

    // Counter
    if (files.length > 1) {
      mediaCounter.textContent = `${idx + 1} / ${files.length}`;
      mediaCounter.style.display = '';
    } else {
      mediaCounter.style.display = 'none';
    }

    // Nav buttons
    mediaPrevBtn.style.display = files.length > 1 ? '' : 'none';
    mediaNextBtn.style.display = files.length > 1 ? '' : 'none';

    // Meta
    const sizeStr = file.size ? formatFileSize(file.size) : '';
    const mimeStr = file.mime || '';
    mediaMeta.textContent = [mimeStr, sizeStr].filter(Boolean).join('  ·  ');

    // Content
    mediaContent.innerHTML = '';
    const mime = (file.mime || '').toLowerCase();
    if (mime.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.autoplay = false;
      video.loop = false;
      video.playsInline = true;
      video.preload = 'metadata';
      video.draggable = false;
      mediaContent.appendChild(video);
    } else if (mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = file.name;
      img.draggable = false;
      img.loading = 'eager';
      img.addEventListener('load', () => {
        // Update meta with dimensions
        const dims = `${img.naturalWidth}×${img.naturalHeight}`;
        const parts = [dims];
        if (file.size) parts.push(formatFileSize(file.size));
        mediaMeta.textContent = parts.join('  ·  ');
      });
      mediaContent.appendChild(img);
    } else if (mime === 'application/pdf') {
      const embed = document.createElement('embed');
      embed.src = url;
      embed.type = 'application/pdf';
      embed.style.width = '100%';
      embed.style.height = 'calc(100vh - 120px)';
      embed.style.borderRadius = 'var(--radius-lg)';
      mediaContent.appendChild(embed);
    } else {
      mediaContent.textContent = 'Preview not available for this file type.';
      mediaContent.style.color = 'var(--text-tertiary)';
      mediaContent.style.fontSize = '14px';
    }

    // Download link
    mediaDownloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    };
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ── Wire up events ──
  if (mediaCloseBtn) mediaCloseBtn.addEventListener('click', closeMediaPreview);
  if (mediaPrevBtn) mediaPrevBtn.addEventListener('click', () => navigateMedia(-1));
  if (mediaNextBtn) mediaNextBtn.addEventListener('click', () => navigateMedia(1));

  // Click background to close
  if (mediaPreview) {
    mediaPreview.addEventListener('click', (e) => {
      if (e.target === mediaPreview || e.target.id === 'media-preview-body') {
        closeMediaPreview();
      }
    });
  }

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!mediaState.open) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMediaPreview();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        navigateMedia(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        navigateMedia(1);
        break;
    }
  });

  // ── Click handler for media file paths in terminal ──
  async function handleMediaClick(filename) {
    try {
      // Validate the file exists and get MIME type
      const resp = await fetch(`/api/uploads/${encodeURIComponent(filename)}`, { method: 'HEAD' });
      if (!resp.ok) {
        showUploadStatus(`File not found: ${filename}`, 'error');
        return;
      }
      const mime = resp.headers.get('content-type') || '';
      const size = parseInt(resp.headers.get('content-length') || '0', 10);

      // Only open preview for media files
      if (!mime.startsWith('image/') && !mime.startsWith('video/') && mime !== 'application/pdf') {
        showUploadStatus(`Not a previewable file: ${filename}`, 'info');
        return;
      }

      openMediaPreview([{
        name: filename,
        path: filename,
        mime: mime,
        size: size
      }], 0);
    } catch (err) {
      console.error('[MediaClick] Error:', err);
      showUploadStatus(`Could not open: ${filename}`, 'error');
    }
  }

  // ── Expose for use in upload handler ──
  const path = { basename: (p) => {
    const sep = p.includes('\\') ? '\\' : '/';
    return p.split(sep).pop() || '';
  }};

  // ============================================================
  // Drag & Drop File Upload
  // ============================================================
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    // Only show file upload overlay if dragging files, not CLI items
    if (!e.dataTransfer.types.includes('text/cli-id')) {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        dom.dropOverlay.classList.remove('hidden');
      }
    }
  });

  document.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer.types.includes('text/cli-id')) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        dom.dropOverlay.classList.add('hidden');
      }
    }
  });

  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/cli-id')) {
      e.preventDefault();
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dom.dropOverlay.classList.add('hidden');

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    showUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const resp = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showUploadStatus(`Upload failed: ${err.error || resp.statusText}`);
        return;
      }

      const result = await resp.json();
      if (result.success) {
        const uploadedFiles = result.files;
        const count = uploadedFiles.length;

        const mediaFiles = uploadedFiles.filter(f => {
          const mime = (f.mime || '').toLowerCase();
          return mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf';
        });

        // Show single toast — clickable for media files
        const hasPreview = mediaFiles.length > 0;
        const toastMsg = hasPreview
          ? { _onClick: () => openMediaPreview(mediaFiles, 0), toString: () => `📷 ${count} file${count > 1 ? 's' : ''} uploaded — click to preview` }
          : `Uploaded ${count} file${count > 1 ? 's' : ''}`;
        showUploadStatus(toastMsg, hasPreview ? 'success' : 'info');

        // Store for keyboard-triggered preview
        if (hasPreview) {
          window.__lastUploadedFiles = mediaFiles;
        }

        if (term && state.launched) {
          const names = uploadedFiles.map(f => f.name).join(', ');
          term.write(`\r\n\x1b[90m[Uploaded: ${names}]\x1b[0m\r\n`);
          // Show clickable media paths
          for (const f of uploadedFiles) {
            const m = (f.mime || '').toLowerCase();
            if (m.startsWith('image/') || m.startsWith('video/') || m === 'application/pdf') {
              term.write(`\x1b[90m  uploads\\${f.name}\x1b[0m\r\n`);
            }
          }
          if (hasPreview) {
            term.write(`\x1b[90m[Click paths above or toast to preview]\x1b[0m\r\n`);
          }
        }
      }
    } catch (err) {
      showUploadStatus('Upload failed — network error');
    }
  });

  // ============================================================
  // Connection Lost — Smooth Transition to Reconnect
  // ============================================================
  let reconnectingFromLost = false;

  dom.connectionLost.addEventListener('click', () => {
    if (reconnectingFromLost) return;
    reconnectingFromLost = true;

    // Show spinner on the reconnect button
    const spinner = dom.connectionLost.querySelector('.reconnect-spinner');
    if (spinner) spinner.classList.remove('hidden');

    // Fade out overlay smoothly before starting reconnect
    dom.connectionLost.classList.remove('visible');

    // Brief delay to let the fade-out animation play
    setTimeout(() => {
      state.reconnectAttempts = 0;
      showProgressBar();
      // Re-show skeleton until WS reconnects
      dom.welcomeOverlay.classList.remove('welcome-loaded');
      connectWS();
      loadCLIs();
      // Hide spinner after starting
      if (spinner) spinner.classList.add('hidden');
      reconnectingFromLost = false;
    }, 500);
  });

  // ============================================================
  // Sidebar toggle
  // ============================================================
  function toggleSidebar(forceState) {
    const isCollapsed = forceState !== undefined
      ? forceState
      : !dom.sidebar.classList.contains('collapsed');

    dom.sidebar.classList.toggle('collapsed', isCollapsed);
    dom.sidebarToggle.textContent = isCollapsed ? '▶' : '◀';
    dom.sidebarToggle.title = isCollapsed ? __('sidebar.toggle.expand') : __('sidebar.toggle.collapse');

    try {
      localStorage.setItem('qcli-sidebar-collapsed', isCollapsed ? '1' : '0');
    } catch (e) { /* ignore */ }

    // Wait for CSS transition to finish, then re-fit terminal
    setTimeout(() => {
      if (fitAddon) {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
        if (state.launched) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
          }
        }
      }
    }, 280); // Slightly after CSS transition (250ms)
  }

  dom.sidebarToggle.addEventListener('click', () => toggleSidebar());

  // Restore sidebar state from localStorage
  try {
    if (localStorage.getItem('qcli-sidebar-collapsed') === '1') {
      toggleSidebar(true);
    }
  } catch (e) { /* ignore */ }

  // Tap mobile overlay to close sidebar
  const mobileOverlay = document.getElementById('sidebar-mobile-overlay');
  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', () => toggleSidebar(true));
  }

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.repeat) {
      // Don't trigger if typing in modal input or search
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleSidebar();
    }
  });

  // ============================================================
  // Sidebar Resize Handle — Draggable Width
  // ============================================================
  const resizeHandle = document.getElementById('sidebar-resize-handle');
  let isResizing = false;
  let currentResizeWidth = 240;
  let resizeRAF = null;

  function getSidebarWidth() {
    try {
      const saved = localStorage.getItem('qcli-sidebar-width');
      if (saved) {
        const w = parseInt(saved, 10);
        if (w >= 160 && w <= 480) return w;
      }
    } catch (e) { /* ignore */ }
    return 240;
  }

  function applySidebarWidth(width) {
    document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    dom.sidebar.style.width = '';
    dom.sidebar.style.minWidth = '';
    // Persist
    try {
      localStorage.setItem('qcli-sidebar-width', String(width));
    } catch (e) { /* ignore */ }
  }

  // Restore saved width on load
  currentResizeWidth = getSidebarWidth();
  applySidebarWidth(currentResizeWidth);

  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      dom.sidebar.classList.add('dragging');
      resizeHandle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      if (resizeRAF) return;
      resizeRAF = requestAnimationFrame(() => {
        resizeRAF = null;
        let width = e.clientX;
        if (width < 160) width = 160;
        if (width > 480) width = 480;
        currentResizeWidth = width;
        document.documentElement.style.setProperty('--sidebar-width', width + 'px');
      });
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      if (resizeRAF) {
        cancelAnimationFrame(resizeRAF);
        resizeRAF = null;
      }
      dom.sidebar.classList.remove('dragging');
      resizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Use tracked width directly — no getComputedStyle needed
      applySidebarWidth(currentResizeWidth);

      // Re-fit terminal after sidebar width has settled
      requestAnimationFrame(() => {
        if (fitAddon) {
          try { fitAddon.fit(); } catch (e) { /* ignore */ }
          if (state.launched) {
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
            }
          }
        }
      });
    });
  }

  // ============================================================
  // Chat Drawer — Bottom Panel
  // ============================================================
  const chat = {
    open: false,
    messages: [],
    sending: false,
  };

  const chatEl = document.getElementById('chat-drawer');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatToggleBtn = document.getElementById('chat-toggle-btn');
  const chatCloseBtn = document.getElementById('chat-close-btn');
  const chatClearBtn = document.getElementById('chat-clear-btn');
  const chatResizeHandle = document.getElementById('chat-resize-handle');

  // ── Restore saved chat height ──
  function getChatHeight() {
    try {
      const saved = localStorage.getItem('qcli-chat-height');
      if (saved) {
        const h = parseInt(saved, 10);
        if (h >= 120 && h <= window.innerHeight * 0.7) return h;
      }
    } catch (e) { /* ignore */ }
    return 280;
  }

  function applyChatHeight(height) {
    if (chatEl) {
      chatEl.style.height = height + 'px';
    }
    try {
      localStorage.setItem('qcli-chat-height', String(height));
    } catch (e) { /* ignore */ }
    // Re-fit terminal after chat panel resizes
    requestAnimationFrame(() => {
      if (fitAddon) {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
        if (state.launched) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
          }
        }
      }
    });
  }

  // ── Toggle chat drawer ──
  function toggleChat() {
    chat.open = !chat.open;
    chatEl.classList.toggle('hidden', !chat.open);
    chatToggleBtn.classList.toggle('active', chat.open);

    // Re-fit terminal when chat opens/closes (flex layout naturally adjusts)
    requestAnimationFrame(() => {
      if (fitAddon) {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
        if (state.launched) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
          }
        }
      }
    });

    // Focus input when opening
    if (chat.open && chatInput) {
      setTimeout(() => chatInput.focus(), 100);
    }

    // Restore saved height when reopening
    if (chat.open) {
      applyChatHeight(getChatHeight());
    }

    try {
      localStorage.setItem('qcli-chat-open', chat.open ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  // ── Load messages from localStorage ──
  function loadChatHistory() {
    try {
      const saved = localStorage.getItem('qcli-chat-history');
      if (saved) {
        const msgs = JSON.parse(saved);
        if (Array.isArray(msgs) && msgs.length > 0) {
          chat.messages = msgs;
          // Remove welcome message since we have history
          const welcome = chatMessages.querySelector('.welcome-msg');
          if (welcome) welcome.remove();
          renderChatMessages();
        }
      }
    } catch (e) { /* ignore */ }
  }

  function saveChatHistory() {
    try {
      // Only save user + ai messages (not thinking indicators)
      const toSave = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant');
      localStorage.setItem('qcli-chat-history', JSON.stringify(toSave.slice(-50))); // keep last 50
    } catch (e) { /* ignore */ }
  }

  // ── Render all messages ──
  function renderChatMessages() {
    chatMessages.innerHTML = '';
    for (const msg of chat.messages) {
      appendMessageToDOM(msg, false);
    }
    scrollChatToBottom();
  }

  // ── Append a single message to DOM ──
  function appendMessageToDOM(msg, animate = true) {
    const div = document.createElement('div');
    div.className = 'chat-message' + (msg.role === 'user' ? ' user-message' : '');
    if (!animate) div.style.animation = 'none';

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar' + (msg.role === 'assistant' ? ' ai-avatar' : '');
    avatar.textContent = msg.role === 'user' ? '👤' : '🤖';
    div.appendChild(avatar);

    // Content
    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = msg.role === 'user' ? __('chat.sender.you') : __('chat.sender.ai');
    content.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble ' + (msg.role === 'user' ? 'user-bubble' : 'ai-bubble');
    bubble.textContent = msg.content;
    content.appendChild(bubble);

    div.appendChild(content);
    chatMessages.appendChild(div);
  }

  // ── Scroll messages to bottom ──
  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  // ── Auto-resize textarea ──
  function autoResizeTextarea() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  }

  // ── Send a message ──
  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || chat.sending) return;

    chat.sending = true;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    chatSendBtn.disabled = true;

    // Add user message
    const userMsg = { role: 'user', content: text };
    chat.messages.push(userMsg);
    appendMessageToDOM(userMsg);
    saveChatHistory();
    scrollChatToBottom();

    // Show thinking indicator
    showThinkingIndicator();
    scrollChatToBottom();

    // Real AI API call via ChatAPI (fallback to mock if unavailable)
    const api = window.QCLI?.ChatAPI;
    if (api) {
      api.isConfigured().then(configured => {
        if (!configured) {
          // No API key configured — use mock fallback
          removeThinkingIndicator();
          const mockResponses = [
            __('chat.response1'),
            __('chat.response2'),
            __('chat.response3'),
            __('chat.response4'),
          ];
          const aiMsg = {
            role: 'assistant',
            content: mockResponses[Math.floor(Math.random() * mockResponses.length)],
          };
          chat.messages.push(aiMsg);
          appendMessageToDOM(aiMsg);
          saveChatHistory();
          scrollChatToBottom();
          chat.sending = false;
          chatSendBtn.disabled = false;
          chatInput.focus();
          showUploadStatus(__('ai.needsKey'), 'info');
          return;
        }

        // Build messages array from chat history
        const msgs = chat.messages.map(m => ({
          role: m.role,
          content: m.content,
        }));

        let fullResponse = '';
        api.sendMessage({
          messages: msgs,
          onToken: (token) => {
            fullResponse += token;
            const indicator = document.getElementById('thinking-indicator');
            if (indicator) {
              const bubble = indicator.querySelector('.msg-bubble');
              if (bubble) {
                if (bubble.classList.contains('thinking')) {
                  bubble.classList.remove('thinking');
                  bubble.textContent = '';
                }
                bubble.textContent = fullResponse;
                scrollChatToBottom();
              }
            }
          },
          onDone: () => {
            removeThinkingIndicator();
            const aiMsg = { role: 'assistant', content: fullResponse };
            chat.messages.push(aiMsg);
            appendMessageToDOM(aiMsg);
            saveChatHistory();
            scrollChatToBottom();
            chat.sending = false;
            chatSendBtn.disabled = false;
            chatInput.focus();
          },
          onError: (err) => {
            removeThinkingIndicator();
            if (err === 'NEEDS_KEY') {
              showUploadStatus(__('ai.needsKey'), 'info');
            } else {
              showUploadStatus('AI Error: ' + err, 'error');
            }
            chat.sending = false;
            chatSendBtn.disabled = false;
            chatInput.focus();
          },
        });
      });
    } else {
      // ChatAPI not loaded — use mock fallback
      removeThinkingIndicator();
      const mockResponses = [
        __('chat.response1'),
        __('chat.response2'),
        __('chat.response3'),
        __('chat.response4'),
      ];
      const aiMsg = {
        role: 'assistant',
        content: mockResponses[Math.floor(Math.random() * mockResponses.length)],
      };
      chat.messages.push(aiMsg);
      appendMessageToDOM(aiMsg);
      saveChatHistory();
      scrollChatToBottom();
      chat.sending = false;
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }


  // ── Register functions on QCLI namespace for module access ──
  Q.Sidebar = Q.Sidebar || {};
  Q.Sidebar.renderCLIList = renderCLIList;
  Q.Sidebar.renderFolder = renderFolder;
  Q.Sidebar.createCLIElement = createCLIElement;
  Q.Sidebar.findFolderForCLI = findFolderForCLI;
  Q.Sidebar.moveCLIToFolder = moveCLIToFolder;
  Q.Sidebar.removeCLIFromAllFolders = removeCLIFromAllFolders;
  Q.Sidebar.finishRename = finishRename;
  Q.Sidebar.updateCLIState = updateCLIState;
  Q.Sidebar.getCLIIcon = getCLIIcon;
  Q.Tabs.getCLIIcon = getCLIIcon;

  Q.Sidebar.updateCategoryCounts = updateCategoryCounts;
  Q.Sidebar.filterCLIs = filterCLIs;
  Q.Sidebar.createFolder = createFolder;
  Q.Sidebar.deleteFolderOnServer = deleteFolderOnServer;
  Q.Sidebar.deleteCLI = deleteCLI;
  Q.Sidebar.launchCLI = launchCLI;
  Q.Sidebar.discoverCLIs = discoverCLIs;

  Q.Palette = Q.Palette || {};
  Q.Palette.openPalette = openPalette;
  Q.Palette.closePalette = closePalette;
  Q.Palette.open = false;
  Q.Palette.input = null;

  Q.Upload = Q.Upload || {};
  Q.Upload.openMediaPreview = openMediaPreview;
  Q.Upload.closeMediaPreview = closeMediaPreview;
  Q.Upload.navigateMedia = navigateMedia;
  Q.Upload.handleMediaClick = handleMediaClick;
  Q.Upload.formatFileSize = formatFileSize;

  Q.ChatUI = Q.ChatUI || {};
  Q.ChatUI.sendChatMessage = sendChatMessage;
  Q.ChatUI.toggleChat = toggleChat;
  Q.ChatUI.clearChatHistory = clearChatHistory;
  Q.ChatUI.appendMessageToDOM = appendMessageToDOM;
  Q.ChatUI.showThinkingIndicator = showThinkingIndicator;
  Q.ChatUI.removeThinkingIndicator = removeThinkingIndicator;
  Q.ChatUI.scrollChatToBottom = scrollChatToBottom;
  Q.ChatUI.open = chat.open;
  Q.ChatUI.messages = chat.messages;

  // Export showToast for submodules (pin-report, etc.)
  Q.showToast = showToast;
  Q.showUploadStatus = showUploadStatus;

  Q.Shortcuts = window.QCLI?.Shortcuts || {};

  // ── Welcome renderer — populates carousel with preset-specific data ──
  Q.Welcome = Q.Welcome || {};
  Q.Welcome.renderWelcome = renderWelcome;

  Q.Agents = window.QCLI?.Agents || {};
  Q.Workflows = window.QCLI?.Workflows || {};
  Q.Settings = window.QCLI?.Settings || {};


  // ── Thinking indicator ──
  function showThinkingIndicator() {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.id = 'thinking-indicator';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar ai-avatar';
    avatar.textContent = '🤖';
    div.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = __('chat.sender.ai');
    content.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble thinking';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'thinking-dot';
      bubble.appendChild(dot);
    }
    content.appendChild(bubble);

    div.appendChild(content);
    chatMessages.appendChild(div);
  }

  function removeThinkingIndicator() {
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
  }

  // ── Clear chat history ──
  function clearChatHistory() {
    if (!confirm(__('chat.clearConfirm'))) return;
    chat.messages = [];
    chatMessages.innerHTML = `
      <div class="chat-message welcome-msg">
        <div class="msg-avatar ai-avatar">🤖</div>
        <div class="msg-content">
          <div class="msg-sender">AI 助手</div>
          <div class="msg-bubble ai-bubble">你好！我是 Q-CLI 的 AI 助手。你可以问我关于 CLI 工具的问题，或者让我帮你分析终端输出。😊</div>
        </div>
      </div>
    `;
    saveChatHistory();
  }

  // ── Wire up events ──
  if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', toggleChat);
  }
  if (chatCloseBtn) {
    chatCloseBtn.addEventListener('click', toggleChat);
  }
  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', sendChatMessage);
  }
  if (chatClearBtn) {
    chatClearBtn.addEventListener('click', clearChatHistory);
  }
  if (chatInput) {
    chatInput.addEventListener('input', autoResizeTextarea);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
      // Escape to close chat
      if (e.key === 'Escape' && chat.open) {
        e.preventDefault();
        toggleChat();
        if (term) term.focus();
      }
    });
  }

  // ── Restore chat state ──
  applyChatHeight(getChatHeight());
  loadChatHistory();
  try {
    const wasOpen = localStorage.getItem('qcli-chat-open');
    if (wasOpen === '1') {
      toggleChat();
    }
  } catch (e) { /* ignore */ }

  // ── Chat resize handle ──
  let isChatResizing = false;
  let chatResizeRAF = null;
  let chatStartY = 0;
  let chatStartHeight = 280;

  if (chatResizeHandle) {
    chatResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isChatResizing = true;
      chatResizeHandle.classList.add('active');
      chatStartY = e.clientY;
      chatStartHeight = chatEl.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isChatResizing) return;
      if (chatResizeRAF) return;
      chatResizeRAF = requestAnimationFrame(() => {
        chatResizeRAF = null;
        const delta = chatStartY - e.clientY; // dragging up = larger
        let height = chatStartHeight + delta;
        const maxHeight = window.innerHeight * 0.7;
        height = Math.max(120, Math.min(maxHeight, height));
        chatEl.style.height = height + 'px';
      });
    });

    document.addEventListener('mouseup', () => {
      if (!isChatResizing) return;
      isChatResizing = false;
      if (chatResizeRAF) {
        cancelAnimationFrame(chatResizeRAF);
        chatResizeRAF = null;
      }
      chatResizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      applyChatHeight(chatEl.offsetHeight);

      // Re-fit terminal after resize
      requestAnimationFrame(() => {
        if (fitAddon) {
          try { fitAddon.fit(); } catch (e) { /* ignore */ }
          if (state.launched) {
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
            }
          }
        }
      });
    });
  }

  // ── Keyboard shortcut: Ctrl+I to toggle chat ──
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleChat();
    }
  });

  // ============================================================
  // Terminal focus
  // ============================================================
  dom.terminal.addEventListener('click', () => {
    if (term) term.focus();
  });

  // ============================================================
  // Keyboard shortcuts
  // ============================================================
  document.addEventListener('keydown', (e) => {
    // Command palette: Cmd+K / Ctrl+K (but not when typing in an input)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !e.repeat) {
      const tag = e.target.tagName;
      // Don't trigger if already in the palette input
      if (e.target === cp.input) return;
      e.preventDefault();
      if (cp.open) {
        closePalette();
      } else {
        openPalette();
      }
      return;
    }

    // Alternative: Ctrl+P (but not in inputs)
    if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.repeat && !cp.open) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.closest('.xterm-helper-textarea')) return;
      e.preventDefault();
      openPalette();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'r') {
      e.preventDefault();
      state.reconnectAttempts = 0;
      connectWS();
      loadCLIs();
    }

    // Ctrl+Shift+F → toggle terminal search bar
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f' && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.closest('.xterm-helper-textarea')) return;
      e.preventDefault();
      toggleSearchBar();
      return;
    }

    // Ctrl+Shift+H → open global command history
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'h' && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.closest('.xterm-helper-textarea')) return;
      e.preventDefault();
      if (document.getElementById('history-panel')?.classList.contains('hidden')) {
        openHistoryPanel();
      } else {
        closeHistoryPanel();
      }
      return;
    }

    // Ctrl+Shift+A → global search across all tabs
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'a' || e.key === 'A') && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.closest('.xterm-helper-textarea')) return;
      e.preventDefault();
      toggleGlobalSearch();
      return;
    }

    // Font zoom: Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+') && !e.repeat) {
      e.preventDefault();
      changeFontSize(1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_') && !e.repeat) {
      e.preventDefault();
      changeFontSize(-1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0' && !e.repeat) {
      e.preventDefault();
      changeFontSize(0);  // reset to default (14)
      return;
    }

    if (e.key === 'Escape') {
      if (!dom.addOverlay.classList.contains('hidden')) {
        hideAddModal();
      }
      if (searchBarVisible()) {
        hideSearchBar();
        e.preventDefault();
      }
    }
    // Ctrl+/ → toggle shortcut cheat sheet
    if ((e.ctrlKey || e.metaKey) && e.key === '/' && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (window.QCLI?.Shortcuts) {
        window.QCLI.Shortcuts.toggle();
      }
      return;
    }

    // Ctrl+Shift+S → open snippets panel
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S') && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.closest('.xterm-helper-textarea')) return;
      e.preventDefault();
      openSnippetPanel();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && state.launched) {
      e.preventDefault();
      if (term) term.reset();
    }
  });

  // ============================================================
  // Terminal Search Bar
  // ============================================================
  const $searchBar = document.getElementById('terminal-search-bar');
  const $searchInput = document.getElementById('terminal-search-input');
  const $searchResults = document.getElementById('terminal-search-results');
  const $searchPrev = document.getElementById('terminal-search-prev');
  const $searchNext = document.getElementById('terminal-search-next');
  const $searchClose = document.getElementById('terminal-search-close');

  function searchBarVisible() {
    return $searchBar && !$searchBar.classList.contains('hidden');
  }

  function toggleSearchBar() {
    if (searchBarVisible()) {
      hideSearchBar();
    } else {
      showSearchBar();
    }
  }

  function showSearchBar() {
    if (!$searchBar) return;
    $searchBar.classList.remove('hidden');
    $searchInput.value = '';
    $searchResults.textContent = '0/0';
    $searchInput.focus();
  }

  function hideSearchBar() {
    if (!$searchBar) return;
    $searchBar.classList.add('hidden');
    if (window.QCLI?.searchAddon) {
      window.QCLI.searchAddon.clearActiveSearch();
    }
    term?.focus();
  }

  function performSearch() {
    const query = $searchInput.value.trim();
    const addon = window.QCLI?.searchAddon;
    if (!addon || !query) {
      $searchResults.textContent = '';
      return;
    }
    // Reset and search from beginning
    addon.clearActiveSearch();
    const found = addon.findNext(query, { incremental: false });
    $searchResults.textContent = found ? '🔍 1+' : '✗';
  }

  function findNext() {
    const query = $searchInput.value.trim();
    const addon = window.QCLI?.searchAddon;
    if (!addon || !query) return;
    addon.findNext(query, { incremental: true });
  }

  function findPrevious() {
    const query = $searchInput.value.trim();
    const addon = window.QCLI?.searchAddon;
    if (!addon || !query) return;
    addon.findPrevious(query, { incremental: true });
  }

  if ($searchInput) {
    // Live search on input
    $searchInput.addEventListener('input', performSearch);
    // Enter → next
    $searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
      }
      if (e.key === 'Escape') {
        hideSearchBar();
      }
    });
  }
  $searchNext?.addEventListener('click', findNext);
  $searchPrev?.addEventListener('click', findPrevious);
  $searchClose?.addEventListener('click', hideSearchBar);

  // ============================================================
  // Voice Input — Web Speech API
  // ============================================================
  const voice = {
    recognition: null,
    active: false,
    finalText: '',
  };

  const $voiceBtn = document.getElementById('voice-input-btn');
  const $voiceStatus = document.getElementById('voice-status');
  const $voiceInterim = document.getElementById('voice-interim') || (() => {
    const el = document.createElement('div');
    el.id = 'voice-interim';
    el.className = 'hidden';
    document.body.appendChild(el);
    return el;
  })();

  /**
   * Initialise speech recognition if the browser supports it.
   * Returns false if unsupported.
   */
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      $voiceBtn.title = 'Speech recognition not supported in this browser';
      $voiceBtn.style.opacity = '0.3';
      $voiceBtn.style.cursor = 'not-allowed';
      return false;
    }

    voice.recognition = new SpeechRecognition();
    voice.recognition.continuous = true;
    voice.recognition.interimResults = true;
    voice.recognition.lang = navigator.language || 'en-US';

    voice.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          voice.finalText += transcript;
          // Send final result to the terminal as input
          if (state.launched && transcript.trim()) {
            wsSend({ type: 'input', data: transcript.trim() + '\n' });
          }
        } else {
          interim += transcript;
        }
      }

      // Show interim result below the terminal
      if (interim) {
        $voiceInterim.innerHTML = `<span class="interim-label">🎤</span>${escapeHtml(interim)}`;
        $voiceInterim.classList.remove('hidden');
      } else if (!voice.active) {
        $voiceInterim.classList.add('hidden');
      }
    };

    voice.recognition.onerror = (event) => {
      console.warn('[Voice] Error:', event.error);
      if (event.error === 'no-speech') {
        // Restart silently
        try { voice.recognition.start(); } catch (e) { /* ignore */ }
        return;
      }
      if (event.error === 'aborted') return;
      stopVoiceInput();
      showToast(`Voice error: ${event.error}`, 'error');
    };

    voice.recognition.onend = () => {
      // Auto-restart if still recording
      if (voice.active && voice.recognition) {
        try {
          voice.recognition.start();
        } catch (e) {
          stopVoiceInput();
        }
      }
    };

    return true;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function toggleVoiceInput() {
    if (!voice.recognition) {
      if (!initSpeechRecognition()) {
        showToast('Speech recognition not available in this browser. Try Chrome or Edge.', 'error');
        return;
      }
    }

    if (voice.active) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  }

  function startVoiceInput() {
    if (!voice.recognition) return;

    // Request microphone permission implicitly via start()
    try {
      voice.active = true;
      voice.finalText = '';
      voice.recognition.start();
      $voiceBtn.classList.add('recording');
      $voiceStatus.classList.remove('hidden');
      $voiceStatus.querySelector('.voice-text').textContent = 'Listening...';
      showToast('Voice input active — speak your command', 'info');
      if (term) term.focus();
    } catch (e) {
      voice.active = false;
      showToast('Could not start microphone. Check permissions.', 'error');
      $voiceBtn.classList.remove('recording');
      $voiceStatus.classList.add('hidden');
    }
  }

  function stopVoiceInput() {
    try {
      if (voice.recognition) {
        voice.recognition.stop();
      }
    } catch (e) { /* ignore */ }
    voice.active = false;
    voice.finalText = '';
    $voiceBtn.classList.remove('recording');
    $voiceStatus.classList.add('hidden');
    $voiceInterim.classList.add('hidden');
  }

  // Wire up the voice button
  if ($voiceBtn) {
    $voiceBtn.addEventListener('click', toggleVoiceInput);
    // Initialise early to detect support (but don't start listening)
    initSpeechRecognition();
  }

  // Cleanup microphone on page unload
  window.addEventListener('beforeunload', () => {
    if (voice.active) stopVoiceInput();
  });

  // ============================================================
  // Theme Switching
  // ============================================================
  const DARK_THEME = {
    background: '#0d0e10',
    foreground: '#e4e4e7',
    cursor: '#e4e4e7',
    cursorAccent: '#0d0e10',
    selection: 'rgba(99,102,241,0.3)',
    black: '#18181b', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
    blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e4e4e7',
    brightBlack: '#71717a', brightRed: '#f87171', brightGreen: '#4ade80',
    brightYellow: '#facc15', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
    brightCyan: '#67e8f9', brightWhite: '#fafafa',
  };

  const LIGHT_THEME = {
    background: '#fafafa',
    foreground: '#18181b',
    cursor: '#18181b',
    cursorAccent: '#fafafa',
    selection: 'rgba(99,102,241,0.2)',
    black: '#e4e4e7', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
    blue: '#6366f1', magenta: '#7c3aed', cyan: '#0891b2', white: '#18181b',
    brightBlack: '#a1a1aa', brightRed: '#ef4444', brightGreen: '#22c55e',
    brightYellow: '#eab308', brightBlue: '#818cf8', brightMagenta: '#a78bfa',
    brightCyan: '#22d3ee', brightWhite: '#09090b',
  };

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem('qcli-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* ignore */ }
    // Respect system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    dom.themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
    dom.themeToggle.title = theme === 'dark' ? '切换到亮色主题' : '切换到深色主题';

    // Sync xterm.js theme
    if (term) {
      const xtermTheme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
      term.options.theme = xtermTheme;
      // Force re-render
      try { term.refresh(0, term.rows - 1); } catch (e) { /* ignore */ }
    }

    // Persist preference
    try {
      localStorage.setItem('qcli-theme', theme);
    } catch (e) { /* ignore */ }
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // Listen for system theme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      // Only auto-switch if user hasn't manually set a preference
      try {
        if (!localStorage.getItem('qcli-theme')) {
          applyTheme(e.matches ? 'light' : 'dark');
        }
      } catch (err) { /* ignore */ }
    });
  }

  // ============================================================
  // Command Palette (Cmd+K)
  // ============================================================
  const COMMAND_ACTIONS = [
    { id: 'add-cli', icon: '➕', name: 'Add CLI', desc: 'Register a new CLI tool', category: 'action' },
    { id: 'discover', icon: '⟳', name: 'Discover CLIs', desc: 'Scan PATH for new CLI tools', category: 'action' },
    { id: 'toggle-theme', icon: '🎨', name: 'Toggle Theme', desc: 'Switch between dark and light mode', category: 'action' },
    { id: 'toggle-sidebar', icon: '📐', name: 'Toggle Sidebar', desc: 'Collapse or expand the sidebar', category: 'action' },
    { id: 'reconnect', icon: '🔌', name: 'Reconnect', desc: 'Re-establish WebSocket connection', category: 'action' },
    { id: 'clear-terminal', icon: '🧹', name: 'Clear Terminal', desc: 'Reset the terminal display', category: 'action' },
    { id: 'reset-font', icon: '🔤', name: 'Reset Font Size', desc: 'Restore default terminal font size (14px)', category: 'action' },
    { id: 'custom-css', icon: '🎨', name: 'Custom CSS', desc: 'Open the custom CSS editor to override styles', category: 'action' },
    { id: 'open-settings', icon: '⚙️', name: 'Settings', desc: 'Open the settings panel', category: 'action' },
    { id: 'open-history', icon: '📜', name: 'Command History', desc: 'Browse global command history (Ctrl+Shift+H)', category: 'action' },
    { id: 'open-snippets', icon: '📋', name: 'Snippet Library', desc: 'Manage command snippets', category: 'action' },
    { id: 'open-workspaces', icon: '📂', name: 'Workspace Profiles', desc: 'Save and restore tab configurations', category: 'action' },
  ]


  // Snippet cache for command palette (loaded synchronously)
  let _snippetCache = [];

  // Load snippets into cache periodically
  async function _refreshSnippetCache() {
    try {
      if (window.QCLI?.SnippetStore) {
        _snippetCache = await window.QCLI.SnippetStore.getAll() || [];
      }
    } catch (e) { _snippetCache = []; }
  }
  // Initial load
  _refreshSnippetCache();

  const cp = {
    overlay: null,
    input: null,
    results: null,
    items: [],
    selectedIndex: -1,
    open: false,
  };

  function initCommandPalette() {
    cp.overlay = document.getElementById('cp-overlay');
    cp.input = document.getElementById('cp-input');
    cp.results = document.getElementById('cp-results');

    if (!cp.overlay) return;

    // Close on overlay click (don't steal focus)
    cp.overlay.addEventListener('click', (e) => {
      if (e.target === cp.overlay) closePalette(false);
    });

    // Input filtering
    cp.input.addEventListener('input', () => renderPaletteResults());

    // Keyboard navigation within palette
    cp.input.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          navigatePalette(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          navigatePalette(-1);
          break;
        case 'Enter':
          e.preventDefault();
          executePaletteSelection();
          break;
        case 'Escape':
          e.preventDefault();
          closePalette(true); // Restore terminal focus
          break;
      }
    });
  }

  function openPalette() {
    if (!cp.overlay) return;
    if (cp.open) return;
    cp.overlay.classList.remove('hidden');
    cp.input.value = '';
    cp.selectedIndex = -1;
    cp.items = [];
    renderPaletteResults();
    // Focus on next tick so the element is definitely in DOM
    requestAnimationFrame(() => cp.input.focus());
    cp.open = true;
  }

  function closePalette(focusTerminal) {
    if (!cp.overlay) return;
    if (!cp.open) return;
    cp.overlay.classList.add('hidden');
    cp.open = false;
    cp.selectedIndex = -1;
    // Only re-focus terminal when explicitly requested (e.g. Escape press)
    // Don't auto-focus when an action handler manages its own focus (e.g. Add CLI modal)
    if (focusTerminal && term) {
      setTimeout(() => term.focus(), 0);
    }
  }

  function buildPaletteItems() {
    const items = [];

    // Add static actions
    for (const action of COMMAND_ACTIONS) {
      items.push({ type: 'action', ...action });
    }

    // Add CLI items
    for (const cli of state.clis) {
      items.push({
        type: 'cli',
        id: cli.id,
        icon: getCLIIcon(cli.name),
        name: cli.name,
        desc: cli.version && cli.version !== 'unknown' ? `v${cli.version}` : (cli.type || 'CLI'),
        category: cli.category || 'tool',
      });
    }

    return items;
  }

  function renderPaletteResults() {
    const query = cp.input.value.toLowerCase().trim();
    let items = buildPaletteItems();

    if (query) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(query) ||
        (item.desc && item.desc.toLowerCase().includes(query))
      );
    }

    cp.results.innerHTML = '';

    if (items.length === 0) {
      cp.results.innerHTML = `<div class="cp-empty">No results for &quot;${cp.input.value}&quot;</div>`;
      cp.items = [];
      cp.selectedIndex = -1;
      return;
    }

    cp.items = items;
    if (cp.selectedIndex >= items.length) cp.selectedIndex = items.length - 1;
    if (cp.selectedIndex < 0 && items.length > 0) cp.selectedIndex = 0;

    // Group by type: actions first, then CLIs
    const actionItems = items.filter(i => i.type === 'action');
    const cliItems = items.filter(i => i.type === 'cli');

    const fragment = document.createDocumentFragment();

    if (actionItems.length > 0) {
      const label = document.createElement('div');
      label.className = 'cp-section-label';
      label.textContent = 'Actions';
      fragment.appendChild(label);

      for (const item of actionItems) {
        fragment.appendChild(createPaletteItemEl(item));
      }
    }

    if (cliItems.length > 0) {
      const label = document.createElement('div');
      label.className = 'cp-section-label';
      label.textContent = `CLIs (${cliItems.length})`;
      fragment.appendChild(label);

      for (const item of cliItems) {
        fragment.appendChild(createPaletteItemEl(item));
      }
    }

    cp.results.appendChild(fragment);
    updatePaletteHighlight();
    scrollToSelected();
  }

  function createPaletteItemEl(item) {
    const el = document.createElement('div');
    el.className = 'cp-item';
    el.dataset.index = cp.items.indexOf(item);

    // Icon
    const icon = document.createElement('span');
    icon.className = 'cp-item-icon';
    icon.textContent = item.icon || '\u25b8';
    el.appendChild(icon);

    // Body
    const body = document.createElement('div');
    body.className = 'cp-item-body';

    const name = document.createElement('div');
    name.className = 'cp-item-name';
    name.textContent = item.name;
    body.appendChild(name);

    if (item.desc) {
      const desc = document.createElement('div');
      desc.className = 'cp-item-desc';
      desc.textContent = item.desc;
      body.appendChild(desc);
    }

    el.appendChild(body);

    // Badge
    const badge = document.createElement('span');
    badge.className = `cp-item-badge ${item.type === 'action' ? 'action' : item.category}`;
    badge.textContent = item.type === 'action' ? 'Cmd' : getCategoryLabel(item.category);
    el.appendChild(badge);

    // Click to execute
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      if (idx >= 0) {
        cp.selectedIndex = idx;
        executePaletteSelection();
      }
    });

    // Hover updates selection
    el.addEventListener('mouseenter', () => {
      const idx = parseInt(el.dataset.index);
      if (idx >= 0) {
        cp.selectedIndex = idx;
        updatePaletteHighlight();
      }
    });

    return el;
  }

  function navigatePalette(direction) {
    if (cp.items.length === 0) return;
    cp.selectedIndex += direction;
    if (cp.selectedIndex < 0) cp.selectedIndex = cp.items.length - 1;
    if (cp.selectedIndex >= cp.items.length) cp.selectedIndex = 0;
    updatePaletteHighlight();
    scrollToSelected();
  }

  function updatePaletteHighlight() {
    const all = cp.results.querySelectorAll('.cp-item');
    all.forEach((el, i) => {
      el.classList.toggle('highlighted', i === cp.selectedIndex);
    });
  }

  function scrollToSelected() {
    const highlighted = cp.results.querySelector('.cp-item.highlighted');
    if (highlighted) {
      try { highlighted.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }

  function executePaletteSelection() {
    if (cp.selectedIndex < 0 || cp.selectedIndex >= cp.items.length) return;
    const item = cp.items[cp.selectedIndex];
    closePalette();

    switch (item.type) {
      case 'cli':
        launchCLI(item.id);
        break;
      case 'action':
        switch (item.id) {
          case 'add-cli':
            showAddModal();
            break;
          case 'discover':
            discoverCLIs();
            break;
          case 'toggle-theme':
            toggleTheme();
            break;
          case 'toggle-sidebar':
            toggleSidebar();
            break;
          case 'reconnect':
            state.reconnectAttempts = 0;
            connectWS();
            loadCLIs();
            break;
          case 'clear-terminal':
            if (term) term.reset();
            break;
          case 'reset-font':
            changeFontSize(0);
            break;
          case 'custom-css':
            if (window.QCLI?.CustomCSS) window.QCLI.CustomCSS.open();
            break;
          case 'open-settings':
            if (window.QCLI?.Settings) window.QCLI.Settings.open();
            break;
          case 'open-history':
            openHistoryPanel();
            break;
          case 'open-snippets':
            openSnippetPanel();
            break;
          case 'open-workspaces':
            openWorkspacePanel();
            break;
        }
        break;
    }
  }

  // ============================================================
  // Restore saved font size after terminal is initialized
  function restoreFontSize() {
    if (!term) return;
    try {
      const saved = localStorage.getItem('qcli-font-size');
      if (saved) {
        const size = parseInt(saved, 10);
        if (size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX && size !== 14) {
          term.options.fontSize = size;
        }
      }
    } catch (e) { /* ignore */ }
    updateFontSizeDisplay();
  }

  // ============================================================
  // ============================================================
  // Welcome Renderer — Populate carousel slides from preset welcome data
  // ============================================================
  function renderWelcome(welcome) {
    if (!welcome) return;

    // Slide 0: Quick Start cards
    const grid = document.getElementById('welcome-grid');
    if (grid && welcome.quickStart) {
      grid.innerHTML = '';
      for (const step of welcome.quickStart) {
        const card = document.createElement('div');
        card.className = 'welcome-card';
        card.innerHTML = '<div class="card-icon">' + step.icon + '</div><div class="card-body"><strong>' + step.title + '</strong><span>' + step.desc + '</span></div>';
        grid.appendChild(card);
      }
    }

    // Slide 0: Features
    const features = document.getElementById('welcome-features');
    if (features && welcome.features) {
      features.innerHTML = '';
      for (const feat of welcome.features) {
        const card = document.createElement('div');
        card.className = 'feature-card';
        card.innerHTML = '<div class="feature-icon" style="color:' + (feat.iconColor || '#6366f1') + '">' + feat.icon + '</div><div class="feature-body"><strong>' + feat.title + '</strong><span>' + feat.desc + '</span></div>';
        features.appendChild(card);
      }
    }

    // Slide 1: Shortcuts
    const shortcuts = document.getElementById('welcome-shortcuts');
    if (shortcuts && welcome.shortcuts) {
      shortcuts.innerHTML = '';
      for (const sc of welcome.shortcuts) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        row.innerHTML = '<span class="shortcut-key">' + sc.key + '</span><span class="shortcut-arrow">→</span><span class="shortcut-desc">' + sc.desc + '</span>';
        shortcuts.appendChild(row);
      }
    }

    // Slide 1: Tips
    const tips = document.getElementById('welcome-tips');
    if (tips && welcome.tips) {
      tips.innerHTML = '';
      for (const tip of welcome.tips) {
        const li = document.createElement('li');
        li.innerHTML = tip;
        tips.appendChild(li);
      }
    }

    // Slide 2: Install tools
    const install = document.getElementById('welcome-install');
    if (install && welcome.installTools) {
      install.innerHTML = '';
      for (const tool of welcome.installTools) {
        const card = document.createElement('div');
        card.className = 'install-card';
        const header = document.createElement('div');
        header.className = 'install-header';
        header.innerHTML = '<span class="install-icon" style="color:' + (tool.iconColor || '#6366f1') + '">' + tool.icon + '</span><div><strong>' + tool.name + '</strong><span class="install-desc">' + tool.desc + '</span></div>';
        card.appendChild(header);
        const body = document.createElement('div');
        body.className = 'install-body';
        if (tool.methods) {
          for (const method of tool.methods) {
            const m = document.createElement('div');
            m.className = 'install-method';
            m.innerHTML = '<span class="method-label">' + method.label + '</span><code class="install-code">' + method.code + '</code>';
            body.appendChild(m);
          }
        }
        card.appendChild(body);
        install.appendChild(card);
      }
    }

    // Reset carousel to first slide after content update
    const track = document.getElementById('carousel-track');
    const dots = document.querySelectorAll('.carousel-dot');
    if (track && dots.length > 0) {
      track.style.transform = 'translateX(0)';
      dots.forEach(function(d, i) { d.classList.toggle('active', i === 0); });
    }
  }

  // Welcome Carousel — Manual slideshow (no auto-scroll)
  // ============================================================
  function initWelcomeCarousel() {
    const track = document.getElementById('carousel-track');
    const slides = track ? track.querySelectorAll('.carousel-slide') : [];
    const dots = document.querySelectorAll('.carousel-dot');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const carouselEl = document.getElementById('welcome-carousel');

    if (!track || slides.length === 0) return;

    let current = 0;

    function goToSlide(index) {
      if (index < 0) index = slides.length - 1;
      if (index >= slides.length) index = 0;
      current = index;
      track.style.transform = `translateX(-${current * 100}%)`;

      // Update dots
      dots.forEach(d => d.classList.toggle('active', parseInt(d.dataset.slide) === current));
    }

    function nextSlide() { goToSlide(current + 1); }
    function prevSlide() { goToSlide(current - 1); }

    // ── Wire up controls ──
    if (prevBtn) prevBtn.addEventListener('click', prevSlide);
    if (nextBtn) nextBtn.addEventListener('click', nextSlide);

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const idx = parseInt(dot.dataset.slide);
        if (!isNaN(idx)) goToSlide(idx);
      });
    });

    // ── Keyboard navigation within carousel ──
    if (carouselEl) {
      carouselEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { prevSlide(); e.preventDefault(); }
        if (e.key === 'ArrowRight') { nextSlide(); e.preventDefault(); }
      });
      if (!carouselEl.getAttribute('tabindex')) {
        carouselEl.setAttribute('tabindex', '-1');
      }
    }

    // Start at slide 0 (快速开始)
    goToSlide(0);
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    initTerminal();
    setupCategoryFilters();
    initCommandPalette();
    // Apply saved/system theme BEFORE connecting (so terminal gets correct colors)
    // Wire up custom CSS button
    const cssBtn = document.getElementById('custom-css-btn');
    if (cssBtn && window.QCLI?.CustomCSS) {
      cssBtn.addEventListener('click', () => window.QCLI.CustomCSS.open());
    }

        // Wire up settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn && window.QCLI?.Settings) {
      settingsBtn.addEventListener('click', () => window.QCLI.Settings.open());
    }

    // Wire up AI settings button
    const aiSettingsBtn = document.getElementById('ai-settings-btn');
    const aiSettingsOverlay = document.getElementById('ai-settings-overlay');
    const aiSettingsForm = document.getElementById('ai-settings-form');
    const aiSettingsCancel = document.getElementById('ai-settings-cancel');
    const aiSettingsStatus = document.getElementById('ai-settings-status');

    if (aiSettingsBtn && aiSettingsOverlay) {
      aiSettingsBtn.addEventListener('click', () => {
        // Pre-fill saved values
        const savedProvider = window.QCLI?.ChatAPI?.getProvider() || 'openai';
        const savedKey = window.QCLI?.ChatAPI?.getApiKey() || '';
        const savedModel = window.QCLI?.ChatAPI?.getModel() || '';
        const savedBaseUrl = window.QCLI?.ChatAPI?.getBaseUrl() || '';
        const provEl = document.getElementById('ai-provider');
        const keyEl = document.getElementById('ai-api-key');
        const modelEl = document.getElementById('ai-model');
        const baseUrlEl = document.getElementById('ai-base-url');
        if (provEl) provEl.value = savedProvider;
        if (keyEl) keyEl.value = savedKey;
        if (modelEl) modelEl.value = savedModel;
        if (baseUrlEl) baseUrlEl.value = savedBaseUrl;
        if (aiSettingsStatus) { aiSettingsStatus.classList.add('hidden'); aiSettingsStatus.textContent = ''; }
        aiSettingsOverlay.classList.remove('hidden');
      });

      // Close on overlay click
      aiSettingsOverlay.addEventListener('click', (e) => {
        if (e.target === aiSettingsOverlay) aiSettingsOverlay.classList.add('hidden');
      });
    }

    // Handle AI settings form submit
    if (aiSettingsForm && aiSettingsCancel) {
      aiSettingsCancel.addEventListener('click', () => {
        aiSettingsOverlay.classList.add('hidden');
      });

      aiSettingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const provEl = document.getElementById('ai-provider');
        const keyEl = document.getElementById('ai-api-key');
        const modelEl = document.getElementById('ai-model');
        const baseUrlEl = document.getElementById('ai-base-url');
        const provider = provEl ? provEl.value : 'openai';
        const apiKey = keyEl ? keyEl.value.trim() : '';
        const model = modelEl ? modelEl.value.trim() : '';
        const baseUrl = baseUrlEl ? baseUrlEl.value.trim() : '';

        if (window.QCLI?.ChatAPI) {
          window.QCLI.ChatAPI.setProvider(provider);
          window.QCLI.ChatAPI.setApiKey(apiKey);
          window.QCLI.ChatAPI.setModel(model);
          window.QCLI.ChatAPI.setBaseUrl(baseUrl);
        }

        if (aiSettingsStatus) {
          aiSettingsStatus.textContent = apiKey ? '✅ API Key 已保存' : '⚠️ 未设置 API Key，将使用环境变量或模拟回复';
          aiSettingsStatus.className = 'ai-status';
          aiSettingsStatus.classList.remove('hidden');
        }

        setTimeout(() => {
          aiSettingsOverlay.classList.add('hidden');
        }, 1500);
      });
    }

    // Load workflows
    if (window.QCLI?.Workflows?.loadWorkflows) {
      window.QCLI.Workflows.loadWorkflows();
    }
    // Load AI agents
    if (window.QCLI?.Agents?.loadAgents) {
      window.QCLI.Agents.loadAgents();
    }

    // ── New Feature: Init all stores and UI ──
    // Request notification permission (feature 1)
    requestNotificationPermission();

    // Render pinned output (feature 3) — only if PinnedSection exists
    renderPinnedList();

    // Wire up terminal context menu
    const ctxMenu = document.getElementById('terminal-context-menu');
    if (ctxMenu) {
      document.addEventListener('click', (e) => {
        if (!ctxMenu.contains(e.target)) hideContextMenu();
      });
      document.getElementById('ctx-copy')?.addEventListener('click', copySelection);
      document.getElementById('ctx-pin')?.addEventListener('click', pinSelectedOutput);
      document.getElementById('ctx-search-sel')?.addEventListener('click', searchSelection);
      document.getElementById('ctx-paste')?.addEventListener('click', pasteClipboard);
      document.getElementById('ctx-clear')?.addEventListener('click', () => {
        hideContextMenu();
        if (term) term.reset();
      });
      document.getElementById('ctx-search')?.addEventListener('click', () => {
        hideContextMenu();
        showSearchBar();
      });
    }

    // Wire up pinned clear button
    document.getElementById('pinned-clear-btn')?.addEventListener('click', async () => {
      const store = window.QCLI?.PinStore;
      if (store) {
        await store.clear();
        await renderPinnedList();
        showToast('已清除所有固定输出', 'info');
      }
    });
    // Wire report panel and export buttons
    document.getElementById('pinned-report-btn')?.addEventListener('click', () => {
      if (window.QCLI?.PinReport?.openReportPanel) {
        window.QCLI.PinReport.openReportPanel();
      }
    });
    document.getElementById('pin-report-export-btn')?.addEventListener('click', () => {
      if (window.QCLI?.PinReport?.exportPinsToMarkdown) {
        window.QCLI.PinReport.exportPinsToMarkdown();
      }
    });

    // Wire up history panel events (feature 2)
    const historySearch = document.getElementById('history-search-input');
    if (historySearch) {
      historySearch.addEventListener('input', () => {
        renderHistoryList(historySearch.value);
      });
    }
    document.getElementById('history-close-btn')?.addEventListener('click', closeHistoryPanel);
    document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
      const store = window.QCLI?.HistoryStore;
      if (store) {
        if (confirm('确定清除所有命令历史？')) {
          await store.clear();
          await renderHistoryList('');
        }
      }
    });
    // Close on bg click
    document.getElementById('history-panel')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('history-panel') || e.target === document.getElementById('history-panel-bg')) {
        closeHistoryPanel();
      }
    });

    // Wire up snippet panel (feature 4)
    document.getElementById('snippet-close-btn')?.addEventListener('click', closeSnippetPanel);
    document.getElementById('snippet-add-btn')?.addEventListener('click', () => {
      document.getElementById('add-snippet-modal')?.classList.remove('hidden');
      document.getElementById('snippet-name')?.focus();
    });
    // Close on bg click
    document.getElementById('snippet-overlay')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('snippet-overlay') || e.target === document.getElementById('snippet-overlay-bg')) {
        closeSnippetPanel();
      }
    });

    // Wire up add snippet form
    const snippetForm = document.getElementById('add-snippet-form');
    if (snippetForm) {
      snippetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('snippet-name')?.value?.trim();
        const command = document.getElementById('snippet-command')?.value?.trim();
        const desc = document.getElementById('snippet-desc')?.value?.trim();
        if (!name || !command) {
          document.getElementById('add-snippet-error').textContent = '名称和命令不能为空';
          document.getElementById('add-snippet-error').classList.remove('hidden');
          return;
        }
        const store = window.QCLI?.SnippetStore;
        if (store) {
          await store.add(name, command, desc);
          document.getElementById('add-snippet-modal')?.classList.add('hidden');
          document.getElementById('add-snippet-error')?.classList.add('hidden');
          snippetForm.reset();
          showToast(`📋 已添加片段 "${name}"`, 'success');
          await renderSnippetList();
          await _refreshSnippetCache();
        }
      });
      document.getElementById('add-snippet-cancel')?.addEventListener('click', () => {
        document.getElementById('add-snippet-modal')?.classList.add('hidden');
        document.getElementById('add-snippet-error')?.classList.add('hidden');
      });
    }

    // Wire up workspace panel (feature 5)
    document.getElementById('workspace-close-btn')?.addEventListener('click', closeWorkspacePanel);
    document.getElementById('workspace-save-btn')?.addEventListener('click', async () => {
      const tabs = window.QCLI?.Tabs;
      if (!tabs || tabs.tabs.length === 0) {
        showToast('没有可保存的 tab。请先启动一些 CLI。', 'info');
        return;
      }
      const name = prompt('工作区名称:');
      if (!name || !name.trim()) return;
      const store = window.QCLI?.WorkspaceStore;
      if (store) {
        await store.save(name.trim(), tabs.tabs);
        showToast(`💾 已保存工作区 "${name.trim()}"`, 'success');
        await renderWorkspaceList();
      }
    });
    // Close on bg click
    document.getElementById('workspace-overlay')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('workspace-overlay') || e.target === document.getElementById('workspace-overlay-bg')) {
        closeWorkspacePanel();
      }
    });

    // Wire up Ctrl+... snippet keyboard shortcut
    document.addEventListener('keydown', function snippetEsc(e) {
      const addModal = document.getElementById('add-snippet-modal');
      if (addModal && !addModal.classList.contains('hidden') && e.key === 'Escape') {
        addModal.classList.add('hidden');
        document.getElementById('add-snippet-error')?.classList.add('hidden');
      }
    });
    // Apply saved/system theme BEFORE connecting (so terminal gets correct colors)
    applyTheme(getPreferredTheme());
    dom.themeToggle.addEventListener('click', toggleTheme);
    // Restore saved language preference
    try {
      const savedLang = localStorage.getItem("qcli-lang");
      if (savedLang === "en" || savedLang === "zh") {
        _locale.current = savedLang;
      }
    } catch (e) { /* ignore */ }

    // Wire up language toggle button
    const langBtn = document.getElementById("lang-toggle-btn");
    if (langBtn) {
      langBtn.textContent = _locale.current === "zh" ? "中" : "EN";
      langBtn.title = __("lang.switch");
      langBtn.addEventListener("click", function() {
        const newLang = _locale.current === "zh" ? "en" : "zh";
        setLanguage(newLang);
      });
    }
    // Initialize welcome carousel
    initWelcomeCarousel();
    // Apply saved language
    applyLanguage();
    // Show global progress bar on initial load
    showProgressBar();
    connectWS();
    loadCLIs();
    checkSavedSessions();
    // Heartbeat is started by connectWS() → ws.onopen, not here
  }

  // ── Expose for settings module ──
  window.QCLI.onDefaultCLIChanged = function(val) {
    console.log('[DefaultCLI] Changed to:', val || '(none)');
  };

  /**
   * Auto-launch the default CLI if configured.
   * Called after connection is established and session restore is resolved.
   */
  function launchDefaultCLI() {
    if (state.launched || state.launching) return;
    const defaultCliId = localStorage.getItem('qcli-default-cli');
    if (!defaultCliId) return;
    const cliObj = state.clis?.find(c => c.id === defaultCliId);
    if (!cliObj) return;
    console.log('[DefaultCLI] Auto-launching', defaultCliId);
    launchCLI(defaultCliId);
  }

  // ============================================================
  // Session Restore — Check for saved terminal tabs
  // ============================================================
  async function checkSavedSessions() {
    // Wait for CLIs to finish loading
    await new Promise(r => setTimeout(r, 500));
    if (!window.QCLI?.SessionStore) return;
    try {
      const sessions = await window.QCLI.SessionStore.loadAllSessions();
      if (!sessions || sessions.length === 0) {
        // No saved sessions — auto-launch default CLI
        launchDefaultCLI();
        return;
      }

      const overlay = document.getElementById("session-restore-overlay");
      const list = document.getElementById("session-restore-list");
      const countEl = document.getElementById("session-restore-count");
      if (!overlay || !list) return;

      // Update count
      if (countEl) countEl.textContent = sessions.length + " tab" + (sessions.length > 1 ? "s" : "");

      // Populate list
      list.innerHTML = "";
      sessions.forEach((session) => {
        const item = document.createElement("div");
        item.className = "session-restore-item selected";
        item.dataset.tabId = session.tabId;

        // Icon
        const icon = document.createElement("span");
        icon.className = "sr-item-icon";
        icon.textContent = session.icon || "▶";
        item.appendChild(icon);

        // Info
        const info = document.createElement("div");
        info.className = "sr-item-info";

        const name = document.createElement("div");
        name.className = "sr-item-name";
        name.textContent = session.name || session.cliId || "Terminal";
        info.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "sr-item-meta";

        const timeStr = session.timestamp ? formatSessionTime(new Date(session.timestamp)) : "";
        const timeSpan = document.createElement("span");
        timeSpan.className = "sr-item-time";
        timeSpan.textContent = timeStr;
        meta.appendChild(timeSpan);

        const bufSize = session.buffer ? session.buffer.length : 0;
        const sizeSpan = document.createElement("span");
        sizeSpan.textContent = bufSize > 0 ? (bufSize / 1024).toFixed(0) + "KB" : "(empty)";
        sizeSpan.style.cssText = "font-size:9px;opacity:0.5";
        meta.appendChild(sizeSpan);

        info.appendChild(meta);
        item.appendChild(info);

        // Checkbox
        const checkbox = document.createElement("span");
        checkbox.className = "sr-item-checkbox";
        checkbox.textContent = "✓";
        item.appendChild(checkbox);

        // Click to toggle selection
        item.addEventListener("click", () => {
          item.classList.toggle("selected");
          const check = item.querySelector(".sr-item-checkbox");
          if (check) {
            check.textContent = item.classList.contains("selected") ? "✓" : "";
          }
        });

        list.appendChild(item);
      });

      // Wire up buttons
      const ignoreBtn = document.getElementById("session-restore-ignore");
      const restoreBtn = document.getElementById("session-restore-all");

      if (ignoreBtn) {
        ignoreBtn.onclick = () => {
          overlay.classList.add("hidden");
          // Auto-launch default CLI when user dismisses session restore
          launchDefaultCLI();
        };
      }

      if (restoreBtn) {
        restoreBtn.onclick = () => {
          const selectedItems = list.querySelectorAll(".session-restore-item.selected");
          const selectedSessions = [];
          selectedItems.forEach(el => {
            const s = sessions.find(sess => sess.tabId === el.dataset.tabId);
            if (s) selectedSessions.push(s);
          });

          if (selectedSessions.length > 0 && window.QCLI?.Tabs) {
            window.QCLI.Tabs.restoreSessions(selectedSessions);
            // Set pending init for each restored tab
            for (const s of selectedSessions) {
              if (s.init) _pendingInit.set(s.cliId, s.init);
            }
          }
          overlay.classList.add("hidden");
          if (window.QCLI?.SessionStore) {
            window.QCLI.SessionStore.clearAllSessions();
          }
        };
      }

      // Show overlay
      overlay.classList.remove("hidden");
    } catch (e) {
      console.warn("[SessionStore] Check error:", e.message);
    }
  }

  function formatSessionTime(date) {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return diffMin + "m ago";
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + "h ago";
    const diffDay = Math.floor(diffHr / 24);
    return diffDay + "d ago";
  }

  // Spin animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);


  // ============================================================
  // Global Command History Panel (Ctrl+Shift+H)
  // ============================================================
  async function openHistoryPanel() {
    const panel = document.getElementById('history-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    await renderHistoryList('');
    const searchInput = document.getElementById('history-search-input');
    if (searchInput) {
      searchInput.value = '';
      setTimeout(() => searchInput.focus(), 100);
    }
  }

  function closeHistoryPanel() {
    const panel = document.getElementById('history-panel');
    if (panel) panel.classList.add('hidden');
  }

  async function renderHistoryList(query) {
    const container = document.getElementById('history-list');
    if (!container) return;
    const store = window.QCLI?.HistoryStore;
    if (!store) { container.innerHTML = '<div class="history-empty">History store not available</div>'; return; }

    const results = await store.search(query || '');
    const count = document.getElementById('history-count');
    if (count) count.textContent = results.length > 0 ? `${results.length} 条` : '';

    if (results.length === 0) {
      container.innerHTML = '<div class="history-empty">暂无命令历史</div>';
      return;
    }

    container.innerHTML = '';
    for (const item of results) {
      const el = document.createElement('div');
      el.className = 'history-item';

      const icon = document.createElement('span');
      icon.className = 'history-item-icon';
      icon.textContent = item.favorite ? '⭐' : '⌘';
      el.appendChild(icon);

      const cmd = document.createElement('span');
      cmd.className = 'history-item-command';
      cmd.textContent = item.command;
      el.appendChild(cmd);

      if (item.tabName) {
        const tab = document.createElement('span');
        tab.className = 'history-item-tab';
        tab.textContent = item.tabName;
        el.appendChild(tab);
      }

      const time = document.createElement('span');
      time.className = 'history-item-time';
      const d = new Date(item.timestamp || Date.now());
      const isToday = new Date().toDateString() === d.toDateString();
      time.textContent = isToday
        ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
      el.appendChild(time);

      const favBtn = document.createElement('button');
      favBtn.className = 'history-fav-btn' + (item.favorite ? ' favorited' : '');
      favBtn.textContent = '☆';
      favBtn.title = item.favorite ? '取消收藏' : '收藏';
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await store.toggleFavorite(item.id);
        await renderHistoryList(query);
      });
      el.appendChild(favBtn);

      // Click to send command to terminal
      el.addEventListener('click', () => {
        if (state.launched || window.QCLI?.Tabs?.activeTabId) {
          const tabId = window.QCLI?.Tabs?.activeTabId;
          wsSend({ type: 'input', data: item.command + '\n', tabId });
          closeHistoryPanel();
          if (term) term.focus();
        }
      });

      container.appendChild(el);
    }
  }

  // ============================================================
  // Global Search Panel (Ctrl+Shift+A)
  // ============================================================

  function openGlobalSearch() {
    const panel = document.getElementById('global-search-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    const input = document.getElementById('global-search-input');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
    const results = document.getElementById('global-search-results');
    if (results) results.innerHTML = '';
    const status = document.getElementById('global-search-status');
    if (status) status.classList.remove('visible');
  }

  function closeGlobalSearch() {
    document.getElementById('global-search-panel')?.classList.add('hidden');
  }

  function toggleGlobalSearch() {
    const panel = document.getElementById('global-search-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
      openGlobalSearch();
    } else {
      closeGlobalSearch();
    }
  }

  /**
   * Search across all tab buffers and render results grouped by tab.
   */
  function renderGlobalSearchResults(query) {
    const container = document.getElementById('global-search-results');
    if (!container) return;

    const status = document.getElementById('global-search-status');
    const count = document.getElementById('global-search-count');

    if (!query || query.length < 2) {
      container.innerHTML = '';
      if (count) count.textContent = '';
      if (status) status.classList.remove('visible');
      return;
    }

    const q = query.toLowerCase();
    const tabs = window.QCLI?.Tabs?.tabs || [];
    let totalMatches = 0;
    const groups = [];

    for (const tab of tabs) {
      if (!tab.buffer) continue;
      const lines = tab.buffer.split('\n');
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          matches.push({ lineNum: i + 1, text: lines[i] });
        }
      }
      if (matches.length > 0) {
        groups.push({ tab, matches });
        totalMatches += matches.length;
      }
    }

    if (count) count.textContent = totalMatches > 0 ? `${totalMatches} 条` : '';

    if (groups.length === 0) {
      container.innerHTML = '<div class="gsr-empty">未找到匹配结果</div>';
      if (status) {
        status.textContent = `搜索 "${query}" — 共 0 条`;
        status.classList.add('visible');
      }
      return;
    }

    if (status) {
      status.textContent = `搜索 "${query}" — 在 ${groups.length} 个终端中找到 ${totalMatches} 条`;
      status.classList.add('visible');
    }

    container.innerHTML = '';
    for (const group of groups) {
      const tab = group.tab;
      const groupDiv = document.createElement('div');
      groupDiv.className = 'gsr-tab-group';

      const header = document.createElement('div');
      header.className = 'gsr-tab-header';
      header.textContent = `${tab.icon || '▶'} ${tab.name || tab.cliId || 'Terminal'}`;
      const span = document.createElement('span');
      span.textContent = ` (${group.matches.length})`;
      header.appendChild(span);
      groupDiv.appendChild(header);

      // Show max 50 matches per tab to avoid performance issues
      const maxShow = 50;
      const showMatches = group.matches.slice(0, maxShow);
      for (const m of showMatches) {
        const item = document.createElement('div');
        item.className = 'gsr-item';
        item.dataset.tabId = tab.tabId;

        const lineNum = document.createElement('span');
        lineNum.className = 'gsr-item-line';
        lineNum.textContent = m.lineNum;
        item.appendChild(lineNum);

        const text = document.createElement('span');
        text.className = 'gsr-item-text';
        // Highlight the match in the text
        const idx = m.text.toLowerCase().indexOf(q);
        if (idx !== -1) {
          const before = m.text.slice(0, idx);
          const match = m.text.slice(idx, idx + query.length);
          const after = m.text.slice(idx + query.length);
          text.innerHTML = escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after);
        } else {
          text.textContent = m.text;
        }
        item.appendChild(text);

        item.addEventListener('click', () => {
          closeGlobalSearch();
          // Switch to the tab
          if (tab.tabId && window.QCLI?.Tabs) {
            window.QCLI.Tabs.switch(tab.tabId);
          }
          if (term) term.focus();
        });

        groupDiv.appendChild(item);
      }

      if (group.matches.length > maxShow) {
        const more = document.createElement('div');
        more.className = 'gsr-empty';
        more.style.padding = '8px var(--space-2)';
        more.style.fontSize = '11px';
        more.textContent = `… 还有 ${group.matches.length - maxShow} 条结果`;
        groupDiv.appendChild(more);
      }

      container.appendChild(groupDiv);
    }
  }

  // Wire up global search panel events
  document.addEventListener('keydown', function globSearchKeydown(e) {
    const panel = document.getElementById('global-search-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGlobalSearch();
      if (term) term.focus();
    }
  });

  // Real-time search on input
  document.getElementById('global-search-input')?.addEventListener('input', (e) => {
    renderGlobalSearchResults(e.target.value);
  });

  // Close button
  document.getElementById('global-search-close-btn')?.addEventListener('click', closeGlobalSearch);

  // Click background to close
  document.getElementById('global-search-bg')?.addEventListener('click', closeGlobalSearch);

  // ============================================================
  // Snippet Manager Panel
  // ============================================================
  async function openSnippetPanel() {
    const panel = document.getElementById('snippet-overlay');
    if (!panel) return;
    panel.classList.remove('hidden');
    await renderSnippetList();
  }

  function closeSnippetPanel() {
    document.getElementById('snippet-overlay')?.classList.add('hidden');
    document.getElementById('add-snippet-modal')?.classList.add('hidden');
  }

  async function renderSnippetList() {
    const container = document.getElementById('snippet-list');
    if (!container) return;
    const store = window.QCLI?.SnippetStore;
    if (!store) { container.innerHTML = '<div class="snippet-empty">Snippet store not available</div>'; return; }

    const snippets = await store.getAll();
    if (snippets.length === 0) {
      container.innerHTML = '<div class="snippet-empty">暂无代码片段，点击 "+ 新增" 创建</div>';
      return;
    }

    container.innerHTML = '';
    for (const s of snippets) {
      const el = document.createElement('div');
      el.className = 'snippet-item';

      const icon = document.createElement('span');
      icon.className = 'snippet-item-icon';
      icon.textContent = '📋';
      el.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'snippet-item-body';

      const name = document.createElement('div');
      name.className = 'snippet-item-name';
      name.textContent = s.name;
      body.appendChild(name);

      const cmd = document.createElement('div');
      cmd.className = 'snippet-item-cmd';
      cmd.textContent = s.command + (s.description ? `  // ${s.description}` : '');
      body.appendChild(cmd);

      el.appendChild(body);

      const del = document.createElement('button');
      del.className = 'snippet-delete-btn';
      del.textContent = '✕';
      del.title = '删除';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await store.remove(s.id);
        await renderSnippetList();
      });
      el.appendChild(del);

      // Click to send command to terminal
      el.addEventListener('click', () => {
        if (state.launched || window.QCLI?.Tabs?.activeTabId) {
          const tabId = window.QCLI?.Tabs?.activeTabId;
          // Replace {{placeholder}} with user input
          let cmdText = s.command;
          const placeholders = cmdText.match(/\{\{\w+\}\}/g);
          if (placeholders) {
            // For simplicity, just use the first placeholder value
            for (const ph of placeholders) {
              const key = ph.replace(/[{}]/g, '');
              const val = prompt(`输入 ${key}:`) || '';
              cmdText = cmdText.replace(ph, val);
            }
          }
          wsSend({ type: 'input', data: cmdText + '\n', tabId });
          closeSnippetPanel();
          if (term) term.focus();
        } else {
          showToast('请先启动一个 CLI', 'info');
        }
      });

      container.appendChild(el);
    }
  }

  // ============================================================
  // Workspace Profiles Panel
  // ============================================================
  async function openWorkspacePanel() {
    const panel = document.getElementById('workspace-overlay');
    if (!panel) return;
    panel.classList.remove('hidden');
    await renderWorkspaceList();
  }

  function closeWorkspacePanel() {
    document.getElementById('workspace-overlay')?.classList.add('hidden');
  }

  async function renderWorkspaceList() {
    const container = document.getElementById('workspace-list');
    if (!container) return;
    const store = window.QCLI?.WorkspaceStore;
    if (!store) { container.innerHTML = '<div class="workspace-empty">Workspace store not available</div>'; return; }

    const workspaces = store.getAll();
    if (workspaces.length === 0) {
      container.innerHTML = '<div class="workspace-empty">暂无保存的工作区，点击 "💾 保存当前" 创建</div>';
      return;
    }

    container.innerHTML = '';
    for (const ws of workspaces) {
      const el = document.createElement('div');
      el.className = 'workspace-item';

      const icon = document.createElement('span');
      icon.className = 'workspace-item-icon';
      icon.textContent = '📂';
      el.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'workspace-item-body';

      const name = document.createElement('div');
      name.className = 'workspace-item-name';
      name.textContent = ws.name;
      body.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'workspace-item-meta';
      const d = new Date(ws.createdAt || Date.now());
      meta.textContent = `${ws.tabCount || 0} 个 tab · 创建于 ${d.toLocaleDateString('zh-CN')}`;
      body.appendChild(meta);

      el.appendChild(body);

      const del = document.createElement('button');
      del.className = 'workspace-delete-btn';
      del.textContent = '✕';
      del.title = '删除';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        store.remove(ws.id);
        await renderWorkspaceList();
      });
      el.appendChild(del);

      // Click to restore workspace
      el.addEventListener('click', async () => {
        const tabs = window.QCLI?.Tabs;
        if (!tabs || !ws.tabs || ws.tabs.length === 0) {
          showToast('工作区没有可恢复的 tab', 'info');
          return;
        }
        // Launch each tab's CLI
        for (const tab of ws.tabs) {
          if (tab.cliId) {
            // Set pending init from workspace profile (overrides CLI default)
            if (tab.init) _pendingInit.set(tab.cliId, tab.init);
            // Small delay between launches
            await new Promise(r => setTimeout(r, 300));
            launchCLI(tab.cliId);
          }
        }
        closeWorkspacePanel();
        showToast(`✅ 已恢复工作区 "${ws.name}"（${ws.tabs.length} 个 tab）`, 'success');
      });

      container.appendChild(el);
    }
  }

  // ============================================================
  // Terminal Context Menu + Output Pins Sidebar
  // ============================================================
  let currentPinText = '';

  function showContextMenu(x, y, selection) {
    const menu = document.getElementById('terminal-context-menu');
    if (!menu) return;
    currentPinText = selection || '';

    // Toggle visibility of selection-dependent vs non-selection items
    const hasSel = !!selection;
    menu.querySelectorAll('.ctx-copy, .ctx-pin, .ctx-search-sel, .ctx-divider-sel')
      .forEach(el => el.classList.toggle('hidden', !hasSel));
    menu.querySelectorAll('.ctx-paste, .ctx-clear, .ctx-search')
      .forEach(el => el.classList.toggle('hidden', hasSel));

    // Clamp to viewport
    const menuW = Math.min(200, window.innerWidth - 16);
    const left = Math.min(x, window.innerWidth - menuW);
    const menuH = menu.scrollHeight || 180;
    const top = Math.min(y, window.innerHeight - menuH - 8);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.classList.remove('hidden');
  }

  function hideContextMenu() {
    document.getElementById('terminal-context-menu')?.classList.add('hidden');
  }

  // Copy terminal selection to clipboard
  function copySelection() {
    hideContextMenu();
    const selection = term?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(err => {
        console.warn('[Clipboard] Copy failed:', err.message);
      });
      term.clearSelection();
    }
  }

  async function pinSelectedOutput() {
    if (!currentPinText) return;
    const store = window.QCLI?.PinStore;
    if (!store) return;
    const activeTab = window.QCLI?.Tabs?.activeTabId;
    const tab = activeTab ? window.QCLI?.Tabs?.getTab(activeTab) : null;
    const title = prompt('Pin title (optional):', tab?.name ? 'Output from ' + tab.name : '');
    await store.add(
      currentPinText.replace(/(?:[@-Z\-_]|[[0-?]*[ -/]*[@-~])/g, '').trim(),
      tab?.cliId || '',
      tab?.name || '',
      title || ''
    );
    hideContextMenu();
    showToast('📌 已固定到输出剪贴板', 'success');
    await renderPinnedList();
  }
function searchSelection() {
    if (!currentPinText) { hideContextMenu(); return; }
    hideContextMenu();
    // Open search bar with selection pre-filled
    showSearchBar();
    if ($searchInput) {
      $searchInput.value = currentPinText;
      performSearch();
    }
  }

  function pasteClipboard() {
    hideContextMenu();
    navigator.clipboard.readText().then(text => {
      if (text) wsSend({ type: 'input', data: text });
    }).catch(err => {
      console.warn('[Clipboard] Right-click paste failed:', err.message);
    });
  }

  async function renderPinnedList() {
    // Delegate to PinReport module for enhanced rendering
    if (window.QCLI?.PinReport?.renderPinnedList) {
      return window.QCLI.PinReport.renderPinnedList();
    }
    // Fallback if PinReport not loaded
    const container = document.getElementById('pinned-list');
    const section = document.getElementById('pinned-section');
    if (!container || !section) return;
    const store = window.QCLI?.PinStore;
    if (!store) { section.classList.add('hidden'); return; }

    const pins = await store.getAll();
    if (pins.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    container.innerHTML = '';
    for (const pin of pins) {
      const el = document.createElement('div');
      el.className = 'pin-item';

      const text = document.createElement('span');
      text.className = 'pin-item-text';
      text.textContent = pin.text.slice(0, 200);
      el.appendChild(text);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'pin-item-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await store.remove(pin.id);
        await renderPinnedList();
      });
      el.appendChild(removeBtn);

      // Click to copy to clipboard
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(pin.text).catch(() => {});
        showToast('📋 已复制到剪贴板', 'success');
      });

      container.appendChild(el);
    }
  }

  // ============================================================
  // Notification permission request + init
  // ============================================================
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

    // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
