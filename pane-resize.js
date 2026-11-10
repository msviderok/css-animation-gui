(() => {
  const workspace = document.querySelector('.workspace');
  const handle = document.getElementById('paneDivider');
  const key = 'framecraft-pane-split';
  const defaults = 57;
  let split = defaults;
  try { split = Number(localStorage.getItem(key)) || defaults; } catch {}
  function apply(value, persist = false) {
    split = Math.max(25, Math.min(75, value));
    workspace.style.setProperty('--editor-pane-width', `${split}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(split)));
    handle.setAttribute('aria-valuetext', `Preview ${Math.round(split)}%, CSS ${Math.round(100 - split)}%`);
    if (persist) { try { localStorage.setItem(key, String(split)); } catch {} }
  }
  let dragging = false;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); dragging = true;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-panes');
  });
  handle.addEventListener('pointermove', event => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const style = getComputedStyle(workspace);
    const scale = rect.width / workspace.offsetWidth;
    const left = parseFloat(style.paddingLeft) * scale;
    const right = parseFloat(style.paddingRight) * scale;
    apply((event.clientX - rect.left - left) / (rect.width - left - right) * 100);
  });
  const finish = () => { if (!dragging) return; dragging = false; document.body.classList.remove('resizing-panes'); apply(split, true); };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('dblclick', () => apply(defaults, true));
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    apply(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : split + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 1), true);
  });
  apply(split);
})();
