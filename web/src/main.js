import "./styles.css";
import { DEFAULT_SETTINGS, initSettings } from "./utils/settings.js";
let preferences = { ...DEFAULT_SETTINGS };
import { LANGUAGES } from "./data/languages.js";
import { tokenize } from "./utils/tokenizer.js";
import { getLanguageByExtension } from "./utils/utils.js";
import { buildRuntimeCommand, parseRunResult } from "./utils/runtime.js";
import {
  COMMON_SNIPPETS,
  getCompletionContext,
  getCompletions,
  lintCode,
  registerSnippets,
} from "./utils/editor-assistance.js";

if (import.meta.env.DEV) {
  import("eruda").then(({ default: eruda }) => {
    window.eruda = eruda;
    eruda.init();
  });
}

const state = {
  files: {
    //   'Main.java': { language: 'java', content: [
    //     'package com.example.app;',
    //     '',
    //     'import java.util.*;',
    //     '',
    //     '/**',
    //     ' * Classe de entrada - demonstra o destaque de sintaxe.',
    //     ' */',
    //     'public class Main {',
    //     '    private static final String GREETING = "Hello, World!";',
    //     '',
    //     '    public static void main(String[] args) {',
    //     '        List<String> names = new ArrayList<>();',
    //     '        names.add("Ana");',
    //     '        names.add("Bruno");',
    //     '',
    //     '        for (String name : names) {',
    //     '            System.out.println(GREETING + " " + name);',
    //     '        }',
    //     '',
    //     '        int total = Calculator.sum(10, 32);',
    //     '        System.out.println("Total: " + total);',
    //     '    }',
    //     '}',
    //     ''
    //   ].join('\n') },
    //   'Calculator.java': { language: 'java', content: [
    //     'package com.example.app;',
    //     '',
    //     '// Operacoes matematicas simples',
    //     'public class Calculator {',
    //     '',
    //     '    public static int sum(int a, int b) {',
    //     '        return a + b;',
    //     '    }',
    //     '',
    //     '    public static int multiply(int a, int b) {',
    //     '        return a * b;',
    //     '    }',
    //     '',
    //     '    public static double average(int[] values) {',
    //     '        int total = 0;',
    //     '        for (int v : values) {',
    //     '            total += v;',
    //     '        }',
    //     '        return (double) total / values.length;',
    //     '    }',
    //     '}',
    //     ''
    //   ].join('\n')
    // }
  },
  // order: ['Main.java', 'Calculator.java'],
  // openTabs: ['Main.java'],
  // activeFile: 'Main.java'
  order: [],
  openTabs: [],
  activeFile: null,
};
const topbarOptions = new Map();
const plugins = new Map();
const shortcuts = new Map();
const diagnosticsProviders = new Map();
const pluginStorageKey = "mcode.plugins.sources";
let pendingPluginSource = null;

const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const fileList = document.getElementById("fileList");
const tabbar = document.getElementById("tabbar");
const breadcrumb = document.getElementById("breadcrumb");
const gutter = document.getElementById("gutter");
const codeInput = document.getElementById("codeInput");
const highlightPre = document.getElementById("highlight");
const highlightCode = document.getElementById("highlightCode");
const cursorPos = document.getElementById("cursorPos");
const langPill = document.getElementById("langPill");
const langModal = document.getElementById("langModal");
const langList = document.getElementById("langList");
const pluginModal = document.getElementById("pluginModal");
const pluginList = document.getElementById("pluginList");
const outputPanel = document.getElementById("outputPanel");
const outputContent = document.getElementById("outputContent");
const autocomplete = document.getElementById("autocomplete");
const problemsPanel = document.getElementById("problemsPanel");
const problemsList = document.getElementById("problemsList");
const problemsStatus = document.getElementById("problemsStatus");
const previewPanel = document.getElementById("previewPanel");
const previewTitle = document.getElementById("previewTitle");
const htmlPreview = document.getElementById("htmlPreview");
const customTopActions = document.getElementById("customTopActions");
const terminalPanel = document.getElementById("terminalPanel");
const terminalOutput = document.getElementById("terminalOutput");
const terminalForm = document.getElementById("terminalForm");
const terminalInput = document.getElementById("terminalInput");
const shortcutBar = document.getElementById("shortcutBar");
const pluginZipInput = document.getElementById("pluginZipInput");
let terminalDirectory = "/sdcard";

function updateKeyboardInset() {
  const viewport = window.visualViewport;
  const keyboardHeight = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;
  document.documentElement.style.setProperty("--keyboard-height", `${keyboardHeight}px`);
}
updateKeyboardInset();
window.visualViewport?.addEventListener("resize", updateKeyboardInset);
window.visualViewport?.addEventListener("scroll", updateKeyboardInset);
window.addEventListener("resize", updateKeyboardInset);
let diagnostics = [];
let completionItems = [];
let selectedCompletion = 0;
let lintTimer = null;

function emitEditorEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(`code-editor:${name}`, { detail }));
}

function stringList(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} deve ser um array.`);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeLanguage(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("A configuração da linguagem deve ser um objeto.");
  }
  const id = String(config.id || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
    throw new TypeError(
      'A linguagem precisa de um id válido, como "javascript".',
    );
  }

  const extensions = stringList(
    config.extensions ?? (config.fileExt ? [config.fileExt] : []),
    "extensions",
  ).map((extension) =>
    extension.startsWith(".")
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`,
  );
  if (!extensions.length)
    throw new TypeError("Informe fileExt ou extensions para a linguagem.");

  let blockComment = null;
  if (config.blockComment != null) {
    if (
      !Array.isArray(config.blockComment) ||
      config.blockComment.length !== 2
    ) {
      throw new TypeError(
        "blockComment deve conter os delimitadores de abertura e fechamento.",
      );
    }
    blockComment = config.blockComment.map((item) => String(item));
  }

  const language = {
    id,
    label: String(config.label || id).trim(),
    badge: String(config.badge || id.slice(0, 2)).slice(0, 3),
    color: String(config.color || "#555"),
    fileExt: extensions[0],
    extensions,
    mimeType: String(config.mimeType || "application/octet-stream"),
    lineComment: config.lineComment == null ? null : String(config.lineComment),
    blockComment,
    keywords: stringList(config.keywords, "keywords"),
    literals: stringList(config.literals, "literals"),
    types: stringList(config.types, "types"),
  };
  if (config.lint != null) {
    if (typeof config.lint !== "function")
      throw new TypeError("lint deve ser uma função.");
    language.lint = config.lint;
  }
  return language;
}

function normalizeDiagnostics(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map((item) => ({
    line: Math.max(1, Number.parseInt(item?.line, 10) || 1),
    column: Math.max(1, Number.parseInt(item?.column, 10) || 1),
    severity: item?.severity === "warning" ? "warning" : "error",
    message: String(item?.message || "Problema encontrado."),
  }));
}

function fileIcon(langId) {
  const lang = LANGUAGES[langId] || { badge: "?", color: "#555" };
  const color = CSS.supports("color", lang.color) ? lang.color : "#555";
  return `<span class="file-icon" style="background:${escapeAttribute(color)}">${escapeHtml(lang.badge)}</span>`;
}

