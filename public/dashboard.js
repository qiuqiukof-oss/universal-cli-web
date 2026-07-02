// ============================================================
// Dashboard Panel — System Status, CLI Stats, Runtime Overview
// ============================================================
const Q = window.QCLI = window.QCLI || {};

export const Dashboard = {
  /** @type {number|null} page load timestamp */
  _startTime: Date.now(),
  /** @type {number|null} auto-refresh interval */
  _refreshTimer: null,
  /** @type {number} refresh interval in ms */
  _REFRESH_MS: 2000,
  /** @type {boolean} guard against double init */
  _initialized: false,
  /** @type {Object.<string,number>} cached previous values for animation detection */
  _prevValues: { clis: 0, agent: 0, directory: 0, tool: 0, tabs: 0, favorites: 0 },
  /** @type {number|null} clock interval */
  _clockTimer: null,
};

// ============================================================
// Initialization
// ============================================================
function init() {
  if (Dashboard._initialized) return;
  Dashboard._initialized = true;

  // Wire up tab switch listener to start/stop refresh
  const tabs = document.getElementById('right-panel-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.right-tab');
      if (tab && tab.dataset.panel === 'dashboard') {
        refresh();
      }
    });
  }

  // Watch for right-panel tab switches via RightPanel
  if (Q.RightPanel) {
    const _origSwitch = Q.RightPanel.switchTab;
    Q.RightPanel.switchTab = function(tabId) {
      _origSwitch.call(Q.RightPanel, tabId);
      if (tabId === 'dashboard') {
        refresh();
      }
    };
  }

  // Initial render
  render();

  // Start auto-refresh
  startAutoRefresh();

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  console.log('[Dashboard] Initialized');
}

function cleanup() {
  stopAutoRefresh();
  if (Dashboard._clockTimer) {
    clearInterval(Dashboard._clockTimer);
    Dashboard._clockTimer = null;
  }
}

// ============================================================
// Auto-Refresh
// ============================================================
function startAutoRefresh() {
  if (Dashboard._refreshTimer) return;
  Dashboard._refreshTimer = setInterval(() => {
    // Only refresh if dashboard panel is visible
    const rpContent = document.getElementById('right-panel-content');
    if (!rpContent) return;
    const dashPanel = document.getElementById('rp-dashboard');
    if (!dashPanel || !dashPanel.classList.contains('active')) return;
    // Only refresh if right panel is not collapsed
    const rp = document.getElementById('right-panel');
    if (rp && rp.classList.contains('collapsed')) return;

    refresh();
  }, Dashboard._REFRESH_MS);
}

function stopAutoRefresh() {
  if (Dashboard._refreshTimer) {
    clearInterval(Dashboard._refreshTimer);
    Dashboard._refreshTimer = null;
  }
}

// ============================================================
// Refresh — update values without full re-render
// ============================================================
function refresh() {
  updateStats();
  updateConnectionStatus();
  updateSessionList();
  updateProjectAnalysis();
}

// ============================================================
// Project Analysis — fetch from server and render
// ============================================================
let _projectData = null;
let _projectLoadAttempted = false;

