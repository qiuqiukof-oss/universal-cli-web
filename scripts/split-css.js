// CSS Split Script v2 — uses exact line ranges from section headers
const fs = require('fs');
const path = require('path');

const cssFile = path.join(__dirname, '..', 'public', 'style.css');
const cssDir = path.join(__dirname, '..', 'public', 'css');

if (!fs.existsSync(cssDir)) fs.mkdirSync(cssDir, { recursive: true });

const content = fs.readFileSync(cssFile, 'utf8');
const lines = content.split('\n');

// Hardcoded line ranges (0-indexed) based on section header analysis
// Each entry: [startLine, endLineExclusive, file]
// Sections cover everything including their header banners
const assignments = [
  // theme.css — CSS variables, reset, global scrollbar, theme refinements
  [0,    99,    'theme.css'],    // Header + Variables (:root, dark, light)
  [99,   175,   'theme.css'],    // Global Progress Bar
  [175,  182,   'theme.css'],    // Layout (body { display: flex })
  [4609, 4644,  'theme.css'],    // Scrollbar
  [5521, 5601,  'theme.css'],    // Theme Refinements
  [5601, 5610,  'theme.css'],    // Custom CSS injected
  
  // sidebar.css — ALL sidebar content
  [182,  324,   'sidebar.css'],  // Sidebar (layout + sub-sections)
  [2761, 2804,  'sidebar.css'],  // Category Filters
  [3931, 3938,  'sidebar.css'],  // Mobile Sidebar Overlay
  [4644, 4711,  'sidebar.css'],  // Responsive
  [5412, 5453,  'sidebar.css'],  // CLI List Entrance Animation
  [6527, 6654,  'sidebar.css'],  // Output Pins (sidebar)
  
  // terminal.css — Terminal, tab bar, status bar, voice, connection lost, effects
  [1861, 2031,  'terminal.css'], // Main / Terminal
  [2804, 3051,  'terminal.css'], // Tab Bar
  [3051, 3137,  'terminal.css'], // Status Bar
  [3137, 3295,  'terminal.css'], // Voice Input
  [4521, 4609,  'terminal.css'], // Connection Lost
  [5270, 5412,  'terminal.css'], // Visual Effects
  
  // welcome.css — Welcome overlay, carousel, etc.
  [2031, 2255,  'welcome.css'],  // Welcome Overlay (all sub-sections)
  [2255, 2575,  'welcome.css'],  // Welcome Page skeleton reveal + shortcut grid etc.
  [2575, 2761,  'welcome.css'],  // Welcome Carousel
  
  // chat.css — Chat drawer
  [4134, 4521,  'chat.css'],     // Chat Drawer
  
  // toast.css — Toast system
  [3391, 3546,  'toast.css'],    // Toast Notification
  
  // modal.css — Modal, command palette, add CLI, settings, shortcuts panel
  [3546, 3649,  'modal.css'],    // Modal
  [3649, 3866,  'modal.css'],    // Command Palette
  [3866, 3931,  'modal.css'],    // Add CLI form
  [5836, 6149,  'modal.css'],    // Settings Panel
  [5601, 5609,  'modal.css'],    // Shortcuts Panel (actually Custom CSS section)
  
  // panels.css — Everything else
  [324,  603,   'panels.css'],   // Workflow Section
  [603,  767,   'panels.css'],   // AI Ensemble
  [767,  1390,  'panels.css'],   // Agent Section
  [1390, 1610,  'panels.css'],   // CLI Item (actually this should go to sidebar)
  [1610, 1758,  'panels.css'],   // Skeleton Loading (sidebar)
  [1758, 1818,  'panels.css'],   // Buttons (sidebar)
  [1818, 1861,  'panels.css'],   // Connection Status (sidebar)
  [3295, 3391,  'panels.css'],   // History Viewer
  [3938, 4098,  'panels.css'],   // Media Preview
  [4098, 4134,  'panels.css'],   // Drop Zone
  [4711, 5270,  'panels.css'],   // Pin Report
  [5453, 5521,  'panels.css'],   // Micro-interactions
  [5610, 5836,  'panels.css'],   // Session Restore
  [6149, 6527,  'panels.css'],   // History Panel
  [6654, 6713,  'panels.css'],   // Terminal Context Menu
  [6713, 6873,  'panels.css'],   // Snippet Manager
  [6873, 6990,  'panels.css'],   // Workspace Profiles
  [6990, 6996,  'panels.css'],   // Notification test button
];

// Fix: move sidebar-related sections from panels.css to sidebar.css
const sidebarSections = [1390, 1610, 1758, 1818]; // CLI Item, Skeleton, Buttons, Connection Status
for (const assign of assignments) {
  if (sidebarSections.includes(assign[0])) {
    assign[2] = 'sidebar.css';
  }
}

// Collect section start line numbers for each file
const fileRanges = {
  'theme.css': [], 'sidebar.css': [], 'terminal.css': [],
  'welcome.css': [], 'chat.css': [], 'toast.css': [],
  'modal.css': [], 'panels.css': []
};

for (const [start, end, file] of assignments) {
  fileRanges[file].push({ start, end });
}

// Sort ranges by start line for each file
for (const file of Object.keys(fileRanges)) {
  fileRanges[file].sort((a, b) => a.start - b.start);
}

// Write each file
let grandTotal = 0;
for (const [file, ranges] of Object.entries(fileRanges)) {
  let output = '';
  for (const { start, end } of ranges) {
    for (let i = start; i < end && i < lines.length; i++) {
      output += lines[i] + '\n';
    }
  }
  const outPath = path.join(cssDir, file);
  fs.writeFileSync(outPath, output, 'utf8');
  const lineCount = output.split('\n').length - 1; // -1 for trailing newline
  grandTotal += lineCount;
  console.log(`  ${file}: ${lineCount} lines`);
}

console.log(`\nTotal: ${grandTotal} lines (original: ${lines.length})`);

// Check if any lines are missing
const covered = new Set();
for (const [file, ranges] of Object.entries(fileRanges)) {
  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      covered.add(i);
    }
  }
}
const missing = [];
for (let i = 0; i < lines.length; i++) {
  if (!covered.has(i)) missing.push(i + 1);
}
if (missing.length === 0) {
  console.log('✅ All lines covered!');
} else {
  console.log(`⚠️ Missing ${missing.length} lines: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '...' : ''}`);
}
