// Script to extract Terminal Search code from app.js
const fs = require('fs');

let content = fs.readFileSync('public/app.js', 'utf8');
const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
console.log('Detected line ending:', JSON.stringify(lineEnding));

const lines = content.split(lineEnding);

// 1. Add import aliases for Terminal Search functions
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Q.Upload?.formatFileSize || function() {};')) {
    insertIdx = i + 1;
    break;
  }
}
if (insertIdx >= 0) {
  lines.splice(insertIdx, 0,
    '  const toggleSearchBar = Q.TerminalSearch?.toggle || function() {};',
    '  const searchBarVisible = Q.TerminalSearch?.visible || function() { return false; };',
    '  const hideSearchBar = Q.TerminalSearch?.hide || function() {};',
    '  const showSearchBar = Q.TerminalSearch?.show || function() {};'
  );
  content = lines.join(lineEnding);
  console.log('Terminal Search aliases added at line', insertIdx + 1);
} else {
  console.log('Could not find formatFileSize line!');
}

// 2. Remove Terminal Search section
const searchStart = '  // ============================================================' + lineEnding +
  '  // Terminal Search Bar' + lineEnding +
  '  // ============================================================' + lineEnding;

// Find the next section header after Terminal Search
// Based on analysis: after Terminal Search comes "getPreferredTheme" and "Theme" section
// Search for "function getPreferredTheme" as marker for next section
const startIdx = content.indexOf(searchStart);
const afterSearch = content.indexOf(lineEnding + '  function getPreferredTheme', startIdx + searchStart.length);

if (startIdx >= 0 && afterSearch >= 0) {
  const removedSection = content.substring(startIdx, afterSearch);
  content = content.substring(0, startIdx) + content.substring(afterSearch);
  console.log('Terminal Search section removed, length:', removedSection.length);
} else {
  console.log('Could not find Terminal Search boundaries');
  console.log('  startIdx:', startIdx);
  console.log('  afterSearch (getPreferredTheme):', afterSearch);
  if (startIdx >= 0) {
    console.log('  Context after start (first 500 chars):');
    console.log(content.substring(startIdx, startIdx + 500));
  }
}

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('Done!');
