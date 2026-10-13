import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// The native bridge drains bounded batches; wait for xterm before requesting more.
export function createInteractiveTerminal(panel, legacyOutput, title, getDirectory) {
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'terminal-resize-handle';
  resizeHandle.setAttribute('role', 'separator');
  resizeHandle.setAttribute('aria-label', 'Redimensionar altura do terminal');
  resizeHandle.setAttribute('aria-orientation', 'horizontal');
  resizeHandle.setAttribute('aria-valuemin', '160');
  resizeHandle.setAttribute('aria-valuemax', '620');
  resizeHandle.setAttribute('tabindex', '0');
  panel.prepend(resizeHandle);

  const container = document.createElement('div');
  container.className = 'interactive-terminal-screen';
  container.setAttribute('aria-label', 'Terminal interativo');
  legacyOutput.before(container);
  legacyOutput.hidden = true;
  const term = new Terminal({ scrollback: 1000, fontSize: 14, cursorBlink: true,
    theme: { background: '#15171a', foreground: '#d7dae0', cursor: '#58c4dc',
      selectionBackground: '#264f78' } });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  let resizeStart = null;
  let id = null;
  let timer = null;
  let sequence = 0;
  let directory = getDirectory();
  const status = message => term.write(`\r\n[terminal] ${message}\r\n`);
  function heightLimits() {
    return { min: 160, max: Math.max(160, Math.min(620, window.innerHeight * 0.65)) };
  }
  function setHeight(height) {
    const { min, max } = heightLimits();
    const next = Math.round(Math.max(min, Math.min(max, height)));
    panel.style.height = `${next}px`;
    resizeHandle.setAttribute('aria-valuenow', String(next));
    resizeHandle.setAttribute('aria-valuemax', String(Math.round(max)));
  }
  function resizeStartPointer(event) {
    if (event.button !== 0) return;
    resizeStart = { y: event.clientY, height: panel.getBoundingClientRect().height };
    resizeHandle.classList.add('active');
    if (event.isTrusted) resizeHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function resizePointer(event) {
    if (!resizeStart) return;
    setHeight(resizeStart.height + resizeStart.y - event.clientY);
  }
  function resizeEnd(event) {
    if (!resizeStart) return;
    resizeStart = null;
    resizeHandle.classList.remove('active');
    if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
  }
  resizeHandle.addEventListener('pointerdown', resizeStartPointer);
  resizeHandle.addEventListener('pointermove', resizePointer);
  resizeHandle.addEventListener('pointerup', resizeEnd);
  resizeHandle.addEventListener('pointercancel', resizeEnd);
  resizeHandle.addEventListener('keydown', event => {
    const { min, max } = heightLimits();
    const current = panel.getBoundingClientRect().height;
    if (event.key === 'ArrowUp') setHeight(current + 24);
    else if (event.key === 'ArrowDown') setHeight(current - 24);
    else if (event.key === 'Home') setHeight(min);
    else if (event.key === 'End') setHeight(max);
    else return;
    event.preventDefault();
  });
  setHeight(Math.min(340, Math.max(180, window.innerHeight * 0.32)));
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
    element.className = 'icon-btn small terminal-action';
    element.textContent = label;
    element.title = label;
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
