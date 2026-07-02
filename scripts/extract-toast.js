// Script to extract Toast code from app.js
const fs = require('fs');

let content = fs.readFileSync('public/app.js', 'utf8');
const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
console.log('Detected line ending:', JSON.stringify(lineEnding));

// 1. Add import aliases after the setupCategoryFilters line
const lines = content.split(lineEnding);
// Find the setupCategoryFilters line
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const setupCategoryFilters = Q.setupCategoryFilters || function() {};')) {
    insertIdx = i + 1;
    break;
  }
}
if (insertIdx >= 0) {
  lines.splice(insertIdx, 0,
    '  const showToast = Q.showToast || function() {};',
    '  const showUploadStatus = Q.showUploadStatus || function() {};'
  );
  content = lines.join(lineEnding);
  console.log('Import aliases added at line', insertIdx + 1);
} else {
  console.log('Could not find setupCategoryFilters line!');
}

// 2. Remove Toast section
const toastStart = '  // ============================================================' + lineEnding +
  '  // Toast Notifications \u2014 Glassmorphism + Auto-Stack' + lineEnding +
  '  // ============================================================' + lineEnding;

const toastEnd = '  function showUploadStatus(msg, type) {' + lineEnding +
  '    return showToast(msg, type || \'info\');' + lineEnding +
  '  }';

const toastFull = toastStart + content.substring(
  content.indexOf(toastStart) + toastStart.length,
  content.indexOf(toastEnd) + toastEnd.length
);

// Try to find the whole section
const startIdx = content.indexOf(toastStart);
const endIdx = content.indexOf(toastEnd);

if (startIdx >= 0 && endIdx >= 0) {
  const fullSection = content.substring(startIdx, endIdx + toastEnd.length);
  console.log('Toast section found at index', startIdx, 'to', endIdx + toastEnd.length, 'length:', fullSection.length);
  content = content.substring(0, startIdx) + content.substring(endIdx + toastEnd.length);
  console.log('Toast section removed successfully');
} else {
  console.log('Toast section NOT FOUND');
  console.log('  toastStart found at:', startIdx);
  console.log('  toastEnd found at:', endIdx);
  // Debug
  const idx = content.indexOf('Toast Notifications');
  if (idx >= 0) {
    console.log('  "Toast Notifications" found at:', idx);
    console.log('  Context:', JSON.stringify(content.substring(idx - 10, idx + 300)));
  }
}

// 3. Remove export lines
const exportLine1 = '  // Export showToast for submodules (pin-report, etc.)';
const exportLine2 = '  Q.showToast = showToast;';
const exportLine3 = '  Q.showUploadStatus = showUploadStatus;';

const exportPattern = exportLine1 + lineEnding + exportLine2 + lineEnding + exportLine3;
const exportIdx = content.indexOf(exportPattern);

if (exportIdx >= 0) {
  content = content.substring(0, exportIdx) + content.substring(exportIdx + exportPattern.length);
  console.log('Export lines removed successfully');
} else if (content.includes(exportLine2)) {
  // Try just the two assignment lines
  const altPattern = exportLine2 + lineEnding + exportLine3;
  const altIdx = content.indexOf(altPattern);
  if (altIdx >= 0) {
    content = content.substring(0, altIdx) + content.substring(altIdx + altPattern.length);
    console.log('Export lines removed (2 assignments only)');
  }
} else {
  console.log('Export lines NOT FOUND');
  console.log('  Contains exportComment:', content.includes(exportLine1));
  console.log('  Contains exportLine2:', content.includes(exportLine2));
  console.log('  Contains exportLine3:', content.includes(exportLine3));
}

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('Done!');
