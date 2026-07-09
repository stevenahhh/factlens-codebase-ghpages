(function () {
  const DEFAULT_SLIDES = [
    'slide-01.html',
    'slide-03.html',
    'slide-04.html',
    'slide-05.html',
    'slide-06.html',
    'slide-11.html',
    'slide-12.html',
    'slide-13.html',
  ];
  const SNAP_SIZE = 8;
  const MAX_HISTORY = 40;
  const MIN_SIZE = 20;
  const HANDLE_SIZE = 10;

  const state = {
    currentFile: DEFAULT_SLIDES[0],
    editorDocument: null,
    mode: 'move',
    snap: true,
    dragging: null,
    resizing: null,
    selectedNode: null,
    overlay: null,
    suppressHistory: false,
    history: [],
    historyIndex: -1,
    ignoreHistory: false,
    isLoading: false,
    stageScale: 1,
  };

  const els = {
    stage: document.getElementById('stage'),
    slideSelect: document.getElementById('slide-select'),
    btnLoad: document.getElementById('btn-load'),
    btnMove: document.getElementById('mode-move'),
    btnEdit: document.getElementById('mode-edit'),
    btnUndo: document.getElementById('btn-undo'),
    btnRedo: document.getElementById('btn-redo'),
    btnCopy: document.getElementById('btn-copy'),
    btnDownload: document.getElementById('btn-download'),
    snapToggle: document.getElementById('snap-toggle'),
    status: document.getElementById('status'),
  };

  const NON_EDITOR_TAGS = new Set([
    'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE',
    'BASE', 'NOSCRIPT',
  ]);

  function setStatus(message) {
    els.status.textContent = message;
  }

  function sanitizeForSnapshot(doc) {
    const clone = doc.cloneNode(true);
    const cleanupSelectors = [
      '#__editor-style-bridge',
      '#__editor-resize-overlay',
      '[contenteditable]',
      '[tabindex]',
      '[data-editor-node]',
      '[data-editor-selected]',
      '[data-editor-bound]',
      '[data-editor-text-bind]',
    ];
    cleanupSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((el) => {
        if (selector.startsWith('[contenteditable]') || selector.startsWith('[tabindex]')) {
          el.removeAttribute(selector.replace('[', '').replace(']', ''));
          return;
        }
        if (selector === '#__editor-style-bridge' || selector === '#__editor-resize-overlay') {
          el.remove();
          return;
        }
        el.removeAttribute(selector.replace('[', '').replace(']', ''));
      });
    });
    clone.querySelectorAll('.editor-editable, .editor-target').forEach((el) => {
      el.classList.remove('editor-editable', 'editor-target');
    });
    return clone;
  }

  function serialize(doc) {
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(sanitizeForSnapshot(doc).documentElement);
    return `<!doctype html>\n${source}`;
  }

  function withEditorStyles(doc) {
    if (doc.getElementById('__editor-style-bridge')) return;
    const style = doc.createElement('style');
    style.id = '__editor-style-bridge';
    style.textContent = `
      .editor-editable {
        position: relative;
        transition: outline 0.15s;
      }
      .editor-editable.editor-target {
        outline: 1px dashed rgba(173, 163, 255, 0.55);
        cursor: move;
      }
      .editor-editable:focus {
        outline: 1px dashed rgba(140, 124, 255, 0.85) !important;
      }
      .editor-editable[contenteditable='true'] {
        cursor: text;
      }
      #__editor-resize-overlay {
        pointer-events: none;
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        z-index: 999;
      }
      #__editor-resize-overlay .editor-resize-handle {
        pointer-events: auto;
        position: absolute;
        width: ${HANDLE_SIZE}px;
        height: ${HANDLE_SIZE}px;
        background: rgba(132, 116, 255, 0.95);
        border: 1px solid #fff;
        box-sizing: border-box;
        border-radius: 2px;
        opacity: 0.95;
      }
      #__editor-resize-overlay .editor-resize-handle:hover {
        background: rgba(167, 157, 255, 0.95);
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function roundSnap(v) {
    return Math.round(v / SNAP_SIZE) * SNAP_SIZE;
  }

  function ensureOverlay(doc) {
    if (state.overlay && state.overlay.ownerDocument === doc) return state.overlay;
    const oldOverlay = doc.getElementById('__editor-resize-overlay');
    if (oldOverlay) {
      state.overlay = oldOverlay;
      return state.overlay;
    }

    const overlay = doc.createElement('div');
    overlay.id = '__editor-resize-overlay';
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((name) => {
      const handle = doc.createElement('div');
      handle.dataset.resizeHandle = name;
      handle.className = 'editor-resize-handle';
      handle.addEventListener('pointerdown', onResizeStart);
      overlay.appendChild(handle);
    });
    doc.body.appendChild(overlay);
    state.overlay = overlay;
    return overlay;
  }

  function positionHandle(handle, rect) {
    const h = handle.dataset.resizeHandle;
    const offset = Math.round(HANDLE_SIZE / 2);
    switch (h) {
      case 'nw':
        handle.style.left = `${-offset}px`;
        handle.style.top = `${-offset}px`;
        handle.style.cursor = 'nwse-resize';
        break;
      case 'n':
        handle.style.left = `${(rect.width / 2) - offset}px`;
        handle.style.top = `${-offset}px`;
        handle.style.cursor = 'ns-resize';
        break;
      case 'ne':
        handle.style.left = `${rect.width - offset}px`;
        handle.style.top = `${-offset}px`;
        handle.style.cursor = 'nesw-resize';
        break;
      case 'e':
        handle.style.left = `${rect.width - offset}px`;
        handle.style.top = `${(rect.height / 2) - offset}px`;
        handle.style.cursor = 'ew-resize';
        break;
      case 'se':
        handle.style.left = `${rect.width - offset}px`;
        handle.style.top = `${rect.height - offset}px`;
        handle.style.cursor = 'nwse-resize';
        break;
      case 's':
        handle.style.left = `${(rect.width / 2) - offset}px`;
        handle.style.top = `${rect.height - offset}px`;
        handle.style.cursor = 'ns-resize';
        break;
      case 'sw':
        handle.style.left = `${-offset}px`;
        handle.style.top = `${rect.height - offset}px`;
        handle.style.cursor = 'nesw-resize';
        break;
      case 'w':
        handle.style.left = `${-offset}px`;
        handle.style.top = `${(rect.height / 2) - offset}px`;
        handle.style.cursor = 'ew-resize';
        break;
      default:
        break;
    }
  }

  function updateOverlayForNode(node) {
    if (!state.editorDocument) return;
    const doc = state.editorDocument;
    const overlay = ensureOverlay(doc);
    if (!node) {
      overlay.style.display = 'none';
      return;
    }
    const rect = node.getBoundingClientRect();
    const parentRect = node.parentElement
      ? node.parentElement.getBoundingClientRect()
      : { left: 0, top: 0 };
    overlay.style.display = 'block';
    overlay.style.left = `${rect.left - parentRect.left}px`;
    overlay.style.top = `${rect.top - parentRect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    Array.from(overlay.children).forEach((handle) => {
      positionHandle(handle, rect);
    });
  }

  function getSourceFileBase(file) {
    const absolute = new URL(file, location.href);
    return absolute.href.replace(/[^/]*$/, '');
  }

  function prepareHtml(file, rawHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    const head = doc.head || doc.createElement('head');
    if (!doc.querySelector('base')) {
      const baseEl = doc.createElement('base');
      baseEl.setAttribute('href', getSourceFileBase(file));
      head.insertBefore(baseEl, head.firstChild);
    }
    if (!doc.querySelector('title')) {
      const titleEl = doc.createElement('title');
      titleEl.textContent = file;
      head.appendChild(titleEl);
    }
    return `<!doctype html>\n${new XMLSerializer().serializeToString(doc)}`;
  }

  function getCurrentHtml() {
    if (!state.editorDocument) return '';
    return serialize(state.editorDocument);
  }

  function pushHistory(html) {
    if (state.ignoreHistory || !html) return;
    const current = html.trim();
    if (state.history[state.historyIndex] === current) return;

    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(current);
    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
      state.historyIndex = state.history.length - 1;
    } else {
      state.historyIndex = state.history.length - 1;
    }
    updateHistoryButtons();
  }

  function restoreFromHistory(index) {
    const html = state.history[index];
    if (!html) return;
    state.historyIndex = index;
    state.isLoading = true;
    state.suppressHistory = true;
    els.stage.srcdoc = html;
    updateHistoryButtons();
  }

  function applySnapshot() {
    const current = getCurrentHtml();
    pushHistory(current);
  }

  function goToFile(file) {
    state.currentFile = file;
    setStatus(`Loading ${file}`);
    fetch(file)
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.text();
      })
      .then((text) => {
        state.isLoading = true;
        state.editorDocument = null;
        state.suppressHistory = false;
        els.stage.srcdoc = prepareHtml(file, text);
        state.history = [];
        state.historyIndex = -1;
      })
      .catch(() => {
        setStatus('Failed to load slide file. Check path.');
      });
  }
  function updateHistoryButtons() {
    els.btnUndo.disabled = state.historyIndex <= 0;
    els.btnRedo.disabled = state.historyIndex >= state.history.length - 1;
  }

  function setMode(mode) {
    state.mode = mode;
    els.btnMove.classList.toggle('active', mode === 'move');
    els.btnEdit.classList.toggle('active', mode === 'edit');
    if (!state.editorDocument) return;
    const doc = state.editorDocument;
    const nodes = doc.querySelectorAll('[data-editor-node="true"]');
    nodes.forEach((node) => {
      if (mode === 'move') {
        node.setAttribute('contenteditable', 'false');
      } else {
        if (isTextEditable(node)) node.setAttribute('contenteditable', 'true');
      }
    });
  }

  function isTextEditable(node) {
    if (!node || !node.tagName) return false;
    if (NON_EDITOR_TAGS.has(node.tagName)) return false;
    const allowed = new Set([
      'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'SPAN', 'STRONG', 'B', 'SMALL', 'LI', 'A', 'DIV',
      'TD', 'TH', 'LABEL', 'BUTTON',
    ]);
    if (allowed.has(node.tagName)) return true;
    return node.children.length === 0 && node.textContent.trim().length > 0;
  }

  function markTextEditable(doc, node) {
    if (!isTextEditable(node)) return;
    node.setAttribute('contenteditable', state.mode === 'edit' ? 'true' : 'false');
    if (!node.dataset.editorTextBind) {
      node.addEventListener('focus', onNodeFocus);
      node.addEventListener('blur', onTextEditEnd);
      node.addEventListener('input', onTextEdited);
      node.dataset.editorTextBind = '1';
    }
  }

  function clearSelection(doc) {
    if (!doc) return;
    const selected = doc.querySelector('[data-editor-selected="1"]');
    if (selected) {
      selected.classList.remove('editor-target');
      selected.removeAttribute('data-editor-selected');
    }
    state.selectedNode = null;
    if (state.overlay) {
      state.overlay.style.display = 'none';
    }
  }

  function selectNode(node) {
    if (!state.editorDocument) return;
    clearSelection(state.editorDocument);
    if (!node) return;
    state.selectedNode = node;
    node.classList.add('editor-target');
    node.dataset.editorSelected = '1';
    updateOverlayForNode(node);
  }

  function onNodeFocus(event) {
    const target = event.currentTarget;
    selectNode(target);
  }

  function onTextEdited() {
    applySnapshot();
  }

  function onTextEditEnd() {
    applySnapshot();
  }

  function onResizeStart(event) {
    if (!state.editorDocument || !state.selectedNode) return;
    const handle = event.currentTarget.dataset.resizeHandle;
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const node = state.selectedNode;
    const rect = node.getBoundingClientRect();
    const style = state.editorDocument.defaultView.getComputedStyle(node);
    const safeLeft = parseFloat(node.style.left);
    const safeTop = parseFloat(node.style.top);
    const left = Number.isFinite(safeLeft) ? safeLeft : (Number.isFinite(parseFloat(style.left)) ? parseFloat(style.left) : rect.left);
    const top = Number.isFinite(safeTop) ? safeTop : (Number.isFinite(parseFloat(style.top)) ? parseFloat(style.top) : rect.top);
    const width = Number.isFinite(parseFloat(node.style.width)) ? parseFloat(node.style.width) : rect.width;
    const height = Number.isFinite(parseFloat(node.style.height)) ? parseFloat(node.style.height) : rect.height;
    if (node.style.position !== 'absolute') {
      const parentRect = node.parentElement ? node.parentElement.getBoundingClientRect() : { left: 0, top: 0 };
      node.style.position = 'absolute';
      node.style.left = `${Math.round(rect.left - parentRect.left)}px`;
      node.style.top = `${Math.round(rect.top - parentRect.top)}px`;
      node.style.width = `${Math.round(rect.width)}px`;
      node.style.height = `${Math.round(rect.height)}px`;
    }
    if (node.style.position !== 'absolute' && node.style.position !== 'fixed') {
      return;
    }
    state.resizing = {
      node,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: left,
      startTop: top,
      startWidth: width,
      startHeight: height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.addEventListener('pointermove', onResizeMove);
  }

  function onResizeMove(event) {
    if (!state.resizing) return;
    const resize = state.resizing;
    const { node, handle, startX, startY, startLeft, startTop, startWidth, startHeight } = resize;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    let left = startLeft;
    let top = startTop;
    let width = startWidth;
    let height = startHeight;

    if (handle.includes('e')) width += dx;
    if (handle.includes('w')) {
      width -= dx;
      left += dx;
    }
    if (handle.includes('s')) height += dy;
    if (handle.includes('n')) {
      height -= dy;
      top += dy;
    }

    if (state.snap) {
      left = roundSnap(left);
      top = roundSnap(top);
      width = roundSnap(width);
      height = roundSnap(height);
    }

    width = Math.max(MIN_SIZE, width);
    height = Math.max(MIN_SIZE, height);

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    updateOverlayForNode(node);
  }

  function finishResize() {
    if (!state.resizing) return;
    const node = state.resizing.node;
    state.resizing = null;
    applySnapshot();
    updateOverlayForNode(node);
  }

  function normalizeRect(node) {
    if (!state.editorDocument || !node || !node.getBoundingClientRect) return null;
    const parent = node.parentElement || state.editorDocument.body;
    const parentRect = parent.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      parent,
      parentRect,
      left: nodeRect.left - parentRect.left,
      top: nodeRect.top - parentRect.top,
      width: nodeRect.width,
      height: nodeRect.height,
    };
  }

  function startDrag(event) {
    if (state.mode !== 'move' || !state.editorDocument) return;
    if (event.button !== 0) return;
    if (!event.currentTarget || event.currentTarget.isContentEditable) return;
    const node = event.currentTarget;
    selectNode(node);
    event.preventDefault();
    event.stopPropagation();

    const rectData = normalizeRect(node);
    if (!rectData) return;
    if (node.style.position !== 'absolute' && node.style.position !== 'fixed') {
      node.style.position = 'absolute';
      node.style.left = `${Math.round(rectData.left)}px`;
      node.style.top = `${Math.round(rectData.top)}px`;
      node.style.width = `${Math.round(rectData.width)}px`;
      node.style.height = `${Math.round(rectData.height)}px`;
    }

    const left = parseFloat(node.style.left || node.offsetLeft || 0);
    const top = parseFloat(node.style.top || node.offsetTop || 0);

    state.dragging = {
      node,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: left,
      startTop: top,
    };
    node.setPointerCapture(event.pointerId);
    node.addEventListener('pointermove', onMove);
  }

  function onMove(event) {
    if (!state.dragging) return;
    const deltaX = event.clientX - state.dragging.startX;
    const deltaY = event.clientY - state.dragging.startY;
    let nextLeft = state.dragging.startLeft + deltaX;
    let nextTop = state.dragging.startTop + deltaY;
    if (state.snap) {
      nextLeft = roundSnap(nextLeft);
      nextTop = roundSnap(nextTop);
    }
    state.dragging.node.style.left = `${nextLeft}px`;
    state.dragging.node.style.top = `${nextTop}px`;
  }

  function finishDrag() {
    if (!state.dragging) return;
    const node = state.dragging.node;
    try {
      node.removeEventListener('pointermove', onMove);
    } catch (_) {}
    state.dragging = null;
    applySnapshot();
  }

  function finishInteraction() {
    finishDrag();
    finishResize();
  }

  function bindNode(node) {
    if (node.dataset.editorBound) return;
    if (NON_EDITOR_TAGS.has(node.tagName)) return;
    node.dataset.editorNode = 'true';
    node.classList.add('editor-editable');
    node.setAttribute('tabindex', '0');
    if (!node.dataset.editorTextBind && isTextEditable(node)) {
      node.addEventListener('focus', onNodeFocus);
    }
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('blur', onTextEditEnd);
    node.addEventListener('input', onTextEdited);
    node.dataset.editorBound = '1';
  }

  function onPointerDown(event) {
    if (state.mode === 'edit') return;
    startDrag(event);
  }

  function attachEditorBehavior(doc, options = {}) {
    withEditorStyles(doc);
    setMode(state.mode);
    const body = doc.body;
    if (!body) return;

    doc.addEventListener('pointerup', finishInteraction);
    doc.addEventListener('pointercancel', finishInteraction);

    const nodes = Array.from(body.querySelectorAll('*'));
    nodes.forEach((node) => {
      if (NON_EDITOR_TAGS.has(node.tagName)) return;
      if (node.id === '__editor-style-bridge') return;
      bindNode(node);
      markTextEditable(doc, node);
    });
    if (!options.skipHistoryPush) {
      pushHistory(serialize(doc));
    }
    updateHistoryButtons();
    setStatus('Ready: Move mode = drag, Edit mode = text');
    resizeToFit();
    if (state.history.length === 0) {
      pushHistory(serialize(doc));
    }
  }


  function onStageLoad() {
    const doc = els.stage.contentDocument;
    state.editorDocument = doc;
    if (!doc) {
      setStatus('Frame load failed');
      return;
    }

    state.isLoading = false;
    if (!doc.body) return;

    const baseNodes = doc.body.querySelectorAll('[data-editor-node="true"]');
    baseNodes.forEach((n) => {
      n.classList.remove('editor-target');
      n.removeAttribute('data-editor-selected');
    });

    const skipHistoryPush = state.suppressHistory;
    state.suppressHistory = false;
    attachEditorBehavior(doc, { skipHistoryPush });
    state.ignoreHistory = false;
  }

  function resizeToFit() {
    const wrap = document.querySelector('.canvas-wrap');
    if (!wrap || !els.stage) return;
    const safeW = Math.max(wrap.clientWidth - 36, 0);
    const safeH = Math.max(wrap.clientHeight - 36, 0);
    const scaleW = safeW / 720;
    const scaleH = safeH / 405;
    const scale = Math.min(scaleW, scaleH, 1);
    state.stageScale = Math.max(scale, 0.1);
    els.stage.style.transform = `scale(${state.stageScale})`;
  }

  function handleLoadClick() {
    goToFile(els.slideSelect.value);
  }

  function handleUndo() {
    if (state.historyIndex <= 0) return;
    restoreFromHistory(state.historyIndex - 1);
  }

  function handleRedo() {
    if (state.historyIndex >= state.history.length - 1) return;
    restoreFromHistory(state.historyIndex + 1);
  }

  function handleCopy() {
    if (!state.editorDocument) return;
    const html = getCurrentHtml();
    navigator.clipboard
      .writeText(html)
      .then(() => {
        setStatus('Current HTML copied');
      })
      .catch(() => {
        setStatus('Clipboard copy failed. Use download button to save HTML.');
      });
  }

  function handleDownload() {
    if (!state.editorDocument) return;
    const html = getCurrentHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = state.currentFile;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`${state.currentFile} saved`);
  }

  function setModeByEvent(eventMode) {
    setMode(eventMode);
  }

  function handleKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault();
        handleRedo();
      }
    }
  }

  function init() {
    DEFAULT_SLIDES.forEach((slideFile) => {
      const option = document.createElement('option');
      option.value = slideFile;
      option.textContent = slideFile.replace('.html', '');
      els.slideSelect.appendChild(option);
    });

    els.btnLoad.addEventListener('click', handleLoadClick);
    els.btnMove.addEventListener('click', () => setModeByEvent('move'));
    els.btnEdit.addEventListener('click', () => setModeByEvent('edit'));
    els.btnUndo.addEventListener('click', handleUndo);
    els.btnRedo.addEventListener('click', handleRedo);
    els.btnCopy.addEventListener('click', handleCopy);
    els.btnDownload.addEventListener('click', handleDownload);

    els.snapToggle.addEventListener('change', () => {
      state.snap = els.snapToggle.checked;
      setStatus(state.snap ? 'Snap ON (8px)' : 'Snap OFF');
    });

    els.stage.addEventListener('load', onStageLoad);
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', resizeToFit);

    const defaultOption = els.slideSelect.querySelector(`option[value="${state.currentFile}"]`);
    if (defaultOption) defaultOption.selected = true;
    goToFile(state.currentFile);
  }

  init();
})();
