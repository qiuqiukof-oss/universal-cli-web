// ============================================================
// Multi-Media Panel — Image Gallery, Video Player, File Preview
// Integrates with existing media-preview.js overlay
// ============================================================
const Q = window.QCLI = window.QCLI || {};

export const Media = {
  _initialized: false,
  /** @type {Array<{id:string,name:string,path:string,mime:string,size:number,addedAt:number}>} */
  _files: [],
  _activeFilter: 'all',
  _activePlayer: null, // video player element reference
};

const STORAGE_KEY = 'qcli-media-files';
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'application/pdf',
];

// ============================================================
// Initialization
// ============================================================

function init() {
  if (Media._initialized) return;
  Media._initialized = true;

  // Load saved files
  loadFiles();

  // Patch RightPanel switchTab to render on activation, stop player on deactivation
  if (Q.RightPanel) {
    const _origSwitch = Q.RightPanel.switchTab;
    Q.RightPanel.switchTab = function(tabId) {
      const prevTab = Q.RightPanel.activeTab;
      _origSwitch.call(Q.RightPanel, tabId);
      if (tabId === 'media') {
        render();
      } else if (prevTab === 'media') {
        // Stop video playback when switching away from media tab
        stopPlayer();
      }
    };
  }

  // Watch for panel activation
  const panel = document.getElementById('rp-media');
  if (panel) {
    const observer = new MutationObserver(() => {
      if (panel.classList.contains('active')) {
        observer.disconnect();
        setTimeout(render, 100);
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    if (panel.classList.contains('active')) {
      observer.disconnect();
      setTimeout(render, 100);
    }
  }

  // Listen to terminal context menu for file clicks
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.panel === 'media') {
      setTimeout(render, 50);
    }
  });

  console.log('[Media] Initialized');
}

// ============================================================
// File Persistence
// ============================================================

function loadFiles() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      Media._files = JSON.parse(saved);
    }
  } catch (e) { /* ignore */ }
}

function saveFiles() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Media._files));
  } catch (e) { /* ignore */ }
}

function addFile(fileData) {
  Media._files.unshift(fileData);
  saveFiles();
  // Re-render gallery if media panel is visible
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) {
    renderGallery();
  }
}

function removeFile(id) {
  // Find the file being removed
  const removed = Media._files.find(f => f.id === id);
  Media._files = Media._files.filter(f => f.id !== id);
  saveFiles();

  // If the removed file is currently playing, pause the player
  if (removed && Media._activePlayer && !Media._activePlayer.paused) {
    const currentSrc = Media._activePlayer.src;
    const fileName = removed.name;
    if (currentSrc && currentSrc.includes(encodeURIComponent(fileName))) {
      Media._activePlayer.pause();
      Media._activePlayer.src = '';
      Media._activePlayer.classList.add('hidden');
      const placeholder = document.getElementById('media-player-placeholder');
      if (placeholder) placeholder.classList.remove('hidden');
      const header = document.querySelector('.media-player-header');
      if (header) header.innerHTML = '<span>🎬</span><span>播放器</span>';
    }
  }

  // Re-render gallery if media panel is visible
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) {
    renderGallery();
  }
}

function clearAllFiles() {
  // Pause any active video
  stopPlayer();
  Media._files = [];
  saveFiles();
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) {
    render();
  }
}