function renderSidebar() {
  if (state.order.length === 0) {
    fileList.innerHTML =
      '<li class="file-empty">Nenhum arquivo ainda. Toque em + para criar um.</li>';
    return;
  }

  fileList.innerHTML = state.order
    .map((name) => {
      const f = state.files[name];
      const active = name === state.activeFile ? "active" : "";
      return `<li class="file-item ${active}" data-file="${escapeAttribute(name)}">
      ${fileIcon(f.language)}
      <span class="file-name">${escapeHtml(name)}</span>
      <button class="file-delete" data-delete="${escapeAttribute(name)}">×</button>
    </li>`;
    })
    .join("");
}

function renderTabs() {
  tabbar.innerHTML = state.openTabs
    .map((name) => {
      const active = name === state.activeFile ? "active" : "";
      return `<div class="tab ${active}" data-file="${escapeAttribute(name)}">
      <span class="tab-name">${escapeHtml(name)}</span>
      <button class="tab-close" data-close="${escapeAttribute(name)}">×</button>
    </div>`;
    })
    .join("");
}

function renderEditor() {
  const name = state.activeFile;
  const file = name ? state.files[name] : null;
  breadcrumb.textContent = name ? name : "Nenhum arquivo aberto";

  if (!file) {
    codeInput.value = "";
    codeInput.disabled = true;
    highlightCode.innerHTML = "";
    gutter.textContent = "";
    langPill.textContent = "—";
    cursorPos.textContent = "Ln 0, Col 0";
    updateDiagnostics([]);
    closeAutocomplete();
    return;
  }

  codeInput.disabled = false;
  codeInput.value = file.content;
  const lang = LANGUAGES[file.language] || LANGUAGES.java;
  langPill.textContent = lang.label;
  refreshHighlight();
  updateCursor();
  runLint();
}

function refreshHighlight() {
  const name = state.activeFile;
  if (!name) return;

  const file = state.files[name];
  const lang = LANGUAGES[file.language] || LANGUAGES.java;
  highlightCode.innerHTML = tokenize(file.content, lang) + "\n";

  const lines = file.content.split("\n").length;
  const byLine = new Map();
  diagnostics.forEach((item) => {
    if (item.severity === "error" || !byLine.has(item.line))
      byLine.set(item.line, item.severity);
  });
  let nums = "";
  for (let i = 1; i <= lines; i += 1) {
    nums += `<span class="gutter-line ${byLine.get(i) || ""}">${i}</span>`;
  }
  gutter.innerHTML = nums;
  syncScroll();
}

function syncScroll() {
  highlightPre.scrollTop = codeInput.scrollTop;
  highlightPre.scrollLeft = codeInput.scrollLeft;
  gutter.scrollTop = codeInput.scrollTop;
}

function updateCursor() {
  const pos = codeInput.selectionStart || 0;
  const before = codeInput.value.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  cursorPos.textContent = `Ln ${line}, Col ${col}`;
}

function updateDiagnostics(items) {
  diagnostics = items;
  const errors = items.filter((item) => item.severity === "error").length;
  const warnings = items.length - errors;
  problemsStatus.textContent = items.length
    ? `× ${errors}  △ ${warnings}`
    : "✓ 0";
  problemsStatus.classList.toggle("has-errors", errors > 0);
  problemsList.innerHTML = items.length
    ? items
        .map(
          (
            item,
            index,
          ) => `<li class="problem-item ${item.severity}" data-problem="${index}">
        <span class="problem-icon">${item.severity === "error" ? "×" : "△"}</span>
        <span>${escapeHtml(item.message)}</span>
        <span class="problem-location">Ln ${item.line}, Col ${item.column}</span>
      </li>`,
        )
        .join("")
    : '<li class="problem-item"><span class="problem-icon">✓</span><span>Nenhum problema detectado.</span></li>';
  refreshHighlight();
}

function runLint() {
  if (!state.activeFile) return updateDiagnostics([]);
  const file = state.files[state.activeFile];
  const lang = LANGUAGES[file.language];
  let resultItems = [];
  if (typeof lang?.lint === "function") {
    try {
      resultItems = lang.lint(file.content, {
        fileName: state.activeFile,
        language: lang,
      });
    } catch (error) {
      resultItems = [
        {
          line: 1,
          column: 1,
          severity: "error",
          message: `Falha no lint: ${error.message}`,
        },
      ];
    }
  } else {
    resultItems = lintCode(file.content, file.language);
  }
  for (const provider of diagnosticsProviders.values()) {
    try {
      const extra = provider(file.content, {
        fileName: state.activeFile,
        language: lang,
        api: CodeEditorAPI,
      });
      if (Array.isArray(extra)) resultItems = [...resultItems, ...extra];
    } catch (error) {
      resultItems = [...resultItems, { line: 1, column: 1, severity: "error", message: `Falha no verificador: ${error.message}` }];
    }
  }
  updateDiagnostics(normalizeDiagnostics(resultItems));
}

function scheduleLint() {
  window.clearTimeout(lintTimer);
  lintTimer = window.setTimeout(runLint, 180);
}

function caretCoordinates() {
  const before = codeInput.value.slice(0, codeInput.selectionStart);
  const lines = before.split("\n");
  const lineHeight = parseFloat(getComputedStyle(codeInput).lineHeight) || 21;
  const charWidth = parseFloat(getComputedStyle(codeInput).fontSize) * 0.61;
  const left =
    6 + lines[lines.length - 1].length * charWidth - codeInput.scrollLeft;
  const caretTop = 8 + lines.length * lineHeight - codeInput.scrollTop;
  const menuHeight = 220;
  const top =
    caretTop + menuHeight > codeInput.clientHeight
      ? caretTop - menuHeight - lineHeight
      : caretTop;
  return {
    left: Math.max(8, Math.min(left, codeInput.clientWidth - 318)),
    top: Math.max(8, top),
  };
}

function closeAutocomplete() {
  completionItems = [];
  selectedCompletion = 0;
  autocomplete.classList.add("hidden");
  autocomplete.innerHTML = "";
}

