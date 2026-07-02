// ============================================================
// Q-CLI State Module — extracted from app.js
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

// ============================================================
export const state = {
    clis: [],
    folders: [],
    activeCliId: null,
    connected: false,
    launched: false,
    launching: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    searchQuery: '',
    renamingFolderId: null,
    categoryFilter: 'all', // 'all' | 'agent' | 'directory' | 'tool'
    theme: 'dark', // 'dark' | 'light'
  };

  // ============================================================


  // ============================================================
  // Scrollback History Buffer — captures terminal output for review
  // ============================================================
  // Ring buffer storing last N lines of terminal output (plain text, ANSI stripped)
  export const SCROLLBACK_MAX_LINES = 10000;
  export const scrollbackBuffer = [];
  export let scrollbackLineCount = 0;

  // ANSI escape code regex
  export const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  export const CR_RE = /\r\n|\r(?!\n)/g;

  export function stripAnsi(str) {
    return str.replace(ANSI_RE, '').replace(CR_RE, '\n');
  }

  export function captureToScrollback(rawData) {
    const text = stripAnsi(rawData);
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line && scrollbackBuffer.length === 0) continue;
      scrollbackBuffer.push(line);
      if (scrollbackBuffer.length > SCROLLBACK_MAX_LINES) {
        scrollbackBuffer.shift();
      }
      scrollbackLineCount++;
    }
  }

  // History Viewer
  export const historyViewer = { open: false, overlay: null, content: null };

  export function initHistoryViewer() {
    const overlay = document.createElement('div');
    overlay.id = 'history-viewer';
    overlay.className = 'history-viewer hidden';
    overlay.innerHTML = '<div class="history-viewer-header"><span class="history-viewer-title">\ud83d\udcdc Scrollback History</span><span class="history-viewer-hint">\u2191\u2193 scroll &middot; Esc close</span></div><div class="history-viewer-content"></div>';
    document.body.appendChild(overlay);
    historyViewer.overlay = overlay;
    historyViewer.content = overlay.querySelector('.history-viewer-content');
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeHistoryViewer(); });
    return overlay;
  }

  export function openHistoryViewer() {
    if (!historyViewer.overlay) initHistoryViewer();
    if (historyViewer.open) return;
    historyViewer.open = true;
    historyViewer.overlay.classList.remove('hidden');
    const content = historyViewer.content;
    if (scrollbackBuffer.length === 0) {
      content.innerHTML = '<div class="history-viewer-empty">No output captured yet.</div>';
    } else {
      const parts = [];
      for (let i = 0; i < scrollbackBuffer.length; i++) {
        const line = scrollbackBuffer[i] || ' ';
        parts.push('<div class="history-viewer-line">' + escapeHtml(line) + '</div>');
      }
      content.innerHTML = parts.join('');
    }
    requestAnimationFrame(function() { content.scrollTop = content.scrollHeight; });
    historyViewer.overlay.tabIndex = -1;
    historyViewer.overlay.focus();
  }

  export function closeHistoryViewer() {
    if (!historyViewer.open) return;
    historyViewer.open = false;
    historyViewer.overlay.classList.add('hidden');
    if (term) term.focus();
  }

  export function toggleHistoryViewer() {
    if (historyViewer.open) closeHistoryViewer(); else openHistoryViewer();
  }

  // Expose state and DOM refs on QCLI namespace

  // ── DOM References ──
  export const $ = (sel) => document.querySelector(sel);
  export const dom = {
    sidebar: $('#sidebar'),
    sidebarToggle: $('#sidebar-toggle'),
    cliList: $('#cli-list'),
    searchInput: $('#search-input'),
    addFolderBtn: $('#add-folder-btn'),
    statusDot: $('#connection-status .status-dot'),
    statusText: $('#connection-status .status-text'),
    statusIndicator: $('#connection-status'),
    activeLabel: $('#active-cli-label'),
    activeVersion: $('#active-cli-version'),
    terminalDims: $('#terminal-dims'),
    terminalFontSize: $('#terminal-font-size'),
    terminal: $('#terminal'),
    welcomeOverlay: $('#welcome-overlay'),
    addOverlay: $('#add-cli-overlay'),
    addForm: $('#add-cli-form'),
    addName: $('#add-cli-name'),
    addPath: $('#add-cli-path'),
    addArgs: $('#add-cli-args'),
    addInit: $('#add-cli-init'),
    addError: $('#add-cli-error'),
    addCancel: $('#add-cli-cancel'),
    addSubmit: $('#add-cli-submit'),
    browseBtn: $('#browse-cli-btn'),
    fileInput: $('#file-input'),
    selectedFile: $('#selected-file'),
    manualPathGroup: $('#manual-path-group'),
    addBtn: $('#add-cli-btn'),
    discoverBtn: $('#discover-btn'),
    dropOverlay: $('#drop-overlay'),
    connectionLost: $('#connection-lost'),
    categoryFilters: $('#category-filters'),
    themeToggle: $('#theme-toggle-btn'),
  };
  Q.dom = dom;
  Q.$ = $;

  // ── Category Filter ──
  export function getCategoryIcon(category) {
    const icons = { agent: '🤖', directory: '📂', tool: '🔧' };
    return icons[category] || '📦';
  }

  export function getCategoryLabel(category) {
    const labels = { agent: 'Agent', directory: 'Env', tool: 'Tool' };
    return labels[category] || category;
  }

  export function setupCategoryFilters() {
    if (!dom.categoryFilters) return;
    const chips = dom.categoryFilters.querySelectorAll('.category-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const category = chip.dataset.category;
        if (category === Q.state.categoryFilter) return;
        Q.state.categoryFilter = category;
        chips.forEach(c => c.classList.toggle('active', c.dataset.category === category));
        // Try calling renderCLIList from QCLI namespace (registered by app.js)
        if (Q.Sidebar && typeof Q.Sidebar.renderCLIList === 'function') {
          Q.Sidebar.renderCLIList();
        }
      });
    });
  }

  Q.getCategoryIcon = getCategoryIcon;
  Q.getCategoryLabel = getCategoryLabel;
  Q.setupCategoryFilters = setupCategoryFilters;
  Q.state = state;
  Q.dom = dom;
  Q.scrollbackBuffer = scrollbackBuffer;
  Q.scrollbackLineCount = scrollbackLineCount;
  Q.historyViewer = historyViewer;
  Q.initHistoryViewer = initHistoryViewer;
  Q.openHistoryViewer = openHistoryViewer;
  Q.closeHistoryViewer = closeHistoryViewer;
  Q.toggleHistoryViewer = toggleHistoryViewer;
  Q.stripAnsi = stripAnsi;
  Q.captureToScrollback = captureToScrollback;
  Q.getCategoryIcon = getCategoryIcon;
  Q.getCategoryLabel = getCategoryLabel;
  Q.setupCategoryFilters = setupCategoryFilters;
  Q.$ = $;
