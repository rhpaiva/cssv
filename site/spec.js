// Renders one of the repository's Markdown documents. Code blocks that
// are CSSV files (they start with a fence) get the site's highlighting.
// marked 18.0.14, copied unchanged from its npm package so the site runs
// no code from other origins.
import { marked } from './vendor/marked.esm.js';
import { highlighters } from './highlight.js';

const DOCS = {
  spec: { file: '../SPEC.md', title: 'CSSV v1 specification' },
  conformance: { file: '../CONFORMANCE.md', title: 'CSSV conformance matrix' },
  readme: { file: '../README.md', title: 'CSSV reference implementation' },
};
const LINKS = { 'SPEC.md': 'spec.html', 'CONFORMANCE.md': 'spec.html?doc=conformance', 'README.md': 'spec.html?doc=readme' };

const asked = new URLSearchParams(location.search).get('doc');
const name = Object.hasOwn(DOCS, asked ?? '') ? asked : 'spec';
const doc = DOCS[name];
const main = document.getElementById('doc');
document.title = doc.title;
document.querySelector(`.doc-switch a[data-doc="${name}"]`)?.setAttribute('aria-current', 'page');

const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

try {
  const res = await fetch(doc.file);
  if (!res.ok) throw new Error(`Could not load ${doc.file} (HTTP ${res.status}).`);
  main.innerHTML = marked.parse(await res.text());
} catch (error) {
  main.textContent = error.message;
  throw error;
}

for (const a of main.querySelectorAll('a[href]')) {
  const href = a.getAttribute('href');
  if (LINKS[href]) a.href = LINKS[href];
  else if (/^https?:/.test(href)) a.rel = 'noopener';
  else if (!href.startsWith('#')) a.href = new URL(href, new URL(doc.file, location.href)).href;
}

for (const code of main.querySelectorAll('pre > code')) {
  const text = code.textContent;
  const lang = code.className.match(/language-(\w+)/)?.[1];
  const kind = /^---[ \t]*\n/.test(text) ? 'cssv' : lang === 'html' ? 'html' : lang === 'js' ? 'js' : null;
  if (kind) code.replaceChildren(highlighters[kind](text));
  code.parentElement.classList.add('code');
}
for (const table of main.querySelectorAll('table')) {
  const scroller = document.createElement('div');
  scroller.className = 'table-scroll';
  table.replaceWith(scroller);
  scroller.append(table);
}

const toc = document.getElementById('toc');
let list = toc;
for (const h of main.querySelectorAll('h2, h3')) {
  const label = h.textContent;
  h.id ||= slug(label);
  const anchor = document.createElement('a');
  anchor.className = 'anchor';
  anchor.href = `#${h.id}`;
  anchor.setAttribute('aria-label', `Link to ${label}`);
  anchor.textContent = '#';
  h.append(anchor);
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.href = `#${h.id}`;
  link.textContent = label;
  li.append(link);
  if (h.localName === 'h2') {
    toc.append(li);
    list = document.createElement('ol');
    li.append(list);
  } else list.append(li);
}
for (const ol of toc.querySelectorAll('ol:empty')) ol.remove();
if (toc.querySelectorAll('a').length < 3) {
  document.querySelector('.toc details').hidden = true;
  document.querySelector('.doc-layout').classList.add('no-toc');
}
if (matchMedia('(max-width: 1000px)').matches) document.querySelector('.toc details').open = false;
if (location.hash) {
  try {
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch {
    // a malformed %-escape names no heading
  }
}
