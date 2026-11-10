(() => {
  const timelineLabelWidth = 210;
  const colors = ['#a293ff', '#80aaff', '#ffbf78', '#f08da4', '#6dd4c0'];
  const makeId = () => `id-${Math.random().toString(36).slice(2, 9)}`;
  const clip = (elementId, enabled = true) => ({ elementId, enabled, start: 0, end: 3, opacityFrom: 1, opacityTo: 1, xFrom: 0, xTo: 0, yFrom: 0, yTo: 0, borderFrom: 0, borderTo: 0, borderColor: '#b5f36c', customCss: '' });
  let state = {
    name: 'Untitled choreography', className: 'is-playing', loop: false,
    elements: [], phases: [],
    selectedElement: null, selectedPhase: null, inspectorTab: 'element', playing: false,
    previewZoom: 200, previewPanX: 0, previewPanY: 0, currentFrame: 0, playheadMs: 0,
  };
  let activeAnimations = [];
  let deletedPhases = [];
  let playbackRaf = 0;
  let toastTimer;
  let contextTarget = null;
  let panDrag = null;
  let frameDrag = null;
  let rangeShiftHeld = false;
  let sequenceDrag = null;
  let playheadHovered = false;
  let timeScrub = null;
  let suppressTimeClickUntil = 0;
  let autosaveTimer = 0;
  let autosaveDbPromise = null;
  let restoringAutosave = true;
  let suppressAutosave = false;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const el = (id) => state.elements.find((item) => item.id === id);
  const phase = (id = state.selectedPhase) => state.phases.find((item) => item.id === id);
  const currentElement = () => el(state.selectedElement) || state.elements[0];
  const currentPhase = () => phase() || state.phases[0];
  const getClip = (phaseId = state.selectedPhase, elementId = state.selectedElement) => {
    const p = phase(phaseId);
    if (!p) return null;
    let c = p.clips.find((item) => item.elementId === elementId);
    if (!c) { c = clip(elementId, false); p.clips.push(c); }
    return c;
  };
  const frameCount = (item) => item?.imageWidth && item.frameWidth ? Math.max(1, Math.floor(item.imageWidth / item.frameWidth)) : 1;
  const lastFrame = (item) => frameCount(item) - 1;
  const canAddPhase = () => {
    if (!state.phases.length) return state.elements.length > 0;
    const last = state.phases[state.phases.length - 1];
    return !state.elements.length || !state.elements.every((item) => {
      const c = last.clips.find((entry) => entry.elementId === item.id);
      return c?.enabled && Number(c.end) >= lastFrame(item);
    });
  };
  const totalMs = () => state.phases.reduce((sum, p) => sum + Number(p.duration || 0) + Number(p.wait || 0), 0);
  const fmtTime = (ms) => `${(Number(ms || 0) / 1000).toFixed(1)}s`;
  const toast = (message) => { const node = $('toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2200); };
  const escapeCssUrl = (s) => String(s).replace(/[\\"\n\r]/g, (c) => `\\${c}`);
  const ensureClip = (p, item) => {
    let c = p.clips.find((entry) => entry.elementId === item.id);
    if (!c) { c = clip(item.id, false); p.clips.push(c); }
    const max = frameCount(item) - 1;
    if (item.image) { c.start = Math.min(Math.max(Number(c.start) || 0, 0), max); c.end = Math.min(Math.max(Number(c.end) || 0, 0), max); }
    return c;
  };
  function normalizeFrameContinuity() {
    state.phases.forEach((p) => state.elements.forEach((item) => {
      const c = ensureClip(p, item);
      if (Number(c.end) < Number(c.start)) c.end = c.start;
    }));
  }

  function autosaveData() {
    return { format: 'framecraft-project', version: 1, name: state.name, className: state.className, loop: state.loop,
      defaultDuration: state.defaultDuration ?? null, domScene: state.domScene || null, previewZoom: state.previewZoom, previewPanX: state.previewPanX, previewPanY: state.previewPanY, currentFrame: state.currentFrame,
      selectedElement: state.selectedElement, selectedPhase: state.selectedPhase, inspectorTab: state.inspectorTab, elements: state.elements, phases: state.phases };
  }
  function openAutosaveDb() {
    if (autosaveDbPromise) return autosaveDbPromise;
    autosaveDbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const request = indexedDB.open('framecraft-autosave', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects', { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open autosave database'));
    });
    return autosaveDbPromise;
  }
  function setPersistenceStatus(message) {
    const node = $('persistenceStatus');
    if (!node) return;
    node.dataset.state = /failed/i.test(message) ? 'error' : /Saving|Checking/.test(message) ? 'pending' : 'saved';
    node.innerHTML = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7"/>${node.dataset.state === 'error' ? '<path d="M10 5v6m0 2v1"/>' : node.dataset.state === 'pending' ? '<path d="M10 5v5l3 2"/>' : '<path d="m6 10 3 3 5-6"/>'}</svg>`;
    node.setAttribute('aria-label', message); node.title = message;
    if (node.dataset.tooltipTitle !== undefined) node.dataset.tooltipTitle = message;
  }
  async function writeAutosave(data) {
    try {
      const db = await openAutosaveDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: 'current', data });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Autosave aborted'));
      });
      setPersistenceStatus('Autosaved locally');
    } catch {
      try { localStorage.setItem('framecraft-autosave-fallback', JSON.stringify(data)); setPersistenceStatus('Autosaved locally'); }
      catch { setPersistenceStatus('Autosave failed'); }
    }
  }
  async function readAutosave() {
    try {
      const db = await openAutosaveDb();
      const record = await new Promise((resolve, reject) => {
        const request = db.transaction('projects', 'readonly').objectStore('projects').get('current');
        request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
      });
      if (record?.data) return record.data;
    } catch {}
    try { return JSON.parse(localStorage.getItem('framecraft-autosave-fallback') || 'null'); } catch { return null; }
  }
  function scheduleAutosave() {
    if (restoringAutosave || suppressAutosave) return;
    clearTimeout(autosaveTimer);
    setPersistenceStatus('Saving locally…');
    autosaveTimer = setTimeout(() => writeAutosave(autosaveData()), 180);
  }
  async function clearAutosave() {
    clearTimeout(autosaveTimer);
    try {
      const db = await openAutosaveDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').delete('current');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } catch {}
    try { localStorage.removeItem('framecraft-autosave-fallback'); } catch {}
  }
  function flushAutosave() {
    if (restoringAutosave || suppressAutosave) return;
    clearTimeout(autosaveTimer);
    void writeAutosave(autosaveData());
  }
  async function restoreAutosave() {
    const data = await readAutosave();
    const valid = data?.format === 'framecraft-project' && Array.isArray(data.elements) && Array.isArray(data.phases);
    if (valid) {
      state = { ...state, name: data.name || 'Untitled choreography', className: data.className || 'is-playing', loop: !!data.loop,
        previewZoom: 200, previewPanX: 0, previewPanY: 0,
        elements: data.elements.map((item) => ({ ...item, position: 50 })), phases: data.phases, domScene: data.domScene || null, defaultDuration: Number.isFinite(data.defaultDuration) && data.defaultDuration >= 0 ? data.defaultDuration : null,
        selectedElement: data.elements.some((item) => item.id === data.selectedElement) ? data.selectedElement : data.elements[0]?.id || null,
        selectedPhase: data.phases.some((item) => item.id === data.selectedPhase) ? data.selectedPhase : data.phases[0]?.id || null,
        inspectorTab: data.inspectorTab === 'element' ? 'element' : data.phases.length ? 'clip' : 'element',
        currentFrame: Math.max(0, Number(data.currentFrame) || 0), playing: false, playheadMs: 0 };
      setPersistenceStatus('Restored local project');
    }
    render();
    restoringAutosave = false;
    if (!valid) setPersistenceStatus('New project');
  }
  async function discardProject() {
    if (!window.confirm('Discard this project and its saved browser copy? This cannot be undone.')) return;
    await clearAutosave();
    deletedPhases = [];
    suppressAutosave = true;
    state = { name: 'Untitled choreography', className: 'is-playing', loop: false, elements: [], phases: [], selectedElement: null, selectedPhase: null, inspectorTab: 'element', playing: false, previewZoom: 200, previewPanX: 0, previewPanY: 0, currentFrame: 0, playheadMs: 0 };
    cancelPlayback(); render(); suppressAutosave = false;
    setPersistenceStatus('Project discarded');
  }

  function render() {
    syncAuthoringPhaseTimes();
    normalizeFrameContinuity();
    normalizeEffectContinuity();
    $('projectName').value = state.name;
    updateLoopUI();
    updatePhaseAddButtons();
    $('totalDuration').textContent = `${fmtTime(totalMs())} total`;
    $('timeline').innerHTML = renderTimeline();
    renderSelectedControls();
    $('frameControls').innerHTML = state.domScene ? '' : renderFrameControls();
    $('domTimelineTools').innerHTML = state.domScene ? renderDomAuthoring() : '';
    renderActors();
    updateZoomUI();
    updateFrameTimelineUI();
    setActorFrame(currentElement(), state.currentFrame);
    updatePlayheadUI();
    updatePreviewButtons();
    scheduleAutosave();
  }

  function updatePhaseAddButtons() {
    ['addPhaseTop'].forEach((id) => { const button = $(id); button.disabled = !state.elements.length; button.title = button.disabled ? 'Add an element first' : 'Insert phase after selection (Shift+P)'; });
  }

  const playheadTooltip = document.createElement('div');
  playheadTooltip.className = 'instant-tooltip playhead-tooltip'; playheadTooltip.hidden = true;
  playheadTooltip.setAttribute('role', 'tooltip'); document.body.appendChild(playheadTooltip);
  function showPlayheadTooltip() {
    const thumb = document.querySelector('[data-sequence-playhead]');
    if (!thumb) { playheadTooltip.hidden = true; return; }
    playheadTooltip.textContent = `${formatPhaseTime(Math.round(state.playheadMs))} · Frame ${state.domScene?.authoring ? authoringFrame(state.playheadMs) : sequenceFrameAt(currentElement(), state.playheadMs)}`;
    playheadTooltip.hidden = false;
    const rect = thumb.getBoundingClientRect(), tip = playheadTooltip.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - tip.width - 4, rect.left + rect.width / 2 - tip.width / 2));
    playheadTooltip.style.left = `${left}px`;
    playheadTooltip.style.top = `${Math.max(4, Math.min(window.innerHeight - tip.height - 4, rect.bottom + 9))}px`;
    playheadTooltip.dataset.placement = 'bottom';
    playheadTooltip.style.setProperty('--tooltip-arrow-x', `${Math.max(10, Math.min(tip.width - 10, rect.left + rect.width / 2 - left))}px`);
  }
  function sequenceTimeFromPointer(clientX) {
    const timeline = document.querySelector('#timeline .timeline');
    if (!timeline) return 0;
    const rect = timeline.getBoundingClientRect(), scale = rect.width / timeline.offsetWidth || 1;
    let position = Math.max(0, (clientX - rect.left) / scale - timelineLabelWidth), elapsed = 0;
    const metrics = timelineMetrics();
    for (let i = 0; i < state.phases.length; i++) {
      const p = state.phases[i], width = metrics.phaseWidths[i], gap = metrics.waitWidths[i];
      if (position <= width) return elapsed + Number(p.duration) * position / width;
      position -= width; elapsed += Number(p.duration);
      if (gap && position <= gap) return elapsed + Number(p.wait) * position / gap;
      position -= gap; elapsed += Number(p.wait);
    }
    return totalMs();
  }
  document.addEventListener('pointerdown', (event) => {
    const ruler = event.target.closest('[data-time-ruler]');
    const thumb = ruler || event.target.closest('[data-sequence-playhead]');
    if (!thumb || event.button !== 0) return;
    event.preventDefault(); thumb.focus(); hideInstantTooltip();
    const rect = thumb.getBoundingClientRect();
    sequenceDrag = { thumb, pointerId: event.pointerId, grabOffset: ruler ? 0 : event.clientX - (rect.left + rect.width / 2) };
    thumb.setPointerCapture(event.pointerId);
    if (ruler) seekSequence(sequenceTimeFromPointer(event.clientX));
    showPlayheadTooltip();
  });
  document.addEventListener('pointermove', (event) => {
    if (!sequenceDrag || sequenceDrag.pointerId !== event.pointerId) return;
    seekSequence(sequenceTimeFromPointer(event.clientX - sequenceDrag.grabOffset)); showPlayheadTooltip();
  });
  const endSequenceDrag = (event) => {
    if (!sequenceDrag || sequenceDrag.pointerId !== event.pointerId) return;
    const { thumb } = sequenceDrag; sequenceDrag = null;
    if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
    playheadHovered = !!document.querySelector('[data-sequence-playhead]')?.matches(':hover'); playheadTooltip.hidden = !playheadHovered;
  };
  document.addEventListener('pointerup', endSequenceDrag);
  document.addEventListener('pointercancel', endSequenceDrag);
  document.addEventListener('pointerover', (event) => { if (event.target.closest('[data-sequence-playhead]')) { playheadHovered = true; showPlayheadTooltip(); } });
  document.addEventListener('pointerout', (event) => { if (event.target.closest('[data-sequence-playhead]')) { playheadHovered = false; if (!sequenceDrag) playheadTooltip.hidden = true; } });
  document.addEventListener('focusin', (event) => { if (event.target.closest('[data-sequence-playhead]')) showPlayheadTooltip(); });
  document.addEventListener('focusout', (event) => { if (event.target.closest('[data-sequence-playhead]') && !sequenceDrag && !playheadHovered) playheadTooltip.hidden = true; });

  function timelineMetrics() {
    const phaseWidths = state.phases.map(() => 210);
    const waitWidths = state.phases.map((p) => Number(p.wait) > 0 ? 48 : 0);
    return { phaseWidths, waitWidths, totalWidth: phaseWidths.reduce((a, b) => a + b, 0) + waitWidths.reduce((a, b) => a + b, 0) };
  }
  function updateTimelineWaitLayout() {
    const metrics = timelineMetrics();
    const updateGap = (anchor, index, ruler) => {
      const className = ruler ? 'ruler-gap' : 'phase-gap';
      let gap = anchor.nextElementSibling?.classList.contains(className) ? anchor.nextElementSibling : null;
      const width = metrics.waitWidths[index];
      if (!width) { gap?.remove(); return; }
      if (!gap) {
        gap = document.createElement(ruler ? 'div' : 'span'); gap.className = className;
        if (!ruler) gap.innerHTML = '<span class="sleep-icon" aria-hidden="true">zᶻᶻ</span>';
        anchor.after(gap);
      }
      gap.style.width = `${width}px`; gap.style.flex = `0 0 ${width}px`;
      if (ruler) {
        let text = gap.querySelector('.ruler-gap-label');
        if (!text) { text = document.createElement('span'); text.className = 'ruler-gap-label'; gap.appendChild(text); }
        text.textContent = `wait ${formatPhaseTime(state.phases[index].wait)}`;
      }
      const label = `${state.phases[index].wait}ms wait`;
      gap.title = label; gap.setAttribute('aria-label', label);
      if (gap.dataset.tooltipTitle !== undefined) gap.dataset.tooltipTitle = label;
    };
    const ruler = document.querySelector('#timeline .ruler-track');
    if (ruler) {
      ruler.style.width = `${metrics.totalWidth}px`;
      ruler.querySelectorAll('.phase-ruler-cell').forEach((cell, index) => updateGap(cell, index, true));
    }
    document.querySelectorAll('#timeline .track-lane').forEach((lane) => {
      lane.style.width = `${metrics.totalWidth}px`;
      lane.querySelectorAll('.track-clip').forEach((clip, index) => {
        updateGap(clip, index, false);
        clip.classList.toggle('joins-prev', index > 0 && !metrics.waitWidths[index - 1]);
        clip.classList.toggle('joins-next', index < state.phases.length - 1 && !metrics.waitWidths[index]);
      });
    });
  }
  function timelineOffset(time, metrics = timelineMetrics()) {
    let elapsed = 0, offset = 0;
    for (let i = 0; i < state.phases.length; i++) {
      const p = state.phases[i], duration = Math.max(0, Number(p.duration)), waitMs = Math.max(0, Number(p.wait));
      if (time <= elapsed + duration) return offset + metrics.phaseWidths[i] * (duration ? Math.max(0, time - elapsed) / duration : 1);
      offset += metrics.phaseWidths[i]; elapsed += duration;
      if (time <= elapsed + waitMs) return offset + metrics.waitWidths[i] * (waitMs ? Math.max(0, time - elapsed) / waitMs : 0);
      offset += metrics.waitWidths[i]; elapsed += waitMs;
    }
    return metrics.totalWidth;
  }

  const authoringFrame = time => Math.round(Number(time) * 60 / 1000);
  function authoringFrameTicks(metrics) {
    const frames = authoringFrame(totalMs());
    const desired = Math.max(1, frames / Math.max(1, metrics.totalWidth / 14));
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].find(n => n >= desired) || Math.ceil(desired / 600) * 600;
    const ticks = [];
    let lastLabel = -Infinity;
    for (let frame = 0; frame <= frames; frame += step) {
      const x = timelineOffset(frame * 1000 / 60, metrics);
      const label = x - lastLabel >= 62;
      if (label) lastLabel = x;
      ticks.push(`<span class="frame-ruler-tick ${label ? 'major' : ''}" style="left:${x}px">${label ? `<span>F${frame}</span>` : ''}</span>`);
    }
    if (metrics.totalWidth - lastLabel >= 40) ticks.push(`<span class="frame-ruler-tick major" style="left:${metrics.totalWidth}px"><span>F${frames}</span></span>`);
    return ticks.join('');
  }
  function timelineTimeTicks(metrics = timelineMetrics()) {
    const ticks = []; let elapsed = 0, offset = 0;
    const add = (x, time, major) => {
      const last = ticks[ticks.length - 1];
      if (last && Math.abs(last.x - x) < .01) { last.major ||= major; return; }
      ticks.push({ x, time, major });
    };
    state.phases.forEach((p, index) => {
      for (const [duration, width] of [[Number(p.duration), metrics.phaseWidths[index]], [Number(p.wait), metrics.waitWidths[index]]]) {
        if (!width) continue;
        add(offset, elapsed, true);
        if (duration > 0) {
          const desired = duration / Math.max(1, width / 12), power = 10 ** Math.floor(Math.log10(desired));
          const step = [1, 2, 5, 10].map((n) => n * power).find((n) => n >= desired);
          for (let i = 1; i * step < duration; i++) add(offset + i * step / duration * width, elapsed + i * step, i % 5 === 0);
        }
        offset += width; elapsed += duration; add(offset, elapsed, true);
      }
    });
    let lastLabel = -Infinity;
    return ticks.map((tick) => {
      const labeled = tick.major && tick.x - lastLabel >= 58;
      if (labeled) lastLabel = tick.x;
      return `<span aria-hidden="true" class="time-tick ${tick.major ? 'major' : ''}" style="left:${tick.x}px">${labeled ? `<span>${formatPhaseTime(Math.round(tick.time))}</span>` : ''}</span>`;
    }).join('') + (state.domScene?.authoring ? authoringFrameTicks(metrics) : '');
  }
  function updateTimelineTimeRuler() {
    const ruler = document.querySelector('[data-time-ruler]'); if (!ruler) return;
    const metrics = timelineMetrics(); ruler.style.width = `${metrics.totalWidth}px`; ruler.innerHTML = timelineTimeTicks(metrics);
  }

  function proportionalTimings(phases, target) {
    const original = phases.reduce((sum, p) => sum + Number(p.duration) + Number(p.wait), 0);
    let cumulative = 0, allocated = 0;
    return phases.map((p, index) => {
      const result = { id: p.id };
      for (const key of ['duration', 'wait']) {
        cumulative += original ? Number(p[key]) : key === 'duration' ? 1 : 0;
        const end = Math.round(cumulative / (original || phases.length) * target * 1000) / 1000;
        result[key] = Math.round((end - allocated) * 1000) / 1000; allocated = end;
      }
      return result;
    });
  }
  function timingValue(node) {
    return node.hasAttribute('data-total-time') ? totalMs() : Number(phase(node.dataset.phase)?.[node.dataset.phaseTime]) || 0;
  }
  function refreshTimingControls() {
    document.querySelectorAll('[data-phase-value]').forEach((input) => {
      const p = phase(input.dataset.phase); if (!p) return;
      const value = Number(p[input.dataset.phaseValue]);
      input.value = Math.max(0, Math.min(1000, value));
      const scrubbing = !!timeScrub && (timeScrub.node.hasAttribute('data-total-time') || (timeScrub.node.dataset.phase === input.dataset.phase && timeScrub.node.dataset.phaseTime === input.dataset.phaseValue));
      const custom = scrubbing || value > 1000 || value % 50 !== 0;
      input.parentElement.classList.toggle('is-custom', custom);
      const output = input.parentElement.querySelector('[data-phase-time]');
      if (output) {
        output.textContent = formatPhaseTime(value);
        const hint = `Double-click to edit · Shift-drag vertically · Command for 50ms steps · Option-click to reset${custom ? ' · custom value' : ''}`;
        output.title = hint; if (output.dataset.tooltipTitle !== undefined) output.dataset.tooltipTitle = hint;
      }
    });
    updateTimelineWaitLayout(); updateTimelineTimeRuler(); updatePlayheadUI(); updatePreviewButtons();
    $('totalDuration').textContent = `${formatPhaseTime(totalMs())} total`; scheduleAutosave();
  }
  function applyTimingValue(node, value, baseline) {
    if (!Number.isFinite(value) || value < 0) return;
    if (state.playing || activeAnimations.length) cancelPlayback();
    if (node.hasAttribute('data-total-time')) {
      const oldTotal = totalMs(), progress = oldTotal ? state.playheadMs / oldTotal : 0;
      proportionalTimings(baseline || state.phases, value).forEach((timing) => {
        const p = phase(timing.id); if (p) { p.duration = timing.duration; p.wait = timing.wait; }
      });
      state.playheadMs = progress * totalMs();
    } else {
      const p = phase(node.dataset.phase); if (!p) return;
      p[node.dataset.phaseTime] = value;
    }
    refreshTimingControls();
  }
  $('setDefaultDuration').addEventListener('click', () => {
    if (!state.phases.length) return;
    state.defaultDuration = totalMs();
    updatePlayheadUI(); scheduleAutosave();
    toast(`${formatPhaseTime(state.defaultDuration)} saved as default duration`);
  });
  function beginTimingEdit(node) {
    if (!state.phases.length || node.querySelector('input')) return;
    if (state.playing || activeAnimations.length) { cancelPlayback(); updatePreviewButtons(); }
    const input = document.createElement('input'); input.className = 'timing-inline-input'; input.type = 'text'; input.value = formatPhaseTime(timingValue(node));
    input.setAttribute('aria-label', node.hasAttribute('data-total-time') ? 'Total animation duration' : `Phase ${node.dataset.phaseTime}`);
    node.classList.add('is-editing-time'); node.appendChild(input); input.focus(); input.select();
    let cancelled = false;
    input.addEventListener('keydown', (event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); input.blur(); } if (event.key === 'Escape') { cancelled = true; input.blur(); } });
    input.addEventListener('blur', () => {
      const match = input.value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i);
      input.remove(); node.classList.remove('is-editing-time');
      const value = match ? Number(match[1]) * (match[2]?.toLowerCase() === 's' ? 1000 : 1) : NaN;
      if (!cancelled && Number.isFinite(value)) applyTimingValue(node, value);
      else if (!cancelled) toast('Enter a time such as 3200ms or 10s');
    }, { once: true });
  }
  document.addEventListener('click', (event) => {
    const node = event.target.closest('[data-total-time], [data-phase-time]');
    if (!node || event.target.matches('input')) return;
    if (event.altKey || event.shiftKey || Date.now() < suppressTimeClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (node.hasAttribute('data-total-time')) { event.preventDefault(); beginTimingEdit(node); }
  }, true);
  document.addEventListener('keydown', (event) => {
    const node = event.target.closest('[data-total-time]');
    if (node && !event.target.matches('input') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); beginTimingEdit(node); }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('[data-phase-time], [data-total-time]');
    if (!node || !event.shiftKey || event.altKey || event.button !== 0 || event.target.matches('input') || !state.phases.length) return;
    event.preventDefault(); event.stopImmediatePropagation(); hideInstantTooltip();
    if (state.playing || activeAnimations.length) { cancelPlayback(); updatePreviewButtons(); }
    timeScrub = { node, pointerId: event.pointerId, y: event.clientY, remainder: 0, baseline: state.phases.map((p) => ({ id: p.id, duration: p.duration, wait: p.wait })) };
    node.setPointerCapture(event.pointerId); document.body.classList.add('is-scrubbing-time');
    refreshTimingControls();
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!timeScrub || timeScrub.pointerId !== event.pointerId) return;
    timeScrub.remainder += timeScrub.y - event.clientY; timeScrub.y = event.clientY;
    const steps = Math.trunc(timeScrub.remainder / 3);
    if (!steps) return;
    timeScrub.remainder -= steps * 3;
    applyTimingValue(timeScrub.node, Math.max(0, timingValue(timeScrub.node) + steps * (event.metaKey ? 50 : 10)), timeScrub.baseline);
  });
  function endTimeScrub(event) {
    if (!timeScrub || timeScrub.pointerId !== event.pointerId) return;
    const { node } = timeScrub; timeScrub = null; suppressTimeClickUntil = Date.now() + 300;
    document.body.classList.remove('is-scrubbing-time');
    refreshTimingControls();
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
  }
  document.addEventListener('contextmenu', (event) => { if (timeScrub) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  document.addEventListener('pointerup', endTimeScrub);
  document.addEventListener('pointercancel', endTimeScrub);

  function formatPhaseTime(value) {
    const ms = Number(value) || 0;
    return ms >= 1000 ? `${Number((ms / 1000).toFixed(3))}s` : `${ms}ms`;
  }
  function phaseTimingControl(p, key, label) {
    const value = Number(p[key]) || 0;
    const custom = value > 1000 || value % 50 !== 0;
    return `<label class="phase-time-control ${custom ? 'is-custom' : ''}"><span>${label}</span><input type="range" min="0" max="1000" step="50" value="${Math.min(1000, value)}" data-phase-value="${key}" data-phase="${p.id}" aria-label="${esc(p.name)} ${key}"><output data-phase-time="${key}" data-phase="${p.id}" title="Double-click to edit · Shift-drag vertically · Command for 50ms steps · Option-click to reset${custom ? ' · custom value' : ''}">${formatPhaseTime(value)}</output></label>`;
  }

  function renderTimeline() {
    if (!state.elements.length) return '<div class="timeline-empty">Add a sprite to start your sequence.</div>';
    const metrics = timelineMetrics(), widths = metrics.phaseWidths;
    const sum = metrics.totalWidth;
    const ruler = `<div class="timeline-ruler"><div class="ruler-label">ELEMENT / TIME</div><div class="ruler-track" style="width:${sum}px">${state.phases.map((p, i) => `<div class="ruler-cell phase-ruler-cell" style="width:${widths[i]}px;flex:0 0 ${widths[i]}px"><button class="phase-name-edit" data-phase-name="${p.id}" title="Double-click to rename">${esc(p.name)}</button><div class="phase-ruler-controls">${phaseTimingControl(p, 'duration', 'PLAY')}${phaseTimingControl(p, 'wait', 'WAIT')}</div></div>${metrics.waitWidths[i] ? `<div class="ruler-gap" style="width:${metrics.waitWidths[i]}px;flex:0 0 ${metrics.waitWidths[i]}px"><span class="ruler-gap-label">wait ${formatPhaseTime(p.wait)}</span></div>` : ''}`).join('')}</div></div>`;
    const rows = state.elements.map((item, ei) => `<div class="phase-track-row"><div class="track-name"><span class="track-color" style="background:${colors[ei % colors.length]}"></span><span class="track-label"><span data-element-edit="name" data-element-id="${item.id}" title="Double-click to edit">${esc(item.name)}</span><small data-element-edit="selector" data-element-id="${item.id}" title="Double-click to edit">${esc(item.selector)}</small></span>${ei > 0 || item.kind === 'dom' ? `<button class="timeline-element-action delete-button" data-action="delete-element" data-id="${item.id}" title="Delete ${esc(item.name)}" aria-label="Delete ${esc(item.name)}">×</button>` : ''}</div><div class="track-lane" style="width:${sum}px">${state.phases.map((p, pi) => {
      const c = ensureClip(p, item);
      return `<button class="track-clip ${c.deleted ? 'removed-clip' : ''} ${pi > 0 && !metrics.waitWidths[pi - 1] ? 'joins-prev' : ''} ${pi < state.phases.length - 1 && !metrics.waitWidths[pi] ? 'joins-next' : ''} ${c.enabled ? '' : 'inactive'} ${!c.deleted && p.id === state.selectedPhase && item.id === state.selectedElement ? 'selected' : ''}" style="width:${widths[pi]}px;flex:0 0 ${widths[pi]}px" data-action="${c.deleted ? 'restore-clip' : 'select-clip'}" data-context="clip" data-phase="${p.id}" data-element="${item.id}" title="${c.deleted ? 'Add clip: ' : ''}${esc(item.name)} · ${esc(p.name)}"><span>${c.deleted ? '+' : c.enabled ? `${item.kind === 'dom' ? 'CSS' : `${c.start}–${c.end} <span class="clip-frames">FR</span>`}` : '— inactive'}</span></button>${metrics.waitWidths[pi] ? `<span class="phase-gap" style="width:${metrics.waitWidths[pi]}px;flex:0 0 ${metrics.waitWidths[pi]}px" title="${p.wait}ms wait" aria-label="${p.wait}ms wait"><span class="sleep-icon" aria-hidden="true">zᶻᶻ</span></span>` : ''}`;
    }).join('')}</div></div>`).join('');
    const boundaries = state.phases.length ? `<div class="playback-range" data-playback-range style="left:${timelineLabelWidth}px;width:${sum}px" aria-hidden="true"></div><div class="playback-boundary playback-start" style="left:${timelineLabelWidth}px" aria-hidden="true"><span>Start · 0ms</span></div><div class="playback-boundary playback-end" data-playback-end style="left:${timelineLabelWidth + sum}px" aria-hidden="true"><span>End · ${formatPhaseTime(totalMs())}</span></div>` : '';
    return `<div class="timeline ${state.domScene?.authoring ? 'has-frame-ruler' : ''}">${boundaries}${ruler}${rows}<div class="timeline-time-ruler" data-time-ruler role="slider" tabindex="0" aria-label="Timeline position" aria-valuemin="0" aria-valuemax="${totalMs()}" aria-valuenow="${state.playheadMs}" style="left:${timelineLabelWidth}px;width:${sum}px">${timelineTimeTicks(metrics)}</div><div id="timelinePlayhead" class="timeline-playhead" style="left:${timelineLabelWidth + timelineOffset(state.playheadMs, metrics)}px"><button class="playhead-thumb" data-sequence-playhead type="button" role="slider" aria-label="Sequence playhead" aria-valuemin="0" aria-valuemax="${totalMs()}" aria-valuenow="${state.playheadMs}">${formatPhaseTime(Math.round(state.playheadMs))}</button></div></div>`;
  }

  function updateZoomUI() {
    const scene = $('stageScene');
    if (scene) scene.style.transform = `translate3d(${state.previewPanX}px, ${state.previewPanY}px, 0) scale(${state.previewZoom / 100})`;
    $('stage').classList.toggle('can-pan', state.previewZoom > 100);
    if ($('zoomReset')) $('zoomReset').textContent = `${state.previewZoom}%`;
    if ($('zoomOut')) $('zoomOut').disabled = state.previewZoom <= 50;
    if ($('zoomIn')) $('zoomIn').disabled = state.previewZoom >= 200;
  }
  function updatePlayheadUI() {
    const total = totalMs();
    state.playheadMs = Math.max(0, Math.min(total, Number(state.playheadMs) || 0));
    const scrubber = $('sequenceScrubber');
    if (!scrubber) return;
    scrubber.step = state.domScene?.authoring ? 'any' : '10';
    scrubber.max = String(total);
    scrubber.value = String(state.playheadMs);
    scrubber.disabled = total <= 0;
    $('setDefaultDuration').disabled = !state.phases.length;
    $('setDefaultDuration').classList.toggle('is-default', state.defaultDuration != null && Math.abs(state.defaultDuration - total) < .001);
    $('sequenceTimeLabel').textContent = state.domScene?.authoring ? formatPhaseTime(Math.round(state.playheadMs)) : fmtTime(state.playheadMs);
    document.querySelectorAll('[data-animation-frame]').forEach(node => { node.textContent = `Frame ${authoringFrame(state.playheadMs)} / ${authoringFrame(total)} · 60 fps`; });
    $('sequenceTotalLabel').textContent = formatPhaseTime(total);
    $('sequenceTotalLabel').setAttribute('aria-disabled', String(!state.phases.length));
    let elapsed = 0;
    const playingPhase = state.playing ? state.phases.find((p, index) => {
      elapsed += Number(p.duration) + Number(p.wait);
      return state.playheadMs < elapsed || index === state.phases.length - 1;
    }) : null;
    document.querySelector('#timeline .timeline')?.classList.toggle('is-playing', state.playing);
    document.querySelectorAll('#timeline .track-clip').forEach((node) => {
      node.classList.toggle('is-playing', !!playingPhase && node.dataset.phase === playingPhase.id && !node.classList.contains('inactive'));
    });
    const timeRuler = document.querySelector('[data-time-ruler]');
    if (timeRuler) { timeRuler.setAttribute('aria-valuenow', String(state.playheadMs)); timeRuler.setAttribute('aria-valuemax', String(total)); }
    const marker = $('timelinePlayhead');
    if (marker) marker.style.left = `${timelineLabelWidth + timelineOffset(state.playheadMs)}px`;
    const endBoundary = document.querySelector('[data-playback-end]'), range = document.querySelector('[data-playback-range]');
    const rangeWidth = timelineMetrics().totalWidth;
    if (endBoundary) { endBoundary.style.left = `${timelineLabelWidth + rangeWidth}px`; endBoundary.querySelector('span').textContent = `End · ${formatPhaseTime(total)}`; }
    if (range) range.style.width = `${rangeWidth}px`;
    const thumb = document.querySelector('[data-sequence-playhead]');
    if (thumb) { thumb.textContent = state.domScene?.authoring ? `F${authoringFrame(state.playheadMs)} · ${formatPhaseTime(Math.round(state.playheadMs))}` : formatPhaseTime(Math.round(state.playheadMs)); thumb.setAttribute('aria-valuenow', String(state.playheadMs)); thumb.setAttribute('aria-valuemax', String(total)); thumb.setAttribute('aria-valuetext', `${formatPhaseTime(state.playheadMs)}, frame ${state.domScene?.authoring ? authoringFrame(state.playheadMs) : state.currentFrame}`); }
    if (sequenceDrag || playheadHovered) showPlayheadTooltip();
  }

  function field(label, control, hint = '') { return `<div class="field-group"><label class="field-label">${label}${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>${control}</div>`; }

  function normalizeEffectContinuity() {
    state.elements.forEach((item) => {
      let previous = { opacity: 1, x: 0, y: 0 };
      state.phases.forEach((p) => {
        const c = p.clips.find((entry) => entry.elementId === item.id && entry.enabled);
        if (!c) return;
        c.opacityFrom = previous.opacity; c.xFrom = previous.x; c.yFrom = previous.y;
        previous = { opacity: Number(c.opacityTo), x: Number(c.xTo), y: Number(c.yTo) };
      });
    });
  }
  function effectControl(key, value, unit, scale = 1) {
    const display = Math.round(Number(value) * scale * 100) / 100;
    const bounds = key === 'opacityTo' ? [0, 100] : [-200, 200];
    const custom = display < bounds[0] || display > bounds[1] || display % 1 !== 0;
    return `<div class="effect-control ${custom ? 'is-custom' : ''}"><input class="effect-slider" type="range" min="${bounds[0]}" max="${bounds[1]}" step="1" value="${display}" data-field="clip.${key}" data-scale="${scale}" aria-label="${key} slider"><output class="effect-output" data-effect-value="${key}" data-scale="${scale}" title="Double-click to enter a custom value">${display}${unit}</output></div>`;
  }
  function previewEffect(item, c) {
    if (state.playing || activeAnimations.length) cancelPlayback();
    const actor = document.querySelector(`[data-actor="${item.id}"]`);
    const sprite = actor?.querySelector('.actor-sprite') || actor;
    if (!sprite) return;
    sprite.style.opacity = String(c.opacityTo);
    sprite.style.transform = `translate(${c.xTo}%, ${c.yTo}%)`;
    updatePreviewButtons();
  }

  function visibilityIcon(visible) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${visible ? '' : '<path d="M3 3l18 18"/>'}</svg>`;
  }
  function targetCss() {
    const scene = state.domScene;
    if (scene.cssScopeVersion !== 2) {
      scene.scopedCss = window.FramecraftCssScope.animation(scene.styles);
      if (scene.targetDrafts) {
        for (const target of ['marker', 'player']) if (scene.targetDrafts[target]) {
          const narrowed = window.FramecraftCssScope.animation(scene.targetDrafts[target]);
          if (narrowed[target].trim()) scene.targetDrafts[target] = narrowed[target];
          else delete scene.targetDrafts[target];
        }
      }
      scene.cssScopeVersion = 2;
    }
    return currentElement()?.domTarget || 'marker';
  }
  function renderSelectedControls() {
    const item = currentElement(), p = phase(), entry = item && p ? getClip(p.id, item.id) : null, c = entry && !entry.deleted ? entry : null;
    $('inspectorActions').innerHTML = c ? `<button class="inspector-icon clip-toggle-icon ${c.enabled ? 'is-active' : ''}" data-action="toggle-selected-clip" aria-label="${c.enabled ? 'Hide clip' : 'Show clip'}" title="${c.enabled ? 'Hide clip' : 'Show clip'} (H)" aria-pressed="${c.enabled}">${visibilityIcon(c.enabled)}</button><button class="inspector-icon" data-action="duplicate-phase" title="Duplicate selected phase (⌘/Ctrl+D)" aria-label="Duplicate selected phase">⧉</button>` : '';
    $('inspectorContent').innerHTML = renderInspector();
    if ($('domTimelineTools')) $('domTimelineTools').innerHTML = state.domScene ? renderDomAuthoring() : '';
    if (state.domScene?.authoring) {
      const track = state.domScene.authoring.tracks.find(t => t.id === state.selectedElement);
      $('customCssControls').innerHTML = `<label for="keyframeCss">${esc(track?.name)} · Frame ${authoringFrame(state.playheadMs)} · ${Math.round(state.playheadMs)} ms</label><textarea id="keyframeCss" class="code-field" spellcheck="false" aria-label="Keyframe CSS">${esc(track ? (Math.round(state.playheadMs) === 0 ? FramecraftKeyframes.format(track.keys[0].css) : FramecraftKeyframes.valuesAt(track, Math.round(state.playheadMs))) : '')}</textarea><p class="muted-small">Edits create a keyframe here. Idle motion continues for properties you leave alone.</p><span id="keyframeEditStatus" role="status" class="muted-small"></span>`; return;
    }
    $('customCssControls').innerHTML = c ? `<label for="selectedCustomCss">Custom CSS</label><textarea id="selectedCustomCss" class="code-field" data-field="clip.customCss" aria-label="Custom CSS for ${esc(p.name)}" placeholder="filter: brightness(1.2);&#10;box-shadow: 0 0 12px #b5f36c">${esc(c.customCss)}</textarea>` : '';
    if (state.domScene) { targetCss(); $('customCssControls').insertAdjacentHTML('beforeend', `<details class="scene-css-editor" ${state.domScene.cssEditorOpen !== false ? 'open' : ''}><summary>${item?.domTarget === 'player' ? 'Player CSS' : 'Marker CSS'}</summary><p>Edit this target’s selectors, pseudo-elements, clip paths, and keyframes. Only entry-animation rules and their keyframes are shown. Base styles and typed properties stay in the preview context.</p><label class="scene-css-mode"><input id="domAuthoredPlayback" type="checkbox" ${state.domScene.authoredPlayback ? 'checked' : ''}> Play scene CSS directly (skip generated timeline overrides)</label><textarea id="domSceneCss" spellcheck="false" aria-label="Target CSS">${esc(state.domScene.targetDrafts?.[targetCss()] ?? state.domScene.scopedCss[targetCss()])}</textarea><div class="scene-css-actions"><button id="applyDomSceneCss" class="button button-primary" type="button">Apply now</button><button id="copyDomSceneCss" class="button button-quiet" type="button">Copy target CSS</button><span id="sceneCssStatus" role="status"></span></div></details>`); }

  }

  function renderInspector() {
    const item = currentElement(), p = phase();
    if (!item || !p) return '';
    const c = getClip(p.id, item.id);
    if (c.deleted) return '';
    if (item.kind === 'dom') return '<span class="muted-small">Edit this target’s entry declarations in Custom CSS below.</span>';
    return `<div class="sequence-effect-grid">${field('Opacity', effectControl('opacityTo', c.opacityTo, '%', 100))}${field('X', effectControl('xTo', c.xTo, '%'))}${field('Y', effectControl('yTo', c.yTo, '%'))}</div>`;
  }

  function renderFrameControls() {
    const item = currentElement();
    if (!item) return '';
    const p = currentPhase(), entry = p ? getClip(p.id, item.id) : null, c = entry && !entry.deleted ? entry : null;
    const max = lastFrame(item), current = Math.min(state.currentFrame, max);
    const start = c ? Number(c.start) : 0, end = c ? Number(c.end) : max;
    const startPct = max ? start / max * 100 : 0, endPct = max ? end / max * 100 : 0;
    const framePct = max ? current / max * 100 : 0;
    const majorStep = max <= 10 ? 1 : max <= 40 ? 5 : Math.ceil(max / 8 / 5) * 5;
    return `<div class="frame-timeline"><div class="frame-timeline-heading"><span>FRAME 00–${String(max).padStart(2, '0')} · ${esc(item.name.toUpperCase())}</span><strong id="currentFrameLabel">VIEWING ${String(current).padStart(2, '0')} / ${String(max).padStart(2, '0')}</strong></div><div class="frame-track" data-frame-track role="slider" tabindex="0" aria-label="Current sprite frame" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${current}"><span class="frame-track-range" style="left:${startPct}%;width:${Math.max(0, endPct - startPct)}%"></span>${Array.from({ length: max + 1 }, (_, frame) => `<i class="frame-tick ${frame % majorStep === 0 || frame === max ? 'major' : ''}" style="left:${max ? frame / max * 100 : 0}%" aria-hidden="true"></i>`).join('')}<span class="frame-playhead" data-frame-playhead style="left:${framePct}%"><i></i></span></div><div class="frame-scale">${Array.from({ length: max + 1 }, (_, frame) => frame % majorStep === 0 || frame === max ? `<span style="left:${max ? frame / max * 100 : 0}%">${frame}</span>` : '').join('')}</div></div>${c ? `<div class="preview-frame-range"><span class="subsection-title">${esc(p.name.toUpperCase())} · FRAME RANGE</span><div class="dual-frame-slider" data-frame-slider style="--start:${startPct}%;--end:${endPct}%"><div class="dual-frame-track"></div><input class="dual-frame-input dual-frame-start" type="range" data-field="clip.start" value="${c.start}" min="0" max="${max}" aria-label="Range start frame" title="Start frame · Shift-drag to move the whole range"><input class="dual-frame-input dual-frame-end" type="range" data-field="clip.end" value="${c.end}" min="0" max="${max}" aria-label="Range end frame" title="End frame · Shift-drag to move the whole range"><div class="dual-frame-readout"><span data-frame-start-label>FROM ${String(c.start).padStart(2, '0')}</span><span data-frame-end-label>TO ${String(c.end).padStart(2, '0')}</span></div></div></div>` : '<div class="preview-frame-hint">Add a phase to set its frame range.</div>'}`;
  }

  function renderActors() {
    $('stageElementName').textContent = currentElement()?.name || '';
    const stage = $('stage');
    const domStage = $('domStage');
    domStage.hidden = !state.domScene;
    $('stageScene').hidden = !!state.domScene;
    if (state.domScene) {
      if (domStage.dataset.sceneId !== state.domScene.id) {
        domStage.dataset.sceneId = state.domScene.id;
        // visibility:hidden leaves CSS animations running. Prune only the preview
        // copy; the original capture still contains every marker for selection.
        const preview = new DOMParser().parseFromString(state.domScene.srcdoc, 'text/html');
        if (preview.querySelector('.marker[data-framecraft-selected]')) preview.querySelectorAll('.marker:not([data-framecraft-selected])').forEach(node => node.remove());
        preview.querySelectorAll('[data-fc-sprite]').forEach(node => node.remove());
        state.elements.filter(item => item.kind !== 'dom').forEach((item, index) => {
          const node = preview.createElement('div'); node.setAttribute('data-fc-sprite', item.id);
          node.style.cssText = `position:absolute;left:${(state.domScene.focus?.x || 300) + index * 100}px;top:${state.domScene.focus?.y || 200}px;width:${item.frameWidth}px;height:${item.frameHeight}px;background-image:url("${item.image || ''}");background-repeat:no-repeat;background-size:auto;image-rendering:pixelated;`;
          preview.body.appendChild(node);
        });
        domStage.onload = () => { if (state.playheadMs > 0 || state.domScene?.authoring) seekDomScene(state.playheadMs); };
        domStage.srcdoc = '<!doctype html>' + preview.documentElement.outerHTML;
      }
      const viewport = state.domScene.viewport, focus = state.domScene.focus;
      if (viewport && focus) {
        const scale = Math.min(1, stage.clientWidth / 700, stage.clientHeight / 340);
        domStage.style.width = `${viewport.width}px`; domStage.style.height = `${viewport.height}px`;
        domStage.style.left = `${stage.clientWidth / 2 - focus.x * scale}px`;
        domStage.style.top = `${stage.clientHeight / 2 - focus.y * scale}px`;
        domStage.style.transform = `scale(${scale})`; domStage.style.transformOrigin = 'top left';
      }
      $('uploadPrompt').hidden = true;
      stage.classList.toggle('playing', !!state.playing);
      return;
    }
    domStage.removeAttribute('srcdoc'); domStage.dataset.sceneId = '';
    const actors = $('stageActors');
    actors.innerHTML = state.elements.map((item, i) => {
      const fit = Math.min(1, 96 / Math.max(1, item.frameWidth), 104 / Math.max(1, item.frameHeight));
      const sizeW = Math.max(1, item.frameWidth * fit);
      const sizeH = Math.max(1, item.frameHeight * fit);
      const style = `left:${item.position}%;width:${sizeW}px;height:${sizeH}px;top:50%;bottom:auto;translate:-50% -50%;`;
      const sprite = item.image ? `<div class="actor-sprite" style="width:${sizeW}px;height:${sizeH}px;background-image:url(&quot;${item.image}&quot;);background-size:${item.imageWidth * sizeW / item.frameWidth}px ${item.imageHeight * sizeH / item.frameHeight}px;background-position:0 0"></div>` : `<div class="actor-placeholder ${i === 1 ? 'door-placeholder' : ''}"><span>${i === 1 ? '▯' : '♟'}</span></div>`;
      return `<div class="stage-actor" tabindex="0" data-context="element" data-id="${item.id}" data-actor="${item.id}" style="${style}">${sprite}</div>`;
    }).join('');
    $('uploadPrompt').hidden = state.elements.some((item) => item.image);
    if (state.playing) stage.classList.add('playing'); else stage.classList.remove('playing');
  }

  function slug(s) { return String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'; }
  function generateCss(spriteOnly = false) {
    if (state.domScene && !spriteOnly) return generateDomCss();
    const trigger = `.${spriteOnly && state.domScene ? state.domScene.authoring ? 'framecraft-entry' : 'marker-enter' : slug(state.className)}`;
    const total = totalMs();
    let css = `/* Generated by Framecraft · ${esc(state.name)} */\n/* Add ${trigger} to a parent to start the sequence. Remove and add it again to replay. */\n\n`;
    css += `/* Replace each image URL with the matching sprite path in your game. */\n`;
    state.elements.filter(item => item.kind !== 'dom').forEach((item) => {
      const selector = `${trigger} ${item.selector}`;
      css += `${selector} {\n  width: ${item.frameWidth}px;\n  height: ${item.frameHeight}px;\n  box-sizing: content-box;\n  background-image: url("${escapeCssUrl(item.imageName ? `./${item.imageName}` : 'sprite.png')}");\n  background-repeat: no-repeat;\n  background-position: 0 0;\n  background-size: auto;\n}\n\n`;
      const active = state.phases.some((p) => p.clips.some((c) => c.enabled && c.elementId === item.id));
      if (!active) return;
      const spriteName = `fc-${slug(item.name)}-sprite`;
      const effectName = `fc-${slug(item.name)}-effects`;
      const framePoints = [{ time: 0, pos: 0, easing: 'steps(1, end)' }];
      const effectPoints = [{ time: 0, opacity: 1, transform: 'translate(0px, 0px)', borderWidth: '0px', borderColor: 'transparent', easing: 'linear', custom: '' }];
      let elapsed = 0;
      state.phases.forEach((p) => {
        const c = p.clips.find((entry) => entry.enabled && entry.elementId === item.id);
        if (c) {
          const distance = Math.abs(Number(c.end) - Number(c.start));
          framePoints.push({ time: elapsed, pos: -Number(c.start) * item.frameWidth, easing: 'steps(1, end)' });
          for (let i = 1; i <= distance; i++) {
            const frame = Number(c.start) + Math.sign(Number(c.end) - Number(c.start)) * i;
            framePoints.push({ time: elapsed + Number(p.duration) * i / distance, pos: -frame * item.frameWidth, easing: 'steps(1, end)' });
          }
          effectPoints.push({ time: elapsed, opacity: c.opacityFrom, transform: `translate(${c.xFrom}%, ${c.yFrom}%)`, borderWidth: `${c.borderFrom}px`, borderColor: c.borderColor, easing: 'linear', custom: c.customCss });
          effectPoints.push({ time: elapsed + Number(p.duration), opacity: c.opacityTo, transform: `translate(${c.xTo}%, ${c.yTo}%)`, borderWidth: `${c.borderTo}px`, borderColor: c.borderColor, easing: 'steps(1, end)', custom: c.customCss });
        }
        elapsed += Number(p.duration) + Number(p.wait);
      });
      const toPct = (time) => `${Math.max(0, Math.min(100, total ? time / total * 100 : 100)).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
      const normalize = (points, propMap) => {
        points.sort((a, b) => a.time - b.time);
        const merged = [];
        points.forEach((point) => {
          const last = merged[merged.length - 1];
          if (last && Math.abs(last.time - point.time) < .001) Object.assign(last, point);
          else merged.push({ ...point });
        });
        return merged.map((point) => `  ${toPct(point.time)} {\n${propMap(point)}\n    animation-timing-function: ${point.easing || 'linear'};\n  }`).join('\n');
      };
      const spriteFrames = normalize(framePoints, (point) => `    background-position-x: ${point.pos}px;`);
      const effectFrames = normalize(effectPoints, (point) => {
        const lines = [`    opacity: ${point.opacity};`, `    transform: ${point.transform};`];
        if (point.custom) point.custom.split(';').map((x) => x.trim()).filter(Boolean).forEach((line) => lines.push(`    ${line};`));
        return lines.join('\n');
      });
      const iteration = state.loop ? 'infinite' : '1';
      const fill = item.endState === 'reset' ? 'none' : 'forwards';
      css += `${selector} {\n  animation: ${spriteName} ${Math.max(1, total)}ms linear 0ms ${iteration} normal ${fill},\n             ${effectName} ${Math.max(1, total)}ms linear 0ms ${iteration} normal ${fill};\n}\n\n`;
      css += `@keyframes ${spriteName} {\n${spriteFrames}\n}\n\n@keyframes ${effectName} {\n${effectFrames}\n}\n\n`;
    });
    css += `/* ${fmtTime(total)} choreography · elements in each phase animate together */\n`;
    return css;
  }

  function renderActorsInitial() {
    document.querySelectorAll('.stage-actor').forEach((node) => {
      node.style.opacity = ''; node.style.transform = ''; node.style.borderWidth = ''; node.style.borderColor = '';
      const sprite = node.querySelector('.actor-sprite'); if (sprite) sprite.style.backgroundPositionX = '0px';
      node.style.boxShadow = '';
    });
  }
  function renderSequenceAt(time) {
    if (state.domScene) { seekDomScene(time); return; }
    let elapsed = 0;
    state.elements.forEach((item) => {
      const actor = document.querySelector(`[data-actor="${item.id}"]`);
      if (!actor) return;
      const sprite = actor.querySelector('.actor-sprite') || actor;
      const fit = Math.min(1, 96 / Math.max(1, item.frameWidth), 104 / Math.max(1, item.frameHeight));
      let pose = { frame: 0, opacity: 1, x: 0, y: 0, border: 0, color: 'transparent', custom: '' };
      for (const p of state.phases) {
        const duration = Math.max(0, Number(p.duration)), waitMs = Math.max(0, Number(p.wait));
        const c = p.clips.find((entry) => entry.enabled && entry.elementId === item.id);
        if (time >= elapsed && time <= elapsed + duration && c) {
          const t = duration ? Math.max(0, Math.min(1, (time - elapsed) / duration)) : 1;
          pose = { frame: Math.round(Number(c.start) + (Number(c.end) - Number(c.start)) * t), opacity: Number(c.opacityFrom) + (Number(c.opacityTo) - Number(c.opacityFrom)) * t,
            x: Number(c.xFrom) + (Number(c.xTo) - Number(c.xFrom)) * t, y: Number(c.yFrom) + (Number(c.yTo) - Number(c.yFrom)) * t,
            border: Number(c.borderFrom) + (Number(c.borderTo) - Number(c.borderFrom)) * t, color: c.borderColor, custom: c.customCss || '' };
          break;
        }
        if (time > elapsed + duration && c) pose = { frame: Number(c.end), opacity: Number(c.opacityTo), x: Number(c.xTo), y: Number(c.yTo), border: Number(c.borderTo), color: c.borderColor, custom: c.customCss || '' };
        elapsed += duration + waitMs;
      }
      sprite.style.opacity = String(pose.opacity);
      sprite.style.transform = `translate(${pose.x}%, ${pose.y}%)`;
      if (actor.querySelector('.actor-sprite')) sprite.style.backgroundPositionX = `${-pose.frame * item.frameWidth * fit}px`;
      const previous = (sprite.dataset.customProps || '').split(',').filter(Boolean);
      previous.forEach((prop) => sprite.style.removeProperty(prop));
      const props = [];
      pose.custom.split(';').forEach((declaration) => { const i = declaration.indexOf(':'); if (i > 0) { const prop = declaration.slice(0, i).trim(); sprite.style.setProperty(prop, declaration.slice(i + 1).trim()); props.push(prop); } });
      sprite.dataset.customProps = props.join(',');
      elapsed = 0;
    });
    state.currentFrame = sequenceFrameAt(currentElement(), time);
    updateFrameTimelineUI();
  }
  function seekSequence(time) {
    // Finished Web Animations with fill:forwards still override inline styles.
    // Clear them on every seek, including after the sequence has completed.
    if (state.playing || activeAnimations.length) cancelPlayback();
    state.playheadMs = Math.max(0, Math.min(totalMs(), Number(time) || 0));
    renderSequenceAt(state.playheadMs); updatePlayheadUI(); updatePreviewButtons();
    if (state.domScene?.authoring) { renderSelectedControls(); $('domTimelineTools').innerHTML = renderDomAuthoring(); }
    $('stageStatus').textContent = state.playheadMs ? `PREVIEW · ${fmtTime(state.playheadMs)}` : 'READY TO PREVIEW';
  }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }
  function actorKeyframes(item, c) {
    const count = Math.abs(c.end - c.start) + 1;
    const fit = Math.min(1, 96 / Math.max(1, item.frameWidth), 104 / Math.max(1, item.frameHeight));
    const keyframes = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const frame = c.start + (c.end >= c.start ? i : -i);
      keyframes.push({
        offset: t,
        backgroundPositionX: `${-frame * item.frameWidth * fit}px`,
      });
    }
    if (count === 1) keyframes.push({ ...keyframes[0], offset: 1 });
    return keyframes;
  }
  function effectKeyframes(c) {
    return [
      { opacity: Number(c.opacityFrom), transform: `translate(${c.xFrom}%, ${c.yFrom}%)` },
      { opacity: Number(c.opacityTo), transform: `translate(${c.xTo}%, ${c.yTo}%)` },
    ];
  }
  function resumeFromPlayhead() {
    if (totalMs() > 0 && state.playheadMs >= totalMs()) {
      seekSequence(0);
      return;
    }
    runSequence();
  }
  async function runSequence(startTime = state.playheadMs) {
    if (!state.elements.length || !state.phases.length) { toast('Add an element and a phase first'); return; }
    if (state.domScene) { runDomSequence(startTime); return; }
    const offset = Math.max(0, Math.min(totalMs(), Number(startTime) || 0));
    cancelPlayback(); state.playheadMs = offset; state.playing = true; renderActors(); renderSequenceAt(offset); $('stageStatus').textContent = 'PLAYING SEQUENCE'; updatePreviewButtons(); updatePlayheadUI();
    const runToken = makeId(); state.runToken = runToken;
    const startedAt = performance.now() - offset, duration = Math.max(1, totalMs());
    const tick = () => {
      if (state.runToken !== runToken || !state.playing) return;
      const elapsed = performance.now() - startedAt;
      state.playheadMs = state.loop ? elapsed % duration : Math.min(duration, elapsed);
      updatePlayheadUI();
      state.currentFrame = sequenceFrameAt(currentElement(), state.playheadMs);
      updateFrameTimelineUI();
      if (state.playing) playbackRaf = requestAnimationFrame(tick);
    };
    playbackRaf = requestAnimationFrame(tick);
    let cycleOffset = offset;
    do {
      if (!cycleOffset) renderActorsInitial();
      let phaseStart = 0;
      for (const p of state.phases) {
        const phaseOffset = Math.max(0, cycleOffset - phaseStart);
        phaseStart += Number(p.duration) + Number(p.wait);
        if (phaseOffset >= Number(p.duration) + Number(p.wait)) continue;
        if (state.runToken !== runToken) return;
        const jobs = (phaseOffset < Number(p.duration) ? p.clips.filter((c) => c.enabled) : []).map((c) => {
          const item = el(c.elementId); const actor = document.querySelector(`[data-actor="${item?.id}"]`); if (!item || !actor) return Promise.resolve();
          const sprite = actor.querySelector('.actor-sprite') || actor;
          if (c.customCss) c.customCss.split(';').forEach((d) => { const ix = d.indexOf(':'); if (ix > 0) sprite.style.setProperty(d.slice(0, ix).trim(), d.slice(ix + 1).trim()); });
          const frameMotion = sprite.animate(actorKeyframes(item, c), { duration: Number(p.duration), easing: Math.abs(c.end - c.start) > 0 ? `steps(${Math.abs(c.end - c.start)}, end)` : 'linear', fill: 'forwards' });
          const effectMotion = sprite.animate(effectKeyframes(c), { duration: Number(p.duration), easing: 'linear', fill: 'forwards' });
          frameMotion.currentTime = phaseOffset; effectMotion.currentTime = phaseOffset;
          activeAnimations.push(frameMotion, effectMotion);
          return Promise.all([frameMotion.finished.catch(() => {}), effectMotion.finished.catch(() => {})]);
        });
        await Promise.all(jobs);
        await wait(Math.max(0, Number(p.wait) - Math.max(0, phaseOffset - Number(p.duration))));
      }
      cycleOffset = 0;
    } while (state.loop && state.runToken === runToken);
    if (state.runToken === runToken) {
      state.playing = false; state.playheadMs = totalMs();
      if (playbackRaf) cancelAnimationFrame(playbackRaf); playbackRaf = 0;
      activeAnimations.forEach((animation) => { try { animation.cancel(); } catch {} });
      activeAnimations = [];
      renderSequenceAt(state.playheadMs);
      state.elements.filter((item) => item.endState === 'reset').forEach((item) => {
        const actor = document.querySelector(`[data-actor="${item.id}"]`); if (!actor) return;
        document.getAnimations().filter((animation) => animation.effect?.target && actor.contains(animation.effect.target)).forEach((animation) => animation.cancel());
        const sprite = actor.querySelector('.actor-sprite') || actor;
        sprite.style.opacity = '1'; sprite.style.transform = 'translate(0px, 0px)'; sprite.style.borderWidth = '0px'; sprite.style.borderColor = 'transparent';
        if (actor.querySelector('.actor-sprite')) sprite.style.backgroundPositionX = '0px';
      });
      updatePlayheadUI(); updatePreviewButtons(); $('stageStatus').textContent = 'SEQUENCE COMPLETE';
    }
  }
  function cancelPlayback() { if (state.domScene) resetDomScene(); state.runToken = null; if (playbackRaf) cancelAnimationFrame(playbackRaf); playbackRaf = 0; activeAnimations.forEach((a) => { try { a.cancel(); } catch {} }); activeAnimations = []; state.playing = false; }
  function updateLoopUI() {
    $('loopToggle').setAttribute('aria-pressed', String(state.loop));
    $('loopToggle').classList.toggle('is-active', state.loop);
  }
  function updatePreviewButtons() { $('playPreview').disabled = false; $('playPreview').classList.toggle('is-running', state.playing); $('stage').classList.toggle('playing', state.playing); $('playIcon').textContent = state.playing ? '■' : '▶'; $('playLabel').textContent = state.playing ? 'Stop sequence' : 'Play sequence'; $('playPreview').setAttribute('aria-label', state.playing ? 'Stop sequence' : 'Play sequence'); $('playPreview').title = state.playing ? 'Stop sequence (Space)' : 'Play sequence (Space)'; }
  function addPhase() {
    if (!state.elements.length) { toast('Add an element before adding a phase'); return; }
    const index = state.phases.findIndex((entry) => entry.id === state.selectedPhase);
    const previous = index >= 0 ? state.phases[index] : null;
    const p = { id: makeId(), name: `Phase ${state.phases.length + 1}`, duration: 500, wait: 0, clips: state.elements.map((item) => {
      const c = clip(item.id, true);
      c.start = previous ? Math.min(Number(previous.clips.find((entry) => entry.elementId === item.id)?.end ?? 0), lastFrame(item)) : 0;
      c.end = previous ? c.start : lastFrame(item);
      const previousEffects = state.phases.slice(0, index + 1).reverse()
        .map((entry) => entry.clips.find((candidate) => candidate.elementId === item.id && candidate.enabled && !candidate.deleted))
        .find(Boolean);
      if (previousEffects) {
        c.opacityFrom = c.opacityTo = Number(previousEffects.opacityTo ?? 1);
        c.xFrom = c.xTo = Number(previousEffects.xTo ?? 0);
        c.yFrom = c.yTo = Number(previousEffects.yTo ?? 0);
        c.customCss = previousEffects.customCss || '';
      }
      return c;
    }) };
    state.phases.splice(index + 1, 0, p); state.selectedPhase = p.id; state.inspectorTab = 'clip';
    if (state.domScene?.authoring) {
      syncAuthoringPhaseTimes();
      let endpoint = 0;
      for (const entry of state.phases) { endpoint += Number(entry.duration); if (entry.id === p.id) break; endpoint += Number(entry.wait); }
      for (const track of state.domScene.authoring.tracks) {
        const start = endpoint - Number(p.duration);
        if (!track.keys.some(key => key.time === start)) {
          FramecraftKeyframes.record(track, start, FramecraftKeyframes.valuesAt(track, start));
          track.keys.find(key => key.time === start).phaseStartId = p.id;
        }
        FramecraftKeyframes.record(track, endpoint, FramecraftKeyframes.valuesAt(track, Math.max(0, endpoint - Number(p.duration))));
        track.keys.find(key => key.time === endpoint).phaseId = p.id;
      }
      state.playheadMs = endpoint;
    }
    render();
    if (state.domScene?.authoring) seekSequence(state.playheadMs);
  }
  function addElement() {
    const n = state.elements.length + 1;
    const item = { id: makeId(), name: `Element ${n}`, selector: `.element-${n}`, image: '', imageName: '', imageWidth: 0, imageHeight: 0, frameWidth: 32, frameHeight: 32, position: 50, endState: 'hold' };
    state.elements.push(item); state.phases.forEach((p) => p.clips.push(clip(item.id, false))); state.selectedElement = item.id; state.inspectorTab = 'element'; render(); $('imageFile').click();
  }
  function selectFile() { $('imageFile').value = ''; $('imageFile').click(); }
  function onImageFile(file) {
    if (!file) return;
    if (file.type !== 'image/png') { toast('Choose a PNG sprite sheet'); return; }
    const item = currentElement(); if (!item) { toast('Add an element first'); return; }
    const hadImage = !!item.image;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image(); img.onload = () => {
        item.image = reader.result; item.imageName = file.name; item.imageWidth = img.naturalWidth; item.imageHeight = img.naturalHeight;
        if (item.frameHeight === 32 && img.naturalHeight !== 32) item.frameHeight = img.naturalHeight;
        // A single-row sheet with square cells is a common default. Guess that width
        // only while the element is still using the untouched 32px starter value.
        if (item.frameWidth === 32 && img.naturalHeight > 32 && img.naturalWidth % img.naturalHeight === 0 && img.naturalWidth / img.naturalHeight >= 2) item.frameWidth = img.naturalHeight;
        const max = lastFrame(item);
        if (!hadImage) {
          let previousEnd = 0;
          state.phases.forEach((p) => { const c = ensureClip(p, item); c.start = previousEnd; c.end = max; previousEnd = c.end; });
        } else state.phases.forEach((p) => { const c = ensureClip(p, item); c.start = Math.min(c.start, max); c.end = Math.min(c.end, max); });
        if (!state.phases.length) {
          state.selectedElement = item.id;
          state.currentFrame = 0; state.playheadMs = 0;
          addPhase();
        } else render();
        toast(`${file.name} loaded · ${frameCount(item)} frames at ${item.frameWidth}px each`);
      }; img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function syncAuthoringPhaseTimes() {
    if (!state.domScene?.authoring) return;
    const endpoints = new Map(), starts = new Map(); let elapsed = 0;
    for (const p of state.phases) { starts.set(p.id, elapsed); elapsed += Number(p.duration); endpoints.set(p.id, elapsed); elapsed += Number(p.wait); }
    for (const track of state.domScene.authoring.tracks) {
      track.keys = track.keys.filter(key => (!key.phaseId || endpoints.has(key.phaseId)) && (!key.phaseStartId || starts.has(key.phaseStartId)));
      track.keys.forEach(key => { if (key.phaseId) key.time = endpoints.get(key.phaseId); else if (key.phaseStartId) key.time = starts.get(key.phaseStartId); });
      track.keys.sort((a, b) => a.time - b.time);
    }
  }
  function renderDomAuthoring() {
    if (!state.domScene.authoring) return `<button class="button button-primary" type="button" data-create-entry>${state.domScene.savedAuthoring ? 'Resume new animation' : 'Create new animation'}</button>`;
    const track = state.domScene.authoring.tracks.find(t => t.id === state.selectedElement);
    const activeKey = track?.keys.filter(key => key.time <= state.playheadMs).at(-1);
    return `<div class="animation-frame-readout" data-animation-frame>Frame ${authoringFrame(state.playheadMs)} / ${authoringFrame(totalMs())} · 60 fps</div><div class="keyframe-toolbar"><button class="button button-quiet" data-entry-reference>Original entry reference</button><label>Following segment <select data-key-easing>${['linear','ease','ease-in','ease-out','ease-in-out','steps(1, end)'].map(value => `<option ${activeKey?.easing === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div><div class="keyframe-toolbar">${track?.keys.map(key => `<button class="button button-quiet" data-key-time="${key.time}">${key.time === 0 ? 'Initial · F0' : `F${authoringFrame(key.time)} · ${key.time} ms`}</button>`).join('') || ''}</div>`;
  }
  document.addEventListener('click', event => {
    if (!state.domScene) return;
    if (event.target.closest('[data-create-entry]')) {
      cancelPlayback();
      if (state.domScene.savedAuthoring) {
        const saved = state.domScene.savedAuthoring; state.domScene.authoring = saved;
        state.elements = saved.elements; state.phases = saved.phases; state.selectedElement = state.elements[0].id; state.selectedPhase = state.phases[0].id; state.playheadMs = 0; state.className = 'framecraft-entry'; render(); seekDomScene(0); return;
      }
      const reference = { elements: state.elements, phases: state.phases, selectedElement: state.selectedElement };
      const d = domDocument();
      const definitions = [
        ['Player', '.player[data-me="true"]', '', 'translate: -50% -50%; opacity: 1; filter: brightness(1); scale: 1; rotate: 0deg; clip-path: none;'],
        ['Polygon faces', '.marker-polygons > *', '', 'filter: brightness(110%); opacity: 1; --sy: calc(var(--side-static-h-fraction) + var(--wave) * var(--side-wave-amplitude)); transform: translateX(var(--side-offset)) scaleY(var(--sy)) rotateY(var(--angle)) translateZ(var(--side-apothem)); transform-origin: bottom center;'],
        ['Bottom polygon', '.marker-polygons::after', '::after', 'opacity: 1; clip-path: var(--bottom-clip-path); filter: brightness(calc(120% + var(--collided, 0) * 20%)); transform: translate(-50%, -50%) translateY(calc(var(--marker-height) / 2)) rotateX(90deg);'],
        ['Black void', '.marker-polygons::before', '::before', 'opacity: 0; --sx: 0; z-index: 0; clip-path: var(--bottom-clip-path); transform: translate(-50%, -50%) translateY(calc(var(--marker-height) / 2)) rotateX(90deg) scaleX(var(--sx)); /* Original void idea: animate --sx to 2.5, opacity to 1, z-index to 1. */'],
      ];
      const tracks = definitions.map(([name, selector, pseudo, css]) => {
        const node = d.querySelector(selector.replace(/::(before|after)$/, ''));
        const computed = node && d.defaultView.getComputedStyle(node, pseudo || null);

        return { id: makeId(), name, selector, idle: computed?.animation || 'none', keys: [{ time: 0, css: FramecraftKeyframes.format(css), easing: 'linear' }] };
      });
      state.domScene.authoring = { tracks, reference };
      state.elements = tracks.map(t => ({ ...t, kind: 'dom', domTarget: t.name === 'Player' ? 'player' : 'marker', frameWidth: 1, frameHeight: 1, position: 50 }));
      const p = { id: makeId(), name: 'New entry', duration: 2000, wait: 0, clips: state.elements.map(item => ({ ...clip(item.id), start: 0, end: 0 })) };
      state.phases = [p]; state.selectedPhase = p.id; state.selectedElement = tracks[0].id; state.playheadMs = 0; state.className = 'framecraft-entry'; render(); seekDomScene(0);
    }
    if (event.target.closest('[data-entry-reference]')) {
      cancelPlayback(); const reference = state.domScene.authoring.reference;
      state.domScene.authoring.elements = state.elements; state.domScene.authoring.phases = state.phases;
      state.elements = reference.elements; state.phases = reference.phases; state.selectedElement = reference.selectedElement; state.selectedPhase = state.phases[0]?.id;
       state.domScene.savedAuthoring = state.domScene.authoring; delete state.domScene.authoring; state.className = 'marker-enter'; render();
    }
    const step = event.target.closest('[data-key-step]'), key = event.target.closest('[data-key-time]');
    if (step || key) { seekSequence(key ? Number(key.dataset.keyTime) : state.playheadMs + Number(step.dataset.keyStep) * 1000 / 60); renderSelectedControls(); $('domTimelineTools').innerHTML = renderDomAuthoring(); }
    if (event.target.closest('[data-key-add]')) {
      const track = state.domScene.authoring.tracks.find(t => t.id === state.selectedElement);
      FramecraftKeyframes.record(track, Math.round(state.playheadMs), FramecraftKeyframes.valuesAt(track, state.playheadMs));
      $('domTimelineTools').innerHTML = renderDomAuthoring(); scheduleAutosave();
    }
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-key-easing]') || !state.domScene?.authoring) return;
    const track = state.domScene.authoring.tracks.find(t => t.id === state.selectedElement);
    const key = track.keys.filter(k => k.time <= state.playheadMs).at(-1);
    key.easing = event.target.value;
    const time = state.playheadMs, playing = state.playing;
    cancelPlayback(); if (playing) runDomSequence(time); else seekDomScene(time); scheduleAutosave();
  });
  let keyframeEditTimer;
  document.addEventListener('input', event => {
    if (event.target.id !== 'keyframeCss' || !state.domScene?.authoring) return;
    clearTimeout(keyframeEditTimer);
    const scene = state.domScene, editor = event.target, time = Math.round(state.playheadMs), id = state.selectedElement;
    keyframeEditTimer = setTimeout(() => {
      if (scene !== state.domScene || !scene.authoring) return;
      const validation = window.FramecraftCssEditor.validate(`.keyframe { ${editor.value} }`);
      if (!validation.valid) { if ($('keyframeEditStatus')) $('keyframeEditStatus').textContent = 'Keeping last valid keyframe · ' + validation.error; return; }
      if ($('keyframeEditStatus')) $('keyframeEditStatus').textContent = 'Keyframe saved';
      const track = scene.authoring.tracks.find(t => t.id === id);
      FramecraftKeyframes.record(track, time, editor.value);
      const playing = state.playing; cancelPlayback(); if (playing) runDomSequence(time); else seekDomScene(time);
      $('domTimelineTools').innerHTML = renderDomAuthoring(); scheduleAutosave();
    }, 180);
  });
  function domDocument() { return $('domStage').contentDocument; }
  function resetDomScene() {
    const d = domDocument();
    if (!d) return;
    d.documentElement.classList.remove('marker-enter', 'framecraft-entry');
    d.querySelector('#framecraft-overrides')?.remove();
  }
  function domDeclarations(c) { return String(c?.customCss || '').trim(); }
  function domPlayerKeyframes() {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(state.domScene.playerKeyframes || '');
    const rule = Array.from(sheet.cssRules).find(r => r.name === 'player-marker-hop');
    if (!rule) return '';
    const frames = Array.from(rule.cssRules).flatMap(r => r.keyText.split(',').map(offset => ({ offset: parseFloat(offset) / 100, style: Object.fromEntries(Array.from(r.style, key => [key, r.style.getPropertyValue(key)])) }))).sort((a, b) => a.offset - b.offset);
    const player = state.elements.find(item => item.domTarget === 'player');
    const enabled = p => p.clips.some(c => c.elementId === player?.id && c.enabled && !c.deleted);
    const active = state.phases.reduce((sum, p) => sum + (enabled(p) ? Number(p.duration) : 0), 0);
    const total = Math.max(1, totalMs());
    const coordinates = value => { let depth = 0, start = 0, out = []; for (let i = 0; i < value.length; i++) { if (value[i] === '(') depth++; if (value[i] === ')') depth--; if (value[i] === ' ' && !depth) { if (i > start) out.push(value.slice(start, i)); start = i + 1; } } if (start < value.length) out.push(value.slice(start)); return out; };
    const sample = progress => {
      const before = frames.filter(f => f.offset <= progress).at(-1) || frames[0], after = frames.find(f => f.offset >= progress) || frames.at(-1);
      if (!before || !after) return {};
      if (before.offset === after.offset) return before.style;
      const t = (progress - before.offset) / (after.offset - before.offset), values = { ...before.style };
      for (const key of Object.keys(after.style)) {
        if (!before.style[key]) continue;
        if (key === 'translate') { const a = coordinates(before.style[key]), b = coordinates(after.style[key]); if (a.length === b.length) values[key] = a.map((v, i) => `calc((${v}) * ${1 - t} + (${b[i]}) * ${t})`).join(' '); }
        else if (/^-?[\d.]+$/.test(before.style[key]) && /^-?[\d.]+$/.test(after.style[key])) values[key] = String(Number(before.style[key]) * (1 - t) + Number(after.style[key]) * t);
      }
      return values;
    };
    const output = [], point = (time, progress) => output.push(`${time / total * 100}% { ${Object.entries(sample(progress)).map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
    let elapsed = 0, played = 0;
    point(0, 0);
    for (const p of state.phases) {
      const duration = Number(p.duration), end = played + (enabled(p) ? duration : 0);
      if (enabled(p) && active) for (const frame of frames) { const position = frame.offset * active; if (position > played && position < end) point(elapsed + position - played, frame.offset); }
      elapsed += duration; played = end; point(elapsed, active ? played / active : 0);
      elapsed += Number(p.wait); point(elapsed, active ? played / active : 0);
    }
    return `@keyframes player-marker-hop {\n${output.join('\n')}\n}`;
  }
  function domOverrideCss() {
    if (state.domScene.authoredPlayback) return '';
    if (!state.domScene.playerEntryDeclarations) state.domScene.playerEntryDeclarations = importedPlayerEntry(state.domScene.styles);
    const total = Math.max(1, totalMs());
    let css = state.domScene.cssDrivenTargets?.marker ? '' : 'html.marker-enter .marker-polygons { animation: none; }\n';
    if (!state.domScene.cssDrivenTargets?.player) css += `html.marker-enter .player[data-me="true"] { ${state.domScene.playerEntryDeclarations || ''} animation: player-marker-hop ${total}ms linear forwards; }\n`;
    state.elements.filter(item => item.kind === 'dom' && !state.domScene.cssDrivenTargets?.[item.domTarget]).forEach(item => {
      const name = `fc-dom-${slug(item.domTarget || item.name)}`;
      const values = item.domTarget === 'marker' ? { '--sy': 'calc(var(--side-static-h-fraction) + var(--wave) * var(--side-wave-amplitude))', filter: 'brightness(110%)' } : {};
      const declaration = text => {
        const style = document.createElement('span').style; style.cssText = text;
        return Object.fromEntries(Array.from(style, key => [key, style.getPropertyValue(key)]));
      };
      const blocks = [];
      const point = time => blocks.push(`${(time / total * 100).toFixed(5)}% { ${Object.entries(values).map(([key, value]) => `${key}: ${value};`).join(' ')} }`);
      point(0);
      let elapsed = 0;
      state.phases.forEach(p => {
        point(elapsed);
        const c = p.clips.find(c => c.elementId === item.id && c.enabled && !c.deleted);
        if (c) Object.assign(values, declaration(domDeclarations(c)));
        elapsed += Number(p.duration); point(elapsed);
        elapsed += Number(p.wait); point(elapsed);
      });
      if (!Object.keys(values).length) return;
      const native = item.domTarget === 'player' ? `player-marker-hop ${total}ms linear forwards, ` : '';
      css += `html.marker-enter ${item.selector} { transition: none; animation: ${native}${name} ${total}ms linear forwards; }\n@keyframes ${name} {\n${blocks.join('\n')}\n}\n`;
    });
    return css;
  }
  function generateDomCss() {
    syncAuthoringPhaseTimes();
    if (state.domScene.authoring) return FramecraftKeyframes.compile(state.domScene.authoring.tracks, Math.max(1, totalMs())) + (state.elements.some(item => item.kind !== 'dom') ? '\n' + generateCss(true) : '');
    return `/* Framecraft: replace the existing marker-enter animation rules with these. Keep the scene’s base styles and @property registrations. */\n${domOverrideCss()}\n${state.elements.some(item => item.kind !== 'dom') ? generateCss(true) : ''}\n${state.domScene.authoredPlayback ? '' : state.domScene.cssDrivenTargets?.player ? state.domScene.playerKeyframes : domPlayerKeyframes()}\n/* Toggle marker-enter on html to play. Remove it to return to idle. */\n`;
  }
  function startDomScene() {
    const d = domDocument(); if (!d) return false;
    resetDomScene();
    const style = d.createElement('style'); style.id = 'framecraft-overrides'; style.textContent = generateDomCss(); for (const [url, value] of Object.entries(state.domScene.assets || {})) style.textContent = style.textContent.split(url).join(value);
    const trigger = state.domScene.authoring ? 'framecraft-entry' : 'marker-enter';
    state.elements.filter(item => item.kind !== 'dom').forEach(item => { style.textContent = style.textContent.split(`.${trigger} ${item.selector}`).join(`.${trigger} [data-fc-sprite="${item.id}"]`); });
    d.head.appendChild(style);
    void d.documentElement.offsetWidth;
    d.documentElement.classList.add(state.domScene.authoring ? 'framecraft-entry' : 'marker-enter');
    return true;
  }
  function seekDomScene(time) {
    const d = domDocument(); if (!d) return;
    if (time <= 0 && !state.domScene.authoring) { resetDomScene(); return; }
    if (!d.documentElement.classList.contains(state.domScene.authoring ? 'framecraft-entry' : 'marker-enter')) startDomScene();
    // Flush style before collecting transitions so seeking never races a later reset.
    void d.documentElement.offsetWidth;
    d.getAnimations().forEach(animation => {
      if (!animation.effect?.target?.closest?.('.marker-polygons, .player[data-me="true"], [data-fc-sprite]')) return;
      animation.pause();
      animation.currentTime = Math.max(0, Math.min(totalMs(), Number(time) || 0));
    });
  }
  function runDomSequence(startTime = state.playheadMs) {
    const offset = Math.max(0, Math.min(totalMs(), Number(startTime) || 0));
    cancelPlayback(); state.playheadMs = offset;
    if (!startDomScene()) { toast('Scene is still loading'); return; }
    void domDocument().documentElement.offsetWidth;
    domDocument().getAnimations().forEach(animation => { if (animation.effect?.target?.closest?.('.marker-polygons, .player[data-me="true"], [data-fc-sprite]')) { animation.currentTime = offset; animation.play(); } });
    state.playing = true; updatePlayheadUI(); updatePreviewButtons(); $('stageStatus').textContent = 'PLAYING SEQUENCE';
    const token = makeId(); state.runToken = token; const start = performance.now() - offset, duration = Math.max(1, totalMs());
    const tick = now => {
      if (state.runToken !== token) return;
      const elapsed = now - start; state.playheadMs = Math.min(duration, elapsed); updatePlayheadUI();
      if (elapsed < duration) playbackRaf = requestAnimationFrame(tick);
      else if (state.loop) { state.playing = false; runDomSequence(0); }
      else { state.playing = false; playbackRaf = 0; updatePreviewButtons(); $('stageStatus').textContent = 'SEQUENCE COMPLETE'; }
    };
    playbackRaf = requestAnimationFrame(tick);
  }
  let liveCssTimer;
  function applyTargetCss() {
    const scene = state.domScene, editor = $('domSceneCss');
    if (!scene || !editor) return;
    const validation = window.FramecraftCssEditor?.validate(editor.value);
    if (!validation?.valid) {
      $('sceneCssStatus').textContent = `Keeping last valid CSS · ${validation?.error || 'Validator is loading'}`;
      editor.setAttribute('aria-invalid', 'true'); return;
    }
    editor.removeAttribute('aria-invalid');
    const target = targetCss(), scoped = scene.scopedCss;
    if (scoped[target] === editor.value && scene.authoredPlayback === $('domAuthoredPlayback').checked) return;
    const playing = state.playing, time = state.playheadMs;
    cancelPlayback();
    scoped[target] = editor.value;
    (scene.cssDrivenTargets ||= {})[target] = true;
    const source = [scoped.context, scoped.marker, scoped.player].join('\n');
    let previewCss = source;
    for (const [url, value] of Object.entries(scene.assets || {})) previewCss = previewCss.split(url).join(value);
    if (scene.focus) previewCss += '\n.marker:not([data-framecraft-selected]) { visibility: hidden !important; }';
    const doc = new DOMParser().parseFromString(scene.srcdoc, 'text/html');
    doc.querySelector('style').textContent = previewCss;
    scene.styles = source; scene.authoredPlayback = $('domAuthoredPlayback').checked;
    scene.playerEntryDeclarations = importedPlayerEntry(source);
    scene.playerKeyframes = importedPlayerKeyframes(source);
    scene.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
    const live = domDocument();
    if (live?.querySelector('style')) live.querySelector('style').textContent = previewCss;
    // Keep the iframe and textarea in place: focus, selection and scroll survive edits.
    if (playing) runDomSequence(time); else { seekDomScene(time); updatePreviewButtons(); updatePlayheadUI(); }
    $('sceneCssStatus').textContent = 'Live CSS applied';
    scheduleAutosave();
  }
  document.addEventListener('input', event => {
    if (event.target.id !== 'domSceneCss' || !state.domScene) return;
    (state.domScene.targetDrafts ||= {})[targetCss()] = event.target.value;
    scheduleAutosave(); clearTimeout(liveCssTimer);
    const scene = state.domScene, target = targetCss(), editor = event.target;
    liveCssTimer = setTimeout(() => { if (state.domScene === scene && targetCss() === target && $('domSceneCss') === editor) applyTargetCss(); }, 180);
  });
  document.addEventListener('change', event => { if (event.target.id === 'domAuthoredPlayback') applyTargetCss(); });
  document.addEventListener('toggle', event => { if (event.target.matches?.('.scene-css-editor') && state.domScene) state.domScene.cssEditorOpen = event.target.open; }, true);
  document.addEventListener('click', async event => {
    if (!state.domScene) return;
    if (event.target.closest('#copyDomSceneCss')) {
      try { await navigator.clipboard.writeText($('domSceneCss').value); $('sceneCssStatus').textContent = 'Target CSS copied'; }
      catch { $('domSceneCss').select(); $('sceneCssStatus').textContent = 'Select and copy the CSS'; }
    }
    if (event.target.closest('#applyDomSceneCss')) { clearTimeout(liveCssTimer); applyTargetCss(); }
  });
  document.addEventListener('input', event => { if (event.target.id === 'domPlayerKeyframes' && state.domScene) { state.domScene.playerKeyframes = event.target.value; scheduleAutosave(); } });
  function importedPlayerKeyframes(source) {
    const match = /@keyframes\s+player-marker-hop\s*\{/.exec(source || '');
    if (!match) return '';
    let depth = 1, index = match.index + match[0].length;
    for (; index < source.length && depth; index++) {
      if (source[index] === '{') depth++;
      else if (source[index] === '}') depth--;
    }
    return depth ? '' : source.slice(match.index, index);
  }
  function importedPlayerEntry(source) {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(source || '');
    const result = document.createElement('span').style;
    const visit = rules => { for (const rule of rules) {
      if (rule.selectorText?.includes('html.marker-enter') && rule.selectorText.includes('.player')) {
        for (const name of rule.style) result.setProperty(name, rule.style.getPropertyValue(name), rule.style.getPropertyPriority(name));
      }
      if (rule.cssRules) visit(rule.cssRules);
    } };
    visit(sheet.cssRules);
    return result.cssText;
  }
  function appendDomCapture(capture) {
    const importId = makeId(), prefix = `[data-framecraft-import="${importId}"]`;
    const incoming = new DOMParser().parseFromString(capture.srcdoc, 'text/html');
    if (incoming.querySelector('.marker[data-framecraft-selected]')) incoming.querySelectorAll('.marker:not([data-framecraft-selected])').forEach(node => node.remove());
    const existing = state.domScene;
    let scene;
    if (existing) {
      const doc = new DOMParser().parseFromString(existing.srcdoc, 'text/html');
      const wrapper = doc.createElement('div'); wrapper.setAttribute('data-framecraft-import', importId); wrapper.style.cssText = (capture.htmlStyle || '') + ';position:absolute;inset:0;';
      wrapper.innerHTML = incoming.body.innerHTML; doc.body.appendChild(wrapper);
      const style = doc.createElement('style');
      style.textContent = `@scope (${prefix}) { ${incoming.querySelector('style')?.textContent || ''} }`;
      doc.head.appendChild(style);
      existing.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
      existing.assets = { ...existing.assets, ...capture.assets }; existing.id = makeId(); scene = existing;
    } else {
      scene = state.domScene = { ...capture, id: makeId(), playerEntryDeclarations: importedPlayerEntry(capture.styles), playerKeyframes: importedPlayerKeyframes(capture.styles) };
    }
    const scope = existing ? prefix + ' ' : '';
    const definitions = scene.authoring ? [
      ['Player', '.player[data-me="true"]', 'translate: -50% -50%; opacity: 1;'],
      ['Polygon faces', '.marker-polygons > *', 'filter: brightness(110%); --sy: calc(var(--side-static-h-fraction) + var(--wave) * var(--side-wave-amplitude));'],
      ['Bottom polygon', '.marker-polygons::after', 'opacity: 1; clip-path: var(--bottom-clip-path);'],
      ['Black void', '.marker-polygons::before', 'opacity: 0; --sx: 0; clip-path: var(--bottom-clip-path);'],
    ] : [['Marker faces', '.marker-polygons > *', '--sy: 0; filter: brightness(120%);'], ['Player', '.player[data-me="true"]', '']];
    const number = (scene.importCount || 1) + 1; scene.importCount = number;
    const added = definitions.map(([name, selector, css]) => {
      const template = scene.authoring?.tracks.find(track => track.name === name || track.name === 'Marker faces' && name === 'Polygon faces');
      return { id: makeId(), name: `${name} (${number})`, kind: 'dom', domTarget: name === 'Player' ? 'player' : 'marker', selector: scope + selector, originalSelector: selector, importId, frameWidth: 1, frameHeight: 1, position: 50,
        keys: [{ time: 0, css: template?.keys[0]?.css || css, easing: 'linear' }], idle: template?.idle || 'none' };
    });
    state.elements.push(...added);
    if (scene.authoring) scene.authoring.tracks.push(...added);
    for (const p of state.phases) for (const item of added) { const c = clip(item.id); c.start = c.end = 0; c.customCss = item.keys[0].css; p.clips.push(c); }
    if (!state.phases.length) { const p = { id: makeId(), name: 'Phase 1', duration: 500, wait: 0, clips: added.map(item => ({ ...clip(item.id), start: 0, end: 0, customCss: item.keys[0].css })) }; state.phases.push(p); state.selectedPhase = p.id; }
    state.selectedElement = added[0].id;
    render(); toast(`${added.length} imported tracks added · existing animation preserved`);
  }
  document.addEventListener('framecraft-import-dom', event => {
    cancelPlayback();
    if (state.elements.length || state.phases.length) { appendDomCapture(event.detail); return; }
    const marker = { id: makeId(), kind: 'dom', domTarget: 'marker', name: 'Marker faces', selector: '.marker-polygons > *', frameWidth: 1, frameHeight: 1, position: 50, endState: 'hold' };
    const player = { id: makeId(), kind: 'dom', domTarget: 'player', name: 'Player', selector: ".player[data-me='true']", frameWidth: 1, frameHeight: 1, position: 50, endState: 'hold' };
    const mc = clip(marker.id), pc = clip(player.id); mc.end = pc.end = 0; mc.customCss = '--sy: 0;\nfilter: brightness(120%);';
    const p = { id: makeId(), name: 'Marker enter', duration: 5000, wait: 0, clips: [mc, pc] };
    state.defaultDuration = null; state.elements = [marker, player]; state.phases = [p]; state.domScene = { ...event.detail, id: makeId(), playerEntryDeclarations: importedPlayerEntry(event.detail.styles), playerKeyframes: importedPlayerKeyframes(event.detail.styles) };
    state.name = 'Marker enter'; state.className = 'marker-enter'; state.selectedElement = marker.id; state.selectedPhase = p.id; state.playheadMs = 0; state.inspectorTab = 'clip'; render();
    toast('Scene imported into timeline');
  });
  function saveProject() {
    state.name = $('projectName').value.trim() || 'Untitled choreography';
    const data = autosaveData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${slug(state.name)}.framecraft.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Project downloaded with embedded sprite images');
  }
  function openProjectFile(file) {
    if (!file) return;
    const reader = new FileReader(); reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.format !== 'framecraft-project' || !Array.isArray(data.elements) || !Array.isArray(data.phases)) throw new Error('Unsupported project');
        deletedPhases = [];
        state.defaultDuration = Number.isFinite(data.defaultDuration) && data.defaultDuration >= 0 ? data.defaultDuration : null; state.domScene = data.domScene || null; state.name = data.name || 'Untitled choreography'; state.className = data.className || 'is-playing'; state.loop = !!data.loop;
        state.previewZoom = 200; state.previewPanX = 0; state.previewPanY = 0;
        state.elements = data.elements.map((item) => ({ ...item, position: 50 })); state.phases = data.phases;
        state.selectedElement = state.elements[0]?.id || null; state.selectedPhase = state.phases[0]?.id || null; state.inspectorTab = state.phases.length ? 'clip' : 'element'; cancelPlayback(); render(); toast('Project opened');
      } catch { toast('Could not open this project file'); }
    }; reader.readAsText(file);
  }
  async function copyCss() {
    const css = generateCss(); $('cssOutput').value = css; $('cssStatus').textContent = state.domScene ? 'Append these overrides after the existing game rules.' : 'CSS is generated from your sequence.'; $('dialogClass').textContent = `.${slug(state.className)}`;
    if (!$('cssDialog').open) $('cssDialog').showModal();
    try { await navigator.clipboard.writeText(css); $('cssStatus').textContent = state.domScene ? 'Copied · append after the existing marker-enter rules.' : 'Copied to clipboard · replace the sprite image paths.'; toast('CSS copied to clipboard'); }
    catch { $('cssStatus').textContent = 'Select and copy the CSS below.'; }
  }
  function saveFieldDraft(target) {
    const key = target.dataset.field, item = currentElement(), p = currentPhase();
    const c = p && item ? getClip(p.id, item.id) : null;
    if (key === 'element.name') item.name = target.value;
    else if (key === 'element.selector') item.selector = target.value;
    else if (key === 'element.frameWidth' || key === 'element.frameHeight') item[key.split('.')[1]] = Math.max(1, Number(target.value) || 1);
    else if (key === 'element.position') item.position = Number(target.value);
    else if (key === 'phase.name') p.name = target.value;
    else if (key === 'phase.duration' || key === 'phase.wait') p[key.split('.')[1]] = Math.max(0, Number(target.value) || 0);
    else if (key === 'project.className') state.className = slug(target.value);
    else if (key === 'clip.enabled') c.enabled = target.checked;
    else if (key.startsWith('clip.') && key !== 'clip.element' && key !== 'clip.scrub') {
      const property = key.slice(5);
      c[property] = target.type === 'number' ? Number(target.value) / Number(target.dataset.scale || 1) : target.value;
      if (property === 'start' && c.end < c.start) c.end = c.start;
      if (property === 'end' && c.start > c.end) c.start = c.end;
      if (property === 'start' || property === 'end') normalizeFrameContinuity();
    } else return;
    updatePhaseAddButtons(); scheduleAutosave();
  }
  function shiftedFrameRange(start, end, delta, max) {
    const offset = Math.max(-start, Math.min(max - end, delta));
    return { start: start + offset, end: end + offset };
  }
  function moveSelectedFrameRange(delta) {
    const item = currentElement(), p = currentPhase(); if (!item || !p) return;
    const c = getClip(p.id, item.id);
    Object.assign(c, shiftedFrameRange(Number(c.start), Number(c.end), delta, lastFrame(item)));
    updateFrameRangeUI(item, p, c); updatePhaseAddButtons(); scheduleAutosave();
  }
  document.addEventListener('pointerdown', (event) => { rangeShiftHeld = event.shiftKey; }, true);
  document.addEventListener('pointermove', (event) => { rangeShiftHeld = event.shiftKey; }, true);
  window.addEventListener('keydown', (event) => {
    rangeShiftHeld = event.shiftKey;
    const input = event.target.closest('.dual-frame-input');
    if (!input || !event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    moveSelectedFrameRange(event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1);
  }, true);
  window.addEventListener('keyup', (event) => { rangeShiftHeld = event.shiftKey; }, true);
  window.addEventListener('blur', () => { rangeShiftHeld = false; });

  function updateFrameRangeUI(item, p, c) {
    const max = lastFrame(item), slider = document.querySelector('[data-frame-slider]');
    const startField = document.querySelector('[data-field="clip.start"]:not([type="range"])');
    const endField = document.querySelector('[data-field="clip.end"]:not([type="range"])');
    if (startField) startField.value = c.start;
    if (endField) endField.value = c.end;
    if (slider) {
      slider.style.setProperty('--start', `${max ? c.start / max * 100 : 0}%`);
      slider.style.setProperty('--end', `${max ? c.end / max * 100 : 0}%`);
      slider.querySelector('.dual-frame-start').value = c.start;
      slider.querySelector('.dual-frame-end').value = c.end;
      slider.querySelector('[data-frame-start-label]').textContent = `FROM ${String(c.start).padStart(2, '0')}`;
      slider.querySelector('[data-frame-end-label]').textContent = `TO ${String(c.end).padStart(2, '0')}`;
    }
    const band = document.querySelector('.frame-track-range');
    if (band) { band.style.left = `${max ? c.start / max * 100 : 0}%`; band.style.width = `${max ? (c.end - c.start) / max * 100 : 0}%`; }
    const timelineClip = document.querySelector(`[data-context="clip"][data-phase="${p.id}"][data-element="${item.id}"] span`);
    if (timelineClip) timelineClip.innerHTML = `${c.start}–${c.end} <span class="clip-frames">FR</span>`;
    updateFrameTimelineUI();
  }
  function updateFrameTimelineUI() {
    const item = currentElement();
    if (!item) return;
    const max = lastFrame(item);
    state.currentFrame = Math.max(0, Math.min(max, Number(state.currentFrame) || 0));
    const percent = max ? state.currentFrame / max * 100 : 0;
    const marker = document.querySelector('[data-frame-playhead]');
    if (marker) marker.style.left = `${percent}%`;
    const track = document.querySelector('[data-frame-track]');
    if (track) { track.setAttribute('aria-valuenow', String(state.currentFrame)); track.setAttribute('aria-valuetext', `Frame ${state.currentFrame} of ${max}`); }
    const label = $('currentFrameLabel');
    if (label) label.textContent = `VIEWING ${String(state.currentFrame).padStart(2, '0')} / ${String(max).padStart(2, '0')}`;
  }
  function setActorFrame(item, frame) {
    if (!item) return;
    const actor = document.querySelector(`[data-actor="${item.id}"]`), sprite = actor?.querySelector('.actor-sprite');
    if (!sprite) return;
    const fit = Math.min(1, 96 / Math.max(1, item.frameWidth), 104 / Math.max(1, item.frameHeight));
    sprite.style.backgroundPositionX = `${-frame * item.frameWidth * fit}px`;
  }
  function syncPhaseToFrame(item, frame) {
    if (!item || !state.phases.length) return;
    const matching = state.phases.filter((p) => {
      const c = p.clips.find((entry) => entry.enabled && entry.elementId === item.id);
      return c && frame >= Number(c.start) && frame <= Number(c.end);
    });
    const selectedStillMatches = matching.some((p) => p.id === state.selectedPhase);
    const next = selectedStillMatches ? state.selectedPhase : matching[0]?.id;
    if (!next || next === state.selectedPhase) return;
    state.selectedPhase = next;
    document.querySelectorAll('.track-clip[data-element]').forEach((node) => {
      node.classList.toggle('selected', node.dataset.phase === next && node.dataset.element === item.id);
    });
    renderSelectedControls();
    const selected = phase(next), c = getClip(next, item.id);
    updateFrameRangeUI(item, selected, c);
    const heading = document.querySelector('.preview-frame-range .subsection-title');
    if (heading) heading.textContent = `${selected.name.toUpperCase()} · FRAME RANGE`;
    const range = document.querySelector('.frame-track-range'), max = lastFrame(item);
    if (range) { range.style.left = `${max ? c.start / max * 100 : 0}%`; range.style.width = `${max ? Math.max(0, c.end - c.start) / max * 100 : 0}%`; }
    scheduleAutosave();
  }
  function setCurrentFrame(value) {
    const item = currentElement();
    if (!item) return;
    if (state.playing || activeAnimations.length) cancelPlayback();
    state.currentFrame = Math.max(0, Math.min(lastFrame(item), Math.round(Number(value) || 0)));
    syncPhaseToFrame(item, state.currentFrame);
    setActorFrame(item, state.currentFrame);
    updateFrameTimelineUI(); updatePreviewButtons();
    if (!state.playing) $('stageStatus').textContent = `FRAME ${state.currentFrame} / ${lastFrame(item)}`;
    scheduleAutosave();
  }
  function stepCurrentFrame(delta) {
    if (state.domScene?.authoring) { seekSequence(state.playheadMs + delta * 1000 / 60); return; }
    setCurrentFrame(state.currentFrame + delta);
  }
  function resetCurrentFrameToSelection() {
    const item = currentElement(), p = currentPhase();
    state.currentFrame = Number(item && p ? getClip(p.id, item.id).start : 0) || 0;
  }
  function sequenceFrameAt(item, time) {
    if (!item) return 0;
    let elapsed = 0, frame = 0;
    for (const p of state.phases) {
      const duration = Math.max(0, Number(p.duration)), waitMs = Math.max(0, Number(p.wait));
      const c = p.clips.find((entry) => entry.enabled && entry.elementId === item.id);
      if (time >= elapsed && time <= elapsed + duration && c) {
        const t = duration ? Math.max(0, Math.min(1, (time - elapsed) / duration)) : 1;
        return Math.round(Number(c.start) + (Number(c.end) - Number(c.start)) * t);
      }
      if (time > elapsed + duration && c) frame = Number(c.end);
      elapsed += duration + waitMs;
    }
    return frame;
  }
  function setField(target, value) {
    const key = target.dataset.field;
    if (!key) return;
    const item = currentElement(), p = currentPhase(), c = p && item ? getClip(p.id, item.id) : null;
    if (target.dataset.scale && c) { if (value === '') return; c[key.slice(5)] = Number(value) / Number(target.dataset.scale); const output = target.parentElement.querySelector('.effect-output'); if (output) output.textContent = `${value}%`; target.parentElement.classList.remove('is-custom'); normalizeEffectContinuity(); previewEffect(item, c); scheduleAutosave(); return; }
    if (key === 'element.name') item.name = value;
    else if (key === 'element.selector') item.selector = value;
    else if (key === 'element.endState') item.endState = value;
    else if (key === 'project.className') state.className = slug(value);
    else if (key === 'element.position') { item.position = Number(value); target.nextElementSibling.textContent = `${value}%`; renderActors(); setActorFrame(item, state.currentFrame); if (c) previewEffect(item, c); scheduleAutosave(); return; }
    else if (key === 'element.frameWidth' || key === 'element.frameHeight') { item[key.split('.')[1]] = Math.max(1, Number(value) || 1); render(); return; }
    else if (key === 'phase.name') p.name = value;
    else if (key === 'phase.duration' || key === 'phase.wait') p[key.split('.')[1]] = Math.max(0, Number(value) || 0);
    else if (key === 'clip.element') { state.selectedElement = value; resetCurrentFrameToSelection(); render(); return; }
    else if (key === 'clip.enabled') c.enabled = target.checked;
    else if (key === 'clip.scrub') {
      c.start = Number(value); c.end = Number(value);
      const label = target.parentElement.querySelector('.range-value');
      if (label) label.textContent = `FRAME ${String(c.start).padStart(2, '0')}`;
      const startField = document.querySelector('[data-field="clip.start"]');
      const endField = document.querySelector('[data-field="clip.end"]');
      if (startField) startField.value = c.start;
      if (endField) endField.value = c.end;
      const timelineClip = document.querySelector(`[data-context="clip"][data-phase="${p.id}"][data-element="${item.id}"] span`);
      if (timelineClip) timelineClip.innerHTML = `${c.start}–${c.end} <span class="clip-frames">FR</span>`;
      const actor = document.querySelector(`[data-actor="${item.id}"]`);
      const sprite = actor?.querySelector('.actor-sprite');
      if (sprite) {
        const fit = Math.min(1, 96 / Math.max(1, item.frameWidth), 104 / Math.max(1, item.frameHeight));
        sprite.style.backgroundPositionX = `${-c.start * item.frameWidth * fit}px`;
      }
      normalizeFrameContinuity(); updatePhaseAddButtons(); scheduleAutosave();
      return;
    }
    else if (key.startsWith('clip.')) {
      const property = key.slice(5);
      c[property] = target.type === 'number' || target.type === 'range' ? Number(value) : value;
      if (property === 'start' && c.end < c.start) c.end = c.start;
      if (property === 'end' && c.start > c.end) c.start = c.end;
      if (property === 'start' || property === 'end') {
        normalizeFrameContinuity(); updateFrameRangeUI(item, p, c); updatePhaseAddButtons(); scheduleAutosave();
        if (target.type !== 'range') render();
        return;
      }
    }
    render();
  }

  function deleteElement(id = state.selectedElement) {
    hideContextMenu(); const item = el(id); if (!item) return;
    if (item.kind !== 'dom' && item.id === state.elements[0]?.id) { toast('The original element cannot be deleted'); return; }
    if (!window.confirm(`Delete ${item.name}?`)) return;
    cancelPlayback(); state.elements = state.elements.filter((entry) => entry.id !== id);
    state.phases.forEach((p) => p.clips = p.clips.filter((c) => c.elementId !== id));
    if (state.domScene?.authoring) state.domScene.authoring.tracks = state.domScene.authoring.tracks.filter(track => track.id !== id);
    if (state.domScene) {
      const doc = new DOMParser().parseFromString(state.domScene.srcdoc, 'text/html');
      const style = doc.createElement('style');
      doc.querySelectorAll(`[data-fc-sprite="${item.id}"]`).forEach(node => node.remove());
      const pseudo = item.selector.match(/::(before|after)$/)?.[0] || '';
      if (item.kind === 'dom') {
        try {
          doc.querySelectorAll(item.selector.replace(/::(before|after)$/, '')).forEach(node => {
            if (!item.importId && node.closest('[data-framecraft-import]')) return;
            const deleted = new Set((node.getAttribute('data-fc-deleted') || '').split(' ').filter(Boolean)); deleted.add(item.id);
            node.setAttribute('data-fc-deleted', [...deleted].join(' '));
          });
        } catch {}
      }
      const selector = `[data-fc-deleted~="${item.id}"]${pseudo}`;
      style.textContent = item.kind !== 'dom' ? '' : pseudo ? `${selector} { content: none !important; animation: none !important; }` : `${selector} { display: none !important; animation: none !important; }`;
      doc.head.appendChild(style); state.domScene.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML; state.domScene.id = makeId();
    }
    if (state.selectedElement === id) state.selectedElement = state.elements[0]?.id || null;
    state.inspectorTab = 'element'; render();
  }
  function deletePhase(id = state.selectedPhase) {
    hideContextMenu(); const index = state.phases.findIndex((p) => p.id === id); if (index < 0) return;
    const item = currentElement();
    if (item && item.id !== state.elements[0]?.id) {
      const c = getClip(id, item.id); if (c.deleted) return;
      cancelPlayback();
      deletedPhases.push({ type: 'clip', phaseId: id, elementId: item.id, clip: structuredClone(c) });
      c.deleted = true; c.enabled = false;
      render(); toast('Clip removed · ⌘/Ctrl+Z to undo'); return;
    }
    cancelPlayback(); deletedPhases.push({ phase: structuredClone(state.phases[index]), index, selectedPhase: state.selectedPhase });
    state.phases.splice(index, 1);
    if (state.selectedPhase === id) state.selectedPhase = state.phases[Math.max(0, index - 1)]?.id || null;
    state.inspectorTab = 'clip'; render(); toast('Phase deleted · ⌘/Ctrl+Z to undo');
  }
  function undoPhaseDeletion() {
    const entry = deletedPhases.pop(); if (!entry) return;
    if (entry.type === 'clip') {
      const p = phase(entry.phaseId);
      if (!p || !el(entry.elementId)) { toast('The clip’s element or phase no longer exists'); return; }
      const index = p.clips.findIndex((c) => c.elementId === entry.elementId);
      if (index >= 0) p.clips[index] = entry.clip; else p.clips.push(entry.clip);
      state.selectedPhase = p.id; state.selectedElement = entry.elementId;
      render(); toast('Clip restored'); return;
    }

    state.phases.splice(Math.min(entry.index, state.phases.length), 0, entry.phase);
    state.selectedPhase = entry.selectedPhase; state.inspectorTab = 'clip'; render(); toast('Phase restored');
  }
  function duplicateElement(id = state.selectedElement) {
    const source = el(id); if (!source) return;
    const newId = makeId();
    const name = `${source.name} copy`;
    const selector = /^\.[\w-]+$/.test(source.selector) || /^#[\w-]+$/.test(source.selector) ? `${source.selector}-copy` : `.element-${state.elements.length + 1}`;
    const copy = { ...source, id: newId, name, selector, position: 50 };
    state.elements.push(copy);
    state.phases.forEach((p) => {
      const sourceClip = p.clips.find((c) => c.elementId === id);
      p.clips.push(sourceClip ? { ...sourceClip, elementId: newId } : clip(newId, false));
    });
    state.selectedElement = newId; state.inspectorTab = 'element'; hideContextMenu(); render();
  }
  function duplicatePhase(id = state.selectedPhase) {
    const source = phase(id); if (!source) return;
    const copy = { ...source, id: makeId(), name: `${source.name} copy`, clips: source.clips.map((entry) => ({ ...entry })) };
    state.phases.splice(state.phases.indexOf(source) + 1, 0, copy);
    state.selectedPhase = copy.id; state.inspectorTab = 'clip'; hideContextMenu(); render();
  }
  function movePhase(id, offset) {
    const index = state.phases.findIndex((p) => p.id === id), next = index + offset;
    if (index < 0 || next < 0 || next >= state.phases.length) { hideContextMenu(); return; }
    const [item] = state.phases.splice(index, 1); state.phases.splice(next, 0, item); state.selectedPhase = id; hideContextMenu(); render();
  }
  function hideContextMenu() { $('contextMenu').hidden = true; contextTarget = null; }
  function showContextMenu(type, targetData, x, y) {
    const menu = $('contextMenu');
    contextTarget = { type, ...targetData };
    const entries = type === 'element'
      ? [['edit', 'Edit element'], ['replace-element', 'Replace sprite'], ['duplicate-element', 'Duplicate element'], ['delete-element', 'Delete element', true]]
      : type === 'phase'
        ? [['edit', 'Edit phase'], ['rename-phase', 'Rename phase'], ['duplicate-phase', 'Duplicate phase'], ['move-left', 'Move earlier'], ['move-right', 'Move later']]
        : [['edit', 'Edit clip'], ['toggle-clip', getClip(targetData.phase, targetData.element)?.enabled ? 'Disable in this phase' : 'Enable in this phase'], ['duplicate-phase', 'Duplicate phase']];
    menu.innerHTML = entries.map(([action, label, danger]) => `<button class="context-item ${danger ? 'danger' : ''}" role="menuitem" type="button" data-menu-action="${action}">${esc(label)}</button>${action === 'duplicate-element' || action === 'duplicate-phase' ? '<span class="context-separator"></span>' : ''}`).join('');
    menu.hidden = false;
    const left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
    menu.style.left = `${left}px`; menu.style.top = `${top}px`;
    menu.querySelector('[role="menuitem"]')?.focus();
  }
  function showSelectedContextMenu() {
    const focused = document.activeElement.closest?.('[data-context]');
    if (focused) {
      const type = focused.dataset.context;
      let data;
      if (type === 'element') { data = { id: focused.dataset.id }; state.selectedElement = data.id; state.inspectorTab = 'element'; }
      else if (type === 'phase') { data = { id: focused.dataset.id }; state.selectedPhase = data.id; state.inspectorTab = 'clip'; }
      else { data = { phase: focused.dataset.phase, element: focused.dataset.element }; state.selectedPhase = data.phase; state.selectedElement = data.element; state.inspectorTab = 'clip'; }
      render(); showContextMenu(type, data, 24, 86); return;
    }
    if (state.inspectorTab === 'element' && currentElement()) showContextMenu('element', { id: currentElement().id }, 24, 86);
    else if (currentPhase()) showContextMenu('phase', { id: currentPhase().id }, 24, 86);
  }
  function handleContextAction(action) {
    const target = contextTarget; if (!target) return;
    if (action === 'edit') {
      if (target.type === 'element') { state.selectedElement = target.id; state.inspectorTab = 'element'; }
      else if (target.type === 'phase') { state.selectedPhase = target.id; state.inspectorTab = 'clip'; }
      else { state.selectedPhase = target.phase; state.selectedElement = target.element; state.inspectorTab = 'clip'; }
      hideContextMenu(); render(); return;
    }
    if (action === 'replace-element') { state.selectedElement = target.id; hideContextMenu(); selectFile(); return; }
    if (action === 'duplicate-element') return duplicateElement(target.id);
    if (action === 'duplicate-phase') return duplicatePhase(target.id || target.phase);
    if (action === 'delete-element') return deleteElement(target.id);
    if (action === 'delete-phase') return deletePhase(target.id || target.phase);
    if (action === 'move-left') return movePhase(target.id, -1);
    if (action === 'move-right') return movePhase(target.id, 1);
    if (action === 'rename-phase') {
      const p = phase(target.id); hideContextMenu();
      if (!p) return;
      const name = window.prompt('Rename phase', p.name);
      if (name?.trim()) { p.name = name.trim(); state.selectedPhase = p.id; state.inspectorTab = 'clip'; render(); }
      return;
    }
    if (action === 'toggle-clip') {
      const c = getClip(target.phase, target.element); if (c) { c.enabled = !c.enabled; if (c.enabled) c.deleted = false; }
      state.selectedPhase = target.phase; state.selectedElement = target.element; state.inspectorTab = 'clip'; resetCurrentFrameToSelection(); hideContextMenu(); render();
    }
  }

  document.addEventListener('click', (event) => {
    const menuAction = event.target.closest('[data-menu-action]');
    if (menuAction) { handleContextAction(menuAction.dataset.menuAction); return; }
    if (!event.target.closest('#contextMenu')) hideContextMenu();
    const target = event.target.closest('[data-action]');
    if (target) {
      const action = target.dataset.action;
      if (action === 'select-element' && !event.target.closest('[data-element-edit]')) { state.selectedElement = target.dataset.id; state.inspectorTab = 'element'; resetCurrentFrameToSelection(); render(); }
      if (action === 'select-phase') { state.selectedPhase = target.dataset.id; state.inspectorTab = 'clip'; resetCurrentFrameToSelection(); render(); }
      if (action === 'restore-clip') { state.selectedPhase = target.dataset.phase; state.selectedElement = target.dataset.element; const c = getClip(); c.deleted = false; c.enabled = true; resetCurrentFrameToSelection(); render(); }
      if (action === 'select-clip') { state.selectedPhase = target.dataset.phase; state.selectedElement = target.dataset.element; state.inspectorTab = 'clip'; resetCurrentFrameToSelection(); render(); }
      if (action === 'inspector-tab') { state.inspectorTab = target.dataset.tab; render(); }
      if (action === 'upload-element') selectFile();
      if (action === 'replace-element') { state.selectedElement = target.dataset.id; selectFile(); }
      if (action === 'duplicate-phase') duplicatePhase();
      if (action === 'toggle-selected-clip') { const c = getClip(); if (c) { c.enabled = !c.enabled; render(); } }
      if (action === 'delete-element') deleteElement(target.dataset.id || state.selectedElement);
      if (action === 'delete-phase') deletePhase();
    }
    if (event.target.closest('#addElement')) addElement();
    if (event.target.closest('#addPhase') || event.target.closest('#addPhaseTop')) addPhase();
    if (event.target.closest('#uploadPrompt')) {
      if (!state.elements.length) addElement();
      else { state.selectedElement = state.elements[0]?.id; state.inspectorTab = 'element'; selectFile(); }
    }
    if (event.target.closest('#loopToggle')) { state.loop = !state.loop; updateLoopUI(); }
    if (event.target.closest('#playPreview')) { if (state.playing) { cancelPlayback(); render(); renderSequenceAt(state.playheadMs); updatePlayheadUI(); $('stageStatus').textContent = 'PREVIEW STOPPED'; } else resumeFromPlayhead(); }
    if (event.target.closest('#resetPreview')) { cancelPlayback(); state.playheadMs = 0; state.currentFrame = 0; renderActorsInitial(); render(); $('stageStatus').textContent = 'READY TO PREVIEW'; }
    if (event.target.closest('#zoomOut')) { state.previewZoom = Math.max(50, state.previewZoom - 10); updateZoomUI(); scheduleAutosave(); }
    if (event.target.closest('#zoomIn')) { state.previewZoom = Math.min(200, state.previewZoom + 10); updateZoomUI(); scheduleAutosave(); }
    if (event.target.closest('#zoomReset')) { state.previewZoom = 200; state.previewPanX = 0; state.previewPanY = 0; updateZoomUI(); scheduleAutosave(); }
    if (event.target.closest('#saveProject')) saveProject();
    if (event.target.closest('#discardProject')) discardProject();
    if (event.target.closest('#openProject')) { $('projectFile').value = ''; $('projectFile').click(); }
    if (event.target.closest('#exportCss') || event.target.closest('#copyCssAgain')) copyCss();
    if (event.target.closest('#showShortcuts')) $('shortcutsDialog').showModal();
    if (event.target.closest('#closeShortcuts')) $('shortcutsDialog').close();
  });
  document.addEventListener('dblclick', (event) => {
    const effect = event.target.closest('[data-effect-value]');
    if (effect) {
      const item = currentElement(), p = currentPhase(), c = p && item ? getClip(p.id, item.id) : null;
      if (!c) return;
      const key = effect.dataset.effectValue, scale = Number(effect.dataset.scale), input = document.createElement('input');
      input.className = 'phase-time-input'; input.type = 'number'; input.step = 'any'; input.value = Number(c[key]) * scale;
      input.setAttribute('aria-label', `${key} custom value`); effect.replaceWith(input); input.focus(); input.select(); let cancelled = false;
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { cancelled = true; input.blur(); } });
      input.addEventListener('blur', () => { if (!cancelled && input.value !== '' && Number.isFinite(Number(input.value))) { c[key] = Number(input.value) / scale; normalizeEffectContinuity(); previewEffect(item, c); scheduleAutosave(); } renderSelectedControls(); }, { once: true });
      return;
    }
    const time = event.target.closest('[data-phase-time]');
    if (time && !event.shiftKey && Date.now() >= suppressTimeClickUntil) { beginTimingEdit(time); return; }
    const elementLabel = event.target.closest('[data-element-edit]');
    if (elementLabel) {
      event.stopPropagation();
      const item = el(elementLabel.dataset.elementId), property = elementLabel.dataset.elementEdit;
      if (!item) return;
      const input = document.createElement('input'); input.className = 'element-inline-input'; input.value = property === 'selector' ? item[property].replace(/^\.+/, '') : item[property];
      elementLabel.classList.add('element-editing'); elementLabel.appendChild(input); input.focus(); input.select();
      let cancelled = false;
      input.addEventListener('keydown', (key) => { key.stopPropagation(); if (key.key === 'Enter') input.blur(); if (key.key === 'Escape') { cancelled = true; input.blur(); } });
      input.addEventListener('blur', () => { if (!cancelled && input.value.trim()) { const value = input.value.trim(); item[property] = property === 'selector' ? `.${value.replace(/^\.+/, '')}` : value; } render(); scheduleAutosave(); }, { once: true });
      return;
    }
    const name = event.target.closest('[data-phase-name]');
    if (!name) return;
    const p = phase(name.dataset.phaseName); if (!p) return;
    const input = document.createElement('input'); input.className = 'phase-name-input'; input.value = p.name;
    name.replaceWith(input); input.focus(); input.select();
    const commit = () => { p.name = input.value.trim() || p.name; state.selectedPhase = p.id; render(); scheduleAutosave(); };
    input.addEventListener('keydown', (key) => { if (key.key === 'Enter') { key.preventDefault(); input.blur(); } if (key.key === 'Escape') render(); });
    input.addEventListener('blur', commit, { once: true });
  });
  document.addEventListener('input', (event) => {
    const control = event.target.closest('[data-phase-value]');
    if (!control) return;
    const p = phase(control.dataset.phase); if (!p) return;
    p[control.dataset.phaseValue] = Number(control.value);
    if (control.dataset.phaseValue === 'wait') updateTimelineWaitLayout();
    updateTimelineTimeRuler();
    control.parentElement.classList.remove('is-custom');
    control.parentElement.querySelector('output').textContent = formatPhaseTime(control.value);
    $('totalDuration').textContent = `${fmtTime(totalMs())} total`; updatePlayheadUI(); scheduleAutosave();
  });
  document.addEventListener('change', (event) => {
    const t = event.target;
    if (t.dataset.phaseValue) return;
    if (t.id === 'sequenceScrubber') seekSequence(t.value);
    else if (t.id === 'imageFile') onImageFile(t.files?.[0]);
    else if (t.id === 'projectFile') openProjectFile(t.files?.[0]);
    else if (t.id === 'projectName') { state.name = t.value.trim() || 'Untitled choreography'; scheduleAutosave(); }
    else if (t.dataset.field) { setField(t, t.type === 'checkbox' ? t.checked : t.value); if (t.type === 'range' && (t.dataset.field === 'clip.start' || t.dataset.field === 'clip.end')) render(); }
  });
  document.addEventListener('input', (event) => {
    const t = event.target;
    if (t.id === 'sequenceScrubber') seekSequence(t.value);
    else if (t.id === 'projectName') { state.name = t.value; scheduleAutosave(); }
    else if (rangeShiftHeld && t.matches('.dual-frame-input')) {
      const p = currentPhase(), item = currentElement();
      if (p && item) { const c = getClip(p.id, item.id); moveSelectedFrameRange(Number(t.value) - Number(c[t.dataset.field.slice(5)])); }
    }
    else if (t.dataset.field && (t.type === 'range' || t.dataset.scale)) setField(t, t.value);
    else if (t.dataset.field) saveFieldDraft(t);
  });
  document.addEventListener('contextmenu', (event) => {
    const target = event.target.closest('[data-context]');
    if (!target) { hideContextMenu(); return; }
    event.preventDefault();
    const type = target.dataset.context;
    let data;
    if (type === 'element') { data = { id: target.dataset.id }; state.selectedElement = data.id; state.inspectorTab = 'element'; }
    else if (type === 'phase') { data = { id: target.dataset.id }; state.selectedPhase = data.id; state.inspectorTab = 'clip'; }
    else { data = { phase: target.dataset.phase, element: target.dataset.element }; state.selectedPhase = data.phase; state.selectedElement = data.element; state.inspectorTab = 'clip'; }
    resetCurrentFrameToSelection(); render(); showContextMenu(type, data, event.clientX, event.clientY);
  });
  document.addEventListener('click', (event) => {
    if (event.target === $('shortcutsDialog')) $('shortcutsDialog').close();
  });
  function sliderDefault(input) {
    if (input.id === 'sequenceScrubber') return 0;
    if (input.dataset.phaseValue === 'duration') return 500;
    if (input.dataset.phaseValue === 'wait') return 0;
    const key = input.dataset.field;
    if (key === 'clip.opacityTo') return 100;
    if (key === 'clip.xTo' || key === 'clip.yTo') return 0;
    if (key === 'clip.end') return lastFrame(currentElement());
    if (key === 'clip.start') {
      const index = state.phases.findIndex((p) => p.id === state.selectedPhase);
      const previous = state.phases[index - 1];
      return previous?.clips.find((c) => c.elementId === state.selectedElement)?.end || 0;
    }
    return Number(input.min) || 0;
  }
  document.addEventListener('pointerdown', (event) => {
    if (!event.altKey || event.button !== 0) return;
    const time = event.target.closest('[data-phase-time], [data-total-time]');
    if (time) {
      event.preventDefault(); event.stopImmediatePropagation();
      suppressTimeClickUntil = Date.now() + 300;
      const value = time.hasAttribute('data-total-time') ? (state.defaultDuration ?? state.phases.length * 500) : time.dataset.phaseTime === 'duration' ? 500 : 0;
      const editor = time.querySelector('input');
      if (editor) { editor.value = formatPhaseTime(value); editor.blur(); }
      else applyTimingValue(time, value);
      return;
    }
    const slider = event.target.closest('input[type="range"], [data-frame-track]');
    if (!slider || slider.disabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (slider.matches('[data-frame-track]')) { setCurrentFrame(0); return; }
    slider.value = String(sliderDefault(slider));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    scheduleAutosave();
  }, true);
  function frameFromPointer(track, clientX) {
    const rect = track.getBoundingClientRect(), max = Number(track.getAttribute('aria-valuemax')) || 0;
    const ratio = rect.width ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    setCurrentFrame(Math.round(ratio * max));
  }
  let effectDrag = null;
  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-effect-scrub]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    const input = handle.parentElement.querySelector('input');
    effectDrag = { handle, input, pointerId: event.pointerId, x: event.clientX, start: Number(input.value) || 0 };
    handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!effectDrag || effectDrag.pointerId !== event.pointerId) return;
    const value = Math.round((effectDrag.start + event.clientX - effectDrag.x) * 100) / 100;
    effectDrag.input.value = value; setField(effectDrag.input, value);
  });
  const endEffectDrag = (event) => {
    if (!effectDrag || effectDrag.pointerId !== event.pointerId) return;
    const { handle } = effectDrag; effectDrag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  document.addEventListener('pointerup', endEffectDrag);
  document.addEventListener('pointercancel', endEffectDrag);
  document.addEventListener('pointerdown', (event) => {
    const track = event.target.closest('[data-frame-track]');
    if (!track || event.button !== 0) return;
    event.preventDefault(); track.focus(); track.setPointerCapture(event.pointerId);
    frameDrag = { track, pointerId: event.pointerId };
    track.classList.add('dragging'); frameFromPointer(track, event.clientX);
  });
  document.addEventListener('pointermove', (event) => {
    if (!frameDrag || frameDrag.pointerId !== event.pointerId) return;
    frameFromPointer(frameDrag.track, event.clientX);
  });
  const endFrameDrag = (event) => {
    if (!frameDrag || frameDrag.pointerId !== event.pointerId) return;
    const { track } = frameDrag; frameDrag = null; track.classList.remove('dragging');
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  };
  document.addEventListener('pointerup', endFrameDrag);
  document.addEventListener('pointercancel', endFrameDrag);
  const stage = $('stage');
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || state.previewZoom <= 100 || event.target.closest('button, input, a, .zoom-controls')) return;
    event.preventDefault();
    panDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: state.previewPanX, panY: state.previewPanY };
    stage.classList.add('is-panning');
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return;
    state.previewPanX = panDrag.panX + event.clientX - panDrag.x;
    state.previewPanY = panDrag.panY + event.clientY - panDrag.y;
    updateZoomUI();
  });
  const endStagePan = (event) => {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return;
    panDrag = null;
    stage.classList.remove('is-panning');
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    scheduleAutosave();
  };
  stage.addEventListener('pointerup', endStagePan);
  stage.addEventListener('pointercancel', endStagePan);
  window.addEventListener('keydown', (event) => {
    const menu = $('contextMenu');
    if (!menu.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); hideContextMenu(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); return; }
    }
    if (event.key === 'Escape') {
      hideContextMenu();
      if ($('shortcutsDialog').open) $('shortcutsDialog').close();
      if ($('cssDialog').open) $('cssDialog').close();
      return;
    }
    const focusedItem = event.target.closest('[data-action="select-element"], [data-action="select-phase"]');
    if (focusedItem && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); focusedItem.click(); return; }
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    const plainKey = !event.metaKey && !event.ctrlKey && !event.altKey;
    const frameStep = event.key === '<' || event.code === 'Comma'
      ? -1
      : event.key === '>' || event.code === 'Period' ? 1 : 0;
    const focusedRange = event.target instanceof HTMLInputElement && event.target.type === 'range';
    if (plainKey && frameStep && (!editing || focusedRange) && !$('cssDialog').open && !$('shortcutsDialog').open) {
      event.preventDefault(); stepCurrentFrame(frameStep); return;
    }
    if ((editing && !focusedRange) || $('cssDialog').open || $('shortcutsDialog').open) return;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && deletedPhases.length) { event.preventDefault(); undoPhaseDeletion(); return; }
    if (event.target.closest('[data-sequence-playhead], [data-time-ruler]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); seekSequence(event.key === 'Home' ? 0 : event.key === 'End' ? totalMs() : state.playheadMs + (event.key === 'ArrowLeft' ? -50 : 50)); showPlayheadTooltip(); return; }
    const frameTrack = event.target.closest('[data-frame-track]');
    if (frameTrack && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault(); stepCurrentFrame(event.key === 'ArrowLeft' ? -1 : 1); return;
    }
    if (plainKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      if (!event.repeat) document.querySelector('[data-action="toggle-selected-clip"]')?.click();
      return;
    }
    if (plainKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      if (!event.repeat) { state.loop = !state.loop; updateLoopUI(); scheduleAutosave(); }
      return;
    }
    const command = event.metaKey || event.ctrlKey;
    if (command && event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); copyCss(); return; }
    if (command && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicatePhase();
      return;
    }
    if (event.key === 'Enter' && plainKey) {
      event.preventDefault();
      if (!event.repeat) { if (state.playing) runSequence(0); else seekSequence(0); }
      return;
    }
    if (event.key === ' ' && !command && !event.altKey) {
      event.preventDefault();
      if (event.repeat) return;
      if (state.playing) { cancelPlayback(); render(); renderSequenceAt(state.playheadMs); updatePlayheadUI(); $('stageStatus').textContent = 'PREVIEW STOPPED'; }
      else resumeFromPlayhead();
      return;
    }
    if (!command && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); addPhase(); return; }
    if (!command && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); addElement(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deletePhase();
      return;
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      const index = state.phases.findIndex((p) => p.id === state.selectedPhase);
      const next = Math.max(0, Math.min(state.phases.length - 1, index + (event.key === '[' ? -1 : 1)));
      state.selectedPhase = state.phases[next]?.id || state.selectedPhase; state.inspectorTab = 'clip'; resetCurrentFrameToSelection(); render(); return;
    }
    if (event.key === 'F10' && event.shiftKey || event.key === 'ContextMenu') { event.preventDefault(); showSelectedContextMenu(); return; }
    if (event.key === '?') { event.preventDefault(); $('shortcutsDialog').showModal(); }
  });
  const instantTooltip = document.createElement('div');
  instantTooltip.className = 'instant-tooltip'; instantTooltip.setAttribute('role', 'tooltip'); instantTooltip.hidden = true;
  document.body.appendChild(instantTooltip);
  let tooltipTarget = null;
  function hideInstantTooltip() {
    if (tooltipTarget?.dataset.tooltipTitle !== undefined) { tooltipTarget.title = tooltipTarget.dataset.tooltipTitle; delete tooltipTarget.dataset.tooltipTitle; }
    tooltipTarget = null; instantTooltip.hidden = true;
  }
  function showInstantTooltip(target) {
    if (timeScrub || sequenceDrag || (target instanceof Element && target.closest('[data-sequence-playhead], [data-time-ruler]'))) { hideInstantTooltip(); return; }
    const node = target instanceof Element ? target.closest('[title], [aria-label], button, input, select, textarea') : null;
    if (!node || node === tooltipTarget) return;
    hideInstantTooltip();
    const label = node.getAttribute('title') || node.getAttribute('aria-label') || node.labels?.[0]?.textContent?.trim() || node.closest('.field-group')?.querySelector('.field-label')?.textContent?.trim() || node.textContent?.trim();
    if (!label) return;
    if (node.hasAttribute('title')) { node.dataset.tooltipTitle = node.title; node.removeAttribute('title'); }
    tooltipTarget = node; instantTooltip.textContent = node.matches('input[type="range"], [data-frame-track]') ? `${label} · Option/Alt-click to reset` : label; instantTooltip.hidden = false;
    const box = node.getBoundingClientRect(), tip = instantTooltip.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - tip.width - 4, box.left + (box.width - tip.width) / 2));
    const above = box.top >= tip.height + 9;
    instantTooltip.style.left = `${left}px`;
    instantTooltip.style.top = `${above ? box.top - tip.height - 9 : box.bottom + 9}px`;
    instantTooltip.dataset.placement = above ? 'top' : 'bottom';
    instantTooltip.style.setProperty('--tooltip-arrow-x', `${Math.max(10, Math.min(tip.width - 10, box.left + box.width / 2 - left))}px`);
  }
  document.addEventListener('pointerover', (event) => showInstantTooltip(event.target));
  document.addEventListener('pointerout', (event) => { if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideInstantTooltip(); });
  document.addEventListener('focusin', (event) => showInstantTooltip(event.target));
  document.addEventListener('focusout', hideInstantTooltip);
  document.addEventListener('scroll', hideInstantTooltip, true);
  window.addEventListener('pagehide', flushAutosave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAutosave(); });
  restoreAutosave();
})();
