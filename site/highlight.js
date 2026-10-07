// Light syntax highlighting for the site: CSSV files, plus the HTML, JS and
// shell snippets in "Get started". The examples pages use it too, for View
// source (source.js) and the experiments' excerpts.

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/; // SPEC 6.1
const FENCE = /^﻿?---[ \t]*\r?\n?$/;      // SPEC 3.4
const HOOK = /(data-(?:col|row|key)|\.(?:number|negative|positive|zero)\b)/;
const CSS_TOKEN = /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?|[{};:]|[^{};:"'/]+|\//g;
const NESTING_AT_RULE = /^\s*@(?:media|supports|layer|container|keyframes|scope|document)\b/;

export function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

// Selectors, with the table model's hooks (data-* and the four classes) marked.
function selector(text, out) {
  text.split(HOOK).forEach((part, i) => {
    if (part) out.append(span(i % 2 ? 't-hook' : 't-sel', part));
  });
}

// A style block, a stylesheet or a few lines of one.
export function highlightCss(css, out = document.createDocumentFragment()) {
  const stack = ['rules'];
  let prelude = '';
  let inValue = false;
  for (const [tok] of css.matchAll(CSS_TOKEN)) {
    const isString = tok[0] === '"' || tok[0] === "'";
    if (tok.startsWith('/*')) { out.append(span('t-comment', tok)); continue; }
    if (tok === '{' || tok === '}' || tok === ';') {
      if (tok === '{') stack.push(stack.at(-1) === 'rules' && NESTING_AT_RULE.test(prelude) ? 'rules' : 'decls');
      if (tok === '}' && stack.length > 1) stack.pop();
      prelude = '';
      inValue = false;
      out.append(span('t-punct', tok));
      continue;
    }
    if (stack.at(-1) === 'rules') {
      prelude += tok;
      if (isString) out.append(span('t-str', tok));
      else if (prelude.trimStart().startsWith('@')) {
        tok.split(/(@[\w-]+)/).forEach((part, i) => { if (part) out.append(span(i % 2 ? 't-at' : 't-atp', part)); });
      } else selector(tok, out);
      continue;
    }
    if (tok === ':' && !inValue) { inValue = true; out.append(span('t-punct', tok)); continue; }
    if (isString) { out.append(span('t-str', tok)); continue; }
    if (inValue) { out.append(span('t-val', tok)); continue; }
    const name = tok.trim();
    out.append(span(name.startsWith('--cssv-') ? 't-cssv' : name.startsWith('--') ? 't-var' : 't-prop', tok));
  }
  return out;
}

function highlightCsv(data, out) {
  // SPEC 5.1: the delimiter is whichever of , and ; the header uses more.
  let quoted = false, commas = 0, semicolons = 0;
  for (const ch of data) {
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '\n' || ch === '\r') break;
    else if (ch === ',') commas++;
    else if (ch === ';') semicolons++;
  }
  const delimiter = semicolons > commas ? ';' : ',';
  let pos = 0, record = 0, lineHasField = false;
  while (pos < data.length) {
    const ch = data[pos];
    if (ch === delimiter) { out.append(span('t-delim', ch)); pos++; lineHasField = true; continue; }
    if (ch === '\r' || ch === '\n') {
      const end = data.startsWith('\r\n', pos) ? pos + 2 : pos + 1;
      out.append(data.slice(pos, end));
      if (lineHasField) record++;
      lineHasField = false;
      pos = end;
      continue;
    }
    let end = pos;
    if (ch === '"') {
      end++;
      while (end < data.length) {
        if (data[end] !== '"') end++;
        else if (data[end + 1] === '"') end += 2;
        else { end++; break; }
      }
    }
    while (end < data.length && data[end] !== delimiter && data[end] !== '\n' && data[end] !== '\r') end++;
    const field = data.slice(pos, end);
    const cls = record === 0 ? 't-head' : ch === '"' ? 't-quoted' : NUMBER.test(field) ? 't-num' : 't-text';
    out.append(span(cls, field));
    lineHasField = true;
    pos = end;
  }
}

export function highlightCssv(text) {
  const out = document.createDocumentFragment();
  const lines = text.split(/(?<=\n)/);
  let i = 0;
  if (lines.length && FENCE.test(lines[0])) {
    out.append(span('t-fence', lines[i++]));
    let css = '';
    while (i < lines.length && !FENCE.test(lines[i])) css += lines[i++];
    highlightCss(css, out);
    if (i < lines.length) out.append(span('t-fence', lines[i++]));
  }
  highlightCsv(lines.slice(i).join(''), out);
  return out;
}

