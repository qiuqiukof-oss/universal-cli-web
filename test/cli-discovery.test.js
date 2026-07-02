// ============================================================
// CLI Discovery tests — pure logic, no network, no subprocess
// ============================================================
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============================================================
// Preset-derived constants — loaded from cli-presets/*.json
// ============================================================
describe('preset constants', () => {
  it('KNOWN_CLI_NAMES should be a non-empty array with expected entries', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_NAMES } = getPresetConstants();
    assert.ok(Array.isArray(KNOWN_CLI_NAMES));
    assert.ok(KNOWN_CLI_NAMES.length > 10);
    assert.ok(KNOWN_CLI_NAMES.includes('node'));
    assert.ok(KNOWN_CLI_NAMES.includes('git'));
    assert.ok(KNOWN_CLI_NAMES.includes('bash'));
  });

  it('KNOWN_CLI_TYPES should have expected batch entries', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_TYPES } = getPresetConstants();
    assert.equal(KNOWN_CLI_TYPES.go, 'batch');
    assert.equal(KNOWN_CLI_TYPES.node, 'batch');
    assert.equal(KNOWN_CLI_TYPES.git, 'batch');
  });

  it('KNOWN_CLI_TYPES should have expected interactive entries', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_TYPES } = getPresetConstants();
    assert.equal(KNOWN_CLI_TYPES.bash, 'interactive');
    assert.equal(KNOWN_CLI_TYPES.vim, 'interactive');
    assert.equal(KNOWN_CLI_TYPES.ssh, 'interactive');
  });

  it('KNOWN_CLI_CATEGORIES should contain agent/directory/tool types', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_CATEGORIES } = getPresetConstants();
    const cats = new Set(Object.values(KNOWN_CLI_CATEGORIES));
    assert.ok(cats.has('agent'));
    assert.ok(cats.has('directory'));
    assert.ok(cats.has('tool'));
  });

  it('KNOWN_CLI_CATEGORIES should classify opencode as agent', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_CATEGORIES } = getPresetConstants();
    assert.equal(KNOWN_CLI_CATEGORIES.opencode, 'agent');
  });

  it('KNOWN_CLI_CATEGORIES should classify bash as directory', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_CATEGORIES } = getPresetConstants();
    assert.equal(KNOWN_CLI_CATEGORIES.bash, 'directory');
  });

  it('KNOWN_CLI_CATEGORIES should classify git as tool', () => {
    const { getPresetConstants } = require('../cli-discovery');
    const { KNOWN_CLI_CATEGORIES } = getPresetConstants();
    assert.equal(KNOWN_CLI_CATEGORIES.git, 'tool');
  });
});

// ============================================================
// guessCategory
// ============================================================
describe('guessCategory', () => {
  it('should return "agent" for opencode', () => {
    const { guessCategory } = require('../cli-discovery');
    assert.equal(guessCategory('opencode'), 'agent');
  });

  it('should return "agent" for codebuff and freebuff', () => {
    const { guessCategory } = require('../cli-discovery');
    assert.equal(guessCategory('codebuff'), 'agent');
    assert.equal(guessCategory('freebuff'), 'agent');
  });

  it('should return "directory" for bash, python, node, go, cmd', () => {
    const { guessCategory } = require('../cli-discovery');
    for (const cli of ['bash', 'python', 'node', 'go', 'cmd']) {
      assert.equal(guessCategory(cli), 'directory', `${cli} should be 'directory'`);
    }
  });

  it('should return "tool" for git, curl, vim, nano, htop, tmux, ssh', () => {
    const { guessCategory } = require('../cli-discovery');
    for (const cli of ['git', 'curl', 'vim', 'nano', 'htop', 'tmux', 'ssh']) {
      assert.equal(guessCategory(cli), 'tool', `${cli} should be 'tool'`);
    }
  });

  it('should return "tool" as default for unknown CLIs', () => {
    const { guessCategory } = require('../cli-discovery');
    assert.equal(guessCategory('some-random-cli-xyz'), 'tool');
    assert.equal(guessCategory(''), 'tool');
  });
});

// ============================================================
// resolveCommand
// ============================================================
describe('resolveCommand', () => {
  let tempDir, originalPath;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'test-bin-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(tempDir, 'my-test-cli.exe'), 'fake');
    } else {
      fs.writeFileSync(path.join(tempDir, 'my-test-cli'), '#!/bin/bash\necho hello');
      fs.chmodSync(path.join(tempDir, 'my-test-cli'), 0o755);
    }

    originalPath = process.env.PATH;
    process.env.PATH = tempDir;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  it('should resolve a command that exists in PATH', () => {
    const { resolveCommand } = require('../cli-discovery');
    const resolved = resolveCommand('my-test-cli');
    assert.ok(resolved, 'should resolve to a path');
    assert.ok(resolved.includes('my-test-cli'), `path should contain CLI name, got: ${resolved}`);
  });

  it('should return null for a command not in PATH', () => {
    const { resolveCommand } = require('../cli-discovery');
    assert.equal(resolveCommand('this-cmd-does-not-exist-99999'), null);
  });
});

