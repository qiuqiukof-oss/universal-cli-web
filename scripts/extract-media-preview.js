// Script to extract Media Preview code from app.js
const fs = require('fs');

let content = fs.readFileSync('public/app.js', 'utf8');
const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
console.log('Detected line ending:', JSON.stringify(lineEnding));

const lines = content.split(lineEnding);

// 1. Add import aliases for Media Preview functions (used in drag-drop upload, terminal init)
// Find the last import alias line
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const escapeHtml = Q.escapeHtml || function')) {
    insertIdx = i + 1;
    break;
  }
}
if (insertIdx >= 0) {
  lines.splice(insertIdx, 0,
    '  const openMediaPreview = Q.Upload?.openMediaPreview || function() {};',
    '  const closeMediaPreview = Q.Upload?.closeMediaPreview || function() {};',
    '  const navigateMedia = Q.Upload?.navigateMedia || function() {};',
    '  const handleMediaClick = Q.Upload?.handleMediaClick || function() {};',
    '  const formatFileSize = Q.Upload?.formatFileSize || function() {};'
  );
  content = lines.join(lineEnding);
  console.log('Media Preview aliases added at line', insertIdx + 1);
} else {
  console.log('Could not find escapeHtml line!');
}

// 2. Remove Media Preview section
const mediaStart = '  // ============================================================' + lineEnding +
  '  // Media Preview Overlay' + lineEnding +
  '  // ============================================================' + lineEnding;

const dragDropSection = '  // ============================================================' + lineEnding +
  '  // Drag & Drop File Upload' + lineEnding +
  '  // ============================================================';

const startIdx = content.indexOf(mediaStart);
const endIdx = content.indexOf(lineEnding + dragDropSection, startIdx + mediaStart.length);

if (startIdx >= 0 && endIdx >= 0) {
  const removedSection = content.substring(startIdx, endIdx);
  content = content.substring(0, startIdx) + content.substring(endIdx);
  console.log('Media Preview section removed, length:', removedSection.length);
} else {
  console.log('Could not find Media Preview boundaries');
  console.log('  startIdx:', startIdx);
  console.log('  endIdx:', endIdx);
  // Debug
  if (startIdx >= 0) {
    console.log('  Context after start:', content.substring(startIdx, startIdx + 300));
  }
}

// 3. Remove old export lines for Upload functions
const uploadExport1 = '  Q.Upload = Q.Upload || {};';
const uploadExport2 = '  Q.Upload.openMediaPreview = openMediaPreview;';
const uploadExport3 = '  Q.Upload.closeMediaPreview = closeMediaPreview;';
const uploadExport4 = '  Q.Upload.navigateMedia = navigateMedia;';
const uploadExport5 = '  Q.Upload.handleMediaClick = handleMediaClick;';
const uploadExport6 = '  Q.Upload.formatFileSize = formatFileSize;';

// Remove the block of Upload export lines
const uploadBlock = uploadExport1 + lineEnding + uploadExport2 + lineEnding + uploadExport3 + lineEnding + uploadExport4 + lineEnding + uploadExport5 + lineEnding + uploadExport6;
const exportIdx = content.indexOf(uploadBlock);
if (exportIdx >= 0) {
  content = content.substring(0, exportIdx) + content.substring(exportIdx + uploadBlock.length);
  console.log('Upload export block removed');
} else {
  // Try removing each line individually
  let removed = 0;
  for (const line of [uploadExport1, uploadExport2, uploadExport3, uploadExport4, uploadExport5, uploadExport6]) {
    const idx = content.indexOf(lineEnding + line);
    if (idx >= 0) {
      content = content.substring(0, idx) + content.substring(idx + line.length + lineEnding.length);
      removed++;
    }
  }
  console.log('Removed', removed, 'upload export lines individually');
}

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('Done!');
