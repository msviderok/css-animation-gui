import { highlighter } from './highlighter.mjs';
import { renderNodesToHtml, renderTokens } from '@tanstack/highlight/core';

// Tokenize the document once so comments and strings spanning lines keep their state.
export function tokenizeLines(source, lang) {
  const lines = [[]];
  for (const token of highlighter.tokenize(source, { lang }).tokens) {
    const parts = token.value.split('\n');
    parts.forEach((value, index) => {
      if (index) lines.push([]);
      if (value) lines.at(-1).push({ ...token, value });
    });
  }
  return lines;
}
export function renderLine(tokens) {
  return renderNodesToHtml(renderTokens(tokens)) || '\u200b';
}
