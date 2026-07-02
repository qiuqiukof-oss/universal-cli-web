// ============================================================
// Right Panel Controller — Dashboard/Charts/Media Sidebar
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

const RightPanel = {
  collapsed: false,
  activeTab: 'dashboard',
  width: 480,
};

// ── DOM References ──
let el, toggleBtn, tabs, content, resizeHandle;

// ── Resize state ──
let isResizing = false;
let resizeRAF = null;

const MIN_WIDTH = 200;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 480;
const STORAGE_COLLAPSED_KEY = 'qcli-right-panel-collapsed';
const STORAGE_WIDTH_KEY = 'qcli-right-panel-width';
const STORAGE_TAB_KEY = 'qcli-right-panel-tab';

// ============================================================
// Initialization
// ============================================================
function init() {
  el = document.getElementById('right-panel');
  if (!el) return;

  toggleBtn = document.getElementById('right-panel-toggle');
  tabs = document.getElementById('right-panel-tabs');
  content = document.getElementById('right-panel-content');
  resizeHandle = document.getElementById('right-panel-resize-handle');

  // Restore saved state
  restoreState();

  // Wire up toggle button
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggle);
  }

  // Wire up tab switching
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.right-tab');
      if (tab && tab.dataset.panel) {
        switchTab(tab.dataset.panel);
        // If collapsed, expand on tab click
        if (RightPanel.collapsed) {
          toggle();
        }
      }
    });
  }

  // Wire up resize handle
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', startResize);
  }

  // Expose on QCLI namespace
  Q.RightPanel = RightPanel;
  RightPanel.init = init;
  RightPanel.toggle = toggle;
  RightPanel.switchTab = switchTab;
  RightPanel.open = open;
  RightPanel.close = close;

  console.log('[RightPanel] Initialized');
}

// ============================================================
// State Persistence
// ============================================================
function restoreState() {
  // Collapsed state
  try {
    const savedCollapsed = localStorage.getItem(STORAGE_COLLAPSED_KEY);
    if (savedCollapsed === '1') {
      RightPanel.collapsed = true;
      el.classList.add('collapsed');
      if (toggleBtn) {
        toggleBtn.title = '展开右侧栏';
      }
    }
  } catch (e) { /* ignore */ }

  // Width
  try {
    const savedWidth = localStorage.getItem(STORAGE_WIDTH_KEY);
    if (savedWidth) {
      const w = parseInt(savedWidth, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) {
        RightPanel.width = w;
        applyWidth(w);
      }
    }
  } catch (e) { /* ignore */ }

  // Active tab
  try {
    const savedTab = localStorage.getItem(STORAGE_TAB_KEY);
    if (savedTab && ['dashboard', 'stocks', 'media'].includes(savedTab)) {
      RightPanel.activeTab = savedTab;
      updateActiveTab(savedTab);
    }
  } catch (e) { /* ignore */ }
}

function saveCollapsed() {
  try {
    localStorage.setItem(STORAGE_COLLAPSED_KEY, RightPanel.collapsed ? '1' : '0');
  } catch (e) { /* ignore */ }
}

function saveWidth(width) {
  try {
    localStorage.setItem(STORAGE_WIDTH_KEY, String(width));
  } catch (e) { /* ignore */ }
}

function saveTab(tabId) {
  try {
    localStorage.setItem(STORAGE_TAB_KEY, tabId);
  } catch (e) { /* ignore */ }
}

// ============================================================
// Toggle (Collapse / Expand)
// ============================================================
function toggle() {
  if (!el) return;
  RightPanel.collapsed = !RightPanel.collapsed;
  el.classList.toggle('collapsed', RightPanel.collapsed);
  if (toggleBtn) {
    toggleBtn.title = RightPanel.collapsed ? '展开右侧栏' : '收起右侧栏';
  }
  saveCollapsed();

  // Re-fit terminal after animation completes
  setTimeout(() => {
    triggerTerminalFit();
  }, 280);
}

