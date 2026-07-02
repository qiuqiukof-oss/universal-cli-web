// ============================================================
// Tab Manager — Multi-Session Terminal Tabs
// ============================================================
'use strict';

const Q = window.QCLI = window.QCLI || {};

export const Tabs = {
    /** @type {Array<{tabId:string, cliId:string, name:string, icon:string, buffer:string, init?:string, pinned?:boolean}>} */
    tabs: [],
    /** @type {string|null} */
    activeTabId: null,
    /** @type {Terminal|null} — set by app.js after terminal init */
    term: null,
    /** @type {FitAddon|null} */
    fitAddon: null,
    /** @type {number|null} — periodic save interval id */
    _saveInterval: null,
    /** @type {RegExp} — ANSI escape sequence regex */
    _ansiRe: /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    /** @type {Object.<string, string[]>} — buffered output before tab creation */
    _pendingOutput: {},
    /** @type {number} — source index during drag-and-drop */
    _dragSourceIndex: -1,

    /**
     * Create a new tab and switch to it.
     */
    create(tabId, cliId, name, icon, init) {
      // Save current terminal content to previous tab before switching
      this.saveActiveTerminal();

      // Add new tab to list
      const newTab = { tabId, cliId, name, icon, init: init || '', buffer: '', pinned: false };
      this.tabs.push(newTab);
      this.activeTabId = tabId;

      // Clear terminal for the new session
      if (this.term) {
        this.term.reset();
      }

      // Hide welcome overlay
      const welcome = document.getElementById('welcome-overlay');
      if (welcome) welcome.classList.add('hidden');

      this.render();

      // Flush any pending output that arrived before tab creation
      this._flushPendingOutput(tabId);

      // Persist: save the new tab to IndexedDB
      this._persistTab(tabId);
      this._startPeriodicSave();

      return newTab;
    },

    /**
     * Switch to an existing tab by id.
     */
    switch(tabId) {
      if (tabId === this.activeTabId || !this.term) return;

      // Save current buffer to the old tab
      this.saveActiveTerminal();

      // Persist: save the old tab before switching
      if (this.activeTabId) {
        this._persistTab(this.activeTabId);
      }

      // Clear input buffer from app.js (partial command shouldn't carry over)
      if (window.QCLI?.resetInputBuffer) {
        window.QCLI.resetInputBuffer();
      }

      // Switch active tab
      this.activeTabId = tabId;

      // Reset and restore new tab's buffer
      this.term.reset();
      this.restoreTabBuffer(tabId);

      this.render();
    },

    /**
     * Close a tab, killing its PTY on the backend.
     */
    close(tabId) {
      const idx = this.tabs.findIndex(t => t.tabId === tabId);
      if (idx === -1) return;

      // Kill PTY on backend
      if (Q.wsSend) {
        Q.wsSend({ type: 'kill', tabId });
      }

      // Clean up pending output
      delete this._pendingOutput[tabId];

      // Remove from IndexedDB
      if (window.QCLI?.SessionStore) {
        window.QCLI.SessionStore.removeTab(tabId);
      }

      // Remove from array
      this.tabs.splice(idx, 1);

      // Handle active tab change
      if (this.activeTabId === tabId) {
        if (this.tabs.length > 0) {
          // Switch to nearest remaining tab
          const nextIdx = Math.min(idx, this.tabs.length - 1);
          const nextTab = this.tabs[nextIdx];
          this.activeTabId = nextTab.tabId;
          if (this.term) {
            this.term.reset();
            this.restoreTabBuffer(nextTab.tabId);
          }
        } else {
          // No more tabs — show welcome
          this.activeTabId = null;
          this._stopPeriodicSave();
          const welcome = document.getElementById('welcome-overlay');
          if (welcome) welcome.classList.remove('hidden');
          if (this.term) this.term.reset();
          const activeLabel = document.getElementById('active-cli-label');
          if (activeLabel) activeLabel.textContent = 'No CLI running';
          const activeVersion = document.getElementById('active-cli-version');
          if (activeVersion) activeVersion.textContent = '';
        }
      }

      this.render();
    },

    /**
     * Move a tab from one position to another (drag-and-drop).
     * @param {number} fromIdx
     * @param {number} toIdx
     */
    move(fromIdx, toIdx) {
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= this.tabs.length || toIdx >= this.tabs.length) return;
      const [tab] = this.tabs.splice(fromIdx, 1);
      this.tabs.splice(toIdx, 0, tab);
      this._persistAllTabs();
      this.render();
    },

    /**
     * Toggle pin state for a tab.
     * @param {string} tabId
     */
    togglePin(tabId) {
      const tab = this.getTab(tabId);
      if (!tab) return;
      tab.pinned = !tab.pinned;
      this._persistTab(tabId);
      this.render();
    },

    /**
     * Get tabs sorted with pinned ones first.
     * @returns {Array} sorted copy of tabs
     */
    getPinnedFirst() {
      return [...this.tabs].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });
    },

    /**
     * Save the current xterm.js terminal content to the active tab's buffer.
     */
    saveActiveTerminal() {
      if (!this.activeTabId || !this.term) return;
      const tab = this.getTab(this.activeTabId);
      if (!tab) return;

      try {
        const buffer = this.term.buffer.active;
        const lines = [];
        // iterate through ALL rows (including scrollback within scrollback limit)
        const len = buffer.length;
        for (let y = 0; y < len; y++) {
          const line = buffer.getLine(y);
          if (line) {
            lines.push(line.translateToString());
          }
        }
        // Join with actual line breaks
        tab.buffer = lines.join('\n');
      } catch (e) {
        // If buffer access fails, no-op
      }
    },

    /**
     * Restore a tab's buffered content to the xterm.js terminal.
     */
    restoreTabBuffer(tabId) {
      if (!this.term) return;
      const tab = this.getTab(tabId);
      if (!tab || !tab.buffer) return;

      try {
        // Use write() instead of writeln() to avoid extra \r\n per line
        this.term.write(tab.buffer);
      } catch (e) {
        // If write fails, no-op
      }
    },

    /**
     * Append PTY output to the active tab's terminal and buffer.
     * Only writes to the visible terminal when the data belongs to the active tab.
     * @param {string} data - Raw PTY output
     * @param {string} [tabId] - The originating tab's ID (sent by server)
     */
    appendOutput(data, tabId) {
      // Only write to the visible terminal if data belongs to the active tab
      // (or if no tabId was provided, for backward compatibility)
      const isForActiveTab = !tabId || tabId === this.activeTabId;
      if (this.term && isForActiveTab) {
        this.term.write(data);
      }

      // Buffer the data for the correct tab
      const targetTabId = tabId || this.activeTabId;
      if (targetTabId) {
        const tab = this.getTab(targetTabId);
        if (tab) {
          // Strip ANSI codes for buffer (plain text preservation)
          const plain = data.replace(this._ansiRe, '');
          tab.buffer = (tab.buffer || '') + plain;
          // Keep buffer under ~100KB per tab to avoid memory issues
          if (tab.buffer.length > 100000) {
            tab.buffer = tab.buffer.slice(-50000);
          }
        }
      }
    },

    /**
     * Get a tab by id.
     */
    getTab(tabId) {
      return this.tabs.find(t => t.tabId === tabId);
    },

    /**
     * Render the tab bar UI.
     */
    render() {
      const bar = document.getElementById('tab-bar');
      if (!bar) return;

      bar.innerHTML = '';

      for (const tab of this.tabs) {
        const el = document.createElement('div');
        el.className = 'tab-item' + (tab.tabId === this.activeTabId ? ' active' : '');
        el.dataset.tabId = tab.tabId;
        el.draggable = true;
        el.dataset.dragIndex = this.tabs.indexOf(tab);
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.tabId);
          el.classList.add('dragging');
          this._dragSourceIndex = this.tabs.indexOf(tab);
        });
        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
          document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('drag-over'));
          this._dragSourceIndex = -1;
        });
        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('drag-over'));
          el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', () => {
          el.classList.remove('drag-over');
        });
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          el.classList.remove('drag-over');
          const fromIdx = this._dragSourceIndex;
          const toIdx = this.tabs.indexOf(tab);
          if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
            this.move(fromIdx, toIdx);
          }
          this._dragSourceIndex = -1;
        });
        el.title = tab.name || tab.cliId || 'Terminal';

        // CLI category color accent
        const clis = window.QCLI?.state?.clis || [];
        const cliObj = clis.find(c => c.id === tab.cliId);
        if (cliObj?.category) {
          el.dataset.category = cliObj.category;
        }

        // Icon
        const icon = document.createElement('span');
        icon.className = 'tab-icon';
        icon.textContent = tab.icon || '▶';
        el.appendChild(icon);

        // Name
        const name = document.createElement('span');
        name.className = 'tab-name';
        name.textContent = tab.name || tab.cliId || 'Terminal';
        el.appendChild(name);

        // Pin button
        const pinBtn = document.createElement('button');
        pinBtn.className = 'tab-pin' + (tab.pinned ? ' pinned' : '');
        pinBtn.textContent = tab.pinned ? '📍' : '📌';
        pinBtn.title = tab.pinned ? 'Unpin tab' : 'Pin tab';
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePin(tab.tabId);
        });
        el.appendChild(pinBtn);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '×';
        closeBtn.title = 'Close tab';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close(tab.tabId);
        });
        el.appendChild(closeBtn);

        // Click to switch
        el.addEventListener('click', () => {
          this.switch(tab.tabId);
        });

        // Middle-click to close
        el.addEventListener('auxclick', (e) => {
          if (e.button === 1) {
            e.preventDefault();
            this.close(tab.tabId);
          }
        });

        bar.appendChild(el);
      }

      // Update tab bar visibility
      bar.classList.toggle('has-tabs', this.tabs.length > 0);
    },

    /**
     * Close all tabs (for reconnection / cleanup).
     */
    closeAll() {
      // Clear pending output
      this._pendingOutput = {};

      // Persist: save all tabs before closing
      this._persistAllTabs();

      for (const tab of this.tabs) {
        if (Q.wsSend) {
          Q.wsSend({ type: 'kill', tabId: tab.tabId });
        }
      }
      this.tabs = [];
      this.activeTabId = null;
      this._stopPeriodicSave();
      this.render();
      if (this.term) this.term.reset();
      const welcome = document.getElementById('welcome-overlay');
      if (welcome) welcome.classList.remove('hidden');
    },

    // ──────────────────────────────────────────────
    // Pending Output + Session Persistence Helpers
    // ──────────────────────────────────────────────

    /**
     * Flush any output that was buffered before a tab was created.
     * @param {string} tabId
     */
    _flushPendingOutput(tabId) {
      const pending = this._pendingOutput[tabId];
      if (!pending || pending.length === 0) return;

      const tab = this.getTab(tabId);
      if (!tab) return;

      // Batch-concatenate plain text for the buffer
      const plainText = pending
        .map(d => d.replace(this._ansiRe || /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, ''))
        .join('');
      tab.buffer = (tab.buffer || '') + plainText;
      if (tab.buffer.length > 100000) {
        tab.buffer = tab.buffer.slice(-50000);
      }

      // Write to terminal if this is the active tab — batch into one write
      if (tabId === this.activeTabId && this.term) {
        const rawText = pending.join('');
        this.term.write(rawText);
      }

      delete this._pendingOutput[tabId];
    },

    /**
     * Save a single tab to IndexedDB.
     * @param {string} tabId
     */
    _persistTab(tabId) {
      if (!window.QCLI?.SessionStore) return;
      const tab = this.getTab(tabId);
      if (!tab) return;

      window.QCLI.SessionStore.saveTab(tabId, {
        cliId: tab.cliId,
        name: tab.name,
        icon: tab.icon,
        init: tab.init || '',
        pinned: !!tab.pinned,
        buffer: tab.buffer || '',
        status: tabId === this.activeTabId ? 'active' : 'inactive',
      });
    },

    /**
     * Save all tabs to IndexedDB.
     */
    _persistAllTabs() {
      for (const tab of this.tabs) {
        this._persistTab(tab.tabId);
      }
      // Flush immediately
      if (window.QCLI?.SessionStore) {
        window.QCLI.SessionStore.flushSaves();
      }
    },

    /**
     * Start periodic save interval (every 15 seconds).
     */
    _startPeriodicSave() {
      if (this._saveInterval) return;
      this._saveInterval = setInterval(() => {
        if (this.activeTabId) {
          this.saveActiveTerminal();
          this._persistTab(this.activeTabId);
        }
      }, 15000);
    },

    /**
     * Stop the periodic save interval.
     */
    _stopPeriodicSave() {
      if (this._saveInterval) {
        clearInterval(this._saveInterval);
        this._saveInterval = null;
      }
    },

    /**
     * Restore tabs from IndexedDB data.
     * Called by the session restore overlay.
     * @param {Array} sessions - Array of session objects from IndexedDB
     */
    restoreSessions(sessions) {
      if (!sessions || sessions.length === 0) return;

      // Save current active tab first
      this.saveActiveTerminal();

      for (const session of sessions) {
        // Skip if already exists
        if (this.getTab(session.tabId)) continue;

        const tab = {
          tabId: session.tabId,
          cliId: session.cliId,
          name: session.name,
          icon: session.icon || '▶',
          init: session.init || '',
          buffer: session.buffer || '',
        };
        this.tabs.push(tab);
      }

      // Switch to the first restored tab (or keep current if none)
      if (this.tabs.length > 0 && !this.activeTabId) {
        this.activeTabId = this.tabs[0].tabId;
        if (this.term) {
          this.term.reset();
          this.restoreTabBuffer(this.activeTabId);
        }
        const welcome = document.getElementById('welcome-overlay');
        if (welcome) welcome.classList.add('hidden');
      }

      this.render();
      this._startPeriodicSave();
    },
  };

// Legacy compat
Q.Tabs = Tabs;

// ── Save all tabs on page unload ──
window.addEventListener('beforeunload', () => {
  if (Tabs.tabs.length > 0) {
    Tabs.saveActiveTerminal();
    Tabs._persistAllTabs();
  }
});
