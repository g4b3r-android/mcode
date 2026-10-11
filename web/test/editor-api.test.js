import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable'
  ].filter(Boolean);
  return candidates.find((command) => {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  });
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForPage(port, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((item) => item.type === 'page');
      if (page) return page;
    } catch {
      // Chromium ainda está inicializando.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error('Chromium não iniciou dentro do tempo esperado.');
}

function connectDevTools(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let messageId = 0;

  const ready = new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });

  async function command(method, params = {}) {
    await ready;
    const id = ++messageId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, reject) => {
      pending.set(id, { resolve: resolveCommand, reject });
    });
  }

  return {
    command,
    async evaluate(expression) {
      const response = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      }
      return response.result.value;
    },
    close() {
      socket.close();
    }
  };
}

test('bundle usa JavaScript clássico compatível com Android WebView', () => {
  const bundledHtml = readFileSync(resolve(projectRoot, 'dist/index.html'), 'utf8');
  assert.doesNotMatch(bundledHtml, /<script[^>]*\btype=["']module["']/i);
  assert.equal(
    bundledHtml.includes(`insertText:${String.fromCharCode(96)}`),
    false,
    'Os snippets não devem virar template strings multilinha.'
  );
  assert(
    bundledHtml.search(/<script\s*>/i) > bundledHtml.indexOf('<div id="app">'),
    'O script clássico precisa executar depois da criação do DOM.'
  );
});

test('CodeEditorAPI registra extensões e renderiza um projeto HTML', { timeout: 25000 }, async (t) => {
  const chromium = findChromium();
  if (!chromium) {
    t.skip('Chromium não está instalado. Defina CHROMIUM_PATH para executar o teste E2E.');
    return;
  }

  const port = await getFreePort();
  const profileDirectory = mkdtempSync(resolve(tmpdir(), 'code-editor-test-'));
  const pageUrl = pathToFileURL(resolve(projectRoot, 'dist/index.html')).href;
  const browser = spawn(chromium, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    pageUrl
  ], { stdio: 'ignore' });

  let devTools;
  t.after(async () => {
    devTools?.close();
    if (browser.exitCode == null) {
      browser.kill('SIGTERM');
      await Promise.race([
        new Promise((resolveExit) => browser.once('exit', resolveExit)),
        new Promise((resolveWait) => setTimeout(resolveWait, 1500))
      ]);
      if (browser.exitCode == null) {
        browser.kill('SIGKILL');
        await new Promise((resolveExit) => browser.once('exit', resolveExit));
      }
    }
    rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const page = await waitForPage(port);
  devTools = connectDevTools(page.webSocketDebuggerUrl);
  // The initial about:blank context can disappear while the file is navigating.
  const readyDeadline = Date.now() + 5000;
  let ready = false;
  while (!ready && Date.now() < readyDeadline) {
    try { ready = await devTools.evaluate('Boolean(window.CodeEditorAPI)'); }
    catch (error) {
      if (!/context|navigat/i.test(error.message)) throw error;
    }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(ready, 'CodeEditorAPI não foi inicializada.');


  const result = await devTools.evaluate(`(async () => {
    const deadline = Date.now() + 5000;
    while (!window.CodeEditorAPI && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!window.CodeEditorAPI) throw new Error('CodeEditorAPI não foi inicializada.');

    const events = [];
    const topbarCallbacks = [];
    ['language-added', 'snippets-added', 'file-added', 'file-updated', 'topbar-option-added', 'topbar-option-removed', 'topbar-action', 'html-rendered']
      .forEach((name) => addEventListener('code-editor:' + name, () => events.push(name)));

    CodeEditorAPI.addLanguage({
      id: 'javascript',
      label: 'JavaScript',
      badge: 'JS',
      color: '#f7df1e',
      extensions: ['js', '.mjs'],
      lineComment: '//',
      blockComment: ['/*', '*/'],
      keywords: ['const', 'let', 'return'],
      literals: ['true', 'false', 'null'],
      types: ['Array', 'Object', 'Promise'],
      lint(code) {
        return code.includes('debugger')
          ? [{ line: 1, column: 1, message: 'Remova debugger.', severity: 'warning' }]
          : [];
      }
    });

    CodeEditorAPI.addSnippets('javascript', [{
      label: 'log',
      detail: 'Console log',
      insertText: 'console.log();',
      caretBack: 2
    }]);

    CodeEditorAPI.addTopbarOption({
      id: 'save',
      type: 'button',
      label: 'Salvar',
      icon: 'S',
      onClick({ id }) { topbarCallbacks.push(id); }
    });
    CodeEditorAPI.addTopbarOption({
      id: 'tools',
      type: 'menu',
      label: 'Ferramentas',
      icon: '⋮',
      items: [{
        id: 'format',
        label: 'Formatar',
        onClick({ itemId }) { topbarCallbacks.push(itemId); }
      }]
    });

    document.querySelector('[data-topbar-option="save"]').click();
    document.querySelector('[data-topbar-menu="tools"]').click();
    const menuOpened = !document.querySelector('[data-topbar-menu-popup="tools"]').classList.contains('hidden');
    document.querySelector('[data-topbar-menu-item="format"]').click();
    const menuClosed = document.querySelector('[data-topbar-menu-popup="tools"]').classList.contains('hidden');
    const topbarOptions = CodeEditorAPI.getTopbarOptions().map(({ id, type }) => ({ id, type }));
    const removedTopbarOption = CodeEditorAPI.removeTopbarOption('save');
    const removedTopbarButtonMissing = !document.querySelector('[data-topbar-option="save"]');

    CodeEditorAPI.addFiles([
      { name: 'app.js', content: 'con', language: 'javascript' },
      { name: 'index.html', content: '<h1 id="result">API funcionando</h1>' }
    ]);

    CodeEditorAPI.openFile('app.js');
    codeInput.selectionStart = codeInput.selectionEnd = codeInput.value.length;
    codeInput.dispatchEvent(new Event('input'));
    const firstCompletion = autocomplete.querySelector('.completion-label')?.textContent;

    CodeEditorAPI.updateFile('app.js', 'debugger;');
    const lintStatus = problemsStatus.textContent;
    const preview = CodeEditorAPI.renderHtml({ file: 'index.html' });

    document.documentElement.style.setProperty('--safe-top', '24px');
    document.documentElement.style.setProperty('--safe-right', '8px');
    document.documentElement.style.setProperty('--safe-bottom', '30px');
    document.documentElement.style.setProperty('--safe-left', '6px');
    const layoutInsets = {
      topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
      statusbarHeight: document.querySelector('.statusbar').getBoundingClientRect().height,
      sidebarPaddingBottom: getComputedStyle(document.querySelector('.sidebar')).paddingBottom
    };

    return {
      version: CodeEditorAPI.version,
      language: CodeEditorAPI.getLanguages().find(({ id }) => id === 'javascript'),
      snippet: CodeEditorAPI.getSnippets('javascript').find(({ label }) => label === 'log'),
      files: CodeEditorAPI.getFiles().map(({ name }) => name),
      firstCompletion,
      lintStatus,
      preview,
      previewVisible: !previewPanel.classList.contains('hidden'),
      previewSource: htmlPreview.srcdoc,
      layoutInsets,
      topbarCallbacks,
      topbarOptions,
      removedTopbarOption,
      removedTopbarButtonMissing,
      menuOpened,
      menuClosed,
      erudaAvailable: Boolean(window.eruda && document.getElementById('eruda')),
      events
    };
  })()`);

  assert.equal(result.version, '1.1.0');
  assert.deepEqual(result.language.extensions, ['.js', '.mjs']);
  assert.deepEqual(result.language.literals, ['true', 'false', 'null']);
  assert.equal(result.snippet.kind, 'snippet');
  assert.equal(result.firstCompletion, 'const');
  assert.equal(result.lintStatus, '× 0  △ 1');
  assert.equal(result.preview.title, 'index.html');
  assert.equal(result.previewVisible, true);
  assert.equal(result.previewSource, '<h1 id="result">API funcionando</h1>');
  assert.deepEqual(result.layoutInsets, {
    topbarHeight: 70,
    statusbarHeight: 56,
    sidebarPaddingBottom: '30px'
  });
  assert.deepEqual(result.topbarCallbacks, ['save', 'format']);
  assert.deepEqual(result.topbarOptions, [
    { id: 'save', type: 'button' },
    { id: 'tools', type: 'menu' }
  ]);
  assert.equal(result.menuOpened, true);
  assert.equal(result.menuClosed, true);
  assert.equal(result.removedTopbarOption, true);
  assert.equal(result.removedTopbarButtonMissing, true);
  assert.equal(result.erudaAvailable, false);
  assert(result.files.includes('app.js'));
  assert(result.files.includes('index.html'));
  for (const event of ['language-added', 'snippets-added', 'file-added', 'file-updated', 'topbar-option-added', 'topbar-option-removed', 'topbar-action', 'html-rendered']) {
    assert(result.events.includes(event), `Evento ausente: ${event}`);
  }

  await t.test('projeto Android lê apenas arquivos abertos e preserva edições', async () => {
    const lazy = await devTools.evaluate(`(() => {
      const reads = [];
      const errors = [];
      window.Android = {
        readProjectFile(root, name) {
          reads.push({ root, name });
          return JSON.stringify(name === 'image.png'
            ? { success: false, error: 'Arquivo binário' }
            : { success: true, content: 'conteúdo original' });
        },
        showToast(message) { errors.push(message); }
      };
      window.dispatchEvent(new CustomEvent('android:project-opened', { detail: {
        rootUri: 'content://project/one',
        files: [{ name: 'main.js' }, { name: 'image.png' }]
      }}));
      const initialReads = reads.length;
      const initialFiles = CodeEditorAPI.getFiles().map(f => f.name);
      CodeEditorAPI.openFile('main.js');
      const content = CodeEditorAPI.getActiveFile().content;
      CodeEditorAPI.updateFile('main.js', 'edição local');
      CodeEditorAPI.openFile('main.js');
      const edited = CodeEditorAPI.getActiveFile().content;
      const failed = CodeEditorAPI.openFile('image.png');
      const activeAfterFailure = CodeEditorAPI.getActiveFile().name;
      window.dispatchEvent(new CustomEvent('android:project-loading'));
      const filesDuringLoading = CodeEditorAPI.getFiles().length;
      window.dispatchEvent(new CustomEvent('android:project-opened', { detail: {
        rootUri: 'content://project/two', files: [{ name: 'main.js' }]
      }}));
      CodeEditorAPI.openFile('main.js');
      return { initialReads, initialFiles, content, edited, failed,
        activeAfterFailure, filesDuringLoading, reads, errors };
    })()`);
    assert.equal(lazy.initialReads, 0);
    assert.deepEqual(lazy.initialFiles, ['main.js', 'image.png']);
    assert.equal(lazy.content, 'conteúdo original');
    assert.equal(lazy.edited, 'edição local');
    assert.equal(lazy.failed, null);
    assert.equal(lazy.activeAfterFailure, 'main.js');
    assert.equal(lazy.filesDuringLoading, 0);
    assert.deepEqual(lazy.reads, [
      { root: 'content://project/one', name: 'main.js' },
      { root: 'content://project/one', name: 'image.png' },
      { root: 'content://project/two', name: 'main.js' },
    ]);
    assert.deepEqual(lazy.errors, ['Arquivo binário']);
  });


  await t.test('terminal mostra a saída uma vez e preserva erros', async () => {
    const transcript = await devTools.evaluate(`(() => {
      const results = [
        { success: true, output: 'tensor([11., 22., 33.])', error: '', exitCode: 0 },
        { success: false, output: 'Traceback: exemplo', error: 'Sessão encerrada', exitCode: 1 }
      ];
      window.Android.runTerminalCommand = () => JSON.stringify(results.shift());
      const terminal = document.getElementById('terminalOutput');
      terminal.textContent = '';
      for (const command of ['python3 exemplo.py', 'python3 erro.py']) {
        document.getElementById('terminalInput').value = command;
        document.getElementById('terminalForm').dispatchEvent(new Event('submit', { cancelable: true }));
      }
      return { text: terminal.textContent,
        duplicateHidden: document.getElementById('outputPanel').classList.contains('hidden') };
    })()`);
    assert.equal(transcript.text.match(/tensor\(/g)?.length, 1);
    assert.equal(transcript.text.match(/python3 exemplo.py/g)?.length, 1);
    assert(transcript.text.includes('Traceback: exemplo\nSessão encerrada\n[exit 1]'));
    assert.equal(transcript.duplicateHidden, true);
  });

  await t.test('configurações personalizam o editor e persistem após recarregar', async () => {
    const configured = await devTools.evaluate(`(() => {
      document.getElementById('btnSettings').click();
      const dialog = document.getElementById('settingsDialog');
      const focused = dialog.contains(document.activeElement);
      const set = (id, value) => {
        const control = document.getElementById(id);
        if (control.type === 'checkbox') control.checked = value;
        else control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('settingTheme', 'light');
      set('settingFontSize', 18);
      set('settingLineHeight', 1.8);
      set('settingTerminalFontSize', 16);
      set('settingTabSize', 2);
      set('settingLineNumbers', false);
      set('settingShortcuts', false);
      set('settingAutocomplete', false);
      set('settingAutoPairs', false);
      CodeEditorAPI.addFile({ name: 'settings-test.js', content: '', open: true });
      const input = document.getElementById('codeInput');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
      const tabContent = input.value;
      const pairNotIntercepted = input.dispatchEvent(new KeyboardEvent('keydown', { key: '(', cancelable: true }));
      CodeEditorAPI.updateFile('settings-test.js', 'con');
      input.selectionStart = input.selectionEnd = 3;
      input.dispatchEvent(new Event('input'));
      const noSuggestions = document.getElementById('autocomplete').classList.contains('hidden');
      const styles = [input, document.getElementById('highlight'), document.getElementById('gutter')].map(el => {
        const css = getComputedStyle(el); return { font: css.fontSize, line: css.lineHeight };
      });
      return { open: dialog.open, focused, theme: document.documentElement.dataset.theme,
        styles, tabContent, pairNotIntercepted, noSuggestions,
        saved: JSON.parse(localStorage.getItem('mcode.interface.settings.v1')),
        numbersHidden: getComputedStyle(document.getElementById('gutter')).display === 'none',
        shortcutsHidden: getComputedStyle(document.getElementById('shortcutBar')).display === 'none' };
    })()`);
    assert.equal(configured.open, true);
    assert.equal(configured.focused, true);
    assert.equal(configured.theme, 'light');
    assert.deepEqual(configured.styles, Array(3).fill({ font: '18px', line: '32.4px' }));
    assert.equal(configured.tabContent, '  ');
    assert.equal(configured.pairNotIntercepted, true);
    assert.equal(configured.noSuggestions, true);
    assert.equal(configured.numbersHidden, true);
    assert.equal(configured.shortcutsHidden, true);
    assert.equal(configured.saved.tabSize, 2);

    for (const [width, height, name] of [[390, 844, 'mobile'], [1280, 900, 'desktop']]) {
      await devTools.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const layout = await devTools.evaluate(`(() => {
        const dialog = document.getElementById('settingsDialog');
        const rect = dialog.getBoundingClientRect();
        return { within: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          noOverflow: dialog.scrollWidth <= dialog.clientWidth };
      })()`);
      assert.equal(layout.within, true);
      assert.equal(layout.noOverflow, true);
      if (process.env.MCODE_SCREENSHOTS) {
        const shot = await devTools.command('Page.captureScreenshot', { format: 'png' });
        writeFileSync(resolve(process.env.MCODE_SCREENSHOTS, `settings-${name}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    await devTools.command('Page.reload');
    let reloaded;
    const deadline = Date.now() + 5000;
    while (!reloaded && Date.now() < deadline) {
      try { reloaded = await devTools.evaluate('window.CodeEditorAPI && document.documentElement.dataset.theme'); } catch {}
      if (!reloaded) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(reloaded, 'light');
    const restored = await devTools.evaluate(`(() => {
      window.openSettings();
      const font = document.getElementById('settingFontSize').value;
      const tab = document.getElementById('settingTabSize').value;
      document.getElementById('btnResetSettings').click();
      const defaults = JSON.parse(localStorage.getItem('mcode.interface.settings.v1'));
      document.getElementById('btnCloseSettings').click();
      return { font, tab, defaults, closed: !document.getElementById('settingsDialog').open };
    })()`);
    assert.equal(restored.font, '18');
    assert.equal(restored.tab, '2');
    assert.equal(restored.defaults.theme, 'dark');
    assert.equal(restored.defaults.fontSize, 13.5);
    assert.equal(restored.defaults.lineNumbers, true);
    assert.equal(restored.closed, true);
  });

});
