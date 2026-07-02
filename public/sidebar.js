// ============================================================
// Q-CLI Sidebar Module — CLI list & folder rendering
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

export const Sidebar = {
  // Will be populated from app.js
  renderCLIList: null,
  renderFolder: null,
  createCLIElement: null,
  findFolderForCLI: null,
  moveCLIToFolder: null,
  removeCLIFromAllFolders: null,
  finishRename: null,
  updateCLIState: null,
  getCLIIcon: null,
  updateCategoryCounts: null,
  filterCLIs: null,
  createFolder: null,
  updateFolderOnServer: null,
  deleteFolderOnServer: null,
  deleteCLI: null,
  launchCLI: null,
  discoverCLIs: null,
};

// Legacy compat
Q.Sidebar = Sidebar;
