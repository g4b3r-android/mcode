export const COMMON_SNIPPETS = {
  java: [
    { label: 'class', detail: 'Declaração de classe', insertText: 'class Name {\n    \n}', caretBack: 2, kind: 'snippet' },
    { label: 'main', detail: 'Método principal', insertText: 'public static void main(String[] args) {\n    \n}', caretBack: 2, kind: 'snippet' },
    { label: 'sout', detail: 'System.out.println', insertText: 'System.out.println();', caretBack: 2, kind: 'snippet' },
    { label: 'fori', detail: 'Laço for', insertText: 'for (int i = 0; i < length; i++) {\n    \n}', caretBack: 2, kind: 'snippet' },
    { label: 'foreach', detail: 'Laço for-each', insertText: 'for (Type item : items) {\n    \n}', caretBack: 2, kind: 'snippet' },
    { label: 'if', detail: 'Bloco condicional', insertText: 'if (condition) {\n    \n}', caretBack: 2, kind: 'snippet' },
    { label: 'try', detail: 'Try/catch', insertText: 'try {\n    \n} catch (Exception e) {\n    \n}', caretBack: 2, kind: 'snippet' },
    { label: 'println', detail: 'System.out.println', insertText: 'println()', caretBack: 1, kind: 'method' },
    { label: 'printf', detail: 'System.out.printf', insertText: 'printf()', caretBack: 1, kind: 'method' },
    { label: 'length', detail: 'Tamanho de array/string', insertText: 'length', kind: 'property' },
    { label: 'add', detail: 'Adiciona um item', insertText: 'add()', caretBack: 1, kind: 'method' },
    { label: 'get', detail: 'Obtém um item', insertText: 'get()', caretBack: 1, kind: 'method' },
    { label: 'size', detail: 'Quantidade de itens', insertText: 'size()', caretBack: 1, kind: 'method' }
  ],
  python: [
    { label: 'def', detail: 'Declaração de função', insertText: 'def name():\n    ', kind: 'snippet' },
    { label: 'class', detail: 'Declaração de classe', insertText: 'class Name:\n    ', kind: 'snippet' },
    { label: 'if', detail: 'Bloco condicional', insertText: 'if condition:\n    ', kind: 'snippet' },
    { label: 'for', detail: 'Laço for', insertText: 'for item in items:\n    ', kind: 'snippet' },
    { label: 'while', detail: 'Laço while', insertText: 'while condition:\n    ', kind: 'snippet' },
    { label: 'try', detail: 'Try/except', insertText: 'try:\n    \nexcept Exception as error:\n    ', caretBack: 31, kind: 'snippet' },
    { label: 'print', detail: 'Escreve no console', insertText: 'print()', caretBack: 1, kind: 'function' },
    { label: 'range', detail: 'Cria uma sequência', insertText: 'range()', caretBack: 1, kind: 'function' },
    { label: 'len', detail: 'Retorna o tamanho', insertText: 'len()', caretBack: 1, kind: 'function' },
    { label: 'append', detail: 'Adiciona um item', insertText: 'append()', caretBack: 1, kind: 'method' },
    { label: 'get', detail: 'Obtém um valor', insertText: 'get()', caretBack: 1, kind: 'method' },
    { label: 'items', detail: 'Pares de um dicionário', insertText: 'items()', caretBack: 1, kind: 'method' }
  ],
  html: [
    { label: 'html5', detail: 'Documento HTML5', insertText: '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Documento</title>\n</head>\n<body>\n    \n</body>\n</html>', caretBack: 16, kind: 'snippet' },
    { label: 'div', detail: 'Elemento div', insertText: '<div></div>', caretBack: 6, kind: 'snippet' },
    { label: 'link:css', detail: 'Folha de estilos', insertText: '<link rel="stylesheet" href="style.css">', kind: 'snippet' },
    { label: 'script', detail: 'Script externo', insertText: '<script src="script.js"></script>', caretBack: 9, kind: 'snippet' }
  ]
};

const SNIPPET_KINDS = new Set(['snippet', 'function', 'method', 'property', 'text']);

