// ============================================================
// Q-CLI Upload Module — file upload & media preview
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

export const Upload = {
  mediaState: { files: [], currentIndex: 0, open: false },
  openMediaPreview: null,
  closeMediaPreview: null,
  navigateMedia: null,
  handleMediaClick: null,
  formatFileSize: null,
};

// Legacy compat
Q.Upload = Upload;
