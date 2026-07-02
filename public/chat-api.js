// ============================================================
// AI Chat API — frontend communication layer
// Handles SSE streaming, API key management, provider switching
// ============================================================
'use strict';

export const ChatAPI = {
    // ── API Key Management ──

    /** Get stored API key from localStorage */
    getApiKey() {
      try {
        return localStorage.getItem('qcli-ai-key') || '';
      } catch (e) { return ''; }
    },

    /** Store API key in localStorage */
    setApiKey(key) {
      try {
        localStorage.setItem('qcli-ai-key', key);
      } catch (e) { /* ignore */ }
    },

    /** Get stored provider */
    getProvider() {
      try {
        return localStorage.getItem('qcli-ai-provider') || 'openai';
      } catch (e) { return 'openai'; }
    },

    /** Store provider */
    setProvider(provider) {
      try {
        localStorage.setItem('qcli-ai-provider', provider);
      } catch (e) { /* ignore */ }
    },

    /** Get stored model name */
    getModel() {
      try {
        return localStorage.getItem('qcli-ai-model') || '';
      } catch (e) { return ''; }
    },

    /** Store model name */
    setModel(model) {
      try {
        localStorage.setItem('qcli-ai-model', model);
      } catch (e) { /* ignore */ }
    },

    /** Get stored API base URL (OpenAI-compatible) */
    getBaseUrl() {
      try {
        return localStorage.getItem('qcli-ai-base-url') || '';
      } catch (e) { return ''; }
    },

    /** Store API base URL */
    setBaseUrl(url) {
      try {
        localStorage.setItem('qcli-ai-base-url', url);
      } catch (e) { /* ignore */ }
    },

    /**
     * Check if AI is configured.
     * Returns true if:
     *  - Server env vars are set, OR
     *  - An API key is stored, OR
     *  - A custom base URL is set (for local/self-hosted models like Ollama)
     */
    async isConfigured() {
      try {
        const resp = await fetch('/api/chat/status');
        if (resp.ok) {
          const data = await resp.json();
          if (data.configured) return true;
        }
      } catch (e) { /* ignore */ }
      // Allow local/self-hosted APIs without a key
      if (!!this.getApiKey()) return true;
      if (!!this.getBaseUrl()) return true;
      return false;
    },

    // ── Streaming Chat ──

    /**
     * Send a chat message and stream the response.
     *
     * @param {object} options
     * @param {Array<{role:string,content:string}>} options.messages - Chat history
     * @param {function(string)} options.onToken - Called with each token
     * @param {function()} options.onDone - Called when stream completes
     * @param {function(string)} options.onError - Called on error
     * @param {function(string)} options.onStatus - Called on status updates (e.g. tool calls)
     * @param {AbortSignal} [options.signal] - Optional abort signal
     */
    async sendMessage({ messages, onToken, onDone, onError, onStatus, signal }) {
      const apiKey = this.getApiKey();
      const provider = this.getProvider();
      const model = this.getModel();
      const baseUrl = this.getBaseUrl();

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            apiKey: apiKey || undefined,
            provider: provider || undefined,
            model: model || undefined,
            baseUrl: baseUrl || undefined,
          }),
          signal,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          if (err.needsKey) {
            onError?.('NEEDS_KEY');
          } else {
            onError?.(err.error || `Request failed (${resp.status})`);
          }
          return;
        }

        // Read SSE stream
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === 'data: [DONE]') {
              onDone?.();
              return;
            }

            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.type === 'token') {
                  onToken?.(parsed.content);
                } else if (parsed.type === 'status') {
                  onStatus?.(parsed.message);
                } else if (parsed.type === 'error') {
                  onError?.(parsed.message);
                }
              } catch (e) {
                // Skip malformed JSON
              }
            }
          }
        }

        onDone?.();
      } catch (err) {
        if (err.name === 'AbortError') {
          onDone?.();
        } else {
          onError?.(err.message);
        }
      }
    },
  };

  // Expose globally for app.js to use
  window.QCLI = window.QCLI || {};
  window.QCLI.ChatAPI = ChatAPI;
