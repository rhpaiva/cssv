// The home: a card for every .cssv file the website serves. Each card shows
// the file's first rows, rendered by <cssv-table> from the file's own styles.
import { metadata, parse, rewriteCssUrls } from '../../src/core.js';
import { scan } from './cssv-text.js';
import { hoistFonts } from './fonts.js';
import { DRAFTS, GROUPS, urlOf } from './files.js';

const PREVIEW_ROWS = 120; // enough for a whole periodic table, not the 1,000-row ledger

function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null));
  return node;
}

// The header and the first rows. The preview has no src, so relative URLs
// in the style block are made absolute against the file's URL (4.3).
function preview(text, s, url) {
  const last = s.records[Math.min(PREVIEW_ROWS, s.records.length - 1)];
  const cut = text.slice(0, last ? last.end : text.length);
  if (!s.style) return cut;
  return cut.slice(0, s.style.start) + rewriteCssUrls(cut.slice(s.style.start, s.style.end), url) + cut.slice(s.style.end);
}

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const size = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

async function fill(card, path) {
  const url = new URL(urlOf(path), location.href).href;
  const table = card.querySelector('cssv-table');
  const desc = card.querySelector('.card-desc');
  const stats = card.querySelector('.card-stats');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status}).`);
    const text = await res.text();
    const model = parse(text);
    const s = scan(text);
    // The file's own title and description (4.6). With a title, the path
    // line names the file.
    const { title, description } = metadata(text);
    if (title) {
      card.querySelector('.card-name').firstChild.data = title;
      card.querySelector('.card-path').textContent = path;
    }
    desc.textContent = description ?? '';
    stats.textContent = `${plural(model.rows.length, 'row')} · ${plural(model.columns.length, 'column')} · ${size(new Blob([text]).size)}`;
    await table.update(preview(text, s, url));
    hoistFonts(table.model);
  } catch (error) {
    card.classList.add('failed');
    stats.textContent = error.message;
  }
}

function hasDraft(path) {
  try {
    return localStorage.getItem(DRAFTS + path) !== null;
  } catch {
    return false;
  }
}

function card(path) {
  const slash = path.lastIndexOf('/');
  const node = h('a', { className: 'card', href: `?file=${encodeURI(path)}` },
    h('div', { className: 'thumb', inert: true }, h('cssv-table')),
    h('div', { className: 'card-body' },
      h('strong', { className: 'card-name', textContent: path.slice(slash + 1) },
        hasDraft(path) ? h('span', { className: 'card-draft', textContent: 'unsaved changes' }) : null),
      h('span', { className: 'card-path', textContent: path.slice(0, slash + 1) }),
      h('p', { className: 'card-desc' }),
      h('span', { className: 'card-stats', textContent: 'Loading…' })));
  fill(node, path);
  return node;
}

/** Fills `root` with a section of cards per group. */
export function renderHome(root) {
  root.replaceChildren(...GROUPS.map((group) => h('section', { className: 'group' },
    h('h2', { textContent: group.title }),
    h('div', { className: 'cards' }, ...group.files.map(card)))));
}
