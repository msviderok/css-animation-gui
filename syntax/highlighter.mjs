import { createHighlighter } from '@tanstack/highlight/core';
import { css } from '@tanstack/highlight/languages/css';
import { js } from '@tanstack/highlight/languages/js';
import { json } from '@tanstack/highlight/languages/json';

// One synchronous registry for server rendering and the browser bundle.
export const highlighter = createHighlighter({ languages: [css, js, json] });
export function highlightCode(code, lang = 'css', options = {}) {
  return highlighter.highlight(code, { ...options, lang }).html;
}
