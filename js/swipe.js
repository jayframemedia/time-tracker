// Swipe left on a History row (touch) to reveal Delete. Mouse users get a delete button instead.
const OPEN_X = -88;

export function enableSwipe(root, { onDelete }) {
  let row = null; // row being dragged
  let open = null; // row currently swiped open
  let startX = 0;
  let startY = 0;
  let base = 0;
  let x = 0;
  let dragging = false;
  let suppressUntil = 0;

  const setX = (el, value, animate) => {
    el.style.transition = animate ? '' : 'none';
    el.style.transform = value ? `translateX(${value}px)` : '';
    el.closest('.swipe')?.classList.toggle('is-open', value < 0);
  };
  const close = (animate = true) => { if (open) { setX(open, 0, animate); open = null; } };

  root.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    const target = ev.target.closest('.swipe .hrow');
    if (open && target !== open && !ev.target.closest('.swipe-del')) close();
    if (!target) return;
    row = target;
    startX = ev.clientX;
    startY = ev.clientY;
    base = target === open ? OPEN_X : 0;
    x = base;
    dragging = false;
  });

  root.addEventListener('pointermove', (ev) => {
    if (!row) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) dragging = true;
      else if (Math.abs(dy) > 8) { row = null; return; } // vertical scroll wins
      else return;
    }
    x = Math.max(OPEN_X * 1.4, Math.min(0, base + dx));
    setX(row, x, false);
  });

  const end = () => {
    if (!row) return;
    if (dragging) {
      suppressUntil = Date.now() + 350; // the tap that ends a swipe shouldn't open the editor
      if (x < OPEN_X / 2) { setX(row, OPEN_X, true); open = row; } else { setX(row, 0, true); if (open === row) open = null; }
    }
    row = null;
    dragging = false;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  // Capture phase: runs before the app's own click handler.
  root.addEventListener('click', (ev) => {
    const del = ev.target.closest('.swipe-del');
    if (del) { ev.stopPropagation(); open = null; onDelete(del.dataset.delete); return; }
    if (Date.now() < suppressUntil) { ev.stopPropagation(); ev.preventDefault(); return; }
    if (open && ev.target.closest('.hrow') === open) { ev.stopPropagation(); close(); }
  }, true);

  return { close: () => close(false), reset: () => { open = null; row = null; } };
}
