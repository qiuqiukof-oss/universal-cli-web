// ============================================================
// Q-CLI Chat UI Module — chat panel rendering & interactions
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

export const ChatUI = {
    open: false,
    messages: [],
    sending: false,
    sendChatMessage: null,
    toggleChat: null,
    clearChatHistory: null,
    appendMessageToDOM: null,
    renderChatMessages: null,
    showThinkingIndicator: null,
    removeThinkingIndicator: null,
    scrollChatToBottom: null,
    init: null,
  };

  Q.ChatUI = ChatUI;