// ============================================================
// guessType
// ============================================================
describe('guessType', () => {
  it('should return "batch" for node from lookup table', async () => {
    const { guessType } = require('../cli-discovery');
    const type = await guessType('/fake/path/node', 'node');
    assert.equal(type, 'batch');
  });

  it('should return "interactive" for bash from lookup table', async () => {
    const { guessType } = require('../cli-discovery');
    const type = await guessType('/fake/path/bash', 'bash');
    assert.equal(type, 'interactive');
  });

  it('should return "batch" for go from lookup table', async () => {
    const { guessType } = require('../cli-discovery');
    const type = await guessType('/fake/path/go', 'go');
    assert.equal(type, 'batch');
  });

  it('should return "interactive" for vim from lookup table', async () => {
    const { guessType } = require('../cli-discovery');
    const type = await guessType('/fake/path/vim', 'vim');
    assert.equal(type, 'interactive');
  });
});

// ============================================================
// withRegistry
// ============================================================
describe('withRegistry', () => {
  it('should execute a function and return its result', async () => {
    const { withRegistry } = require('../cli-discovery');
    const result = await withRegistry(() => ({ success: true, value: 42 }));
    assert.equal(result.success, true);
    assert.equal(result.value, 42);
  });

  it('should propagate errors from the inner function', async () => {
    const { withRegistry } = require('../cli-discovery');
    await assert.rejects(
      () => withRegistry(() => { throw new Error('inner error'); }),
      { message: 'inner error' }
    );
  });

  it('should handle sequential operations', async () => {
    const { withRegistry } = require('../cli-discovery');
    const results = [];
    const p1 = withRegistry(() => { results.push(1); return 1; });
    const p2 = withRegistry(() => { results.push(2); return 2; });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 1);
    assert.equal(r2, 2);
  });
});

// ============================================================
// isWin
// ============================================================
describe('isWin', () => {
  it('should match the current platform', () => {
    const { isWin } = require('../cli-discovery');
    assert.equal(isWin, process.platform === 'win32');
  });
});

// ============================================================
// Registry persistence — uses temp files
// ============================================================
describe('registry persistence', () => {
  it('saveRegistry should write valid JSON and loadRegistry should read it back', () => {
    const { saveRegistry, loadRegistry, REGISTRY_PATH } = require('../cli-discovery');

    // Save some test data to the actual registry path
    const testData = {
      version: 1,
      clis: [
        { id: 'test-one', name: 'test-one', type: 'batch', category: 'tool' },
        { id: 'test-two', name: 'test-two', type: 'interactive', category: 'directory' },
      ]
    };

    // Backup existing registry if it exists
    let backup = null;
    try {
      if (fs.existsSync(REGISTRY_PATH)) {
        backup = fs.readFileSync(REGISTRY_PATH, 'utf-8');
      }
    } catch (e) { /* ignore */ }

    try {
      // Write test data
      saveRegistry(testData);

      // Read it back — loadRegistry should find the file we just wrote
      const loaded = loadRegistry();
      assert.equal(loaded.version, 1);
      assert.equal(loaded.clis.length, 2);
      assert.equal(loaded.clis[0].id, 'test-one');
      assert.equal(loaded.clis[1].id, 'test-two');
    } finally {
      // Restore backup
      if (backup !== null) {
        fs.writeFileSync(REGISTRY_PATH, backup, 'utf-8');
      } else {
        try { fs.unlinkSync(REGISTRY_PATH); } catch (e) { /* ignore */ }
      }
    }
  });

  it('loadRegistry should return default structure when file is missing', () => {
    const { loadRegistry, REGISTRY_PATH } = require('../cli-discovery');

    // Temporarily remove the registry file
    let backup = null;
    try {
      if (fs.existsSync(REGISTRY_PATH)) {
        backup = fs.readFileSync(REGISTRY_PATH, 'utf-8');
        fs.unlinkSync(REGISTRY_PATH);
      }
    } catch (e) { /* ignore */ }

    try {
      const loaded = loadRegistry();
      assert.ok(loaded);
      assert.equal(loaded.version, 1);
      assert.ok(Array.isArray(loaded.clis));
    } finally {
      if (backup !== null) {
        fs.writeFileSync(REGISTRY_PATH, backup, 'utf-8');
      }
    }
  });
});
