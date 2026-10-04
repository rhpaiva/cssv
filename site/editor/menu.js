// Menus: the menu bar and the pop-up menus it and the column headers open.
// An item is { label, run, shortcut, disabled, checked, icon } or
// { separator: true } or { heading }. Items are built when a menu opens, so
// labels, checks and disabled states always describe the current selection.
// Keyboard: Up and Down move, Home and End jump, Enter and Space run, Escape
// closes, and in the menu bar Left and Right move to the next menu.

let open = null; // { menu, anchor, close }

function itemButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-item';
  button.tabIndex = -1;
  if (item.checked !== undefined) {
    button.setAttribute('role', 'menuitemcheckbox');
    button.setAttribute('aria-checked', String(!!item.checked));
  } else button.setAttribute('role', 'menuitem');
  if (item.disabled) button.setAttribute('aria-disabled', 'true');
  const mark = document.createElement('span');
  mark.className = 'menu-mark';
  mark.setAttribute('aria-hidden', 'true');
  if (item.checked) mark.textContent = '✓';
  else if (item.icon) mark.innerHTML = item.icon;
  const label = document.createElement('span');
  label.className = 'menu-label';
  label.textContent = item.label;
  button.append(mark, label);
  if (item.shortcut) {
    const kbd = document.createElement('kbd');
    kbd.textContent = item.shortcut;
    button.append(kbd);
  }
  return button;
}

/**
 * Opens a menu of `items` under `anchor`. `onArrow(dir)` handles Left and
 * Right (the menu bar moves to the next menu); `focusFirst` puts focus on the
 * first item, as when the menu opened from the keyboard.
 */
export function openMenu(anchor, items, { label = '', onArrow = null, focusFirst = false, done = null, at = null } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.tabIndex = -1;
  menu.setAttribute('role', 'menu');
  if (label) menu.setAttribute('aria-label', label);
  const buttons = [];
  for (const item of items) {
    if (item.separator) {
      const hr = document.createElement('div');
      hr.className = 'menu-sep';
      hr.setAttribute('role', 'separator');
      menu.append(hr);
    } else if (item.heading) {
      const h = document.createElement('div');
      h.className = 'menu-heading';
      h.textContent = item.heading;
      menu.append(h);
    } else {
      const button = itemButton(item);
      button.addEventListener('click', () => {
        if (item.disabled) return;
        closeMenu();
        item.run?.();
        done?.();
      });
      menu.append(button);
      if (!item.disabled) buttons.push(button);
    }
  }
  document.body.append(menu);

  // Under the anchor, or at a point; kept inside the window.
  const r = at ?? anchor.getBoundingClientRect();
  const left = at ? at.x : r.left;
  const top = at ? at.y : r.bottom + 4;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  menu.style.top = `${top + h > innerHeight - 8 ? Math.max(8, (at ? top : r.top - 4) - h) : top}px`;

  const focus = (i) => buttons[(i + buttons.length) % buttons.length]?.focus();
  menu.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(-1);
    else if (e.key === 'Escape') {
      closeMenu();
      if (anchor.isConnected && anchor.focus) anchor.focus();
      else done?.();
    } else if (e.key === 'Tab') closeMenu();
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onArrow) onArrow(e.key === 'ArrowLeft' ? -1 : 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  menu.addEventListener('mousemove', (e) => {
    const b = e.target.closest('.menu-item');
    if (b && buttons.includes(b) && document.activeElement !== b) b.focus({ preventScroll: true });
  });
  if (focusFirst) focus(0);
  else menu.focus({ preventScroll: true });
  anchor.setAttribute?.('aria-expanded', 'true');
  open = {
    menu,
    anchor,
    close: () => {
      menu.remove();
      anchor.setAttribute?.('aria-expanded', 'false');
    },
  };
  return menu;
}

export function closeMenu() {
  if (!open) return;
  const { close } = open;
  open = null;
  close();
}

export const menuOpen = () => open;

// A pointer press outside the open menu and its anchor closes it.
addEventListener('pointerdown', (e) => {
  if (!open) return;
  if (open.menu.contains(e.target) || open.anchor.contains?.(e.target)) return;
  closeMenu();
}, true);
addEventListener('resize', () => closeMenu());
addEventListener('blur', () => closeMenu());

/**
 * Builds a menu bar in `bar` from `menus`: [{ label, items: () => items }].
 * `done` runs after an item, to give focus back to the sheet.
 */
export function menubar(bar, menus, { done = null } = {}) {
  bar.setAttribute('role', 'menubar');
  const tops = menus.map((m, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menubar-item';
    button.textContent = m.label;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.tabIndex = i === 0 ? 0 : -1;
    bar.append(button);
    return button;
  });
  const show = (i, focusFirst) => {
    const button = tops[(i + tops.length) % tops.length];
    const index = tops.indexOf(button);
    tops.forEach((b) => { b.tabIndex = b === button ? 0 : -1; });
    button.focus({ preventScroll: true });
    openMenu(button, menus[index].items(), {
      label: menus[index].label,
      focusFirst,
      done,
      onArrow: (dir) => show(index + dir, true),
    });
  };
  tops.forEach((button, i) => {
    button.addEventListener('click', () => {
      if (open?.anchor === button) closeMenu();
      else show(i, false);
    });
    // With a menu open, pointing at another title opens that menu.
    button.addEventListener('pointerenter', () => {
      if (open && tops.includes(open.anchor) && open.anchor !== button) show(i, false);
    });
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = tops[(i + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length];
        if (open) show(tops.indexOf(next), true);
        else {
          tops.forEach((b) => { b.tabIndex = b === next ? 0 : -1; });
          next.focus();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show(i, true);
      }
    });
  });
  return tops;
}
