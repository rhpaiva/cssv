// What the website's pages share: tabs (any role="tablist" whose tabs name
// their panels in aria-controls), and highlighting and a copy button for each
// <pre class="code" data-lang>. The home page loads it through site.js, the
// desktop app's page (viewer.html) on its own.
import { highlighters } from './highlight.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Tabs ------------------------------------------------------------------

for (const list of $$('[role="tablist"]')) {
  const tabs = $$('[role="tab"]', list);
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    list.dispatchEvent(new CustomEvent('tabchange', { detail: tab }));
  };
  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab);
  });
  list.addEventListener('keydown', (event) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });
}

// Code blocks: highlighting and copy buttons -----------------------------

export function copyButton(getText, label = 'Copy') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.textContent = label;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = label; }, 1400);
  });
  return button;
}

for (const pre of $$('pre.code[data-lang]')) {
  const code = $('code', pre);
  const text = code.textContent;
  code.replaceChildren(highlighters[pre.dataset.lang](text));
  const wrap = document.createElement('div');
  wrap.className = 'code-wrap';
  pre.replaceWith(wrap);
  wrap.append(pre, copyButton(() => text));
}

// The nav's Learn menu ------------------------------------------------------

// A popover stays open when a link in it scrolls the same page, as the home
// page's sections do there; close it then.
for (const pop of $$('.nav-pop')) {
  pop.addEventListener('click', (event) => {
    if (event.target.closest('a')) pop.hidePopover();
  });
}
