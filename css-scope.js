/* Preserve authored declarations rather than serializing them through CSSOM. */
window.FramecraftCssScope = (() => {
  function blocks(source) {
    const result = []; let start = 0, depth = 0, quote = '', comment = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i], next = source[i + 1];
      if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '\\') { i++; continue; }
      if (c === '/' && next === '*') { comment = true; i++; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (!depth) { result.push(source.slice(start, i + 1)); start = i + 1; } }
      if (c === ';' && !depth) { result.push(source.slice(start, i + 1)); start = i + 1; }
    }
    if (source.slice(start).trim()) result.push(source.slice(start));
    return result;
  }
  function split(source) {
    const targets = { marker: [], player: [] }, context = [];
    function visit(text) {
      const open = text.indexOf('{');
      if (open < 0) { context.push(text); return; }
      const head = text.slice(0, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (/^@(layer|media|supports|container)\b/.test(head) || (!head.startsWith('@') && !/\.(marker|player)/.test(head) && /\.(marker|player)/.test(text.slice(open + 1)))) {
        const nested = split(text.slice(open + 1, text.lastIndexOf('}')));
        if (nested.context.trim()) context.push(`${text.slice(0, open + 1)}${nested.context}}`);
        for (const key of Object.keys(targets)) if (nested[key].trim()) targets[key].push(`${text.slice(0, open + 1)}${nested[key]}}`);
        return;
      }
      if (!head.startsWith('@') && /\.player(?:[\w-]*)(?![\w-])/.test(head)) targets.player.push(text);
      else if (!head.startsWith('@') && /\.marker(?:[\w-]*)(?![\w-])/.test(head)) targets.marker.push(text);
      else context.push(text);
    }
    blocks(source).forEach(visit);
    // Keyframes and typed variables belong with the target that references them.
    let shared = context.join('\n');
    for (const text of blocks(shared)) {
      const head = text.slice(0, text.indexOf('{')).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const match = /^@(keyframes|property)\s+([^\s{]+)/.exec(head);
      if (!match) continue;
      for (const key of Object.keys(targets)) {
        const content = targets[key].join('\n');
        const name = match[2];
        if (content.includes(name) || (key === 'marker' && ['spinY', 'flactuateHeight', 'blinkBright'].includes(name))) targets[key].push(text);
      }
    }
    return { context: shared, marker: targets.marker.join('\n'), player: targets.player.join('\n') };
  }
  return { split };
})();
