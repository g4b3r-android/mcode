import { escapeHtml, escapeRe } from './utils.js';

export function tokenize(code, lang) {
  const kw = {};
  const lit = {};
  const types = {};

  (lang.keywords || []).forEach((k) => { kw[k] = true; });
  (lang.literals || []).forEach((k) => { lit[k] = true; });
  (lang.types || []).forEach((k) => { types[k] = true; });

  const pieces = [];
  if (lang.blockComment) {
    pieces.push(`${escapeRe(lang.blockComment[0])}[\\s\\S]*?${escapeRe(lang.blockComment[1])}`);
  }
  if (lang.lineComment) pieces.push(`${escapeRe(lang.lineComment)}[^\\n]*`);
  pieces.push(/"(?:\\.|[^"\\\n])*"/.source);
  pieces.push(/'(?:\\.|[^'\\\n])*'/.source);
  pieces.push(/@[A-Za-z_]\w*/.source);
  pieces.push(/\b\d+\.?\d*[a-zA-Z]?\b/.source);
  pieces.push(/[A-Za-z_$][A-Za-z0-9_$]*/.source);
  pieces.push(/[^\sA-Za-z0-9_$]/.source);
  pieces.push(/\s+/.source);

  const re = new RegExp(pieces.join('|'), 'g');
  let out = '';
  let m;

  while ((m = re.exec(code)) !== null) {
    const tok = m[0];
    let cls = null;

    if (lang.blockComment && tok.indexOf(lang.blockComment[0]) === 0) cls = 'tok-comment';
    else if (lang.lineComment && tok.indexOf(lang.lineComment) === 0) cls = 'tok-comment';
    else if (tok[0] === '"' || tok[0] === "'") cls = 'tok-string';
    else if (tok[0] === '@') cls = 'tok-annotation';
    else if (/^\d/.test(tok)) cls = 'tok-number';
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tok)) {
      if (kw[tok]) cls = 'tok-keyword';
      else if (lit[tok]) cls = 'tok-literal';
      else if (types[tok] || /^[A-Z]/.test(tok)) cls = 'tok-type';
      else {
        const rest = code.slice(m.index + tok.length);
        if (/^\s*\(/.test(rest)) cls = 'tok-function';
      }
    }

    out += cls ? `<span class="${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok);
    if (m.index === re.lastIndex) re.lastIndex++;
  }

  return out;
}
