// ============================================================
// Q-CLI Hub — esbuild entry point
// All modules converted from IIFE to ESM, bundled into single output.
// Each module sets window.QCLI.* for cross-module dependency resolution. // eslint-disable-line
// ============================================================

// ── Import converted modules in original script order ──
import './i18n.js';      // i18n → sets Q.__, Q._locale, Q.setLanguage, etc.
import './state.js';     // State → sets Q.state, Q.dom, Q.$ , etc.
import './chat-api.js';  // ChatAPI → sets Q.ChatAPI
import './toast.js';     // Toast  → sets Q.showToast, Q.showUploadStatus

// ── Storage layer (IndexedDB / localStorage) ──
import './session-store.js'; // SessionStore  → terminal tab persistence
import './stores.js';        // HistoryStore, PinStore, SnippetStore
import './workspace-store.js'; // WorkspaceStore → profile save/restore

// ── Utilities (no deps on other QCLI modules) ──
import './upload.js';        // Upload → file upload & media preview
import './custom-css.js';    // CustomCSS → user CSS injection
import './shortcuts.js';     // Shortcuts → keyboard shortcut panel
import './pin-report.js';    // PinReport → pin management UI

// ── UI panels (loaded after utilities) ──
import './sidebar.js';       // Sidebar → CLI list & folder rendering
import './palette.js';       // Palette → command palette
import './chat-ui.js';       // ChatUI  → chat panel rendering
import './agents.js';        // Agents  → AI CLI agent workbench
import './workflows.js';     // Workflows → multi-step agent orchestration

// ── Chart engine (no QCLI deps) ──
import './chart-core.js';    // ChartCore → canvas chart engine

// ── Browser preview panel (no QCLI deps) ──
import './browser-panel.js'; // BrowserPanel → iframe web viewer

// ── Tab manager (reads Q.wsSend/Q.resetInputBuffer lazily) ──
import './tabs.js';          // Tabs → multi-session terminal tabs

// ── Voice input (Web Speech API, all Q reads lazy) ──
import './voice-input.js';   // VoiceInput → speech-to-text for terminal

// ── Preset selector — loaded before settings/dashboard (reads Q.Welcome lazily) ──
import './presets.js';       // Presets → CLI presets, welcome carousel

// ── Settings — export/import, env vars, config management (reads Q.state/Q.dom lazily) ──
import './settings.js';      // Settings → settings UI, env vars

// ── Media preview overlay (Q.Upload extensions, all Q reads lazy) ──
import './media-preview.js'; // MediaPreview → overlay for image/video preview

// ── Terminal search bar (reads Q.searchAddon lazily) ──
import './terminal-search.js'; // TerminalSearch → search in xterm

// ── Right panel controller (reads Q.Tabs/Q.state/Q.wsSend lazily) ──
import './right-panel.js';   // RightPanel → dashboard/charts/media sidebar

// ── Stock analysis panel (uses ChartCore, reads Q.RightPanel lazily) ──
import './stock-analysis.js'; // Stocks → stock/fund charts in right panel

// ── Multi-Media panel — image gallery, video player, file preview ──
import './multi-media.js';   // Media → media gallery in right panel

// ── Dashboard panel — system status, CLI stats, runtime overview ──
import './dashboard.js';     // Dashboard → system dashboard tab

// ── Quant Trading panel — simulated AI quant strategy backtester ──
import './quant-trading.js'; // QuantTrading → quant trading tab

// ── App — main CLI bridge frontend (init & wire everything) ──
import './app.js';           // App → init(), all UI wiring, event handlers

// ── Boot message (bundle loaded successfully) ──
console.log('[Q-CLI] ES module bundle loaded — window.QCLI ready');