function renderAutocomplete() {
  const kindIcons = {
    keyword: "K",
    literal: "L",
    type: "T",
    snippet: "S",
    function: "ƒ",
    method: "M",
    property: "P",
    text: "abc",
  };
  autocomplete.innerHTML = completionItems
    .map(
      (item, index) => `
    <button class="completion-item ${index === selectedCompletion ? "selected" : ""}" data-completion="${index}" role="option" aria-selected="${index === selectedCompletion}" aria-label="${escapeHtml(`${item.label}, ${item.detail}`)}">
      <span class="completion-kind ${item.kind}" title="${escapeHtml(item.detail)}">${kindIcons[item.kind] || "?"}</span>
      <span class="completion-label">${escapeHtml(item.label)}</span>
      <span class="completion-detail">${escapeHtml(item.detail)}</span>
    </button>`,
    )
    .join("");
  autocomplete.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function showAutocomplete(showAll = false) {
  if (!preferences.autocomplete && !showAll) return closeAutocomplete();
  if (!state.activeFile) return;
  const file = state.files[state.activeFile];
  const lang = LANGUAGES[file.language] || LANGUAGES.java;
  completionItems = getCompletions(
    codeInput.value,
    codeInput.selectionStart,
    lang,
    showAll,
  );
  selectedCompletion = 0;
  if (!completionItems.length) return closeAutocomplete();
  const position = caretCoordinates();
  autocomplete.style.left = `${position.left}px`;
  autocomplete.style.top = `${position.top}px`;
  autocomplete.classList.remove("hidden");
  renderAutocomplete();
}

function acceptCompletion(index = selectedCompletion) {
  const item = completionItems[index];
  if (!item) return;
  const context = getCompletionContext(
    codeInput.value,
    codeInput.selectionStart,
  );
  const end = codeInput.selectionStart;
  const indentation =
    codeInput.value
      .slice(0, context.start)
      .match(/(?:^|\n)([ \t]*)[^\n]*$/)?.[1] || "";
  const rawCaretOffset = item.insertText.length - (item.caretBack || 0);
  const inserted = item.insertText.replace(/\n/g, `\n${indentation}`);
  const caretOffset = item.insertText
    .slice(0, rawCaretOffset)
    .replace(/\n/g, `\n${indentation}`).length;
  codeInput.selectionStart = context.start;
  codeInput.selectionEnd = end;
  insertAtCursor(inserted, caretOffset);
  closeAutocomplete();
}

function renderLangList() {
  const current = state.activeFile
    ? state.files[state.activeFile].language
    : null;
  const items = Object.values(LANGUAGES).map((lang) => {
    const active = lang.id === current ? "active" : "";
    return `<li class="lang-item ${active}" data-lang="${escapeAttribute(lang.id)}">${fileIcon(lang.id)}<span>${escapeHtml(lang.label)}</span></li>`;
  });
  langList.innerHTML = items.join("");
}

function ensureFileLoaded(name) {
  const file = state.files[name];
  if (!file || file.loaded !== false) return file;
  if (typeof window.Android?.readProjectFile !== "function") {
    throw new Error("A leitura de arquivos Android não está disponível.");
  }
  const result = JSON.parse(window.Android.readProjectFile(file.projectRoot, name));
  if (!result.success) throw new Error(result.error || "Não foi possível ler o arquivo.");
  file.content = String(result.content ?? "");
  file.loaded = true;
  return file;
}

function openFile(name) {
  if (!state.files[name]) return;
  try {
    ensureFileLoaded(name);
  } catch (error) {
    window.Android?.showToast?.(String(error.message || error));
    return false;
  }
  if (!state.openTabs.includes(name)) state.openTabs.push(name);
  state.activeFile = name;
  renderSidebar();
  renderTabs();
  renderEditor();
  closeSidebar();
}

function closeTab(name) {
  const idx = state.openTabs.indexOf(name);
  if (idx === -1) return;

  state.openTabs.splice(idx, 1);

  if (state.activeFile === name) {
    state.activeFile = state.openTabs[idx] || state.openTabs[idx - 1] || null;
  }

  renderTabs();
  renderEditor();
}

function deleteFile(name) {
  if (!state.files[name]) return;
  if (!window.confirm(`Excluir "${name}"?`)) return;

  removeFileFromState(name);
}

function removeFileFromState(name) {
  if (!state.files[name]) return false;

  delete state.files[name];
  state.order = state.order.filter((n) => n !== name);

  if (state.openTabs.includes(name)) closeTab(name);
  renderSidebar();
  emitEditorEvent("file-removed", { name });
  return true;
}

function createFile() {
  const name = window.prompt("Nome do novo arquivo:", "NovoArquivo.java");
  if (!name) return;

  const trimmedName = name.trim();
  if (!trimmedName) return;
  if (state.files[trimmedName]) {
    window.alert("Já existe um arquivo com esse nome.");
    return;
  }

  const language = getLanguageByExtension(trimmedName, LANGUAGES);
  addFileToState({ name: trimmedName, language, content: "", open: true });
}

function addFileToState({
  name,
  content = "",
  language,
  open = true,
  overwrite = false,
  projectRoot = null,
  loaded = true,
}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName || /[\0\r\n]/.test(normalizedName)) {
    throw new TypeError("O arquivo precisa de um nome válido.");
  }
  if (state.files[normalizedName] && !overwrite) {
    throw new Error(`O arquivo "${normalizedName}" já existe.`);
  }

  const languageId =
    language || getLanguageByExtension(normalizedName, LANGUAGES);
  if (!LANGUAGES[languageId])
    throw new Error(`Linguagem "${languageId}" não registrada.`);

  const existed = Boolean(state.files[normalizedName]);
  state.files[normalizedName] = {
    language: languageId,
    content: String(content ?? ""),
    ...(projectRoot ? { projectRoot, loaded } : {}),
  };
  if (!existed) state.order.push(normalizedName);

  if (open) openFile(normalizedName);
  else {
    renderSidebar();
    if (state.activeFile === normalizedName) renderEditor();
  }
  emitEditorEvent(existed ? "file-updated" : "file-added", {
    file: { name: normalizedName, ...state.files[normalizedName] },
  });
  return { name: normalizedName, ...state.files[normalizedName] };
}

function updateFileInState(name, changes) {
  if (!state.files[name]) throw new Error(`Arquivo "${name}" não encontrado.`);
  const update = typeof changes === "string" ? { content: changes } : changes;
  if (!update || typeof update !== "object")
    throw new TypeError("As alterações do arquivo são inválidas.");

  if (update.language != null) {
    if (!LANGUAGES[update.language])
      throw new Error(`Linguagem "${update.language}" não registrada.`);
    state.files[name].language = update.language;
  }
  if (update.content != null) {
    state.files[name].content = String(update.content);
    state.files[name].loaded = true;
  }
  renderSidebar();
  if (state.activeFile === name) renderEditor();
  const file = { name, ...state.files[name] };
  emitEditorEvent("file-updated", { file });
  return file;
}