function stopPlayer() {
  if (Media._activePlayer) {
    Media._activePlayer.pause();
    Media._activePlayer.src = '';
    Media._activePlayer.classList.add('hidden');
    Media._activePlayer = null;
  }
  const placeholder = document.getElementById('media-player-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
  const header = document.querySelector('.media-player-header');
      if (header) header.innerHTML = '<span>🎬</span><span>播放器</span>';
}

// ============================================================
// Render
// ============================================================

function render() {
  const panel = document.getElementById('rp-media');
  if (!panel) return;

  panel.innerHTML = buildPanelHTML();
  setupEventListeners(panel);
  renderGallery();
  setupDropZone(panel);
}

function buildPanelHTML() {
  return `
    <div class="media-content" id="media-content">
      <!-- Drop Zone -->
      <div class="media-section">
        <div class="media-drop-zone" id="media-drop-zone">
          <div class="media-drop-icon">📁</div>
          <div class="media-drop-text">拖拽文件到此处上传</div>
          <div class="media-drop-hint">或点击选择文件</div>
          <input type="file" id="media-file-input" multiple hidden
            accept="image/*,video/*,application/pdf,.svg" />
        </div>
        <div class="media-upload-progress hidden" id="media-upload-progress">
          <div class="media-upload-progress-bar" id="media-upload-progress-bar"></div>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="media-section">
        <div class="media-toolbar">
          <div class="media-filter-tabs" id="media-filter-tabs">
            <button class="media-filter-btn active" data-filter="all">全部</button>
            <button class="media-filter-btn" data-filter="image">图片</button>
            <button class="media-filter-btn" data-filter="video">视频</button>
            <button class="media-filter-btn" data-filter="pdf">文档</button>
          </div>
          <button class="media-action-btn" id="media-upload-btn" title="选择文件上传">📁</button>
          <button class="media-action-btn danger" id="media-clear-btn" title="清除全部">🗑️</button>
          <a href="/media" class="media-standalone-btn" title="新窗口打开独立页面" target="_blank">↗</a>
        </div>
      </div>

      <!-- Gallery -->
      <div class="media-section" style="flex:1;min-height:0;">
        <div class="media-gallery" id="media-gallery"></div>
        <div class="media-empty" id="media-empty">
          <div class="media-empty-icon">🎬</div>
          <div class="media-empty-text">暂无媒体文件</div>
          <div class="media-empty-hint">拖拽或点击上传图片、视频、PDF 文件</div>
        </div>
      </div>

      <!-- Video Player -->
      <div class="media-section">
        <div class="media-section-title">视频播放器</div>
        <div class="media-player-section">
          <div class="media-player-header">
            <span>🎬</span>
            <span>播放器</span>
          </div>
          <div class="media-player-area" id="media-player-area">
            <div class="media-player-placeholder" id="media-player-placeholder">
              <div class="media-player-placeholder-icon">▶</div>
              <span>选择一个视频播放</span>
            </div>
            <video id="media-player" class="hidden" controls playsinline preload="metadata"></video>
          </div>
        </div>
      </div>

      <!-- Info Bar -->
      <div class="media-info-bar" id="media-info-bar">
        <span id="media-file-count">0 个文件</span>
        <span id="media-total-size">0 B</span>
        <div style="flex:1"></div>
        <button class="media-ai-toggle" id="media-ai-toggle">🤖 AI</button>
      </div>

      <!-- AI Panel -->
      <div class="media-ai-panel hidden" id="media-ai-panel">
        <div class="media-ai-response" id="media-ai-response">
          AI 分析媒体文件，输入问题开始。
        </div>
        <div class="media-ai-input-row">
          <input type="text" id="media-ai-input" placeholder="例如：总共有多少图片？" />
          <button id="media-ai-send">发送</button>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// Gallery Rendering
// ============================================================

function renderGallery() {
  const gallery = document.getElementById('media-gallery');
  const empty = document.getElementById('media-empty');
  const fileCount = document.getElementById('media-file-count');
  const totalSize = document.getElementById('media-total-size');

  if (!gallery) return;

  let files = Media._files;
  // Apply filter
  if (Media._activeFilter !== 'all') {
    files = files.filter(f => {
      const mime = (f.mime || '').toLowerCase();
      if (Media._activeFilter === 'image') return mime.startsWith('image/');
      if (Media._activeFilter === 'video') return mime.startsWith('video/');
      if (Media._activeFilter === 'pdf') return mime === 'application/pdf';
      return true;
    });
  }

  if (files.length === 0) {
    gallery.innerHTML = '';
    if (empty) empty.style.display = '';
  } else {
    if (empty) empty.style.display = 'none';
    gallery.innerHTML = files.map(f => buildGalleryItem(f)).join('');
  }

  // Update info bar
  if (fileCount) {
    const total = Media._files.length;
    const filtered = files.length;
    fileCount.textContent = total > 0 && total !== filtered
      ? filtered + ' / ' + total + ' 个文件'
      : total + ' 个文件';
  }
  if (totalSize) {
    const totalBytes = Media._files.reduce((sum, f) => sum + (f.size || 0), 0);
    totalSize.textContent = formatFileSize(totalBytes);
  }
}

function buildGalleryItem(file) {
  const mime = (file.mime || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf';

  const thumbContent = isImage
    ? `<img src="/api/uploads/${encodeURIComponent(file.name)}?mime=${encodeURIComponent(mime)}" alt="${escapeHtml(file.name)}" loading="lazy" />`
    : isVideo
      ? `<span class="media-thumb-icon">🎬</span>`
      : isPdf
        ? `<span class="media-thumb-icon">📄</span>`
        : `<span class="media-thumb-icon">📁</span>`;

  return `
    <div class="media-item" data-file-id="${file.id}" data-mime="${mime}">
      <div class="media-thumb">
        ${thumbContent}
        <div class="media-thumb-overlay">
          <span>${isVideo ? '▶ 播放' : isImage ? '🔍 预览' : '📁 打开'}</span>
        </div>
      </div>
      <button class="media-delete-btn" data-action="delete" title="删除">✕</button>
      <div class="media-info-row">
        <span class="media-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="media-file-meta">${formatFileSize(file.size)} 路 ${getFileTypeLabel(mime)}</span>
      </div>
    </div>
  `;
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners(panel) {
  // Filter tabs
  const filterTabs = panel.querySelector('#media-filter-tabs');
  if (filterTabs) {
    filterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.media-filter-btn');
      if (btn && btn.dataset.filter) {
        filterTabs.querySelectorAll('.media-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Media._activeFilter = btn.dataset.filter;
        renderGallery();
      }
    });
  }

  // Upload button
  const uploadBtn = panel.querySelector('#media-upload-btn');
  const fileInput = panel.querySelector('#media-file-input');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(e.target.files);
        e.target.value = ''; // reset
      }
    });
  }

  // Clear button
  const clearBtn = panel.querySelector('#media-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearAllFiles);
  }

  // Gallery click delegation
  const gallery = panel.querySelector('#media-gallery');
  if (gallery) {
    gallery.addEventListener('click', (e) => {
      // Delete button
      const delBtn = e.target.closest('[data-action="delete"]');
      if (delBtn) {
        const item = delBtn.closest('.media-item');
        if (item && item.dataset.fileId) {
          removeFile(item.dataset.fileId);
        }
        return;
      }

      // Media item click 鈫?preview
      const item = e.target.closest('.media-item');
      if (item && item.dataset.fileId) {
        const file = Media._files.find(f => f.id === item.dataset.fileId);
        if (file) {
          const mime = (file.mime || '').toLowerCase();
          if (mime.startsWith('video/')) {
            playVideo(file);
          } else if (mime.startsWith('image/') || mime === 'application/pdf') {
            openPreview(file);
  }

  // ── AI event wiring ──
  const aiToggle = panel.querySelector('#media-ai-toggle');
  const aiPanel = panel.querySelector('#media-ai-panel');
  const aiInput = panel.querySelector('#media-ai-input');
  const aiSend = panel.querySelector('#media-ai-send');
  const aiResponse = panel.querySelector('#media-ai-response');

  if (aiToggle && aiPanel) {
    aiToggle.addEventListener('click', () => {
      aiPanel.classList.toggle('hidden');
      aiToggle.textContent = aiPanel.classList.contains('hidden') ? '🤖 AI' : '✕ 关闭';
    });
  }

  if (aiSend && aiInput && aiResponse) {
    const doMediaAIChat = () => {
      const text = aiInput.value.trim();
      if (!text) return;
      aiInput.value = '';

      const fileCount = Media._files.length;
      const imgCount = Media._files.filter(f => f.mime.startsWith('image/')).length;
      const vidCount = Media._files.filter(f => f.mime.startsWith('video/')).length;
      const pdfCount = Media._files.filter(f => f.mime === 'application/pdf').length;

      aiResponse.textContent = '正在思考...';

      if (window.QCLI?.ChatAPI?.sendMessage) {
        window.QCLI.ChatAPI.sendMessage({
          messages: [
            { role: 'system', content: '你是一个媒体文件管理助手。用中文简洁回答关于媒体文件的问题。' },
            { role: 'user', content: `我有 ${fileCount} 个媒体文件（${imgCount} 图片，${vidCount} 视频，${pdfCount} PDF）。\n\n${text}` },
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
    };
    aiSend.addEventListener('click', doMediaAIChat);
    aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doMediaAIChat(); });
  }
}
      }
    });
  }
}

// ============================================================
// Drag & Drop
// ============================================================

function setupDropZone(panel) {
  const dropZone = panel.querySelector('#media-drop-zone');
  const fileInput = panel.querySelector('#media-file-input');
  if (!dropZone) return;

  // Click to open file picker
  dropZone.addEventListener('click', () => {
    if (fileInput) fileInput.click();
  });

  // Drag events
  let dragCounter = 0;

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropZone.classList.remove('drag-over');

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });
}

// ============================================================
// Upload
// ============================================================

async function uploadFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  // Validate types
  const validFiles = files.filter(f => {
    const valid = ALLOWED_TYPES.includes(f.type) || f.type.startsWith('image/') || f.type.startsWith('video/');
    if (!valid) {
      Q.showToast?.('不支持的文件类型: ' + f.name, 'error');
    }
    return valid;
  });

  if (validFiles.length === 0) return;

  const progressBar = document.getElementById('media-upload-progress');
  const progressFill = document.getElementById('media-upload-progress-bar');
  if (progressBar) progressBar.classList.remove('hidden');

  const formData = new FormData();
  validFiles.forEach(f => formData.append('files', f));

  try {
    const xhr = new XMLHttpRequest();

    const result = await new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && progressFill) {
          const pct = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = pct + '%';
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid response')); }
        } else {
          reject(new Error('Upload failed: ' + xhr.status));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error')));

      xhr.open('POST', '/api/upload');
      xhr.send(formData);
    });

    // Add uploaded files to local store
    if (result && result.success && result.files) {
      result.files.forEach(f => {
        addFile({
          id: generateId(),
          name: f.name,
          path: f.path,
          mime: f.mime || detectMimeType(f.name),
          size: f.size || 0,
          addedAt: Date.now(),
        });
      });
      Q.showToast?.('成功上传 ' + result.files.length + ' 个文件', 'success');
    }
  } catch (err) {
    console.error('[Media] Upload error:', err);
    Q.showToast?.('上传失败: ' + err.message, 'error');
  } finally {
    if (progressBar) progressBar.classList.add('hidden');
    if (progressFill) progressFill.style.width = '0%';
  }
}

// ============================================================
// Preview & Playback
// ============================================================

function openPreview(file) {
  // Use existing media-preview.js overlay
  if (Q.Upload && Q.Upload.openMediaPreview) {
    Q.Upload.openMediaPreview([{
      name: file.name,
      path: file.path || file.name,
      mime: file.mime || '',
      size: file.size || 0,
    }], 0);
  }
}

function playVideo(file) {
  const player = document.getElementById('media-player');
  const placeholder = document.getElementById('media-player-placeholder');
  if (!player) return;

  // Stop any current playback
  player.pause();
  player.currentTime = 0;

  const url = '/api/uploads/' + encodeURIComponent(file.name) + '?mime=' + encodeURIComponent(file.mime || '');
  player.src = url;
  player.load();

  // Show player, hide placeholder
  if (placeholder) placeholder.classList.add('hidden');
  player.classList.remove('hidden');

  player.play().catch(e => {
    console.warn('[Media] Autoplay prevented:', e.message);
  });

  // Update player header
  const header = document.querySelector('.media-player-header');
  if (header) {
    header.innerHTML = `<span>🎬</span><span>${escapeHtml(file.name)}</span>`;
  }

  // Track active player for cleanup
  Media._activePlayer = player;
}

// ============================================================
// Helpers
// ============================================================

let _idCounter = Date.now();
function generateId() {
  return 'media-' + (++_idCounter);
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function getFileTypeLabel(mime) {
  if (!mime) return '未知';
  if (mime.startsWith('image/')) return '图片';
  if (mime.startsWith('video/')) return '视频';
  if (mime === 'application/pdf') return 'PDF';
  return '文件';
}

function detectMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'ogg': 'video/ogg',
    'mov': 'video/quicktime', 'pdf': 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// Cleanup
// ============================================================

function cleanup() {
  stopPlayer();
}

window.addEventListener('beforeunload', cleanup);

// ============================================================
// Exports
// ============================================================
// Legacy compat
Q.Media = Media;
Media.init = init;
Media.render = render;
Media.addFile = addFile;
Media.removeFile = removeFile;
Media.cleanup = cleanup;

// ── Auto-init ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 300);
}

