// ============================================================
// Agent Lifecycle E2E — tests the full agent flow via WebSocket
//  1. Natural lifecycle: launch → started → output → exit
//  2. User stop:        launch → started → kill → killed
//  3. Error case:       launch with no cmd → error
//
// Uses a standalone test approach (not node:test describe/it)
// because the HTTP+WS server's event loop keeps node:test from
// exiting cleanly.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocket } = require('ws');
const { setupWebSocket } = require('../ws-handler');

let failures = 0;
function assert(condition, label) {
  if (!condition) { console.log('FAIL:', label); failures++; }
  else { console.log('PASS:', label); }
}

async function runTests() {
  // ── Server setup ──
  const server = http.createServer((_req, res) => res.end('ok'));
  const wsHandler = setupWebSocket(server, { port: 0 });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    // ════════════════════════════════════════════
    // Test 1: Natural lifecycle (launch → output → exit)
    // ════════════════════════════════════════════
    console.log('\n=== Test 1: Natural lifecycle ===');
    {
      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise(r => ws.on('open', r));

      ws.send(JSON.stringify({
        type: 'agent:launch',
        agentId: 'test-natural',
        name: 'Natural Exit Test',
        cmd: 'node',
        args: ['-e', 'setTimeout(() => console.log("HELLO_AGENT"), 200)'],
      }));

      const msgs = await new Promise((resolve, reject) => {
        const list = [];
        const timer = setTimeout(() => {
          reject(new Error(`Timeout. Got: ${list.map(m => m.type).join(', ')}`));
        }, 12000);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          list.push(msg);
          if (msg.type === 'agent:exit') { clearTimeout(timer); resolve(list); }
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
      ws.close();

      const types = msgs.map(m => m.type);
      assert(types.includes('agent:started'), 'agent:started received');
      assert(types.includes('agent:output'), 'agent:output received');
      assert(types.includes('agent:exit'), 'agent:exit received');

      const started = msgs.find(m => m.type === 'agent:started');
      const exit = msgs.find(m => m.type === 'agent:exit');
      assert(started.agentId === 'test-natural', `started.agentId = '${started.agentId}' (expected 'test-natural')`);
      assert(!!started.sessionId, `started.sessionId = '${started.sessionId}' (expected truthy)`);
      assert(exit.sessionId === started.sessionId, `exit.sessionId = '${exit.sessionId}', started.sessionId = '${started.sessionId}'`);
      assert(exit.code === 0, `exit.code = ${exit.code} (expected 0)`);

      const outputs = msgs.filter(m => m.type === 'agent:output');
      assert(outputs.some(m => m.data.includes('HELLO_AGENT')),
        `output contains HELLO_AGENT (${outputs.length} chunk(s))`);

      assert(types.indexOf('agent:started') < types.indexOf('agent:output'),
        'started before output');
      assert(types.indexOf('agent:output') < types.indexOf('agent:exit'),
        'output before exit');
    }

    // ════════════════════════════════════════════
    // Test 2: User stop (launch → kill → killed / exit)
    // ════════════════════════════════════════════
    console.log('\n=== Test 2: User stop ===');
    {
      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise(r => ws.on('open', r));

      ws.send(JSON.stringify({
        type: 'agent:launch',
        agentId: 'test-stop',
        name: 'User Stop Test',
        cmd: 'node',
        args: ['-e', 'setTimeout(() => {}, 2000)'], // short hang; test sends kill before natural exit
      }));

      // Wait for started, then send kill
      let startedSessionId;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for agent:started')), 5000);
        const handler = (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === 'agent:started') {
            clearTimeout(timer);
            startedSessionId = msg.sessionId;
            ws.removeListener('message', handler);
            ws.send(JSON.stringify({ type: 'agent:kill', sessionId: msg.sessionId }));
            resolve();
          }
        };
        ws.on('message', handler);
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });

      // Wait for killed or exit
      const msgs = await new Promise((resolve, reject) => {
        const list = [];
        const timer = setTimeout(() => {
          reject(new Error(`Timeout. Got: ${list.map(m => m.type).join(', ')}`));
        }, 10000);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          list.push(msg);
          if (msg.type === 'agent:killed' || msg.type === 'agent:exit') {
            clearTimeout(timer);
            resolve(list);
          }
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
      ws.close();

      const types = msgs.map(m => m.type);
      const hasKilled = types.includes('agent:killed');
      const hasExit = types.includes('agent:exit');
      assert(hasKilled || hasExit,
        `agent:killed or agent:exit received (got: ${types.join(', ')})`);
      if (hasKilled) {
        const sid = msgs.find(m => m.type === 'agent:killed').sessionId;
        assert(sid === startedSessionId,
          `killed.sessionId = '${sid}', expected '${startedSessionId}'`);
      }
      if (hasExit) {
        const sid = msgs.find(m => m.type === 'agent:exit').sessionId;
        assert(sid === startedSessionId,
          `exit.sessionId = '${sid}', expected '${startedSessionId}'`);
      }
    }

    // ════════════════════════════════════════════
    // Test 3: Error case (no command → error)
    // ════════════════════════════════════════════
    console.log('\n=== Test 3: No command error ===');
    {
      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise(r => ws.on('open', r));

      ws.send(JSON.stringify({
        type: 'agent:launch',
        agentId: 'test-no-cmd',
        name: 'No Cmd Test',
        // No 'cmd' field
      }));

      const msgs = await new Promise((resolve, reject) => {
        const list = [];
        const timer = setTimeout(() => {
          reject(new Error(`Timeout. Got: ${list.map(m => m.type).join(', ')}`));
        }, 5000);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          list.push(msg);
          if (msg.type === 'agent:error') { clearTimeout(timer); resolve(list); }
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
      ws.close();

      const err = msgs.find(m => m.type === 'agent:error');
      assert(!!err, 'agent:error received (got undefined)');
      assert(err.agentId === 'test-no-cmd', `error.agentId = '${err.agentId}' (expected 'test-no-cmd')`);
      assert(err.errorCode === 'no_command', `error.errorCode = '${err.errorCode}' (expected 'no_command')`);
      assert(!!err.message, `error.message = '${err.message}' (expected truthy)`);
    }

    // ════════════════════════════════════════════
    // Test 4: Command not found error
    // ════════════════════════════════════════════
    console.log('\n=== Test 4: Command not found ===');
    {
      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise(r => ws.on('open', r));

      ws.send(JSON.stringify({
        type: 'agent:launch',
        agentId: 'test-notfound',
        name: 'Not Found Test',
        cmd: 'nonexistent-command-xyz-99999',
      }));

      const msgs = await new Promise((resolve, reject) => {
        const list = [];
        const timer = setTimeout(() => {
          reject(new Error(`Timeout. Got: ${list.map(m => m.type).join(', ')}`));
        }, 5000);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw);
          list.push(msg);
          if (msg.type === 'agent:error') { clearTimeout(timer); resolve(list); }
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
      ws.close();

      const err = msgs.find(m => m.type === 'agent:error');
      assert(!!err, 'agent:error received (got undefined)');
      assert(err.agentId === 'test-notfound', `error.agentId = '${err.agentId}' (expected 'test-notfound')`);
      assert(err.errorCode === 'command_not_found', `error.errorCode = '${err.errorCode}' (expected 'command_not_found')`);
      assert(!!err.message, `error.message = '${err.message}' (expected truthy)`);
    }

    // ════════════════════════════════════════════
    // Test 5: PTY spawn error (0-byte file, platform-independent)
    // ════════════════════════════════════════════
    console.log('\n=== Test 5: PTY spawn error ===');
    {
      // Create a 0-byte file that exists but cannot execute (no extension =
      // platform-independent — fails on both Windows and Unix)
      const badExe = path.join(os.tmpdir(), 'test-spawn-err-' + Date.now());
      fs.writeFileSync(badExe, '');

      let ws;
      try {
        ws = new WebSocket(`ws://localhost:${port}`);
        await new Promise(r => ws.on('open', r));

        ws.send(JSON.stringify({
          type: 'agent:launch',
          agentId: 'test-spawn-err',
          name: 'Spawn Error Test',
          cmd: badExe,  // absolute path to 0-byte file → pty.spawn throws
          args: [],
        }));

        const msgs = await new Promise((resolve, reject) => {
          const list = [];
          const timer = setTimeout(() => {
            reject(new Error(`Timeout. Got: ${list.map(m => m.type).join(', ')}`));
          }, 5000);
          ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            list.push(msg);
            if (msg.type === 'agent:error') { clearTimeout(timer); resolve(list); }
          });
          ws.on('error', (err) => { clearTimeout(timer); reject(err); });
        });

        const err = msgs.find(m => m.type === 'agent:error');
        assert(!!err, 'agent:error received (got undefined)');
        assert(err.agentId === 'test-spawn-err', `error.agentId = '${err.agentId}' (expected 'test-spawn-err')`);
        assert(err.errorCode === 'spawn_error', `error.errorCode = '${err.errorCode}' (expected 'spawn_error')`);
        assert(!!err.message, `error.message = '${err.message}' (expected truthy)`);
      } finally {
        if (ws) ws.close();
        try { fs.unlinkSync(badExe); } catch (e) { /* ignore */ }
      }
    }

  } finally {
    // Always clean up
    wsHandler.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exit(failures > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('\nFATAL:', err.message || err);
  process.exit(1);
});