function downloadFile() {
  const name = state.activeFile;
  if (!name) return;

  const blob = new Blob([state.files[name].content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function runFile() {
  const name = state.activeFile;

  if (!name) {
    outputPanel.classList.remove("hidden");
    outputContent.textContent = "Nenhum arquivo aberto.";
    return;
  }

  const file = state.files[name];
  const lang = LANGUAGES[file.language] || LANGUAGES.java;
  if (lang.id === "html") {
    renderHtmlPreview({ file: name });
    return;
  }

  previewPanel.classList.add("hidden");
  outputPanel.classList.add("hidden");

  const command = buildRuntimeCommand(name, lang.id, terminalDirectory);
  if (!isTerminalAvailable()) {
    notifyTerminalRequired();
    return;
  }
  // Usa o mesmo caminho do terminal: preenche o input e confirma com Enter.
  openTerminal();
  terminalInput.value = command;
  terminalForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function openTerminal(directory = terminalDirectory) {
  terminalDirectory = String(directory || "/sdcard");
  terminalPanel.classList.remove("hidden");
  terminalInput.focus();
}

function saveActiveFile() {
  const name = state.activeFile;
  if (!name) return;
  const file = state.files[name];
  if (!window.Android || typeof window.Android.saveProjectFile !== "function") {
    window.Android?.showToast?.("Nenhum projeto Android aberto");
    return;
  }
  const language = LANGUAGES[file.language];
  const saved = window.Android.saveProjectFile(name, file.content, language?.mimeType || "application/octet-stream");
  window.Android.showToast?.(saved ? `Salvo: ${name}` : "Não foi possível salvar o arquivo");
}

function shellQuoteWeb(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function utf8Base64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function createFileInCurrentDirectory() {
  const name = window.prompt("Nome do novo arquivo:");
  if (!name?.trim() || /[\0\r\n]/.test(name) || name.trim().startsWith("/")) return;
  const content = window.prompt("Conteúdo inicial (opcional):", "") ?? "";
  const target = shellQuoteWeb(name.trim());
  const command = content
    ? `printf %s ${shellQuoteWeb(utf8Base64(content))} | base64 -d > ${target}`
    : `: > ${target}`;
  const result = runTerminalCommand(command, terminalDirectory);
  if (!result.success) {
    window.Android?.showToast?.(result.error || "Não foi possível criar o arquivo");
    return;
  }
  try {
    CodeEditorAPI.addFile({ name: name.trim(), content, open: true });
    window.Android?.showToast?.(`Criado: ${name.trim()}`);
  } catch (error) {
    window.Android?.showToast?.(`Arquivo criado, mas não foi adicionado ao editor: ${String(error)}`);
  }
}

function addPluginFromPrompt() {
  const source = window.prompt("Cole um script ou objeto de plugin JavaScript (ex.: CodeEditorAPI.addPlugin({...})):");
  if (!source?.trim()) return;
  try {
    installPluginSource(source);
    window.Android?.showToast?.("Plugin adicionado");
  } catch (error) {
    window.Android?.showToast?.(`Erro no plugin: ${String(error)}`);
  }
}

function openPluginList() {
  const entries = CodeEditorAPI.getPlugins();
  pluginList.innerHTML = entries.length
    ? entries.map(({ id, name }) => `<li class="lang-item active"><span class="file-icon" style="background:#6a9955">🧩</span><span>${escapeHtml(name)}</span><small class="text-muted">${escapeHtml(id)}</small></li>`).join("")
    : '<li class="file-empty">Nenhum plugin instalado.</li>';
  pluginModal.classList.remove("hidden");
}

function installPluginSource(source, { persist = true } = {}) {
  pendingPluginSource = source;
  try {
    let result;
    try { result = Function("CodeEditorAPI", `return (${source});`)(CodeEditorAPI); }
    catch { result = Function("CodeEditorAPI", source)(CodeEditorAPI); }
    if (result && typeof result === "object" && result.id && typeof result.activate === "function") CodeEditorAPI.addPlugin(result);
    if (persist) {
      const saved = JSON.parse(localStorage.getItem(pluginStorageKey) || "[]");
      if (!saved.includes(source)) localStorage.setItem(pluginStorageKey, JSON.stringify([...saved, source]));
      const pluginId = source.match(/\bid\s*:\s*["']([^"']+)["']/)?.[1];
      if (pluginId && window.Android && typeof window.Android.savePluginFile === "function") {
        window.Android.savePluginFile(`${pluginId}.js`, source);
      }
    }
  } finally {
    pendingPluginSource = null;
  }
}

function restoreStoredPlugins() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(pluginStorageKey) || "[]"); }
  catch { saved = []; }
  if (!Array.isArray(saved)) return;
  saved.forEach((source) => {
    if (typeof source !== "string") return;
    try { installPluginSource(source, { persist: false }); }
    catch (error) { emitEditorEvent("plugin-error", { error: `Falha ao restaurar plugin: ${String(error)}` }); }
  });
}

async function importPluginZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const files = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameSize));
    const start = offset + 30 + nameSize + extraSize;
    const compressed = bytes.slice(start, start + compressedSize);
    let data = compressed;
    if (method === 8) {
      if (typeof DecompressionStream !== "function") throw new Error("Este WebView não suporta ZIP compactado.");
      data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    } else if (method !== 0) throw new Error(`Método ZIP não suportado: ${method}`);
    files.push({ name, data });
    offset = start + compressedSize;
  }
  const scripts = files.filter(({ name }) => name.toLowerCase().endsWith(".js"));
  if (!scripts.length) throw new Error("O ZIP não contém arquivos .js de plugin.");
  for (const entry of scripts) installPluginSource(decoder.decode(entry.data));
  window.Android?.showToast?.(`${scripts.length} plugin(s) adicionado(s)`);
}

function choosePluginZip() { pluginZipInput.click(); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function exportPluginsZip() {
  const encoder = new TextEncoder();
  const registered = [...plugins.values()];
  let persistedSources = [];
  try { persistedSources = JSON.parse(localStorage.getItem(pluginStorageKey) || "[]"); }
  catch { persistedSources = []; }
  const knownSources = new Set(registered.map((plugin) => plugin.source).filter(Boolean));
  const persistedOnly = persistedSources.filter((source) => typeof source === "string" && !knownSources.has(source)).map((source) => {
    const id = source.match(/\bid\s*:\s*["']([^"']+)["']/)?.[1] || `plugin-${Math.random().toString(36).slice(2, 8)}`;
    const name = source.match(/\bname\s*:\s*["']([^"']+)["']/)?.[1] || id;
    return { id, name, startupCommands: [], commands: new Map(), source };
  });
  const allPlugins = [...registered, ...persistedOnly];
  const functionSource = (fn) => {
    const source = fn.toString();
    if (/^(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(source)) {
      const asyncPrefix = source.startsWith("async ") ? "async " : "";
      return `${asyncPrefix}function${source.slice(source.indexOf("("))}`;
    }
    return source;
  };
  const sourceFor = (plugin) => plugin.source || `CodeEditorAPI.addPlugin({\n  id: ${JSON.stringify(plugin.id)},\n  name: ${JSON.stringify(plugin.name)},\n  startupCommands: ${JSON.stringify(plugin.startupCommands)},\n  activate: ${functionSource(plugin.activate)},\n  ${typeof plugin.deactivate === "function" ? `deactivate: ${functionSource(plugin.deactivate)},` : ""}\n  commands: {${[...plugin.commands.entries()].map(([id, handler]) => `${JSON.stringify(id)}: ${functionSource(handler)}`).join(",")}}\n});`;
  const files = [
    { name: "plugins.json", content: JSON.stringify(allPlugins.map(({ id, name, startupCommands, commands }) => ({ id, name, startupCommands, commands: [...commands.keys()] })), null, 2) },
    ...allPlugins.map((plugin) => ({
      name: `plugins/${plugin.id}.js`,
      content: sourceFor(plugin),
    })),
  ];
  const local = [];
  const central = [];
  let offset = 0;
  const u16 = (value) => [value & 255, (value >>> 8) & 255];
  const u32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0, ...name]);
    local.push(header, data);
    const entry = new Uint8Array([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset), ...name]);
    central.push(entry);
    offset += header.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), 0, 0]);
  const blob = new Blob([...local, ...central, end], { type: "application/zip" });
  if (window.Android && typeof window.Android.savePluginZip === "function") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    window.Android.savePluginZip(btoa(binary), "plugins.zip");
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "plugins.zip";
  link.click();
  URL.revokeObjectURL(url);
}

