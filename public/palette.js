// ============================================================
// Q-CLI Command Palette Module
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

export const Palette = {
    open: false,
    input: null,
    results: null,
    overlay: null,
    highlightedIdx: 0,
    items: [],
    openPalette: null,
    closePalette: null,
    init: null,
  };


  // ── Snippet integration ──
  async function loadSnippets() {
    if (!window.QCLI?.SnippetStore) return [];
    return await window.QCLI.SnippetStore.getAll();
  }

  Palette.loadSnippets = loadSnippets;
  Q.Palette = Palette;
