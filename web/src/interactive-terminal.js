import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// The native bridge drains bounded batches; wait for xterm before requesting more.
export function createInteractiveTerminal(panel, legacyOutput, title, getDirectory) {
  const container = document.createElement('div');
  container.style.cssText = 'height:220px;min-height:100px;padding:4px 10px;overflow:hidden';
  container.setAttribute('aria-label', 'Terminal interativo');
  legacyOutput.before(container);
  legacyOutput.hidden = true;
  const term = new Terminal({ scrollback: 1000, fontSize: 14, cursorBlink: true,
    theme: { background: '#111111' } });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  panel.querySelector('.output-header').style.flexWrap = 'wrap';
  let id = null;
  let timer = null;
  let sequence = 0;
  let directory = getDirectory();
  const status = message => term.write(`\r\n[terminal] ${message}\r\n`);
  function resize() {
    if (panel.classList.contains('hidden')) return;
    const size = Number.parseFloat(getComputedStyle(legacyOutput).fontSize);
    if (Number.isFinite(size)) term.options.fontSize = size;
    fit.fit();
    if (term.cols > 300 || term.rows > 200) term.resize(Math.min(term.cols, 300), Math.min(term.rows, 200));
  }
  function poll(sessionId) {
    if (id !== sessionId) return;
    let result;
    try { result = JSON.parse(window.Android.readInteractiveTerminal(sessionId)); }
    catch (error) { status(String(error)); id = null; title.textContent = 'TERMINAL — Desconectado'; return; }
    const next = () => {
      if (id !== sessionId) return;
      if (result.state === 'closed' && !result.more) {
        id = null;
        title.textContent = 'TERMINAL — Encerrado';
        status(result.error || `Sessão encerrada${result.exitCode == null ? '' : ` (exit ${result.exitCode})`}.`);
      } else {
        title.textContent = result.state === 'opening' ? 'TERMINAL — Conectando…' : 'TERMINAL — Interativo';
        timer = setTimeout(() => poll(sessionId), result.more ? 0 : 50);
      }
    };
    if (result.truncated) {
      // Reset parser state if an escape sequence was lost when the native buffer overflowed.
      term.reset();
      status('Saída truncada: o volume excedeu o limite de retenção.');
    }
    if (result.output) term.write(result.output, next); else next();
  }
  function open() {
    resize();
    if (id) return true;
    const nextId = `terminal-${Date.now()}-${++sequence}`;
    directory = getDirectory();
    if (!window.Android.openInteractiveTerminal(nextId, directory, term.rows, term.cols)) {
      status('Não foi possível abrir a sessão. Verifique a conexão com LunusDroid.');
      return false;
    }
    id = nextId;
    clearTimeout(timer);
    poll(id);
    return true;
  }
  function write(data) {
    if (!id) return false;
    // Keep paste/input batches below the bridge limit, preserving surrogate pairs.
    for (let start = 0; start < data.length;) {
      let end = Math.min(start + 4096, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
      if (!window.Android.writeInteractiveTerminal(id, data.slice(start, end))) {
        status('Entrada não enviada: sessão indisponível ou fila cheia.');
        return false;
      }
      start = end;
    }
    return true;
  }
  term.onData(write);
  term.onResize(({ rows, cols }) => {
    if (id && !window.Android.resizeInteractiveTerminal(id, rows, cols)) status('Não foi possível redimensionar a sessão.');
  });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  function button(label, action) {
    const element = document.createElement('button');
    element.className = 'icon-btn small';
    element.textContent = label;
    element.type = 'button';
    element.addEventListener('click', action);
    panel.querySelector('.output-header').appendChild(element);
  }
  button('Ctrl+C', () => write('\x03'));
  button('Encerrar sessão', () => {
    if (id && !window.Android.closeInteractiveTerminal(id)) status('Não foi possível encerrar a sessão.');
  });
  return { open, write, focus: () => term.focus(), directory: () => directory };
}