function runTerminalCommand(command, directory = terminalDirectory) {
  if (!window.Android || typeof window.Android.runTerminalCommand !== "function") {
    notifyTerminalRequired();
    return { success: false, exitCode: -1, output: "", error: "Terminal Debian indisponível no Android." };
  }
  const targetDirectory = String(directory || terminalDirectory || "/sdcard");
  openTerminal(targetDirectory);
  return parseRunResult(window.Android.runTerminalCommand(command, targetDirectory));
}

function isTerminalAvailable() {
  return Boolean(window.Android && typeof window.Android.isTerminalAvailable === "function" && window.Android.isTerminalAvailable());
}

function notifyTerminalRequired() {
  const message = "Terminal Debian não instalado ou desconectado. Instale e abra o LunusDroid para executar código.";
  outputPanel.classList.remove("hidden");
  outputContent.textContent = message;
  terminalPanel.classList.remove("hidden");
  terminalOutput.textContent += `${terminalOutput.textContent ? "\n" : ""}[terminal] ${message}\n`;
  window.Android?.showToast?.(message);
}

window.openTerminal = openTerminal;
window.saveActiveFile = saveActiveFile;
window.createFileInCurrentDirectory = createFileInCurrentDirectory;
window.addPluginFromPrompt = addPluginFromPrompt;
window.choosePluginZip = choosePluginZip;
window.openPluginList = openPluginList;
window.exportPluginsZip = exportPluginsZip;
window.addEventListener("android:project-loading", () => {
  state.files = {};
  state.order = [];
  state.openTabs = [];
  state.activeFile = null;
  renderSidebar();
  renderTabs();
  renderEditor();
});
window.addEventListener("android:project-opened", (event) => {
  const directory = event.detail?.terminalDirectory;
  if (directory) terminalDirectory = directory;
  if (!Array.isArray(event.detail?.files)) return;
  // Replace the previous project so files with the same name cannot be mixed.
  state.files = {};
  state.order = [];
  state.openTabs = [];
  state.activeFile = null;
  for (const file of event.detail.files) {
    const name = String(file.name);
    state.files[name] = {
      language: getLanguageByExtension(name, LANGUAGES),
      content: "",
      loaded: false,
      projectRoot: file.projectRoot || event.detail.rootUri,
    };
    state.order.push(name);
  }
  renderSidebar();
  renderTabs();
  renderEditor();
});

function renderHtmlPreview(source, options = {}) {
  let html;
  let title = options.title || "HTML";

  if (source == null) {
    if (!state.activeFile)
      throw new Error("Nenhum arquivo aberto para renderizar.");
    html = ensureFileLoaded(state.activeFile).content;
    title = state.activeFile;
  } else if (typeof source === "object") {
    if (source.file != null) {
      const name = String(source.file);
      if (!state.files[name])
        throw new Error(`Arquivo "${name}" não encontrado.`);
      html = ensureFileLoaded(name).content;
      title = source.title || name;
    } else if (source.html != null) {
      html = String(source.html);
      title = source.title || title;
    } else {
      throw new TypeError("Use { file } ou { html } para renderizar.");
    }
  } else if (state.files[String(source)]) {
    const name = String(source);
    html = ensureFileLoaded(name).content;
    title = name;
  } else {
    html = String(source);
  }

  outputPanel.classList.add("hidden");
  previewTitle.textContent = title;
  htmlPreview.srcdoc = html;
  previewPanel.classList.remove("hidden");
  emitEditorEvent("html-rendered", { title, html });
  return { title, html };
}

function closeHtmlPreview() {
  previewPanel.classList.add("hidden");
  htmlPreview.removeAttribute("srcdoc");
  htmlPreview.src = "about:blank";
  emitEditorEvent("preview-closed");
}

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("show");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}

function toggleSidebar() {
  if (sidebar.classList.contains("open")) closeSidebar();
  else openSidebar();
}

function openLangModal() {
  if (!state.activeFile) return;
  renderLangList();
  langModal.classList.remove("hidden");
}

function closeLangModal() {
  langModal.classList.add("hidden");
}

function insertAtCursor(text, caretOffset) {
  const start = codeInput.selectionStart;
  const end = codeInput.selectionEnd;
  const value = codeInput.value;
  codeInput.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const newPos = start + (caretOffset ?? text.length);
  codeInput.selectionStart = codeInput.selectionEnd = newPos;
  codeInput.dispatchEvent(new Event("input"));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normalizeTopbarId(value, field = "id") {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
    throw new TypeError(
      `${field} deve começar com uma letra e usar apenas letras, números, "-" ou "_".`,
    );
  }
  return id;
}

function normalizeTopbarHandler(value, field) {
  if (value != null && typeof value !== "function") {
    throw new TypeError(`${field} deve ser uma função.`);
  }
  return value || null;
}

function normalizeTopbarOption(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("A opção da barra superior deve ser um objeto.");
  }

  const id = normalizeTopbarId(config.id);
  const type = config.type || "button";
  if (type !== "button" && type !== "menu") {
    throw new TypeError('type deve ser "button" ou "menu".');
  }

  const label = String(config.label || "").trim();
  if (!label)
    throw new TypeError("A opção da barra superior precisa de label.");

  const option = {
    id,
    type,
    label,
    title: String(config.title || label),
    icon: config.icon == null ? "" : String(config.icon),
    showLabel: config.showLabel === true,
    disabled: config.disabled === true,
    onClick: normalizeTopbarHandler(config.onClick, "onClick"),
  };

  if (type === "menu") {
    if (!Array.isArray(config.items) || config.items.length === 0) {
      throw new TypeError("Uma opção do tipo menu precisa de items.");
    }
    const itemIds = new Set();
    option.items = config.items.map((item, index) => {
      if (!item || typeof item !== "object")
        throw new TypeError(`Item ${index + 1} do menu inválido.`);
      const itemId = normalizeTopbarId(item.id, `items[${index}].id`);
      if (itemIds.has(itemId))
        throw new Error(`O item "${itemId}" está duplicado no menu "${id}".`);
      itemIds.add(itemId);
      const itemLabel = String(item.label || "").trim();
      if (!itemLabel)
        throw new TypeError(`O item "${itemId}" precisa de label.`);
      return {
        id: itemId,
        label: itemLabel,
        title: String(item.title || itemLabel),
        icon: item.icon == null ? "" : String(item.icon),
        disabled: item.disabled === true,
        onClick: normalizeTopbarHandler(
          item.onClick,
          `items[${index}].onClick`,
        ),
      };
    });
  }
  return option;
}

