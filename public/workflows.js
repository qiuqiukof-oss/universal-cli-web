// ============================================================
// Q-CLI Workflow Engine — multi-step agent orchestration UI
// ============================================================
'use strict';
const Q = window.QCLI = window.QCLI || {};

  // ── State ──
  const workflows = {
    list: [],           // available workflow definitions from API
    active: null,       // { id, name, steps, currentStep, status, results: [] }
    ws: null,
  };

  // ── Load workflow definitions from API ──
  async function loadWorkflows() {
    try {
      const resp = await fetch('/api/workflows');
      if (!resp.ok) return [];
      const data = await resp.json();
      workflows.list = data.workflows || [];
      renderWorkflowList();
      return workflows.list;
    } catch (err) {
      console.warn('[Workflows] Load failed:', err);
      return [];
    }
  }

  // ── Render workflow list in sidebar ──
  function renderWorkflowList() {
    const container = document.getElementById('workflow-list');
    if (!container) return;

    container.innerHTML = '';

    if (workflows.list.length === 0) {
      container.innerHTML = '<div class="agent-empty">No workflows available</div>';
      return;
    }

    for (const wf of workflows.list) {
      const el = document.createElement('div');
      el.className = 'workflow-item';
      el.dataset.wfId = wf.id;

      // Icon
      const icon = document.createElement('span');
      icon.className = 'workflow-item-icon';
      icon.textContent = wf.icon || '⚡';
      el.appendChild(icon);

      // Info
      const info = document.createElement('div');
      info.className = 'workflow-item-info';

      const name = document.createElement('div');
      name.className = 'workflow-item-name';
      name.textContent = wf.name;
      info.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'workflow-item-desc';
      desc.textContent = wf.description;
      info.appendChild(desc);

      el.appendChild(info);

      // Steps count badge
      const badge = document.createElement('span');
      badge.className = 'workflow-step-badge';
      badge.textContent = `${wf.steps.length} steps`;
      el.appendChild(badge);

      // Check if this workflow is currently running
      const isActive = workflows.active && workflows.active.id === wf.id && workflows.active.status === 'running';
      if (isActive) el.classList.add('running');

      // Click to run
      el.addEventListener('click', () => {
        startWorkflow(wf);
      });

      container.appendChild(el);
    }
  }

  // ── Start a workflow ──
  function startWorkflow(wfDef) {
    if (workflows.active && workflows.active.status === 'running') {
      showWfToast('A workflow is already running. Cancel it first.', 'error');
      return;
    }

    const ws = workflows.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      showWfToast('WebSocket not connected', 'error');
      return;
    }

    // Create active workflow state
    workflows.active = {
      id: wfDef.id,
      name: wfDef.name,
      icon: wfDef.icon,
      steps: wfDef.steps.map(s => ({ ...s, status: 'pending', output: '' })),
      currentStep: -1,
      status: 'running',
      results: [],
      wfId: null,
    };

    // Send to server
    ws.send(JSON.stringify({
      type: 'workflow:start',
      workflowId: wfDef.id,
      name: wfDef.name,
      steps: wfDef.steps,
    }));

    showWfToast(`▶ Started: ${wfDef.name}`, 'info');
    renderWorkflowList();
    showWorkflowProgress();
  }

  // ── Cancel the active workflow ──
  function cancelWorkflow() {
    if (!workflows.active || workflows.active.status !== 'running') return;
    const ws = workflows.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'workflow:cancel',
        wfId: workflows.active.wfId,
      }));
    }
    workflows.active.status = 'cancelled';
    showWfToast('⏹ Workflow cancelled', 'info');
    renderWorkflowList();
    updateProgressDisplay();
  }

  // ── Show workflow progress overlay ──
  function showWorkflowProgress() {
    let overlay = document.getElementById('wf-progress-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wf-progress-overlay';
      overlay.className = 'wf-progress-overlay';
      overlay.innerHTML = `
        <div class="wf-progress-panel">
          <div class="wf-progress-header">
            <span class="wf-progress-title"></span>
            <button class="wf-progress-close" id="wf-progress-close" title="Close">✕</button>
          </div>
          <div class="wf-progress-steps" id="wf-progress-steps"></div>
          <div class="wf-progress-footer">
            <button id="wf-cancel-btn" class="wf-cancel-btn">Cancel Workflow</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Close button
      overlay.querySelector('#wf-progress-close').addEventListener('click', () => {
        overlay.classList.add('hidden');
      });

      // Cancel button
      overlay.querySelector('#wf-cancel-btn').addEventListener('click', () => {
        cancelWorkflow();
      });

      // Click backdrop to close
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    }

    overlay.classList.remove('hidden');
    updateProgressDisplay();
  }

  // ── Update the progress overlay ──
  function updateProgressDisplay() {
    const overlay = document.getElementById('wf-progress-overlay');
    if (!overlay) return;

    if (!workflows.active) {
      overlay.classList.add('hidden');
      return;
    }

    const active = workflows.active;
    overlay.querySelector('.wf-progress-title').textContent =
      `${active.icon || '⚡'} ${active.name}`;

    const stepsContainer = document.getElementById('wf-progress-steps');
    stepsContainer.innerHTML = '';

    for (let i = 0; i < active.steps.length; i++) {
      const step = active.steps[i];
      const isParallel = step.mode === 'parallel' && step.agents;

      const stepEl = document.createElement('div');
      stepEl.className = 'wf-step-item ' + step.status;

      // Status indicator
      const statusEl = document.createElement('span');
      statusEl.className = 'wf-step-status';
      switch (step.status) {
        case 'running':
          statusEl.textContent = '⟳';
          statusEl.style.animation = 'spin 1s linear infinite';
          break;
        case 'completed':
          statusEl.textContent = '✅';
          break;
        case 'error':
          statusEl.textContent = '❌';
          break;
        case 'cancelled':
          statusEl.textContent = '⏹';
          break;
        default:
          statusEl.textContent = '○';
      }
      stepEl.appendChild(statusEl);

      // Step info
      const infoEl = document.createElement('div');
      infoEl.className = 'wf-step-info';

      const labelEl = document.createElement('div');
      labelEl.className = 'wf-step-label';
      labelEl.textContent = `Step ${i + 1}: ${step.label}`;
      infoEl.appendChild(labelEl);

      // For parallel steps, show expandable agent output panels
      if (isParallel && step.agentOutputs) {
        const agentsWrap = document.createElement('div');
        agentsWrap.className = 'wf-parallel-agents';
        for (let ai = 0; ai < step.agentOutputs.length; ai++) {
          const agentOut = step.agentOutputs[ai];
          const agentCard = document.createElement('div');
          agentCard.className = 'wf-parallel-agent-card ' + (agentOut.status || 'pending');
          
          // Collapsible header
          const agentHeader = document.createElement('div');
          agentHeader.className = 'wf-parallel-agent-header';
          
          const statusIcon = document.createElement('span');
          statusIcon.className = 'wf-parallel-agent-icon';
          if (agentOut.status === 'running') {
            statusIcon.textContent = '\u27f3';
            statusIcon.style.animation = 'spin 1s linear infinite';
          } else if (agentOut.status === 'completed') {
            statusIcon.textContent = '\u2705';
          } else if (agentOut.status === 'error') {
            statusIcon.textContent = '\u274c';
          } else {
            statusIcon.textContent = '\u25cb';
          }
          agentHeader.appendChild(statusIcon);
          
          const agentName = document.createElement('span');
          agentName.className = 'wf-parallel-agent-name';
          const agentLabels = { opencode: '\u26a1 OpenCode', codebuff: '\u{1F9CA} Codebuff', freebuff: '\u{1F9CA} Freebuff' };
          agentName.textContent = agentLabels[agentOut.agentId] || agentOut.agentId;
          agentHeader.appendChild(agentName);
          
          // Expand/collapse toggle
          const toggleIcon = document.createElement('span');
          toggleIcon.className = 'wf-parallel-agent-toggle';
          toggleIcon.textContent = '\u25bc';
          toggleIcon.style.marginLeft = 'auto';
          toggleIcon.style.fontSize = '8px';
          toggleIcon.style.color = 'var(--text-tertiary)';
          agentHeader.appendChild(toggleIcon);
          
          agentCard.appendChild(agentHeader);
          
          // Collapsible output panel
          const outputPanel = document.createElement('pre');
          outputPanel.className = 'wf-parallel-agent-output';
          outputPanel.textContent = agentOut.output ? agentOut.output.slice(-1000) : '(awaiting output...)';
          
          let expanded = false;
          agentHeader.addEventListener('click', function() {
            expanded = !expanded;
            outputPanel.classList.toggle('expanded', expanded);
            toggleIcon.textContent = expanded ? '\u25b2' : '\u25bc';
          });
          
          agentCard.appendChild(outputPanel);
          agentsWrap.appendChild(agentCard);
        }
        infoEl.appendChild(agentsWrap);
      }
      
      // Show merge/comparison result for completed parallel steps
      if (isParallel && step.status === 'completed' && step.output) {
        const mergeResult = document.createElement('div');
        mergeResult.className = 'wf-merge-result';
        
        const mergeLabel = document.createElement('div');
        mergeLabel.className = 'wf-merge-label';
        mergeLabel.textContent = '\u{1F500} Merged Result';
        mergeResult.appendChild(mergeLabel);
        
        const mergeOutput = document.createElement('pre');
        mergeOutput.className = 'wf-merge-output';
        mergeOutput.textContent = step.output.slice(-500);
        mergeResult.appendChild(mergeOutput);
        
        infoEl.appendChild(mergeResult);
      }

      if (step.output) {
        const outputEl = document.createElement('pre');
        outputEl.className = 'wf-step-output';
        outputEl.textContent = step.output.slice(-300);
        infoEl.appendChild(outputEl);
      }

      stepEl.appendChild(infoEl);

      stepsContainer.appendChild(stepEl);
    }

    // Auto-scroll to the latest step
    requestAnimationFrame(() => {
      stepsContainer.scrollTop = stepsContainer.scrollHeight;
    });
  }

  // ── Handle parallel agent progress messages ──
  function handleParallelOutput(msg) {
    if (!workflows.active) return;
    const step = workflows.active.steps[msg.stepIndex];
    if (!step || step.mode !== 'parallel') return;

    // Initialize agentOutputs tracking
    if (!step.agentOutputs) {
      step.agentOutputs = (step.agents || []).map(a => ({
        agentId: a.agentId,
        output: '',
        status: 'pending',
      }));
    }

    const agentOut = step.agentOutputs[msg.agentIndex];
    if (agentOut) {
      if (msg.type === 'workflow:step:output') {
        agentOut.status = 'running';
        agentOut.output += msg.data || '';
        if (agentOut.output.length > 3000) {
          agentOut.output = '...' + agentOut.output.slice(-2970);
        }
      } else if (msg.type === 'workflow:step:agent:complete') {
        agentOut.status = msg.exitCode === 0 ? 'completed' : 'error';
        if (!agentOut.output && msg.output) {
          agentOut.output = msg.output;
        }
      }
    }
    updateProgressDisplay();
  }

  // ── Handle WebSocket messages for workflows ──
  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'workflow:started': {
        if (workflows.active && workflows.active.status === 'running') {
          workflows.active.wfId = msg.workflowId;
          workflows.active.totalSteps = msg.totalSteps;
        }
        break;
      }

      case 'workflow:step:start': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          step.status = 'running';
          workflows.active.currentStep = msg.stepIndex;
        }
        updateProgressDisplay();
        break;
      }

      case 'workflow:step:output': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          // Parallel step: route to agent-level tracking
          if (step.mode === 'parallel' && msg.agentIndex !== undefined) {
            handleParallelOutput(msg);
            break;
          }
          step.output += msg.data;
          if (step.output.length > 5000) {
            step.output = '...' + step.output.slice(-4970);
          }
          // Update progress overlay if visible
          updateProgressDisplay();
        }
        break;
      }

      case 'workflow:step:agent:complete': {
        if (!workflows.active) break;
        handleParallelOutput(msg);
        break;
      }

      case 'workflow:step:complete': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          step.status = msg.exitCode === 0 ? 'completed' : 'error';
          if (!step.output && msg.output) {
            step.output = msg.output;
          }
        }
        updateProgressDisplay();
        break;
      }

      case 'workflow:step:error': {
        if (!workflows.active) break;
        const step = workflows.active.steps[msg.stepIndex];
        if (step) {
          step.status = 'error';
          step.output = (step.output || '') + '\n[Error] ' + (msg.error || 'Unknown error');
        }
        updateProgressDisplay();
        break;
      }

      case 'workflow:progress': {
        if (workflows.active) {
          workflows.active.currentStep = msg.currentStep;
        }
        break;
      }

      case 'workflow:completed': {
        if (workflows.active) {
          workflows.active.status = 'completed';
          const successCount = workflows.active.steps.filter(s => s.status === 'completed').length;
          showWfToast(
            `✅ ${workflows.active.name} completed (${successCount}/${workflows.active.steps.length} steps)`,
            'success'
          );
          renderWorkflowList();
          updateProgressDisplay();
        }
        break;
      }

      case 'workflow:cancelled': {
        if (workflows.active) {
          workflows.active.status = 'cancelled';
          showWfToast('⏹ Workflow cancelled', 'info');
          renderWorkflowList();
          updateProgressDisplay();
        }
        break;
      }

      case 'workflow:error': {
        showWfToast('Workflow error: ' + (msg.message || 'unknown'), 'error');
        break;
      }
    }
  }

  // ── Handle WebSocket disconnect — mark active workflow as failed ──
  function handleDisconnect() {
    if (workflows.active && workflows.active.status === 'running') {
      workflows.active.status = 'error';
      // Mark any pending steps as error
      for (const step of workflows.active.steps) {
        if (step.status === 'pending' || step.status === 'running') {
          step.status = 'error';
          step.output = (step.output || '') + '\n[Disconnected] WebSocket connection lost';
        }
      }
      showWfToast('⏹ Workflow interrupted — connection lost', 'error');
      renderWorkflowList();
      updateProgressDisplay();
    }
  }

  // ── Toast notification ──
  function showWfToast(msg, type) {
    const el = document.getElementById('wf-toast') || (() => {
      const e = document.createElement('div');
      e.id = 'wf-toast';
      e.className = 'wf-toast';
      document.body.appendChild(e);
      return e;
    })();
    el.textContent = msg;
    el.className = 'wf-toast ' + (type || 'info');
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // ── Wire up ──
  export const Workflows = {
    loadWorkflows,
    renderWorkflowList,
    startWorkflow,
    cancelWorkflow,
    handleWSMessage,
    handleDisconnect,
    showWorkflowProgress,
    updateProgressDisplay,
    workflows,
    showWfToast,
  };
  Q.Workflows = Workflows;
