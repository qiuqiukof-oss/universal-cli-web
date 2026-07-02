// ws-handler.test.js - E2E test for PTY lifecycle via WebSocket
// Standalone test (avoids node:test) because WebSocket/HTTP server event loop prevents clean exit

const http = require('http')
const WebSocket = require('ws')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const { setupWebSocket } = require(path.join(PROJECT_ROOT, 'ws-handler.js'))

let failures = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`)
  } else {
    console.log(`  FAIL: ${label}`)
    failures++
  }
}

async function runTests() {
  const server = http.createServer()
  const wsHandler = setupWebSocket(server, { port: 0 })

  try {
    await new Promise(resolve => server.listen(0, resolve))
    const port = server.address().port
    const WS_URL = `ws://127.0.0.1:${port}`
    console.log(`Test server started on port ${port}`)

    function createConnection() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL)
        ws.on('open', () => resolve(ws))
        ws.on('error', reject)
      })
    }

    function collectMessages(ws, sendMsg, terminalTypes, timeout = 5000) {
      return new Promise((resolve) => {
        const msgs = []
        const timer = setTimeout(() => {
          ws.removeAllListeners('message')
          resolve(msgs)
        }, timeout)
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString())
            msgs.push(msg)
            if (terminalTypes.includes(msg.type)) {
              clearTimeout(timer)
              ws.removeAllListeners('message')
              resolve(msgs)
            }
          } catch (e) {
            // ignore parse errors
          }
        })
        if (sendMsg) {
          ws.send(JSON.stringify(sendMsg))
        }
      })
    }

    // ===== Test 1: Launch batch command (node via cliId) =====
    console.log('\n--- Test 1: Launch batch command (cliId: node) ---')
    {
      const ws = await createConnection()
      const msgs = await collectMessages(ws,
        { type: 'launch', cliId: 'node' },
        ['launched', 'error'], 8000)

      assert(msgs.length > 0, 'Received at least one message')
      const launchedMsg = msgs.find(m => m.type === 'launched')
      assert(!!launchedMsg, 'Received launched message')
      if (launchedMsg) {
        assert(!!launchedMsg.tabId, 'launched has tabId')
        // Kill the node process
        const killMsgs = await collectMessages(ws,
          { type: 'kill', tabId: launchedMsg.tabId },
          ['exit', 'killed'], 5000)
        assert(killMsgs.some(m => m.type === 'exit' || m.type === 'killed'),
          'Tab was killed or exited')
      }
      ws.close()
    }

    // ===== Test 2: Launch interactive shell (cmd via cliId) =====
    console.log('\n--- Test 2: Launch interactive shell (cliId: cmd) ---')
    {
      const ws = await createConnection()
      const msgs = await collectMessages(ws,
        { type: 'launch', cliId: 'cmd' },
        ['launched', 'error'], 5000)

      const launchedMsg = msgs.find(m => m.type === 'launched')
      assert(!!launchedMsg, 'Received launched message for cmd')
      if (launchedMsg) {
        assert(!!launchedMsg.tabId, 'launched has tabId')
        // Kill it
        const killMsgs = await collectMessages(ws,
          { type: 'kill', tabId: launchedMsg.tabId },
          ['exit', 'killed'], 5000)
        assert(killMsgs.some(m => m.type === 'exit' || m.type === 'killed'),
          'Tab was killed or exited')
      }
      ws.close()
    }

    // ===== Test 3: Unknown cliId =====
    console.log('\n--- Test 3: Unknown cliId ---')
    {
      const ws = await createConnection()
      const msgs = await collectMessages(ws,
        { type: 'launch', cliId: 'this-cli-does-not-exist' },
        ['error'], 5000)

      const errorMsg = msgs.find(m => m.type === 'error')
      assert(!!errorMsg, 'Received error for unknown cliId')
      if (errorMsg) {
        assert(typeof errorMsg.message === 'string', 'Error has message string')
      }
      ws.close()
    }

    // ===== Test 4: Tab listing =====
    console.log('\n--- Test 4: Tab listing ---')
    {
      const ws = await createConnection()
      // Launch a cmd shell
      const launchMsgs = await collectMessages(ws,
        { type: 'launch', cliId: 'cmd' },
        ['launched', 'error'], 5000)
      const launched = launchMsgs.find(m => m.type === 'launched')

      // Request tab list
      const listMsgs = await collectMessages(ws,
        { type: 'tab:list' },
        ['tab:list'], 3000)
      const listMsg = listMsgs.find(m => m.type === 'tab:list')
      assert(!!listMsg, 'Received tab:list response')
      if (listMsg) {
        assert(Array.isArray(listMsg.tabs), 'tab:list.tabs is an array')
        if (launched) {
          assert(listMsg.tabs.length >= 1, 'At least one tab in list')
        }
      }

      // Cleanup
      if (launched && launched.tabId) {
        await collectMessages(ws,
          { type: 'kill', tabId: launched.tabId },
          ['exit', 'killed'], 5000)
      }
      ws.close()
    }

    // ===== Test 5: PTY resize =====
    console.log('\n--- Test 5: PTY resize ---')
    {
      const ws = await createConnection()
      const launchMsgs = await collectMessages(ws,
        { type: 'launch', cliId: 'cmd' },
        ['launched', 'error'], 5000)
      const launched = launchMsgs.find(m => m.type === 'launched')

      if (launched && launched.tabId) {
        ws.send(JSON.stringify({
          type: 'resize',
          tabId: launched.tabId,
          cols: 120,
          rows: 40
        }))
        await new Promise(r => setTimeout(r, 300))
        const killMsgs = await collectMessages(ws,
          { type: 'kill', tabId: launched.tabId },
          ['exit', 'killed'], 5000)
        assert(killMsgs.some(m => m.type === 'exit' || m.type === 'killed'),
          'Resized tab killed successfully')
      } else {
        assert(false, 'Launched shell for resize test')
      }
      ws.close()
    }

    // ===== Test 6: No cliId specified =====
    console.log('\n--- Test 6: No cliId specified ---')
    {
      const ws = await createConnection()
      const msgs = await collectMessages(ws,
        { type: 'launch' },
        ['error'], 5000)

      const errorMsg = msgs.find(m => m.type === 'error')
      assert(!!errorMsg, 'Received error for no cliId')
      if (errorMsg) {
        assert(typeof errorMsg.message === 'string', 'Error has message')
      }
      ws.close()
    }

    console.log(`\n=== Results: ${failures} failure(s) ===`)
    process.exit(failures > 0 ? 1 : 0)

  } catch (err) {
    console.error('Fatal error:', err)
    process.exit(1)
  } finally {
    wsHandler.close()
    server.close()
  }
}

runTests()
