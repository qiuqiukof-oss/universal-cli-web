// Script to extract Voice Input code from app.js
const fs = require('fs');

let content = fs.readFileSync('public/app.js', 'utf8');
const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
console.log('Detected line ending:', JSON.stringify(lineEnding));

// 1. Add escapeHtml import alias after the showToast/showUploadStatus aliases
const lines = content.split(lineEnding);
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const showUploadStatus = Q.showUploadStatus || function() {};')) {
    insertIdx = i + 1;
    break;
  }
}
if (insertIdx >= 0) {
  lines.splice(insertIdx, 0,
    '  const escapeHtml = Q.escapeHtml || function(str) { const d = document.createElement(\'div\'); d.textContent = str; return d.innerHTML; };'
  );
  content = lines.join(lineEnding);
  console.log('escapeHtml alias added at line', insertIdx + 1);
} else {
  console.log('Could not find showUploadStatus line!');
}

// 2. Remove Voice Input section
const voiceStart = '  // ============================================================' + lineEnding +
  '  // Voice Input — Web Speech API' + lineEnding +
  '  // ============================================================' + lineEnding;

const voiceSectionAfter = '  // ============================================================' + lineEnding +
  '  // Theme' + lineEnding +
  '  // ============================================================';
// Search for what comes after - it might be "Theme" or something else in the current file

const startIdx = content.indexOf(voiceStart);
if (startIdx >= 0) {
  // Find the next major section header after Voice Input
  let endIdx = content.indexOf(lineEnding + voiceSectionAfter, startIdx + voiceStart.length);
  if (endIdx < 0) {
    // Try "Color Palette" or "Dark Theme"
    const altAfter = '  // ============================================================' + lineEnding +
      '  // Color Palette';
    endIdx = content.indexOf(lineEnding + altAfter, startIdx + voiceStart.length);
  }
  if (endIdx < 0) {
    // Try "getPreferredTheme"
    endIdx = content.indexOf(lineEnding + '  function getPreferredTheme', startIdx + voiceStart.length);
  }
  if (endIdx < 0) {
    // Last resort: find by searching for specific patterns after voice section
    const afterPattern = lineEnding + '  // ===';
    endIdx = content.indexOf(afterPattern, startIdx + voiceStart.length);
  }

  if (endIdx >= 0) {
    const removedSection = content.substring(startIdx, endIdx);
    content = content.substring(0, startIdx) + content.substring(endIdx);
    console.log('Voice Input section removed, length:', removedSection.length);
  } else {
    console.log('Could not find end of Voice Input section');
    // Just show context around the voice section
    const preview = content.substring(startIdx, startIdx + 2000);
    console.log('Preview after voice start:', preview.substring(0, 500));
  }
} else {
  console.log('Voice Input section NOT FOUND');
}

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('Done!');
