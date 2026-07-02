// ============================================================
// WebSocket + PTY Manager — per-client isolated terminal sessions
// ============================================================
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const path = require('path');
const { loadRegistry, resolveCommand, isWin } = require('./cli-discovery');

/**
 * Set up the WebSocket server with PTY management.
 *
 * @param {http.Server} server  — the HTTP server to attach to
 * @param {object}      [opts]
 * @param {number}      [opts.port=3001]  — used for CLI_BRIDGE_URL env var
 * @returns {{ wss: WebSocketServer, activePTYs: Map, close: Function }}
 */
function setupWebSocket(server, { port = 3001 } = {}) {
  const wss = new WebSocketServer({ server });

  /**
   * Map of WebSocket → Map<tabId, { pty, cliId, name, outputBuffer }>
   * Each client can have multiple concurrent terminal sessions (tabs).
   * The active tab receives terminal output; others buffer their output.
   */
  const activePTYs = new Map();
  let tabIdCounter = 0;

  /**
   * Agent PTY sessions — each client can have multiple parallel agent sessions.
   * Map of WebSocket → Map<sessionId, { pty, agentId, name, log: [] }>
   */
  const agentSessions = new Map();
  let agentSessionCounter = 0;

  /**
   * Workflow orchestration — serial multi-step agent execution.
   * Map<ws, { id, name, steps: [], currentStep: number, stepResults: [], running: boolean }>
   */
  const activeWorkflows = new Map();
  let workflowIdCounter = 0;

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  /**
   * Kill a specific tab's PTY for a client.
   */
  function killTab(ws, tabId) {
    const tabs = activePTYs.get(ws);
    if (!tabs) return;
    const tab = tabs.get(tabId);
    if (tab) {
      try { tab.pty.kill(); } catch (e) { /* process already dead */ }
      tabs.delete(tabId);
      if (tabs.size === 0) activePTYs.delete(ws);
    }
  }

  /**
   * Kill all tabs for a client.
   */
  function killAllTabs(ws) {
    const tabs = activePTYs.get(ws);
    if (!tabs) return;
    for (const [, tab] of tabs) {
      try { tab.pty.kill(); } catch (e) { /* ignore */ }
    }
    activePTYs.delete(ws);
  }

  /**
   * Create a PTY for the given registry entry and client.
   */
  function createPTY(cliEntry, ws, cols, rows, tabId) {
    let cmd = cliEntry.path;
    if (!path.isAbsolute(cmd)) {
      const resolved = resolveCommand(cmd);
      if (resolved) {
        cmd = resolved;
      } else {
        // Cannot resolve the command path — send error to client
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Cannot resolve command "${cmd}" — not found in PATH and not an absolute path`,
          }));
        }
        return null;
      }
    }
    const args = cliEntry.args || [];

    // Filter process.env to avoid leaking secrets: keep all common env vars
    // but explicitly remove variables that may contain credentials.
    // This is safer than a whitelist, which may miss important vars CLIs need.
    const SENSITIVE_VAR_PATTERNS = [
      /^API_KEY/i, /^API_SECRET/i, /^ACCESS_KEY/i, /^SECRET_KEY/i,
      /^TOKEN/i, /^PASSWORD/i, /^PASSWD/i, /^CREDENTIAL/i,
      /^AUTH/i, /^SESSION/i, /^COOKIE/i, /^BEARER/i,
      /^PRIVATE_KEY/i, /^SSH_KEY/i, /^PGP_KEY/i, /^GPG_KEY/i,
      /^AWS_SECRET/i, /^AWS_SESSION_TOKEN/i, /^TF_VAR/i,
      /^DB_PASSWORD/i, /^DB_URL/i, /^DATABASE_URL/i,
      /^REDIS_URL/i, /^MONGODB_URI/i, /^MONGO_URI/i,
      /^NPM_TOKEN/i, /^GITHUB_TOKEN/i, /^GH_TOKEN/i,
      /^SLACK_TOKEN/i, /^DISCORD_TOKEN/i, /^TELEGRAM/i,
      /^OPENAI_API_KEY/i, /^ANTHROPIC_API_KEY/i,
      /^CODEX_API_KEY/i, /^CLAUDE_API_KEY/i,
      /^JWT/i, /^SECRET/i,
    ];
    const safeEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      const isSensitive = SENSITIVE_VAR_PATTERNS.some(pattern => pattern.test(key));
      if (!isSensitive) {
        safeEnv[key] = value;
      }
    }

    const shellOpts = {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: process.env.HOME || process.env.USERPROFILE || __dirname,
      env: {
        ...safeEnv,
        TERM: 'xterm-256color',
        TERMINAL_PROGRAM: 'Universal-CLI-Bridge',
        CLI_BRIDGE_URL: `http://localhost:${port}`,
      },
    };

    // On Windows: try ConPTY first (required for mouse sequence support in
    // CLI programs like vim, htop, nano). Fall back to WinPTY only if ConPTY
    // crashes (conpty_console_list_agent).
    if (isWin) {
      shellOpts.useConpty = true;
    }

    let p;
    try {
      p = pty.spawn(cmd, args, shellOpts);
    } catch (err) {
      // On Windows, if ConPTY failed, retry with WinPTY
      if (isWin && shellOpts.useConpty !== false) {
        shellOpts.useConpty = false;
        try {
          p = pty.spawn(cmd, args, shellOpts);
        } catch (err2) {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Failed to spawn "${cmd}": ${err2.message}`,
            }));
          }
          return null;
        }
      } else {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Failed to spawn "${cmd}": ${err.message}`,
          }));
        }
        return null;
      }
    }

    // Track start time for duration calculation
    const ptyStartTime = Date.now();

    p.onData((data) => {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'output', data, tabId }));
      }
    });

    p.onExit(({ exitCode, signal }) => {
      // Find which tab this PTY belongs to
      const tabs = activePTYs.get(ws);
      let tabId = null;
      let cliName = '';
      if (tabs) {
        for (const [tid, tab] of tabs) {
          if (tab.pty === p) {
            tabId = tid;
            cliName = tab.name || tab.cliId || '';
            tabs.delete(tid);
            break;
          }
        }
        if (tabs.size === 0) activePTYs.delete(ws);
      }

      // Calculate duration
      const duration = Date.now() - ptyStartTime;
      const commandDuration = Math.round(duration / 1000);

      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'exit',
          code: exitCode,
          signal,
          tabId,
          duration: commandDuration,
          cli: tabId ? (tabs?.get(tabId)?.cliId || null) : null,
        }));

        // Send a notification event for long-running commands (> 5 seconds)
        // or any non-zero exit
        const isLongRunning = commandDuration >= 5;
        const isErrorExit = exitCode !== 0 && exitCode !== null;
        if (isLongRunning || isErrorExit) {
          ws.send(JSON.stringify({
            type: 'command:complete',
            tabId,
            exitCode,
            duration: commandDuration,
            cliName,
            isLongRunning,
            isError: isErrorExit,
          }));
        }
      }
    });

    return p;
  }

  /**
   * Create a headless PTY (no terminal output to client, output is captured
   * via callbacks). Shared helper for agent sessions and workflow steps,
   * reducing code duplication between createAgentPTY, executeWorkflowStep,
   * and executeParallelWorkflowStep.
   *
   * @param {string} cmd - Command to run
   * @param {string[]} [args=[]] - Command arguments
   * @param {object} [opts]
   * @param {number} [opts.cols=120] - Terminal columns
   * @param {number} [opts.rows=40] - Terminal rows
   * @param {object} [opts.extraEnv={}] - Additional env vars to inject
   * @param {function(string):void} [opts.onData] - Called with ANSI-cleaned data chunks
   * @param {function({exitCode, signal}):void} [opts.onExit] - Called on PTY exit
   * @param {function(Error):void} [opts.onError] - Called on spawn failure
   * @returns {object|null} The spawned PTY process, or null on failure
   */
  function createHeadlessPTY(cmd, args = [], opts = {}) {
    const { cols = 120, rows = 40, extraEnv = {}, onData, onExit, onError } = opts;

    let resolvedPath = cmd;
    if (!path.isAbsolute(resolvedPath)) {
      const r = resolveCommand(cmd);
      if (r) {
        resolvedPath = r;
        console.log('[AgentSrv] Resolved command:', cmd, '→', resolvedPath);
      } else {
        console.log('[AgentSrv] Command not resolved:', cmd, '(will try as-is)');
      }
    }

    const safeEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      const isSensitive = /^API_KEY|^TOKEN|^SECRET|^PASSWORD|^AUTH/i.test(key);
      if (!isSensitive) safeEnv[key] = value;
    }

    const shellOpts = {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || process.env.USERPROFILE || __dirname,
      env: {
        ...safeEnv,
        TERM: 'xterm-256color',
        TERMINAL_PROGRAM: 'Universal-CLI-Bridge',
        ...extraEnv,
      },
    };

    if (isWin) shellOpts.useConpty = true;

    try {
      const p = pty.spawn(resolvedPath, args, shellOpts);
      if (onData) {
        p.onData((data) => {
          const cleaned = data.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
          onData(cleaned);
        });
      }
      if (onExit) p.onExit(onExit);
      return p;
    } catch (err) {
      if (onError) onError(err);
      return null;
    }
  }

  /**
   * Create a headless PTY for an agent session (no terminal output to client,
   * output is captured to a log buffer).
   */
  function createAgentPTY(cmd, args, ws, sessionId, agentId) {
    console.log('[AgentSrv] createAgentPTY:', agentId, '| cmd:', cmd, '| args:', args);
    const log = [];
    const MAX_LOG_LINES = 500;

    const p = createHeadlessPTY(cmd, args || [], {
      onData: (cleaned) => {
        log.push(cleaned);
        if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'agent:output', sessionId, data: cleaned }));
        }
      },
      onExit: ({ exitCode, signal }) => {
        const duration = Date.now() - (p ? p._startTime || Date.now() : Date.now());
        console.log('[AgentSrv] PTY exited:', agentId, '| session:', sessionId, '| code:', exitCode, '| signal:', signal, '| duration:', Math.round(duration / 1000) + 's');
        const sessions = agentSessions.get(ws);
        if (sessions) sessions.delete(sessionId);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'agent:exit', sessionId, code: exitCode, signal }));
        }
      },
      onError: (err) => {
        console.log('[AgentSrv] PTY spawn error:', agentId, '| session:', sessionId, '| error:', err.message);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'agent:error',
            sessionId,
            agentId,
            errorCode: 'spawn_error',
            message: err.message,
          }));
        }
      },
    });

    if (!p) {
      console.log('[AgentSrv] createHeadlessPTY returned null for', agentId);
      return null;
    }
    p._startTime = Date.now();
    console.log('[AgentSrv] PTY spawned successfully:', agentId, '| pid:', p.pid);
    return { pty: p, log };
  }

  /**
   * Get the agent command for a given agentId.
   * Uses the known agents list from routes/agents.js.
   */
  function getAgentCommand(agentId) {
    // Built-in known agent paths (resolved from PATH)
    const KNOWN = [
      'opencode', 'codebuff', 'freebuff', 'aider',
      'claude', 'codex', 'copilot', 'openhands', 'mentat',
    ];
    if (KNOWN.includes(agentId)) {
      const resolved = resolveCommand(agentId);
      if (resolved) return resolved;
    }
    // Fallback: use the agentId as the command name
    const fallback = resolveCommand(agentId);
    return fallback || agentId;
  }

  /**
   * Resolve a command string to its absolute path with typed error codes.
   * Returns { cmd: string } on success, or { errorCode: string, message: string } on failure.
   * Used by workflow steps and agent:launch for consistent error type differentiation.
   */
  function lookupCommand(rawCmd, label) {
    if (!rawCmd) {
      return { errorCode: 'no_command', message: `No command specified for "${label || 'unknown'}"` };
    }
    if (!path.isAbsolute(rawCmd)) {
      const resolved = resolveCommand(rawCmd);
      if (resolved) return { cmd: resolved };
      return { errorCode: 'command_not_found', message: `Command "${rawCmd}" not found in PATH` };
    }
    // Absolute path — skip pre-check, let pty.spawn decide (may produce spawn_error)
    return { cmd: rawCmd };
  }

  /**
   * Execute a parallel workflow step: launch multiple agents simultaneously,
   * capture all outputs, then merge them together.
   * @returns {Promise<string>} the merged output
   */
  async function executeParallelWorkflowStep(ws, workflow, stepIndex) {
    const step = workflow.steps[stepIndex];
    const agents = step.agents || [];
    if (agents.length === 0) {
      throw new Error('No agents defined for parallel step');
    }

    const results = await Promise.all(agents.map((agent, i) => {
      return new Promise((resolve) => {
        const lookup = lookupCommand(getAgentCommand(agent.agentId), agent.agentId);
        if (lookup.errorCode) {
          resolve({ agentId: agent.agentId, output: `[${lookup.errorCode}] ${lookup.message}`, exitCode: -1 });
          return;
        }
        const cmd = lookup.cmd;
        let output = '';

        const p = createHeadlessPTY(cmd, [], {
          extraEnv: {
            WORKFLOW_STEP: step.label + ' [' + agent.agentId + ']',
            WORKFLOW_ID: workflow.id,
          },
          onData: (cleaned) => {
            output += cleaned;
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'workflow:step:output',
                workflowId: workflow.wfId,
                stepIndex,
                agentIndex: i,
                agentId: agent.agentId,
                data: cleaned,
              }));
            }
          },
          onExit: ({ exitCode }) => {
            clearTimeout(timeout);
            resolve({ agentId: agent.agentId, output, exitCode });
          },
          onError: (err) => {
            resolve({ agentId: agent.agentId, output: '[spawn_error] ' + err.message, exitCode: -1 });
          },
        });

        if (!p) {
          resolve({ agentId: agent.agentId, output: '[spawn_error] Failed to spawn PTY', exitCode: -1 });
          return;
        }

        const timeout = setTimeout(() => {
          try { p.kill(); } catch (e) { /* ignore */ }
          resolve({ agentId: agent.agentId, output, exitCode: null });
        }, 120000);

        // Send the task prompt to the agent
        p.write(agent.task + '\n');
      });
    }));

    // Send individual agent outputs as complete
    results.forEach((r, i) => {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'workflow:step:agent:complete',
          workflowId: workflow.wfId,
          stepIndex,
          agentIndex: i,
          agentId: r.agentId,
          exitCode: r.exitCode,
          output: r.output.slice(-1000),
        }));
      }
    });

    // Merge all results — structured per-agent sections for ensemble comparison
    const agentLabels = { opencode: 'OpenCode', codebuff: 'Codebuff', freebuff: 'Freebuff', aider: 'Aider', claude: 'Claude', codex: 'CODEX' };
    const agentSections = results.map(function(r, i) {
      var label = agentLabels[r.agentId] || r.agentId;
      var successIcon = r.exitCode === 0 ? '[OK]' : (r.exitCode === null ? '[TMO]' : '[ERR]');
      var sep = '\n' + Array(52).join('=') + '\n';
      var header = sep + '  ' + successIcon + ' Agent: ' + label + ' (' + r.agentId + ')\n' + sep;
      return header + '\n' + (r.output || '(no output)') + '\n';
    }).join('\n\n');

    var mergeHeader = '\n' + Array(54).join('#') + '\n'
      + '  AI ENSEMBLE - MERGED OUTPUT\n'
      + Array(54).join('#') + '\n';
    var mergeFooter = '\n' + Array(54).join('-') + '\n'
      + '  Agents: ' + results.length + ' | Success: ' + results.filter(function(r) { return r.exitCode === 0; }).length + '\n'
      + Array(54).join('-') + '\n';

    var summary = mergeHeader + agentSections + mergeFooter;
    // Compute worst exit code: 0 if ALL agents succeeded (exitCode 0 or null), 1 if ANY failed
    const parallelExitCode = results.some(r => r.exitCode !== 0 && r.exitCode !== null) ? 1 : 0;

    // Send step completion for the entire parallel step
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'workflow:step:complete',
        workflowId: workflow.wfId,
        stepIndex,
        exitCode: parallelExitCode,
        mode: 'parallel',
        output: summary.slice(-2000),
      }));
    }

    return summary;
  }

  /**
   * Execute a single workflow step: launch the agent, write the prompt,
   * capture all output until the agent exits, then return the output.
   * @returns {Promise<string>} the captured output
   */
  function executeWorkflowStep(ws, workflow, stepIndex) {
    return new Promise((resolve, reject) => {
      const step = workflow.steps[stepIndex];
      const lookup = lookupCommand(getAgentCommand(step.agentId), step.agentId);
      if (lookup.errorCode) {
        reject(new Error(`[${lookup.errorCode}] ${lookup.message}`));
        return;
      }
      const cmd = lookup.cmd;
      const args = [];

      // Build prompt with context from previous steps
      let prompt = step.task;
      if (stepIndex > 0 && workflow.stepResults.length > 0) {
        const prevResult = workflow.stepResults[stepIndex - 1];
        if (prevResult) {
          prompt = `[Context from previous step]\n${prevResult}\n\n---\n\n${prompt}`;
        }
      }

      let output = '';

      const p = createHeadlessPTY(cmd, args, {
        extraEnv: { WORKFLOW_STEP: step.label, WORKFLOW_ID: workflow.id },
        onData: (cleaned) => {
          output += cleaned;
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'workflow:step:output',
              workflowId: workflow.wfId,
              stepIndex,
              data: cleaned,
            }));
          }
        },
        onExit: ({ exitCode, signal }) => {
          clearTimeout(timeout);
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'workflow:step:complete',
              workflowId: workflow.wfId,
              stepIndex,
              exitCode,
              mode: workflow.steps[stepIndex]?.mode || 'serial',
              output: output.slice(-2000),
            }));
          }
          resolve(output);
        },
        onError: (err) => {
          reject(new Error(`[spawn_error] Failed to spawn ${step.agentId}: ${err.message}`));
        },
      });

      if (!p) {
        reject(new Error(`[spawn_error] Failed to spawn ${step.agentId}: PTY could not be created`));
        return;
      }

      const timeout = setTimeout(() => {
        try { p.kill(); } catch (e) { /* ignore */ }
        resolve(output); // resolve with what we have on timeout
      }, 120000); // 2 minute timeout per step

      // Send the prompt to the agent (with newline to execute)
      p.write(prompt + '\n');
    });
  }

  /**
   * Execute a full workflow — run each step sequentially.
   */
  async function executeWorkflow(ws, workflow) {
    workflow.running = true;
    workflow.currentStep = 0;
    workflow.stepResults = [];

    // Notify start
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'workflow:started',
        workflowId: workflow.wfId,
        totalSteps: workflow.steps.length,
        name: workflow.name,
      }));
    }

    for (let i = 0; i < workflow.steps.length; i++) {
      if (!workflow.running) break; // cancelled

      workflow.currentStep = i;

      // Notify step start
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'workflow:step:start',
          workflowId: workflow.wfId,
          stepIndex: i,
          stepLabel: workflow.steps[i].label,
        }));
      }

      try {
        const isParallel = workflow.steps[i].mode === 'parallel';
        const output = isParallel
          ? await executeParallelWorkflowStep(ws, workflow, i)
          : await executeWorkflowStep(ws, workflow, i);
        workflow.stepResults.push(output);

        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'workflow:progress',
            workflowId: workflow.wfId,
            currentStep: i + 1,
            totalSteps: workflow.steps.length,
          }));
        }
      } catch (err) {
        workflow.stepResults.push(err.message);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'workflow:step:error',
            workflowId: workflow.wfId,
            stepIndex: i,
            error: err.message,
          }));
        }
        break; // stop on error
      }
    }

    // Notify completion (only if not cancelled — cancelWorkflow already deleted from map)
    workflow.running = false;
    const wasCancelled = !activeWorkflows.has(ws);
    if (!wasCancelled) {
      activeWorkflows.delete(ws);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'workflow:completed',
          workflowId: workflow.wfId,
          totalSteps: workflow.steps.length,
          completedSteps: workflow.currentStep + 1,
          summary: workflow.stepResults.map((r, i) =>
            `Step ${i + 1} (${workflow.steps[i].label}): ${(r || '').slice(0, 200)}`
          ).join('\n'),
        }));
      }
    }
  }

  /**
   * Cancel a running workflow.
   */
  function cancelWorkflow(ws, wfId) {
    const wf = activeWorkflows.get(ws);
    if (!wf || wf.wfId !== wfId) return;
    wf.running = false;
    activeWorkflows.delete(ws);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'workflow:cancelled', workflowId: wfId }));
    }
  }

  function killAllAgentSessions(ws) {
    const sessions = agentSessions.get(ws);
    if (!sessions) return;
    for (const [, session] of sessions) {
      try { session.pty.kill(); } catch (e) { /* ignore */ }
    }
    agentSessions.delete(ws);
  }

  /**
   * Kill a specific agent session.
   */
  function killAgentSession(ws, sessionId) {
    const sessions = agentSessions.get(ws);
    if (!sessions) {
      console.log('[AgentSrv] killAgentSession: no sessions for client');
      return;
    }
    const session = sessions.get(sessionId);
    if (session) {
      console.log('[AgentSrv] Killing agent session:', sessionId, '| agentId:', session.agentId);
      try { session.pty.kill(); } catch (e) { /* ignore */ }
      sessions.delete(sessionId);
    } else {
      console.log('[AgentSrv] killAgentSession: session not found:', sessionId);
    }
  }

  // ──────────────────────────────────────────────
  // Connection handler
  // ──────────────────────────────────────────────

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    agentSessions.set(ws, new Map());
    activePTYs.set(ws, new Map());

    ws.on('message', (raw, isBinary) => {
      // P3: Ignore binary frames — ws v8 provides isBinary flag
      if (isBinary) return;

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {

        case 'launch': {
          const registry = loadRegistry();
          const entry = registry.clis.find(c => c.id === msg.cliId);
          if (!entry) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `CLI "${msg.cliId}" not found in registry`,
            }));
            return;
          }

          // Assign or use provided tabId
          const tabId = msg.tabId || ('tab-' + (++tabIdCounter));

          const cols = typeof msg.cols === 'number'
            ? Math.max(10, Math.min(500, Math.floor(msg.cols)))
            : 80;
          const rows = typeof msg.rows === 'number'
            ? Math.max(2, Math.min(200, Math.floor(msg.rows)))
            : 24;
          const pty = createPTY(entry, ws, cols, rows, tabId);


          if (pty) {
            // Store tab with output buffer
            const tabs = activePTYs.get(ws) || new Map();
            tabs.set(tabId, { pty, cliId: msg.cliId, name: entry.name, outputBuffer: '' });
            activePTYs.set(ws, tabs);
            ws.send(JSON.stringify({ type: 'launched', cli: entry, tabId }));
          }
          break;
        }

        case 'input': {
          if (typeof msg.data !== 'string') return;
          const tabs = activePTYs.get(ws);
          if (!tabs) break;
          const tab = msg.tabId ? tabs.get(msg.tabId) : null;
          if (tab) {
            tab.pty.write(msg.data);
          }
          break;
        }

        case 'resize': {
          if (typeof msg.cols !== 'number' || typeof msg.rows !== 'number') return;
          const cols = Math.max(10, Math.min(500, Math.floor(msg.cols)));
          const rows = Math.max(2, Math.min(200, Math.floor(msg.rows)));
          const tabs = activePTYs.get(ws);
          if (!tabs) break;
          const tab = msg.tabId ? tabs.get(msg.tabId) : null;
          if (tab) {
            try { tab.pty.resize(cols, rows); } catch (e) { /* pty dead */ }
          }
          break;
        }

        case 'kill': {
          if (msg.tabId) {
            killTab(ws, msg.tabId);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'killed', tabId: msg.tabId }));
            }
          } else {
            killAllTabs(ws);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'killed' }));
            }
          }
          break;
        }

        case 'agent:launch': {
          const { agentId, name, cmd, args } = msg;
          console.log('[AgentSrv] agent:launch received:', agentId, '| cmd:', cmd, '| args:', args);
          if (!cmd) {
            console.log('[AgentSrv] agent:launch rejected — no cmd for', agentId);
            ws.send(JSON.stringify({
              type: 'agent:error',
              agentId,
              errorCode: 'no_command',
              message: 'No command specified',
            }));
            break;
          }
          // Pre-check: if command is not an absolute path and not resolvable via PATH,
          // fail fast with a clear error code (avoids pty.spawn ENOENT ambiguity).
          if (!path.isAbsolute(cmd) && !resolveCommand(cmd)) {
            console.log('[AgentSrv] agent:launch rejected — command not found:', cmd, 'for', agentId);
            ws.send(JSON.stringify({
              type: 'agent:error',
              agentId,
              errorCode: 'command_not_found',
              message: `Command "${cmd}" not found in PATH`,
            }));
            break;
          }
          agentSessionCounter++;
          const sessionId = 'agent-' + agentSessionCounter;
          console.log('[AgentSrv] Creating PTY for', agentId, '| session:', sessionId);
          const session = createAgentPTY(cmd, args || [], ws, sessionId, agentId);
          if (session) {
            const sessions = agentSessions.get(ws);
            sessions.set(sessionId, { ...session, agentId, name });
            console.log('[AgentSrv] PTY created, sending agent:started:', agentId, '| session:', sessionId);
            ws.send(JSON.stringify({ type: 'agent:started', sessionId, agentId, name }));
          } else {
            console.log('[AgentSrv] PTY creation FAILED for', agentId, '| session:', sessionId, '(error already sent via onError)');
          }
          break;
        }

        case 'agent:input': {
          const { sessionId, data } = msg;
          if (typeof data !== 'string') break;
          const sessions = agentSessions.get(ws);
          if (!sessions) break;
          const session = sessions.get(sessionId);
          if (session) {
            session.pty.write(data);
          }
          break;
        }

        case 'agent:kill': {
          if (msg.sessionId) {
            killAgentSession(ws, msg.sessionId);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'agent:killed', sessionId: msg.sessionId }));
            }
          }
          break;
        }

        case 'agent:list': {
          const sessions = agentSessions.get(ws);
          const list = [];
          if (sessions) {
            for (const [sid, session] of sessions) {
              list.push({ sessionId: sid, agentId: session.agentId, name: session.name });
            }
          }
          ws.send(JSON.stringify({ type: 'agent:list', sessions: list }));
          break;
        }

        // ── Workflow messages ──
        case 'workflow:start': {
          const { workflowId: wfId, name, steps } = msg;
          if (!steps || !Array.isArray(steps) || steps.length === 0) {
            ws.send(JSON.stringify({ type: 'workflow:error', message: 'No steps defined' }));
            break;
          }
          workflowIdCounter++;
          const wf = {
            wfId: workflowIdCounter,
            id: wfId || ('wf-' + workflowIdCounter),
            name: name || 'Workflow',
            steps,
            currentStep: 0,
            stepResults: [],
            running: false,
          };
          activeWorkflows.set(ws, wf);
          // Execute asynchronously (don't block the WS message loop)
          executeWorkflow(ws, wf);
          break;
        }

        case 'workflow:cancel': {
          const { wfId: cancelId } = msg;
          if (cancelId) {
            cancelWorkflow(ws, cancelId);
          }
          break;
        }

        // ── Tab management ──
        case 'tab:list': {
          const tbs = activePTYs.get(ws);
          const list = [];
          if (tbs) {
            for (const [tid, tab] of tbs) {
              list.push({ tabId: tid, cliId: tab.cliId, name: tab.name });
            }
          }
          ws.send(JSON.stringify({ type: 'tab:list', tabs: list }));
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      const agentCount = agentSessions.get(ws)?.size || 0;
      if (agentCount > 0) {
        console.log('[AgentSrv] Cleaning up', agentCount, 'agent session(s) on disconnect');
      }
      killAllTabs(ws);
      killAllAgentSessions(ws);
      // Clean up any running workflows
      const wf = activeWorkflows.get(ws);
      if (wf) {
        wf.running = false;
        activeWorkflows.delete(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  });

  /**
   * Gracefully shut down all PTY sessions and close the WebSocket server.
   */
  function close() {
    for (const [, tabs] of activePTYs) {
      for (const [, tab] of tabs) {
        try { tab.pty.kill(); } catch (e) { /* ignore */ }
      }
    }
    activePTYs.clear();
    // Close the WebSocket server — stops accepting new connections
    try { wss.close(); } catch (e) { /* already closed */ }
  }

  return { wss, activePTYs, close };
}

module.exports = { setupWebSocket };
