window.FramecraftKeyframes = (() => {
  const escapeName = name => name.replace(/[^a-z0-9-]/gi, '-');
  function format(source) {
    let output = '', quote = '', comment = false, depth = 0;
    for (let i = 0; i < source.length; i++) {
      const c = source[i], next = source[i + 1];
      output += c;
      if (comment) { if (c === '*' && next === '/') { output += next; i++; comment = false; } continue; }
      if (c === '\\') { if (next) { output += next; i++; } continue; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '/' && next === '*') { output += next; i++; comment = true; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ';' && !depth) { output += '\n'; while (/\s/.test(source[i + 1] || '') && i + 1 < source.length) i++; }
    }
    return output.trim();
  }
  function record(track, time, css, easing = 'linear') {
    const existing = track.keys.find(key => key.time === time);
    if (existing) Object.assign(existing, { css, easing });
    else track.keys.push({ time, css, easing });
    track.keys.sort((a, b) => a.time - b.time);
  }
  function valuesAt(track, time) {
    const values = {};
    for (const key of track.keys.filter(key => key.time <= time)) {
      const style = document.createElement('span').style; style.cssText = key.css;
      for (const property of style) values[property] = style.getPropertyValue(property);
    }
    return Object.entries(values).map(([key, value]) => `${key}: ${value};`).join('\n');
  }
  function compile(tracks, duration) {
    let output = '/* Toggle framecraft-entry on html. Keep the scene base styles and @property registrations. */\n';
    for (const track of tracks) {
      if (!track.keys.length) continue;
      const name = `fc-keyframes-${escapeName(track.id)}`;
      const frames = track.keys.map(key => `${Math.min(100, key.time / duration * 100)}% { ${valuesAt(track, key.time)} animation-timing-function: ${key.easing || 'linear'}; }`);
      if (track.keys.at(-1).time < duration) frames.push(`100% { ${valuesAt(track, duration)} }`);
      const idle = track.idle && track.idle !== 'none' ? track.idle + ', ' : '';
      output += `html.framecraft-entry ${track.selector} { transition: none; animation: ${idle}${name} ${duration}ms linear forwards; }\n@keyframes ${name} {\n${frames.join('\n')}\n}\n`;
    }
    return output;
  }
  return { record, valuesAt, compile, format };
})();
