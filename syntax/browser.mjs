import { highlightCode } from './highlighter.mjs';

const editors = new WeakMap();
const languages = { domCapture: 'json', cssOutput: 'css', selectedCustomCss: 'css', domSceneCss: 'css', domPlayerKeyframes: 'css' };
function update(textarea) {
  const state = editors.get(textarea);
  if (!state || state.value === textarea.value) return;
  state.value = textarea.value;
  // The highlighter escapes all source text; no user HTML is injected directly.
  state.layer.innerHTML = highlightCode(textarea.value + '\n', languages[textarea.id]);
  sync(textarea);
}
function sync(textarea) {
  const layer = editors.get(textarea)?.layer;
  if (layer) { layer.scrollTop = textarea.scrollTop; layer.scrollLeft = textarea.scrollLeft; }
}
function enhance(textarea) {
  if (editors.has(textarea)) { update(textarea); return; }
  const box = document.createElement('div'); box.className = 'syntax-editor';
  const layer = document.createElement('div'); layer.className = 'syntax-paint'; layer.setAttribute('aria-hidden', 'true');
  textarea.before(box); box.append(layer, textarea);
  editors.set(textarea, { layer, value: null });
  textarea.classList.add('syntax-input');
  textarea.addEventListener('input', () => update(textarea));
  textarea.addEventListener('scroll', () => sync(textarea));
  update(textarea);
}
function refresh() {
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
    (record.type === 'attributes' || [...record.addedNodes].some(node => node.nodeType === 1 && !node.matches('.syntax-editor, .syntax-paint, .th-code') && !node.closest('.syntax-paint'))))) schedule();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
// Programmatic textarea.value assignments do not emit DOM mutations.
document.addEventListener('click', schedule);
document.addEventListener('input', schedule);
refresh();

// Read-only JS samples can use exactly the same renderer.
export { highlightCode };