// Tags, attribute names and values; text between tags stays plain. The table
// model's attributes (data-col, data-row, data-key, class) are marked as hooks.
const HTML_TAG = /<!--[\s\S]*?-->|<\/?[\w-]+[^>]*>/g;
const HTML_IN_TAG = /(<\/?[\w-]+)|([\w-]+)(?:(=)("[^"]*"))?|(\/?>)|(\s+)/g;
const MODEL_ATTR = /^(?:data-(?:col|row|key)|class)$/;

export function highlightHtml(text) {
  const out = document.createDocumentFragment();
  let pos = 0;
  for (const match of text.matchAll(HTML_TAG)) {
    out.append(text.slice(pos, match.index));
    pos = match.index + match[0].length;
    if (match[0].startsWith('<!--')) { out.append(span('t-comment', match[0])); continue; }
    for (const [, open, name, eq, value, close, space] of match[0].matchAll(HTML_IN_TAG)) {
      if (open || close) out.append(span('t-tag', open || close));
      else if (space) out.append(space);
      else {
        out.append(span(MODEL_ATTR.test(name) ? 't-hook' : 't-attr', name));
        if (eq) out.append(span('t-punct', eq), span('t-str', value));
      }
    }
  }
  out.append(text.slice(pos));
  return out;
}

const JS_TOKEN = /\/\/[^\n]*|'[^'\n]*'|"[^"\n]*"|`[^`]*`|\b(?:import|from|const|let|await|new|return|export|async|function)\b|\b\d+\b|[\s\S]/g;

export function highlightJs(text) {
  const out = document.createDocumentFragment();
  let plain = '';
  const flush = () => { if (plain) out.append(plain); plain = ''; };
  for (const [tok] of text.matchAll(JS_TOKEN)) {
    let cls = null;
    if (tok.startsWith('//')) cls = 't-comment';
    else if (/^['"`]/.test(tok)) cls = 't-str';
    else if (/^[a-z]{3,}$/.test(tok)) cls = 't-kw';
    else if (/^\d+$/.test(tok)) cls = 't-num';
    if (cls) { flush(); out.append(span(cls, tok)); } else plain += tok;
  }
  flush();
  return out;
}

export function highlightShell(text) {
  const out = document.createDocumentFragment();
  for (const line of text.split(/(?<=\n)/)) {
    const [, cmd, rest] = line.match(/^(\S*)([\s\S]*)$/);
    if (line.startsWith('#')) { out.append(span('t-comment', line)); continue; }
    out.append(span('t-kw', cmd));
    const comment = rest.indexOf('#');
    if (comment < 0) out.append(rest);
    else out.append(rest.slice(0, comment), span('t-comment', rest.slice(comment)));
  }
  return out;
}

// Markdown, line by line: front matter, headings, fenced code, list markers,
// and inline code and bold within a line.
export function highlightMarkdown(text) {
  const out = document.createDocumentFragment();
  const lines = text.split(/(?<=\n)/);
  let frontMatter = lines[0]?.startsWith('---');
  let fenced = false;
  lines.forEach((line, i) => {
    if (frontMatter) {
      if (line.startsWith('---')) {
        out.append(span('t-fence', line));
        if (i > 0) frontMatter = false;
      } else {
        const [, key, rest] = line.match(/^([\w-]+:)?([\s\S]*)$/);
        if (key) out.append(span('t-prop', key));
        out.append(span('t-val', rest));
      }
      return;
    }
    if (line.startsWith('```')) { fenced = !fenced; out.append(span('t-comment', line)); return; }
    if (fenced) { out.append(span('t-str', line)); return; }
    if (line.startsWith('#')) { out.append(span('t-head', line)); return; }
    const [, marker = '', rest] = line.match(/^(\s*(?:[-*]|\d+\.)\s)?([\s\S]*)$/);
    if (marker) out.append(span('t-delim', marker));
    for (const part of rest.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
      if (!part) continue;
      if (part.startsWith('`')) out.append(span('t-str', part));
      else if (part.startsWith('**')) out.append(span('t-head', part));
      else out.append(part);
    }
  });
  return out;
}

export const highlighters = { cssv: highlightCssv, html: highlightHtml, js: highlightJs, shell: highlightShell, md: highlightMarkdown };
