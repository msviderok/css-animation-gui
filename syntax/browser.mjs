import { highlightCode } from './highlighter.mjs';

import { Virtualizer, observeElementOffset, elementScroll } from '@tanstack/virtual-core';
import { tokenizeLines, renderLine } from './lines.mjs';

const editors = new WeakMap();
const mounted = new Set();
const languages = { keyframeCss: 'css', domCapture: 'json', cssOutput: 'css', selectedCustomCss: 'css', domSceneCss: 'css', domPlayerKeyframes: 'css' };
function paint(textarea) {
  const state = editors.get(textarea);
  if (!state) return;
  const items = state.virtualizer.getVirtualItems();
  state.code.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  const key = items.map(item => item.index).join(',');
  if (state.rendered === key) return;
  state.rendered = key;
  state.code.innerHTML = items.map(item => {
    let html = state.cache.get(item.index);
    if (html === undefined) { html = renderLine(state.lines[item.index] || []); state.cache.set(item.index, html); }
    return `<span class="syntax-line" data-line="${item.index + 1}" style="top:${item.start}px;height:${item.size}px">${html}</span>`;
  }).join('');
  if (state.cache.size > 500) { const visible = new Set(items.map(item => item.index)); for (const index of state.cache.keys()) if (!visible.has(index)) state.cache.delete(index); }
}
function update(textarea) {
  const state = editors.get(textarea);
  if (!state || state.value === textarea.value) return;
  state.value = textarea.value;
  state.lines = tokenizeLines(textarea.value, languages[textarea.id]);
  state.cache.clear(); state.rendered = null;
  // Native textarea line boxes can be fractionally rounded, especially under CSS zoom.
  const height = textarea.scrollHeight;
  const measured = height > textarea.clientHeight + 2 ? (height - 24) / state.lines.length : parseFloat(getComputedStyle(textarea).lineHeight);
  const changed = state.lineHeight !== measured; state.lineHeight = measured;

  state.virtualizer.setOptions({ ...state.virtualizer.options, count: state.lines.length });
  if (changed) state.virtualizer.measure();
  state.virtualizer._willUpdate();
  paint(textarea);
}
function enhance(textarea) {
  if (editors.has(textarea)) { if (!editors.get(textarea).timer) update(textarea); return; }
  const box = document.createElement('div'); box.className = 'syntax-editor';
  const layer = document.createElement('div'); layer.className = 'syntax-paint'; layer.setAttribute('aria-hidden', 'true');
  const pre = document.createElement('pre'); pre.className = 'th-code syntax-virtual';
  const code = document.createElement('code'); pre.append(code); layer.append(pre);
  textarea.before(box); box.append(layer, textarea); textarea.classList.add('syntax-input');
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 17.6;
  const state = { layer, code, lines: [[]], value: null, cache: new Map(), rendered: null, lineHeight };
  editors.set(textarea, state); mounted.add(textarea);
  state.virtualizer = new Virtualizer({
    count: 1, getScrollElement: () => textarea, estimateSize: () => state.lineHeight,
    paddingStart: 12, paddingEnd: 12, overscan: 8,
    scrollToFn: elementScroll, observeElementOffset,
    observeElementRect: (_instance, callback) => {
      const measure = () => {
        layer.style.width = `${textarea.clientWidth}px`;
        if (textarea.clientHeight && textarea.scrollHeight > textarea.clientHeight + 2) {
          const size = (textarea.scrollHeight - 24) / state.lines.length;
          if (Math.abs(size - state.lineHeight) > 0.000001) { state.lineHeight = size; state.rendered = null; state.virtualizer.measure(); }
        }
        callback({ width: textarea.clientWidth, height: textarea.clientHeight });
      };
      const observer = new ResizeObserver(measure); observer.observe(textarea); measure();
      return () => observer.disconnect();
    },
    onChange: () => paint(textarea),
  });
  state.cleanup = state.virtualizer._didMount();
  textarea.addEventListener('input', () => {
    clearTimeout(state.timer);
    if (textarea.value.length < 100000) { state.timer = null; box.classList.remove('syntax-pending'); update(textarea); return; }
    box.classList.add('syntax-pending');
    state.timer = setTimeout(() => { state.timer = null; update(textarea); box.classList.remove('syntax-pending'); }, 80);
  });
  textarea.addEventListener('scroll', () => paint(textarea));
  update(textarea);
}
function refresh() {
  for (const textarea of mounted) if (!textarea.isConnected) { clearTimeout(editors.get(textarea).timer); editors.get(textarea).cleanup(); mounted.delete(textarea); editors.delete(textarea); }
  document.querySelectorAll('[data-highlight-language]:not([data-highlighted])').forEach(node => {
    const markup = highlightCode(node.textContent, node.dataset.highlightLanguage);
    const template = document.createElement('template'); template.innerHTML = markup;
    const pre = template.content.firstElementChild; pre.dataset.highlighted = 'true';
    pre.dataset.highlightLanguage = node.dataset.highlightLanguage;
    node.replaceWith(pre);
  });
  for (const id of Object.keys(languages)) {
    const textarea = document.getElementById(id);
    if (textarea) enhance(textarea);
  }
}
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; refresh(); });
}
new MutationObserver(records => {
  if (records.some(record => !record.target.closest?.('.syntax-paint') &&
    (record.type === 'attributes' || record.removedNodes.length || [...record.addedNodes].some(node => node.nodeType === 1 && !node.matches('.syntax-editor, .syntax-paint, .th-code') && !node.closest('.syntax-paint'))))) schedule();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
// Programmatic textarea.value assignments do not emit DOM mutations.
document.addEventListener('click', schedule);
document.addEventListener('input', schedule);
refresh();

// Read-only JS samples can use exactly the same renderer.
export { highlightCode };

import { validateCss } from './validate-css.mjs';
window.FramecraftCssEditor = { validate: source => validateCss(source, (property, value) => CSS.supports(property, value)) };