function open() {
  if (!el) return;
  el.classList.remove('hidden', 'collapsed');
  RightPanel.collapsed = false;
  if (toggleBtn) toggleBtn.title = '收起右侧栏';
  saveCollapsed();
  setTimeout(triggerTerminalFit, 280);
}

function close() {
  if (!el) return;
  el.classList.add('collapsed');
  RightPanel.collapsed = true;
  if (toggleBtn) toggleBtn.title = '展开右侧栏';
  saveCollapsed();
  setTimeout(triggerTerminalFit, 280);
}

// ============================================================
// Tab Switching
// ============================================================
function switchTab(tabId) {
  if (!content || RightPanel.activeTab === tabId) return;

  RightPanel.activeTab = tabId;
  saveTab(tabId);

  updateActiveTab(tabId);

  // Show/hide panels
  const panels = content.querySelectorAll('.rp-panel');
  panels.forEach(p => {
    p.classList.remove('active');
  });
  const target = document.getElementById('rp-' + tabId);
  if (target) {
    target.classList.add('active');
  }

  // Re-trigger entrance animation
  if (target) {
    target.style.animation = 'none';
    void target.offsetWidth; // force reflow
    target.style.animation = '';
  }

  // Update header icon
  const headerIcon = el.querySelector('.right-panel-header-icon');
  if (headerIcon) {
    const icons = { dashboard: '📊', stocks: '📈', media: '🎬', browser: '🌐', quant: '🤖' };
    headerIcon.textContent = icons[tabId] || '📊';
  }

  // Update title
  const titleEl = el.querySelector('.right-panel-title');
  if (titleEl) {
    const titles = { dashboard: '工作台', stocks: '股票分析', media: '多媒体', browser: '浏览器预览', quant: '量化交易' };
    titleEl.textContent = titles[tabId] || '工作台';
  }
}

function updateActiveTab(tabId) {
  if (!tabs) return;
  const tabBtns = tabs.querySelectorAll('.right-tab');
  tabBtns.forEach(t => {
    t.classList.toggle('active', t.dataset.panel === tabId);
  });
}

// ============================================================
// Resize Handle
// ============================================================
function startResize(e) {
  e.preventDefault();
  isResizing = true;
  el.classList.add('dragging');
  resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
}

function onResize(e) {
  if (!isResizing) return;
  if (resizeRAF) return;
  resizeRAF = requestAnimationFrame(() => {
    resizeRAF = null;
    // Calculate width from right edge of viewport
    const viewportWidth = window.innerWidth;
    let width = viewportWidth - e.clientX;
    if (width < MIN_WIDTH) width = MIN_WIDTH;
    if (width > MAX_WIDTH) width = MAX_WIDTH;
    RightPanel.width = width;
    applyWidth(width);
  });
}

function stopResize() {
  if (!isResizing) return;
  isResizing = false;
  if (resizeRAF) {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = null;
  }
  el.classList.remove('dragging');
  resizeHandle.classList.remove('active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  saveWidth(RightPanel.width);

  // Re-fit terminal after resize settles
  requestAnimationFrame(() => {
    triggerTerminalFit();
  });

  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}

function applyWidth(width) {
  document.documentElement.style.setProperty('--right-panel-width', width + 'px');
  el.style.width = '';
  el.style.minWidth = '';
}

// ============================================================
// Terminal Re-fit Helper
// ============================================================
function triggerTerminalFit() {
  try {
    const fitAddon = window.QCLI?.Tabs?.fitAddon;
    const term = window.QCLI?.Tabs?.term;
    const state = window.QCLI?.state;
    if (fitAddon) {
      fitAddon.fit();
      if (state && state.launched) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          const wsSend = window.QCLI?.wsSend;
          if (wsSend) {
            wsSend({
              type: 'resize',
              cols: dims.cols,
              rows: dims.rows,
              tabId: window.QCLI?.Tabs?.activeTabId
            });
          }
        }
      }
    }
  } catch (e) { /* ignore */ }
}

// ============================================================
// Exports
// ============================================================
export { RightPanel };
// Legacy compat
Q.RightPanel = RightPanel;

// ============================================================
// Auto-init on DOM ready
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

