(() => {
  const $ = id => document.getElementById(id);
  // This runs in DevTools, where $0 is the element selected in the Elements panel.
  const capture = `(async () => {
  if (typeof $0 === 'undefined' || !($0 instanceof Element)) {
    console.error('Select a scene container in the Elements panel first.'); return;
  }
  // DevTools helpers must be captured before the first asynchronous operation.
  const selected = $0;
  const copyCapture = typeof copy === 'function' ? copy : null;
  const warnings = [], styles = [];
  for (const sheet of document.styleSheets) {
    try {
      const base = sheet.href || document.baseURI;
      let source = !sheet.href && sheet.ownerNode?.textContent;
      if (sheet.href) {
        try {
          let response = await fetch(sheet.href);
          if (!(response.headers.get('content-type') || '').includes('text/css')) {
            const direct = new URL(sheet.href); direct.searchParams.set('direct', '');
            response = await fetch(direct);
          }
          if (response.ok && (response.headers.get('content-type') || '').includes('text/css')) source = await response.text();
        } catch {}
      }
      if (!source) {
        source = Array.from(sheet.cssRules, rule => rule.cssText).join('\\n');
        if (sheet.cssRules.length) warnings.push('Stylesheet captured through CSSOM; some declarations may be incomplete: ' + base);
      }
      styles.push(source.replace(/url\\(\\s*(['"]?)([^)'"\\s]+)\\1\\s*\\)/gi, (match, quote, url) => {
        if (/^(data:|blob:|#)/i.test(url)) return match;
        try { return 'url("' + new URL(url, base).href.replace(/"/g, '%22') + '")'; } catch { warnings.push('Could not resolve asset: ' + url); return match; }
      }));
    }
    catch { warnings.push('Could not read stylesheet: ' + (sheet.href || 'inline stylesheet')); }
  }
  const root = selected.cloneNode(true);
  const player = selected.querySelector('.player[data-me="true"]');
  const markers = Array.from(selected.querySelectorAll('.marker'));
  const playerRect = player?.getBoundingClientRect();
  let chosenIndex = -1;
  if (playerRect && markers.length) {
    const px = playerRect.left + playerRect.width / 2, py = playerRect.top + playerRect.height / 2;
    chosenIndex = markers.reduce((best, marker, index) => {
      const distance = node => { const r = node.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - px, r.top + r.height / 2 - py); };
      return distance(marker) < distance(markers[best]) ? index : best;
    }, 0);
    root.querySelectorAll('.marker')[chosenIndex]?.setAttribute('data-framecraft-selected', '');
  }
  const markerRect = chosenIndex >= 0 ? markers[chosenIndex].getBoundingClientRect() : null;
  const focus = playerRect && markerRect ? { x: (playerRect.left + playerRect.width / 2 + markerRect.left + markerRect.width / 2) / 2, y: (playerRect.top + playerRect.bottom + markerRect.top + markerRect.bottom) / 4 } : null;
  root.querySelectorAll('script,iframe,object,embed').forEach(node => node.remove());
  let scene = root;
  for (let ancestor = selected.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const wrapper = ancestor.cloneNode(false); wrapper.appendChild(scene); scene = wrapper;
  }
  const assets = {}, urls = new Set();
  const addUrls = value => { for (const match of String(value).matchAll(/url\\(\\s*['"]?([^)'"\\s]+)['"]?\\s*\\)/gi)) { try { urls.add(new URL(match[1], document.baseURI).href); } catch {} } };
  for (const node of [selected, ...selected.querySelectorAll('*')]) {
    const computed = getComputedStyle(node);
    addUrls(computed.backgroundImage); addUrls(computed.maskImage); addUrls(computed.getPropertyValue('--bg-sprite'));
    if (node instanceof HTMLImageElement) urls.add(node.currentSrc || node.src);
  }
  for (const source of styles) for (const match of source.matchAll(/html\\.marker-enter[^{}]*\\.player[^{}]*\\{([^}]+)\\}/g)) addUrls(match[1]);
  const entryAssets = rules => { for (const rule of rules) { if (rule.selectorText?.includes('marker-enter') && rule.selectorText.includes('.player')) addUrls(rule.style.cssText); if (rule.cssRules) entryAssets(rule.cssRules); } };
  for (const sheet of document.styleSheets) { try { entryAssets(sheet.cssRules); } catch {} }
  let assetBytes = 0;
  for (const url of urls) {
    if (/^data:/i.test(url)) continue;
    try {
      const response = await fetch(url); if (!response.ok) throw new Error('HTTP ' + response.status);
      const blob = await response.blob();
      if (blob.size > 2 * 1024 * 1024 || assetBytes + blob.size > 20 * 1024 * 1024) throw new Error('asset size limit');
      assets[url] = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      assetBytes += blob.size;
    } catch { warnings.push('Add this asset manually: ' + url); }
  }
  const data = { format: 'framecraft-dom-capture', version: 1, url: document.baseURI,
    html: scene.outerHTML, styles: styles.join('\\n'), viewport: { width: innerWidth, height: innerHeight }, focus, markerRects: markers.map(node => node.getBoundingClientRect().toJSON()), playerRect: playerRect?.toJSON(), chosenIndex,
    htmlClass: document.documentElement.className, htmlStyle: document.documentElement.getAttribute('style') || '', bodyClass: document.body.className, bodyStyle: document.body.getAttribute('style') || '',
    warnings, assets };
  const output = JSON.stringify(data);
  if (copyCapture) copyCapture(output);
  else await navigator.clipboard.writeText(output);
  console.log('Framecraft capture copied.', warnings);
})()`;
  const markerChoice = document.createElement('select');
  markerChoice.id = 'domMarkerChoice'; markerChoice.setAttribute('aria-label', 'Marker to preview'); markerChoice.hidden = true;
  $('domPreviewControls').before(markerChoice);
  markerChoice.addEventListener('change', () => {
    try {
      const data = JSON.parse($('domCapture').value), index = Number(markerChoice.value);
      const doc = new DOMParser().parseFromString(data.html, 'text/html');
      doc.querySelectorAll('.marker').forEach((node, i) => node.toggleAttribute('data-framecraft-selected', i === index));
      const m = data.markerRects[index], p = data.playerRect;
      data.focus = { x: (p.left + p.width / 2 + m.left + m.width / 2) / 2, y: (p.top + p.bottom + m.top + m.bottom) / 4 };
      data.chosenIndex = index; data.html = doc.body.innerHTML;
      $('domCapture').value = JSON.stringify(data); $('previewDomCapture').click();
    } catch (error) { $('domImportStatus').textContent = error.message; }
  });
  const snippetDetails = document.createElement('details');
  snippetDetails.className = 'capture-source';
  const snippetSummary = document.createElement('summary'); snippetSummary.textContent = 'View capture snippet';
  const snippetCode = document.createElement('pre'); snippetCode.dataset.highlightLanguage = 'js'; snippetCode.textContent = capture;
  snippetDetails.append(snippetSummary, snippetCode); $('copyCaptureSnippet').after(snippetDetails);
  $('importDom').addEventListener('click', () => $('domImportDialog').showModal());
  $('closeDomImport').addEventListener('click', () => $('domImportDialog').close());
  $('copyCaptureSnippet').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(capture); $('domImportStatus').textContent = 'Snippet copied. Run it in your game’s DevTools Console.'; }
    catch { $('domImportStatus').textContent = 'Clipboard access failed. Open Framecraft on localhost and try again.'; }
  });
  $('domPlay').addEventListener('click', () => {
    const root = $('domCapturePreview').contentDocument?.documentElement;
    const name = $('domTrigger').value.trim().replace(/^\./, '');
    if (!root || !name || /\s/.test(name)) { $('domImportStatus').textContent = 'Enter a single trigger class.'; return; }
    root.classList.remove(name);
    void root.offsetWidth;
    root.classList.add(name);
  });
  $('domReset').addEventListener('click', () => {
    const root = $('domCapturePreview').contentDocument?.documentElement;
    const name = $('domTrigger').value.trim().replace(/^\./, '');
    if (root && name && !/\s/.test(name)) root.classList.remove(name);
  });
  $('useDomCapture').addEventListener('click', () => {
    try {
      const data = JSON.parse($('domCapture').value);
      if (data.format !== 'framecraft-dom-capture' || data.version !== 1 || typeof data.html !== 'string' || typeof data.styles !== 'string') throw new Error('This is not a supported Framecraft capture.');
      const html = new DOMParser().parseFromString(data.html, 'text/html');
      if (!html.querySelector('.marker-polygons') || !html.querySelector('.player[data-me="true"]')) throw new Error('This first version needs a scene containing the marker and player.');
      if (!window.confirm('Replace the current project with this captured scene?')) return;
      $('previewDomCapture').click();
      data.srcdoc = $('domCapturePreview').srcdoc;
      if (!data.srcdoc) throw new Error('Preview the scene first.');
      document.dispatchEvent(new CustomEvent('framecraft-import-dom', { detail: data }));
      $('domImportDialog').close();
    } catch (error) { $('domImportStatus').textContent = `Could not import capture: ${error.message}`; }
  });
  $('previewDomCapture').addEventListener('click', () => {
    try {
      const data = JSON.parse($('domCapture').value);
      if (data.format !== 'framecraft-dom-capture' || data.version !== 1 || typeof data.html !== 'string' || typeof data.styles !== 'string') throw new Error('This is not a supported Framecraft capture.');
      markerChoice.hidden = !data.markerRects?.length;
      if (data.markerRects?.length) {
        markerChoice.replaceChildren(...data.markerRects.map((_, index) => new Option(`Marker ${index + 1}`, String(index))));
        markerChoice.value = String(data.chosenIndex ?? 0);
      }
      const doc = new DOMParser().parseFromString(data.html, 'text/html');
      doc.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv]').forEach(node => node.remove());
      if (doc.querySelector('.marker[data-framecraft-selected]')) doc.querySelectorAll('.marker:not([data-framecraft-selected])').forEach(node => node.remove());
      doc.querySelectorAll('*').forEach(node => Array.from(node.attributes).forEach(attr => { if (/^on/i.test(attr.name)) node.removeAttribute(attr.name); }));
      const escapeAttr = value => String(value || '').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
      const base = new URL(data.url);
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('The capture needs an HTTP or HTTPS game URL.');
      let embeddedStyles = data.styles;
      for (const [url, value] of Object.entries(data.assets || {})) { if (typeof value === 'string' && value.startsWith('data:image/')) embeddedStyles = embeddedStyles.split(url).join(value); }
      doc.querySelectorAll('img').forEach(node => { const url = new URL(node.getAttribute('src') || '', base).href; if (data.assets?.[url]) { node.src = data.assets[url]; node.removeAttribute('srcset'); } });
      const css = (embeddedStyles + (data.focus ? '\n.marker:not([data-framecraft-selected]) { visibility: hidden !important; }' : '')).replace(/<\/style/gi, '<\\/style');
      const srcdoc = `<!doctype html><html class="${escapeAttr(data.htmlClass)}" style="${escapeAttr(data.htmlStyle)}"><head><base href="${escapeAttr(base.href)}"><style>${css}</style></head><body class="${escapeAttr(data.bodyClass)}" style="${escapeAttr(data.bodyStyle)}">${doc.body.innerHTML}</body></html>`;
      data.srcdoc = srcdoc;
      $('domCapturePreview').srcdoc = srcdoc;
      $('domCapturePreview').hidden = false;
      $('domPreviewControls').hidden = false;
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      $('domImportStatus').textContent = warnings.length ? `Preview loaded with capture warnings: ${warnings.join('; ')}` : 'Preview loaded. Check that the scene and its styles are visible.';
    } catch (error) { $('domImportStatus').textContent = `Could not load capture: ${error.message}`; }
  });
})();