export function registerSnippets(languageId, snippets, { replace = false } = {}) {
  if (typeof languageId !== 'string' || !languageId.trim()) {
    throw new TypeError('O id da linguagem deve ser uma string não vazia.');
  }
  if (!Array.isArray(snippets) || snippets.length === 0) {
    throw new TypeError('snippets deve ser um array não vazio.');
  }

  const normalized = snippets.map((snippet, index) => {
    if (!snippet || typeof snippet !== 'object') {
      throw new TypeError(`Snippet ${index + 1} inválido.`);
    }
    const label = String(snippet.label || '').trim();
    const insertText = String(snippet.insertText ?? '');
    if (!label || !insertText) {
      throw new TypeError(`Snippet ${index + 1} precisa de label e insertText.`);
    }
    const kind = SNIPPET_KINDS.has(snippet.kind) ? snippet.kind : 'snippet';
    const caretBack = Number.isInteger(snippet.caretBack) && snippet.caretBack >= 0
      ? Math.min(snippet.caretBack, insertText.length)
      : 0;
    return {
      label,
      insertText,
      detail: String(snippet.detail || 'Snippet'),
      kind,
      ...(caretBack ? { caretBack } : {})
    };
  });

  const id = languageId.trim();
  const combined = replace ? normalized : [...(COMMON_SNIPPETS[id] || []), ...normalized];
  COMMON_SNIPPETS[id] = [...new Map(
    combined.map((snippet) => [`${snippet.kind}:${snippet.label}:${snippet.insertText}`, snippet])
  ).values()];
  return [...COMMON_SNIPPETS[id]];
}

function stripStringsAndComments(code, langId) {
  let result = '';
  let i = 0;
  let quote = null;
  let quoteStart = -1;
  let blockComment = false;

  while (i < code.length) {
    const char = code[i];
    const next = code[i + 1];

    if (blockComment) {
      if (char === '*' && next === '/') {
        result += '  ';
        i += 2;
        blockComment = false;
      } else {
        result += char === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (char === '\\') {
        result += '  ';
        i += Math.min(2, code.length - i);
      } else if (char === quote) {
        result += ' ';
        quote = null;
        quoteStart = -1;
        i += 1;
      } else {
        result += char === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (langId === 'java' && char === '/' && next === '*') {
      result += '  ';
      i += 2;
      blockComment = true;
    } else if (langId === 'java' && char === '/' && next === '/') {
      const lineEnd = code.indexOf('\n', i);
      const end = lineEnd === -1 ? code.length : lineEnd;
      result += ' '.repeat(end - i);
      i = end;
    } else if (langId === 'python' && char === '#') {
      const lineEnd = code.indexOf('\n', i);
      const end = lineEnd === -1 ? code.length : lineEnd;
      result += ' '.repeat(end - i);
      i = end;
    } else if (char === '"' || char === "'") {
      result += ' ';
      quote = char;
      quoteStart = i;
      i += 1;
    } else {
      result += char;
      i += 1;
    }
  }

  return { text: result, unclosedString: quote, unclosedStringStart: quoteStart, unclosedComment: blockComment };
}

function lineAndColumn(code, index) {
  const before = code.slice(0, index);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: index - lastNewline
  };
}

function diagnostic(code, index, message, severity = 'error') {
  return { ...lineAndColumn(code, Math.max(0, index)), message, severity };
}

function lintPairs(code, cleanCode, pairs) {
  const diagnostics = [];
  const stack = [];
  const opening = Object.keys(pairs);
  const closing = Object.values(pairs);

  for (let i = 0; i < cleanCode.length; i += 1) {
    const char = cleanCode[i];
    if (opening.includes(char)) {
      stack.push({ char, index: i });
    } else if (closing.includes(char)) {
      const expectedOpening = opening[closing.indexOf(char)];
      const last = stack[stack.length - 1];
      if (!last || last.char !== expectedOpening) {
        diagnostics.push(diagnostic(code, i, `Fechamento "${char}" sem abertura correspondente.`));
      } else {
        stack.pop();
      }
    }
  }

  stack.forEach(({ char, index }) => {
    diagnostics.push(diagnostic(code, index, `Falta fechar "${pairs[char]}".`));
  });
  return diagnostics;
}

function lintJava(code, cleanCode) {
  const diagnostics = lintPairs(code, cleanCode, { '(': ')', '[': ']', '{': '}' });
  const lines = cleanCode.split('\n');
  let offset = 0;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    const isStatement = /^(?:return\b|throw\b|break\b|continue\b|(?:[A-Za-z_$][\w$<>?,.\[\]]*\s+)+[A-Za-z_$][\w$]*\s*=|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:=|\+=|-=|\*=|\/=|%=|\+\+|--)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*(?:\([^;{}]*\))?)+\s*)/.test(trimmed);
    const exempt = !trimmed || /[;{}:]$/.test(trimmed) || /^(?:if|for|while|switch|catch|try|else|do|class|interface|enum|record|package|import)\b/.test(trimmed);
    if (isStatement && !exempt) {
      diagnostics.push(diagnostic(code, offset + line.length, 'Possível ponto e vírgula ausente.', 'warning'));
    }
    if (/^\s*(?:public\s+)?class\s+\d/.test(line)) {
      diagnostics.push(diagnostic(code, offset + line.search(/\d/), 'O nome da classe deve começar com uma letra, _ ou $.'));
    }
    offset += line.length + (lineIndex < lines.length - 1 ? 1 : 0);
  });
  return diagnostics;
}

