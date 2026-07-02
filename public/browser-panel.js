// ============================================================
// Browser Preview Panel — simple iframe-based web viewer
// ============================================================
'use strict';

const urlInput = document.getElementById('browser-url-input');
const goBtn = document.getElementById('browser-go-btn');
const iframe = document.getElementById('browser-iframe');
const statusText = document.getElementById('browser-status-text');
const backBtn = document.getElementById('browser-back');
const forwardBtn = document.getElementById('browser-forward');
const refreshBtn = document.getElementById('browser-refresh');
const closeBtn = document.getElementById('browser-close');

// ── AI elements ──
const aiToggle = document.getElementById('browser-ai-toggle');
const aiPanel = document.getElementById('browser-ai-panel');
const aiInput = document.getElementById('browser-ai-input');
const aiSend = document.getElementById('browser-ai-send');
const aiResponse = document.getElementById('browser-ai-response');
const aiContext = document.getElementById('browser-ai-context');

// ── Navigation history ──
let history = [];
let historyIndex = -1;

function navigate(url) {
  if (!url || !url.trim()) return;
  url = url.trim();
  // Auto-add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  urlInput.value = url;
  statusText.textContent = '加载中...';
  iframe.src = url;

  // Update history (discard forward entries)
  history = history.slice(0, historyIndex + 1);
  history.push(url);
  historyIndex = history.length - 1;
  updateNavButtons();
  updateAIContext(url);
}

function updateNavButtons() {
  backBtn.disabled = historyIndex <= 0;
  forwardBtn.disabled = historyIndex >= history.length - 1;
}

// ── AI helpers ──
function updateAIContext(url) {
  if (aiContext) {
    const display = url || '无';
    aiContext.textContent = '当前页面：' + display;
  }
}

function doAIChat() {
  if (!aiInput || !aiResponse) return;
  const text = aiInput.value.trim();
  if (!text) return;
  aiInput.value = '';
  aiResponse.textContent = '正在思考...';

  const currentUrl = urlInput?.value || 'about:blank';

  if (window.QCLI?.ChatAPI?.sendMessage) {
    window.QCLI.ChatAPI.sendMessage({
      messages: [
        { role: 'system', content: '你是一个浏览器助手。根据用户提供的页面 URL 和问题，给出简洁的中文回答。如果不知道页面内容，诚实告知。' },
        { role: 'user', content: `当前页面 URL: ${currentUrl}\n\n${text}` },
      ],
      onToken: (token) => {
        if (aiResponse) aiResponse.textContent += token;
      },
      onError: (err) => {
        if (aiResponse) aiResponse.textContent = 'AI 出错: ' + err.message;
      },
    });
    if (aiResponse) aiResponse.textContent = '';
  } else {
    aiResponse.textContent = '请先在设置页配置 AI API Key';
  }
}

// ── Event bindings (only if panel elements exist) ──
if (iframe) {
  goBtn.addEventListener('click', () => navigate(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(urlInput.value);
  });

  backBtn.addEventListener('click', () => {
    if (historyIndex > 0) {
      historyIndex--;
      iframe.src = history[historyIndex];
      urlInput.value = history[historyIndex];
      updateNavButtons();
      updateAIContext(history[historyIndex]);
    }
  });

  forwardBtn.addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      iframe.src = history[historyIndex];
      urlInput.value = history[historyIndex];
      updateNavButtons();
      updateAIContext(history[historyIndex]);
    }
  });

  refreshBtn.addEventListener('click', () => {
    if (iframe.src && iframe.src !== 'about:blank') {
      iframe.src = iframe.src; // reload
    }
  });

  closeBtn.addEventListener('click', () => {
    iframe.src = 'about:blank';
    urlInput.value = '';
    statusText.textContent = '就绪';
    history = [];
    historyIndex = -1;
    updateNavButtons();
    updateAIContext(null);
  });

  // iframe load complete
  iframe.addEventListener('load', () => {
    statusText.textContent = '就绪';
    try {
      // Same-origin: sync address bar
      if (iframe.contentWindow?.location?.href) {
        urlInput.value = iframe.contentWindow.location.href;
        updateAIContext(iframe.contentWindow.location.href);
      }
    } catch {
      // Cross-origin: keep current URL
    }
  });

  // iframe error
  iframe.addEventListener('error', () => {
    statusText.textContent = '加载失败';
  });
}

// ── AI event wiring ──
if (aiToggle && aiPanel) {
  aiToggle.addEventListener('click', () => {
    aiPanel.classList.toggle('hidden');
    aiToggle.textContent = aiPanel.classList.contains('hidden') ? '🤖 AI' : '✕ 关闭';
  });
}
if (aiSend && aiInput && aiResponse) {
  aiSend.addEventListener('click', doAIChat);
  aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAIChat(); });
}

// Export for potential external control
export const BrowserPanel = { navigate, history, iframe };
// Legacy compat
const Q = window.QCLI = window.QCLI || {};
Q.BrowserPanel = BrowserPanel;
