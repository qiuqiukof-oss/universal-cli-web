// ============================================================
// Workspace Store — Save/restore tab configurations as profiles
// ============================================================
'use strict';

const Q = window.QCLI = window.QCLI || {};

const STORAGE_KEY = 'qcli-workspaces';
const MAX_WORKSPACES = 20;

export const WorkspaceStore = {
  /** Get all saved workspaces */
  getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  },

  /** Save all workspaces */
  _saveAll(workspaces) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
    } catch (e) { /* ignore */ }
  },

  /** Create a new workspace from current tabs */
  async save(name, tabs) {
    if (!name || !name.trim()) return null;
    const workspaces = this.getAll();
    // Sort tabs: pinned first
    const sorted = [...tabs].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
    const ws = {
      id: 'ws-' + Date.now(),
      name: name.trim(),
      tabs: sorted.map(t => ({
        cliId: t.cliId,
        name: t.name,
        icon: t.icon,
        init: t.init || '',
      })),
      createdAt: Date.now(),
      tabCount: sorted.length,
    };
    workspaces.push(ws);
    if (workspaces.length > MAX_WORKSPACES) {
      workspaces.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      workspaces.length = MAX_WORKSPACES;
    }
    this._saveAll(workspaces);
    return ws;
  },

  /** Delete a workspace by id */
  remove(id) {
    const workspaces = this.getAll().filter(w => w.id !== id);
    this._saveAll(workspaces);
  },

  /** Get a single workspace by id */
  get(id) {
    return this.getAll().find(w => w.id === id) || null;
  },
};

// Legacy compat
Q.WorkspaceStore = WorkspaceStore;