function lintPython(code, cleanCode) {
  const diagnostics = lintPairs(code, cleanCode, { '(': ')', '[': ']', '{': '}' });
  const lines = cleanCode.split('\n');
  const blockPattern = /^\s*(?:async\s+(?:def|for|with)|def|class|if|elif|else|for|while|try|except|finally|with|match|case)\b/;
  let previousIndent = 0;
  let previousWasBlock = false;
  let offset = 0;
  let bracketDepth = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const indentText = line.match(/^[ \t]*/)?.[0] || '';
    const indent = indentText.replace(/\t/g, '    ').length;
    const lineOffset = offset;
    const depthAtLineStart = bracketDepth;

    if (/\t/.test(indentText) && / /.test(indentText)) {
      diagnostics.push(diagnostic(code, lineOffset, 'Evite misturar tabs e espaços na indentação.', 'warning'));
    }
    if (trimmed && blockPattern.test(line) && !trimmed.endsWith(':')) {
      diagnostics.push(diagnostic(code, lineOffset + line.length, 'Falta ":" ao final do bloco.'));
    }
    if (trimmed && indent > previousIndent && !previousWasBlock && depthAtLineStart === 0) {
      diagnostics.push(diagnostic(code, lineOffset, 'Indentação inesperada.', 'warning'));
    }
    if (trimmed) {
      previousIndent = indent;
      previousWasBlock = trimmed.endsWith(':') || blockPattern.test(line);
    }
    for (const char of line) {
      if ('([{'.includes(char)) bracketDepth += 1;
      else if (')]}'.includes(char)) bracketDepth = Math.max(0, bracketDepth - 1);
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  });
  return diagnostics;
}

export function lintCode(code, langId) {
  if (!code.trim()) return [];
  const clean = stripStringsAndComments(code, langId);
  let diagnostics;
  if (langId === 'python') diagnostics = lintPython(code, clean.text);
  else if (langId === 'java') diagnostics = lintJava(code, clean.text);
  else diagnostics = lintPairs(code, clean.text, { '(': ')', '[': ']', '{': '}' });

  if (clean.unclosedString) {
    diagnostics.push(diagnostic(code, clean.unclosedStringStart, 'String não fechada.'));
  }
  if (clean.unclosedComment) {
    diagnostics.push(diagnostic(code, code.lastIndexOf('/*'), 'Comentário de bloco não fechado.'));
  }

  return diagnostics
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .slice(0, 50);
}

function wordsFromCode(code) {
  const words = code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  return [...new Set(words)];
}

export function getCompletionContext(code, cursor) {
  const before = code.slice(0, cursor);
  const match = before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
  const prefix = match ? match[0] : '';
  return {
    prefix,
    start: cursor - prefix.length,
    afterDot: /\.\s*[A-Za-z0-9_$]*$/.test(before)
  };
}

export function getCompletions(code, cursor, lang, showAll = false) {
  const context = getCompletionContext(code, cursor);
  if (!showAll && !context.prefix) return [];

  const languageItems = [
    ...(lang.keywords || []).map((label) => ({ label, detail: 'keyword', insertText: label, kind: 'keyword' })),
    ...(lang.literals || []).map((label) => ({ label, detail: 'literal', insertText: label, kind: 'literal' })),
    ...(lang.types || []).map((label) => ({ label, detail: 'type', insertText: label, kind: 'type' })),
    ...(COMMON_SNIPPETS[lang.id] || []),
    ...wordsFromCode(code)
      .filter((label) => label !== context.prefix)
      .map((label) => ({ label, detail: 'Neste arquivo', insertText: label, kind: 'text' }))
  ];

  const prefix = context.prefix.toLowerCase();
  const unique = new Map();
  const priority = { keyword: 5, literal: 5, type: 5, method: 4, property: 4, function: 4, snippet: 3, text: 1 };
  languageItems.forEach((item) => {
    if (context.afterDot && !['method', 'property', 'text'].includes(item.kind)) return;
    if (!showAll && !item.label.toLowerCase().startsWith(prefix)) return;
    const key = `${item.kind}:${item.label}:${item.insertText}`;
    if (!unique.has(key)) unique.set(key, item);
  });

  return [...unique.values()]
    .sort((a, b) => {
      const aCaseMatch = a.label.startsWith(context.prefix) ? 0 : 1;
      const bCaseMatch = b.label.startsWith(context.prefix) ? 0 : 1;
      return aCaseMatch - bCaseMatch
        || priority[b.kind] - priority[a.kind]
        || a.label.localeCompare(b.label);
    })
    .slice(0, 200);
}