function cloneTopbarOption(option) {
  return {
    ...option,
    ...(option.items
      ? { items: option.items.map((item) => ({ ...item })) }
      : {}),
  };
}

function createTopbarButton(option, attributes = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-btn topbar-option-button${option.icon && !option.showLabel ? " icon-only" : ""}`;
  button.title = option.title;
  button.setAttribute("aria-label", option.label);
  button.disabled = option.disabled;
  Object.entries(attributes).forEach(([name, value]) =>
    button.setAttribute(name, value),
  );

  if (option.icon) {
    const icon = document.createElement("span");
    icon.className = "topbar-option-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = option.icon;
    button.append(icon);
  }
  if (!option.icon || option.showLabel) {
    const label = document.createElement("span");
    label.className = "topbar-option-label";
    label.textContent = option.label;
    button.append(label);
  }
  return button;
}

function closeTopbarMenus(exceptId = null) {
  customTopActions
    .querySelectorAll("[data-topbar-menu-popup]")
    .forEach((popup) => {
      if (popup.getAttribute("data-topbar-menu-popup") === exceptId) return;
      popup.classList.add("hidden");
      popup.parentElement
        .querySelector("[data-topbar-menu]")
        ?.setAttribute("aria-expanded", "false");
    });
}

function renderTopbarOptions() {
  customTopActions.replaceChildren();
  topbarOptions.forEach((option) => {
    if (option.type === "button") {
      customTopActions.append(
        createTopbarButton(option, { "data-topbar-option": option.id }),
      );
      return;
    }

    const menu = document.createElement("div");
    menu.className = "topbar-menu";
    const toggle = createTopbarButton(option, {
      "data-topbar-menu": option.id,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    });
    const popup = document.createElement("div");
    popup.className = "topbar-menu-popup hidden";
    popup.setAttribute("data-topbar-menu-popup", option.id);
    popup.setAttribute("role", "menu");

    option.items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "topbar-menu-item";
      button.setAttribute("data-topbar-menu-item", item.id);
      button.setAttribute("data-topbar-menu-parent", option.id);
      button.setAttribute("role", "menuitem");
      button.title = item.title;
      button.disabled = item.disabled;
      if (item.icon) {
        const icon = document.createElement("span");
        icon.className = "topbar-option-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = item.icon;
        button.append(icon);
      }
      const label = document.createElement("span");
      label.textContent = item.label;
      button.append(label);
      popup.append(button);
    });
    menu.append(toggle, popup);
    customTopActions.append(menu);
  });
}

function topbarActionDetail(option, item = null) {
  return {
    id: option.id,
    type: option.type,
    itemId: item?.id || null,
    label: item?.label || option.label,
    activeFile: state.activeFile
      ? { name: state.activeFile, ...state.files[state.activeFile] }
      : null,
  };
}

function invokeTopbarAction(option, item, originalEvent) {
  const detail = topbarActionDetail(option, item);
  emitEditorEvent("topbar-action", detail);
  const handler = item?.onClick || option.onClick;
  return handler?.({ ...detail, originalEvent, api: CodeEditorAPI });
}

function addTopbarOption(config, { replace = false } = {}) {
  const option = normalizeTopbarOption(config);
  if (topbarOptions.has(option.id) && !replace) {
    throw new Error(`A opção "${option.id}" já existe na barra superior.`);
  }
  topbarOptions.set(option.id, option);
  renderTopbarOptions();
  const result = cloneTopbarOption(option);
  emitEditorEvent("topbar-option-added", { option: result });
  return result;
}

function removeTopbarOption(id) {
  const normalizedId = String(id || "").trim();
  if (!topbarOptions.delete(normalizedId)) return false;
  renderTopbarOptions();
  emitEditorEvent("topbar-option-removed", { id: normalizedId });
  return true;
}

function addLanguageToRegistry(config, { replace = false } = {}) {
  const language = normalizeLanguage(config);
  if (LANGUAGES[language.id] && !replace) {
    throw new Error(`A linguagem "${language.id}" já está registrada.`);
  }
  LANGUAGES[language.id] = language;
  renderLangList();
  if (
    state.activeFile &&
    state.files[state.activeFile].language === language.id
  )
    renderEditor();
  const result = cloneLanguage(language);
  emitEditorEvent("language-added", { language: result });
  if (config.snippets)
    addSnippetsToRegistry(language.id, config.snippets, { replace });
  return result;
}

function addShortcut(config, { replace = false } = {}) {
  if (typeof config === "string") config = { id: config, label: config, text: config };
  if (!config || typeof config !== "object") throw new TypeError("Atalho inválido.");
  const id = String(config.id || "").trim();
  const text = String(config.text ?? config.insertText ?? "");
  if (!id || !text) throw new TypeError("Atalho precisa de id e text.");
  if (shortcuts.has(id) && !replace) throw new Error(`O atalho "${id}" já existe.`);
  shortcuts.set(id, { id, label: String(config.label || text), text });
  renderShortcuts();
  return { ...shortcuts.get(id) };
}

function removeShortcut(id) { return shortcuts.delete(String(id)) && (renderShortcuts(), true); }
function renderShortcuts() {
  shortcutBar.replaceChildren();
  shortcuts.forEach((shortcut) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "shortcut-item"; button.textContent = shortcut.label; button.title = shortcut.text;
    button.addEventListener("click", () => {
      const target = document.activeElement === terminalInput ? terminalInput : codeInput;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      target.setRangeText(shortcut.id === "tab" ? " ".repeat(preferences.tabSize) : shortcut.text, start, end, "end");
      target.dispatchEvent(new Event("input", { bubbles: true })); target.focus();
    });
    shortcutBar.append(button);
  });
}

function updateLanguageInRegistry(id, changes) {
  const languageId = String(id || "").trim().toLowerCase();
  const current = LANGUAGES[languageId];
  if (!current) throw new Error(`Linguagem "${languageId}" não registrada.`);
  if (!changes || typeof changes !== "object") throw new TypeError("As alterações da linguagem devem ser um objeto.");
  return addLanguageToRegistry({ ...current, ...changes, id: languageId }, { replace: true });
}

function registerDiagnosticsProvider(providerId, provider) {
  if (typeof provider !== "function") throw new TypeError("O verificador deve ser uma função.");
  const id = String(providerId || `provider-${diagnosticsProviders.size + 1}`);
  diagnosticsProviders.set(id, provider);
  scheduleLint();
  return () => { diagnosticsProviders.delete(id); scheduleLint(); };
}

function normalizePlugin(config) {
  if (!config || typeof config !== "object") throw new TypeError("O plugin deve ser um objeto.");
  const id = String(config.id || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new TypeError("O plugin precisa de um id válido.");
  if (typeof config.activate !== "function") throw new TypeError(`O plugin "${id}" precisa de activate(context).`);
  return { id, name: String(config.name || id).trim(), activate: config.activate, deactivate: config.deactivate, startupCommands: Array.isArray(config.startupCommands) ? config.startupCommands.map(String) : [], commands: config.commands && typeof config.commands === "object" ? config.commands : {} };
}

function addPlugin(config, { replace = false } = {}) {
  const plugin = normalizePlugin(config);
  if (plugins.has(plugin.id) && !replace) throw new Error(`O plugin "${plugin.id}" já está registrado.`);
  if (plugins.has(plugin.id)) removePlugin(plugin.id);
  const commands = new Map(Object.entries(plugin.commands).filter(([, handler]) => typeof handler === "function"));
  const context = {
    id: plugin.id,
    name: plugin.name,
    api: CodeEditorAPI,
    addLanguage: addLanguageToRegistry,
    updateLanguage: updateLanguageInRegistry,
    addShortcut,
    addSnippets: addSnippetsToRegistry,
    addTopbarOption,
  runTerminalCommand: (command, directory) => runTerminalCommand(String(command), directory),
    isTerminalAvailable,
    registerCommand: (id, handler) => {
      if (!id || typeof handler !== "function") throw new TypeError("Comando de plugin inválido.");
      commands.set(String(id), handler);
    },
    registerDiagnostics: (provider) => registerDiagnosticsProvider(`${plugin.id}:${diagnosticsProviders.size}`, provider),
  };
  const record = { ...plugin, commands, context, cleanup: null, source: pendingPluginSource };
  plugins.set(plugin.id, record);
  emitEditorEvent("plugin-added", { id: plugin.id, name: plugin.name });
  try {
    record.cleanup = plugin.activate(context) || null;
    for (const command of plugin.startupCommands) context.runTerminalCommand(command);
    emitEditorEvent("plugin-activated", { id: plugin.id, name: plugin.name });
  } catch (error) {
    plugins.delete(plugin.id);
    emitEditorEvent("plugin-error", { id: plugin.id, error: String(error) });
    throw error;
  }
  return { id: plugin.id, name: plugin.name };
}

function removePlugin(id) {
  const record = plugins.get(String(id || "").trim().toLowerCase());
  if (!record) return false;
  if (typeof record.cleanup === "function") record.cleanup();
  if (typeof record.deactivate === "function") record.deactivate(record.context);
  plugins.delete(record.id);
  emitEditorEvent("plugin-removed", { id: record.id });
  return true;
}

function executePluginCommand(pluginId, commandId, ...args) {
  const record = plugins.get(String(pluginId || "").trim().toLowerCase());
  const handler = record?.commands.get(String(commandId));
  if (!handler) throw new Error(`Comando "${commandId}" não encontrado no plugin "${pluginId}".`);
  return handler(...args, record.context);
}

function addSnippetsToRegistry(languageId, snippets, options) {
  if (!LANGUAGES[languageId])
    throw new Error(`Linguagem "${languageId}" não registrada.`);
  const registered = registerSnippets(languageId, snippets, options);
  emitEditorEvent("snippets-added", {
    languageId,
    snippets: registered.map((snippet) => ({ ...snippet })),
  });
  return registered.map((snippet) => ({ ...snippet }));
}

function addFileFromApi(file, content = "", options = {}) {
  if (file && typeof file === "object") return addFileToState(file);
  if (content && typeof content === "object") {
    return addFileToState({ name: file, ...content });
  }
  return addFileToState({ name: file, content, ...options });
}

function addFilesFromApi(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("files deve ser um array não vazio.");
  }
  return files.map((file, index) => {
    const config = typeof file === "string" ? { name: file } : { ...file };
    if (!config || typeof config !== "object")
      throw new TypeError(`Arquivo ${index + 1} inválido.`);
    return addFileToState({
      ...config,
      overwrite: config.overwrite ?? options.overwrite ?? false,
      open:
        config.open ??
        (options.openLast === true && index === files.length - 1),
    });
  });
}

function cloneLanguage(language) {
  return {
    ...language,
    extensions: [...(language.extensions || [language.fileExt])],
    keywords: [...(language.keywords || [])],
    literals: [...(language.literals || [])],
    types: [...(language.types || [])],
    blockComment: language.blockComment ? [...language.blockComment] : null,
    mimeType: language.mimeType || "application/octet-stream",
  };
}

[
  { id: "tab", label: "Tab", text: "    " },
  { id: "braces", label: "{}", text: "{}" },
  { id: "quotes", label: "\"\"", text: "\"\"" },
  { id: "parentheses", label: "()", text: "()" },
  { id: "arrow", label: "=>", text: " => " },
].forEach((shortcut) => addShortcut(shortcut));

export const CodeEditorAPI = Object.freeze({
  version: "1.1.0",
  addLanguage: addLanguageToRegistry,
  updateLanguage: updateLanguageInRegistry,
  addSnippets: addSnippetsToRegistry,
  getLanguages: () => Object.values(LANGUAGES).map(cloneLanguage),
  getSnippets: (languageId) =>
    (COMMON_SNIPPETS[languageId] || []).map((snippet) => ({ ...snippet })),
  addFile: addFileFromApi,
  addFiles: addFilesFromApi,
  updateFile: updateFileInState,
  removeFile: removeFileFromState,
  openFile: (name) => {
    if (!state.files[name])
      throw new Error(`Arquivo "${name}" não encontrado.`);
    if (openFile(name) === false) return null;
    emitEditorEvent("file-opened", { file: { name, ...state.files[name] } });
    return { name, ...state.files[name] };
  },
  getFile: (name) =>
    state.files[name] ? { name, ...ensureFileLoaded(name) } : null,
  getFiles: () => state.order.map((name) => ({ name, ...state.files[name] })),
  getActiveFile: () =>
    state.activeFile
      ? { name: state.activeFile, ...state.files[state.activeFile] }
      : null,
  addTopbarOption,
  removeTopbarOption,
  getTopbarOptions: () => [...topbarOptions.values()].map(cloneTopbarOption),
  renderHtml: renderHtmlPreview,
  closePreview: closeHtmlPreview,
  addShortcut,
  removeShortcut,
  getShortcuts: () => [...shortcuts.values()].map((shortcut) => ({ ...shortcut })),
  registerDiagnostics: registerDiagnosticsProvider,
  addPlugin,
  removePlugin,
  getPlugins: () => [...plugins.values()].map(({ id, name }) => ({ id, name })),
  executePluginCommand,
  isTerminalAvailable,
});

window.CodeEditorAPI = CodeEditorAPI;
restoreStoredPlugins();

customTopActions.addEventListener("click", (event) => {
  const menuItem = event.target.closest("[data-topbar-menu-item]");
  if (menuItem) {
    const option = topbarOptions.get(
      menuItem.getAttribute("data-topbar-menu-parent"),
    );
    const item = option?.items.find(
      ({ id }) => id === menuItem.getAttribute("data-topbar-menu-item"),
    );
    closeTopbarMenus();
    if (option && item) invokeTopbarAction(option, item, event);
    return;
  }

  const menuToggle = event.target.closest("[data-topbar-menu]");
  if (menuToggle) {
    const id = menuToggle.getAttribute("data-topbar-menu");
    const popup = customTopActions.querySelector(
      `[data-topbar-menu-popup="${id}"]`,
    );
    const willOpen = popup?.classList.contains("hidden");
    closeTopbarMenus(willOpen ? id : null);
    popup?.classList.toggle("hidden", !willOpen);
    menuToggle.setAttribute("aria-expanded", String(Boolean(willOpen)));
    return;
  }

  const button = event.target.closest("[data-topbar-option]");
  const option =
    button && topbarOptions.get(button.getAttribute("data-topbar-option"));
  if (option) invokeTopbarAction(option, null, event);
});

document.addEventListener("pointerdown", (event) => {
  if (!customTopActions.contains(event.target)) closeTopbarMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTopbarMenus();
});

document
  .getElementById("btnToggleSidebar")
  .addEventListener("click", toggleSidebar);
overlay.addEventListener("click", closeSidebar);
document.getElementById("btnNewFile").addEventListener("click", createFile);
document.getElementById("btnDownload").addEventListener("click", downloadFile);
document.getElementById("btnSave").addEventListener("click", saveActiveFile);
document.getElementById("btnRun").addEventListener("click", runFile);
pluginZipInput.addEventListener("change", async () => {
  const files = [...(pluginZipInput.files || [])];
  pluginZipInput.value = "";
  if (!files.length) return;
  try { for (const file of files) await importPluginZip(file); }
  catch (error) { window.Android?.showToast?.(`Erro ao importar plugin: ${String(error)}`); }
});
document.getElementById("btnClosePluginModal").addEventListener("click", () => pluginModal.classList.add("hidden"));
pluginModal.addEventListener("click", (event) => { if (event.target === pluginModal) pluginModal.classList.add("hidden"); });
document.getElementById("btnCloseTerminal").addEventListener("click", () => terminalPanel.classList.add("hidden"));
terminalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = terminalInput.value.trim();
  if (!command) return;
  terminalOutput.textContent += `${terminalOutput.textContent ? "\n" : ""}${terminalDirectory} $ ${command}\n`;
  terminalInput.value = "";
  try {
    const result = runTerminalCommand(command);
    if (result.output) terminalOutput.textContent += `${result.output}\n`;
    if (result.error) terminalOutput.textContent += `${result.error}\n`;
    if (!result.success) terminalOutput.textContent += `[exit ${result.exitCode}]\n`;
    // The terminal already contains the transcript; do not repeat it in Output.
    outputPanel.classList.add("hidden");
  } catch (error) {
    terminalOutput.textContent += `Erro: ${String(error)}\n`;
  }
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  terminalInput.focus();
});
document
  .getElementById("btnCloseOutput")
  .addEventListener("click", () => outputPanel.classList.add("hidden"));
document
  .getElementById("btnClosePreview")
  .addEventListener("click", closeHtmlPreview);
langPill.addEventListener("click", openLangModal);
document
  .getElementById("btnCloseLangModal")
  .addEventListener("click", closeLangModal);
langModal.addEventListener("click", (e) => {
  if (e.target === langModal) closeLangModal();
});

fileList.addEventListener("click", (e) => {
  const delButton = e.target.closest("[data-delete]");
  if (delButton) {
    e.stopPropagation();
    deleteFile(delButton.getAttribute("data-delete"));
    return;
  }

  const item = e.target.closest("[data-file]");
  if (item) openFile(item.getAttribute("data-file"));
});

tabbar.addEventListener("click", (e) => {
  const closeButton = e.target.closest("[data-close]");
  if (closeButton) {
    e.stopPropagation();
    closeTab(closeButton.getAttribute("data-close"));
    return;
  }

  const tab = e.target.closest("[data-file]");
  if (tab) {
    state.activeFile = tab.getAttribute("data-file");
    renderTabs();
    renderEditor();
  }
});

langList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-lang]");
  if (!item || !state.activeFile) return;

  state.files[state.activeFile].language = item.getAttribute("data-lang");
  closeLangModal();
  renderEditor();
});

problemsStatus.addEventListener("click", () =>
  problemsPanel.classList.toggle("hidden"),
);
document
  .getElementById("btnCloseProblems")
  .addEventListener("click", () => problemsPanel.classList.add("hidden"));
problemsList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-problem]");
  if (!item) return;
  const problem = diagnostics[Number(item.getAttribute("data-problem"))];
  if (!problem) return;
  const lines = codeInput.value.split("\n");
  const offset = lines
    .slice(0, problem.line - 1)
    .reduce((total, line) => total + line.length + 1, 0);
  const position = offset + problem.column - 1;
  codeInput.focus();
  codeInput.selectionStart = codeInput.selectionEnd = position;
  codeInput.scrollTop = Math.max(0, (problem.line - 3) * 21);
  updateCursor();
  syncScroll();
});

autocomplete.addEventListener("pointerdown", (e) => {
  const item = e.target.closest("[data-completion]");
  if (!item) return;
  e.preventDefault();
  acceptCompletion(Number(item.getAttribute("data-completion")));
});

codeInput.addEventListener("input", () => {
  if (!state.activeFile) return;
  state.files[state.activeFile].content = codeInput.value;
  refreshHighlight();
  updateCursor();
  scheduleLint();
  showAutocomplete();
});
codeInput.addEventListener("scroll", () => {
  syncScroll();
  closeAutocomplete();
});
codeInput.addEventListener("click", () => {
  updateCursor();
  closeAutocomplete();
});
codeInput.addEventListener("keyup", updateCursor);
codeInput.addEventListener("blur", () =>
  window.setTimeout(closeAutocomplete, 120),
);

codeInput.addEventListener("keydown", (e) => {
  const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };

  if (!autocomplete.classList.contains("hidden")) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const direction = e.key === "ArrowDown" ? 1 : -1;
      selectedCompletion =
        (selectedCompletion + direction + completionItems.length) %
        completionItems.length;
      renderAutocomplete();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      acceptCompletion();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeAutocomplete();
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === " ") {
    e.preventDefault();
    showAutocomplete(true);
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault();
    insertAtCursor(" ".repeat(preferences.tabSize));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const pos = codeInput.selectionStart;
    const before = codeInput.value.slice(0, pos);
    const lineStart = before.lastIndexOf("\n") + 1;
    const currentLine = before.slice(lineStart);
    const indentMatch = currentLine.match(/^[ \t]*/);
    let indent = indentMatch ? indentMatch[0] : "";

    if (/[{(\[]\s*$/.test(currentLine)) indent += " ".repeat(preferences.tabSize);
    insertAtCursor(`\n${indent}`);
  } else if (preferences.autoPairs && pairs[e.key]) {
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    if (start === end) {
      e.preventDefault();
      insertAtCursor(`${e.key}${pairs[e.key]}`, 1);
    }
  } else {
    const closers = ")]}\"'";
    if (preferences.autoPairs && closers.includes(e.key)) {
      const pos = codeInput.selectionStart;
      if (codeInput.value[pos] === e.key) {
        e.preventDefault();
        codeInput.selectionStart = codeInput.selectionEnd = pos + 1;
      }
    }
  }
});

initSettings((settings) => {
  preferences = settings;
  closeAutocomplete();
  syncScroll();
});

renderSidebar();
renderTabs();
renderEditor();
queueMicrotask(() => emitEditorEvent("ready", { api: CodeEditorAPI }));