async function loadProjectAnalysis() {
  if (_projectLoadAttempted) return _projectData;
  _projectLoadAttempted = true;
  try {
    const resp = await fetch('/api/project/analyze');
    if (resp.ok) {
      const data = await resp.json();
      if (data.success) {
        _projectData = data;
        return data;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ============================================================
// Full Render
// ============================================================
function render() {
  const panel = document.getElementById('rp-dashboard');
  if (!panel) return;

  // Load project data lazily
  loadProjectAnalysis();

  // Build dashboard HTML
  panel.innerHTML = `
    <div class="dash-content" id="dash-content">
      <!-- Connection Status -->
      <div class="dash-section">
        <div class="dash-section-title">连接状态</div>
        <div class="dash-card" id="dash-connection-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🔌</span>
            <span class="dash-card-title">WebSocket</span>
            <span class="dash-card-badge" id="dash-conn-badge">检查中</span>
          </div>
          <div class="dash-card-body" id="dash-conn-body">
            <div class="dash-stat">
              <span class="dash-status-dot offline" id="dash-conn-dot"></span>
              <span class="dash-stat-label" id="dash-conn-text">未连接</span>
              <span class="dash-stat-value" id="dash-conn-latency">—</span>
            </div>
            <div class="dash-conn-row">
              <span class="dash-label">🔄 重试次数</span>
              <span class="dash-value" id="dash-reconn-count">0</span>
            </div>
            <div class="dash-conn-row">
              <span class="dash-label">⏱ 运行时长</span>
              <span class="dash-value" id="dash-uptime">0s</span>
            </div>
          </div>
        </div>
      </div>

      <!-- CLI Statistics -->
      <div class="dash-section">
        <div class="dash-section-title">CLI 统计</div>
        <div class="dash-card" id="dash-cli-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🚀</span>
            <span class="dash-card-title">已注册 CLI</span>
            <span class="dash-card-badge" id="dash-total-clis">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-stat-grid" id="dash-cli-grid">
              <div class="dash-grid-item">
                <span class="dash-grid-icon">🤖</span>
                <span class="dash-grid-value" id="dash-count-agent">0</span>
                <span class="dash-grid-label">Agent</span>
              </div>
              <div class="dash-grid-item">
                <span class="dash-grid-icon">📂</span>
                <span class="dash-grid-value" id="dash-count-dir">0</span>
                <span class="dash-grid-label">Env</span>
              </div>
              <div class="dash-grid-item">
                <span class="dash-grid-icon">🔧</span>
                <span class="dash-grid-value" id="dash-count-tool">0</span>
                <span class="dash-grid-label">Tool</span>
              </div>
              <div class="dash-grid-item">
                <span class="dash-grid-icon">⭐</span>
                <span class="dash-grid-value" id="dash-count-fav">0</span>
                <span class="dash-grid-label">收藏</span>
              </div>
            </div>
            <div class="dash-progress" id="dash-cli-progress">
              <div class="dash-progress-bar" id="dash-cli-progress-bar" style="width:0%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Project Analysis -->
      <div class="dash-section">
        <div class="dash-section-title">项目分析</div>
        <div class="dash-card" id="dash-project-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">📁</span>
            <span class="dash-card-title">工作区文件</span>
            <span class="dash-card-badge" id="dash-project-badge">扫描中</span>
          </div>
          <div class="dash-card-body">
            <!-- Main language + file count -->
            <div class="dash-stat">
              <span class="dash-stat-icon">📜</span>
              <span class="dash-stat-label">主要语言</span>
              <span class="dash-stat-value" id="dash-project-lang">—</span>
            </div>
            <div class="dash-stat">
              <span class="dash-stat-icon">📫</span>
              <span class="dash-stat-label">文件总数</span>
              <span class="dash-stat-value" id="dash-project-files">—</span>
            </div>
            <div class="dash-stat">
              <span class="dash-stat-icon">📹</span>
              <span class="dash-stat-label">源代码行数</span>
              <span class="dash-stat-value" id="dash-project-loc">—</span>
            </div>
            <!-- File type distribution as mini grid -->
            <div class="dash-project-type-grid" id="dash-project-types"></div>
            <!-- Key config files detected -->
            <div class="dash-project-keyfiles" id="dash-project-keyfiles"></div>
            <!-- Refresh button -->
            <button class="dash-project-refresh-btn" id="dash-project-refresh" title="重新扫描项目">🔄 重新扫描</button>
          </div>
        </div>
      </div>

      <!-- Active Sessions -->
      <div class="dash-section">
        <div class="dash-section-title">活动会话</div>
        <div class="dash-card" id="dash-session-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">📋</span>
            <span class="dash-card-title">终端标签</span>
            <span class="dash-card-badge" id="dash-tab-count">0</span>
          </div>
          <div class="dash-card-body">
            <div id="dash-tab-list" class="dash-tab-list">
              <div class="dash-empty">暂无活动会话</div>
            </div>
          </div>
        </div>
      </div>

      <!-- System Info -->
      <div class="dash-section">
        <div class="dash-section-title">系统信息</div>
        <div class="dash-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🌡️</span>
            <span class="dash-card-title">运行环境</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-stat">
              <span class="dash-stat-icon">🛠️</span>
              <span class="dash-stat-label">主题</span>
              <span class="dash-stat-value" id="dash-theme">深色</span>
            </div>
            <div class="dash-stat">
              <span class="dash-stat-icon">⏱</span>
              <span class="dash-stat-label">当前时间</span>
              <span class="dash-stat-value" id="dash-clock" style="font-size:10px;">—</span>
            </div>
            <div class="dash-stat">
              <span class="dash-stat-icon">📫</span>
              <span class="dash-stat-label">页面大小</span>
              <span class="dash-stat-value" id="dash-memory">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Initial update
  refresh();

  // Start clock
  startClock();

  // Wire up project refresh button
  const refreshBtn = document.getElementById('dash-project-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      _projectLoadAttempted = false;
      _projectData = null;
      updateProjectAnalysis();
    });
  }

  console.log('[Dashboard] Rendered');
}

// ============================================================
// Project Analysis Render
// ============================================================
async function updateProjectAnalysis() {
  const data = await loadProjectAnalysis();
  const badge = document.getElementById('dash-project-badge');
  if (!badge) return;

  if (!data) {
    badge.textContent = '不可用';
    setText('dash-project-lang', '—');
    setText('dash-project-files', '—');
    setText('dash-project-loc', '—');
    return;
  }

  badge.textContent = data.stats.totalFiles + ' 文件';
  badge.style.background = 'rgba(99,102,241,0.12)';
  badge.style.color = 'var(--accent)';

  // Main language
  setText('dash-project-lang', data.mainLanguage.name + (data.mainLanguage.fileCount > 0 ? ' (' + data.mainLanguage.fileCount + ')' : ''));

  // File count
    setText('dash-project-files', data.stats.totalFiles + ' 文件 / ' + data.stats.totalDirs + ' 目录');

  // Lines of code
  if (data.stats.sourceLOC > 0) {
    setText('dash-project-loc', data.stats.sourceLOC.toLocaleString() + ' 行');
  } else {
    setText('dash-project-loc', '—');
  }

  // File type distribution (mini grid)
  const typeGrid = document.getElementById('dash-project-types');
  if (typeGrid && data.categories) {
    const icons = { source: '📫', markup: '📑', style: '🎹', config: '⚙️', data: '🗂️', media: '🎬', docs: '📄', other: '📦' };
    const labels = { source: '源码', markup: '标记', style: '样式', config: '配置', data: '数据', media: '媒体', docs: '文档', other: '其他' };
    const cats = data.categories;
    typeGrid.innerHTML = Object.keys(cats).filter(k => cats[k] > 0).map(k => `
      <div class="dash-project-type-item">
        <span class="dash-project-type-icon">${icons[k] || '📦'}</span>
        <span class="dash-project-type-value">${cats[k]}</span>
        <span class="dash-project-type-label">${labels[k] || k}</span>
      </div>
    `).join('');
  }

  // Key config files
  const keyFilesEl = document.getElementById('dash-project-keyfiles');
  if (keyFilesEl && data.keyFiles && data.keyFiles.length > 0) {
    keyFilesEl.innerHTML = '<div class="dash-project-section-label">📁 检测到配置文件</div>' +
      data.keyFiles.map(kf => `
        <div class="dash-project-kf-item">
          <span class="dash-project-kf-name">${escapeHtml(kf.name)}</span>
          <span class="dash-project-kf-label">${escapeHtml(kf.label)}</span>
        </div>
      `).join('');
  } else if (keyFilesEl) {
    keyFilesEl.innerHTML = '';
  }
}

// ============================================================
// Update Methods (called on each refresh)
// ============================================================

/** Update CLI statistics counters */
function updateStats() {
  const clis = Q.state?.clis || [];
  const total = clis.length;

  // Count by category
  let agent = 0, directory = 0, tool = 0;
  for (const cli of clis) {
    const cat = cli.category || 'tool';
    if (cat === 'agent') agent++;
    else if (cat === 'directory') directory++;
    else tool++;
  }

  // Count favorites
  let favorites = 0;
  try {
    const favs = JSON.parse(localStorage.getItem('qcli-favorites')) || [];
    favorites = favs.length;
  } catch (e) { /* ignore */ }

  // Animate count-up if value changed
  animateIfChanged('dash-total-clis', total);
  animateIfChanged('dash-count-agent', agent);
  animateIfChanged('dash-count-dir', directory);
  animateIfChanged('dash-count-tool', tool);
  animateIfChanged('dash-count-fav', favorites);

  // Update text values
  setText('dash-total-clis', total);
  setText('dash-count-agent', agent);
  setText('dash-count-dir', directory);
  setText('dash-count-tool', tool);
  setText('dash-count-fav', favorites);

  // Update progress bar (scale by 10 max for display)
  const maxScale = Math.max(total, 10);
  const pct = Math.min(100, (total / maxScale) * 100);
  const bar = document.getElementById('dash-cli-progress-bar');
  if (bar) bar.style.width = pct + '%';

  // Store for next comparison
  Dashboard._prevValues.clis = total;
  Dashboard._prevValues.agent = agent;
  Dashboard._prevValues.directory = directory;
  Dashboard._prevValues.tool = tool;
  Dashboard._prevValues.favorites = favorites;
}


/** Update connection status display */
function updateConnectionStatus() {
  const state = Q.state || {};
  const connected = !!state.connected;
  const launched = !!state.launched;
  const reconnCount = state.reconnectAttempts || 0;

  // Dot
  const dot = document.getElementById('dash-conn-dot');
  if (dot) {
    dot.className = 'dash-status-dot ' + (connected ? 'online' : 'offline');
  }

  // Badge
  const badge = document.getElementById('dash-conn-badge');
  if (badge) {
    badge.textContent = connected ? (launched ? '运行中' : '已连接') : '断开';
    badge.style.color = connected ? 'var(--success)' : 'var(--text-tertiary)';
    badge.style.background = connected
      ? 'rgba(34,197,94,0.1)'
      : 'var(--bg-hover)';
  }

  // Status text
  const text = document.getElementById('dash-conn-text');
  if (text) {
    text.textContent = connected
      ? (launched ? 'CLI 运行中' : 'WebSocket 已连接')
      : '未连接';
  }

  // Latency / reconnect
  setText('dash-reconn-count', reconnCount);

  // Uptime
  const elapsed = Math.floor((Date.now() - Dashboard._startTime) / 1000);
  const uptimeEl = document.getElementById('dash-uptime');
  if (uptimeEl) {
    uptimeEl.textContent = formatDuration(elapsed);
  }
}

/** Update active session / tab list */
function updateSessionList() {
  const tabs = Q.Tabs?.tabs || [];
  const activeId = Q.Tabs?.activeTabId;

  // Update badge count
  setText('dash-tab-count', tabs.length);

  // Update tab list using event delegation
  const list = document.getElementById('dash-tab-list');
  if (!list) return;

  if (tabs.length === 0) {
    list.innerHTML = '<div class="dash-empty">暂无活动会话</div>';
    return;
  }

  // Only rebuild if the content actually changed (compare serialized state)
  const serialized = tabs.map(t => t.tabId + '|' + (t.tabId === activeId ? '1' : '0')).join(',');
  if (list.dataset.serialized === serialized) return;
  list.dataset.serialized = serialized;

  const html = tabs.map(tab => {
    const isActive = tab.tabId === activeId;
    return `<div class="dash-tab-item" data-tab-id="${tab.tabId}">
      <span class="dash-tab-dot" style="background:${isActive ? 'var(--success)' : 'var(--text-tertiary)'}"></span>
      <span class="dash-tab-name">${escapeHtml(tab.name || tab.cliId || 'Terminal')}</span>
      <span class="dash-tab-status">${isActive ? '当前' : ''}</span>
    </div>`;
  }).join('');

  // Update once — event delegation on list handles clicks
  if (list.innerHTML !== html) {
    list.innerHTML = html;
  }
}

// Handle tab item clicks via event delegation (attached once)
document.addEventListener('click', (e) => {
  const item = e.target.closest('.dash-tab-item');
  if (!item) return;
  const tabId = item.dataset.tabId;
  if (tabId && Q.Tabs?.switch) {
    Q.Tabs.switch(tabId);
    const welcome = document.getElementById('welcome-overlay');
    if (welcome) welcome.classList.add('hidden');
  }
});

// ============================================================
// Clock
// ============================================================
function startClock() {
  updateClock();
  Dashboard._clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  setText('dash-clock', timeStr);

  // Update theme
  const theme = Q.state?.theme || 'dark';
  const themeEl = document.getElementById('dash-theme');
  if (themeEl) themeEl.textContent = theme === 'dark' ? '深色' : '亮色';

  // Estimate memory (not precise, but gives an idea)
  const memEl = document.getElementById('dash-memory');
  if (memEl && performance?.memory) {
    const mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
    memEl.textContent = mb + ' MB';
  } else if (memEl) {
    memEl.textContent = '—';
  }
}

// ============================================================
// Helpers
// ============================================================

/** Set text content with null-safety */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/** Add count-up animation class if value changed */
function animateIfChanged(id, newVal) {
  const el = document.getElementById(id);
  if (!el) return;
  // Map DOM id to _prevValues key
  const KEY_MAP = {
    'dash-total-clis': 'clis',
    'dash-count-agent': 'agent',
    'dash-count-dir': 'directory',
    'dash-count-tool': 'tool',
    'dash-count-fav': 'favorites',
  };
  const prevKey = KEY_MAP[id];
  if (!prevKey) return;
  const prev = Dashboard._prevValues[prevKey];
  if (prev !== undefined && prev !== newVal) {
    el.classList.remove('dash-countup');
    void el.offsetWidth;
    el.classList.add('dash-countup');
    setTimeout(() => el.classList.remove('dash-countup'), 350);
  }
}

/** Escape HTML entities */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** Format seconds into human-readable duration */
function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return mins + 'm ' + secs + 's';
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return hrs + 'h ' + remainMins + 'm';
}

// ── Expose on QCLI namespace ──
// Legacy compat
Q.Dashboard = Dashboard;
Dashboard.init = init;
Dashboard.refresh = refresh;
Dashboard.render = render;

// ── Auto-init on DOM ready ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // Small delay to ensure right panel is ready
  setTimeout(init, 100);
}
