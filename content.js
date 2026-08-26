// Quillan-Ronin Sovereign Content Script
// Antigravity-Grade Autonomous Browser Controller & Set-of-Marks Engine

// Constants for configuration
const MAX_TEXT_LENGTH = 15000;
const MAX_HEADING_COUNT = 30;
const MAX_INTERACTIVE_SAMPLE = 25;
const MAX_SCRIPT_LENGTH = 10000;
const MAX_RESULT_LENGTH = 4000;
const MIN_ELEMENT_SIZE = 8;
const MAX_ELEMENT_TEXT_LENGTH = 70;
const MAX_HREF_LENGTH = 100;
const BATCH_SIZE = 50;

let indexedElements = [];
let badgeContainer = null;

// Message dispatcher for background and popup requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getPageContent':
      sendResponse({
        title: document.title,
        url: window.location.href,
        text: (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, MAX_TEXT_LENGTH)
      });
      break;

    case 'getPageStructure':
      sendResponse({ structure: extractPageStructure() });
      break;

    case 'indexInteractiveElements':
      sendResponse({ elements: indexInteractiveElements(request.highlight || false) });
      break;

    case 'clearHighlights':
      clearElementHighlights();
      sendResponse({ ok: true });
      break;

    case 'clickElement':
      sendResponse(clickElementByIdx(request.idx, request.selector));
      break;

    case 'typeElement':
      sendResponse(typeElementByIdx(request.idx, request.selector, request.text, request.pressEnter));
      break;

    case 'scrollTo':
      sendResponse(scrollPage(request.direction, request.amount));
      break;

    case 'chessReadBoard':
      sendResponse(extractChessBoardState());
      break;

    case 'chessMove':
      sendResponse(executeChessMove(request.from, request.to));
      break;

    case 'executeScript':
      try {
        // Security: Use Function constructor instead of eval for slightly better isolation
        // Still risky but better than direct eval - validate script length first
        if (!request.script || typeof request.script !== 'string') {
          sendResponse({ error: 'Invalid script: must be a non-empty string' });
          return;
        }
        if (request.script.length > MAX_SCRIPT_LENGTH) {
          sendResponse({ error: `Script too long: max ${MAX_SCRIPT_LENGTH} characters` });
          return;
        }
        const fn = new Function(request.script);
        const result = fn();
        sendResponse({ result: String(result).slice(0, MAX_RESULT_LENGTH) });
      } catch (error) {
        sendResponse({ error: error.message });
      }
      break;

    default:
      sendResponse({ error: `Unknown action: ${request.action}` });
      break;
  }
  return true;
});

function extractPageStructure() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => ({
    level: h.tagName.toLowerCase(),
    text: h.textContent.trim()
  })).filter(h => h.text.length > 0).slice(0, MAX_HEADING_COUNT);

  const interactive = indexInteractiveElements(false);

  return {
    title: document.title,
    url: window.location.href,
    headings,
    interactiveCount: interactive.length,
    interactiveSample: interactive.slice(0, MAX_INTERACTIVE_SAMPLE),
    metaDescription: document.querySelector('meta[name="description"]')?.content || '',
    textSnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1500)
  };
}

// ─── SET-OF-MARKS INTERACTIVE ELEMENT INDEXER ────────────────────────────────
function indexInteractiveElements(highlight = true) {
  clearElementHighlights();
  indexedElements = [];
  
  if (highlight && !badgeContainer) {
    badgeContainer = document.createElement('div');
    badgeContainer.id = 'quillan-som-overlay';
    badgeContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(badgeContainer);
  }

  const selectors = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="tab"]',
    '[tabindex="0"]', '[contenteditable="true"]',
    '.piece[class*="square-"]', 'cg-board piece'
  ];
  
  const allElements = document.querySelectorAll(selectors.join(', '));
  let idx = 0;

  allElements.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_ELEMENT_SIZE || rect.height < MIN_ELEMENT_SIZE) return;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return;

    el.setAttribute('data-quillan-idx', String(idx));
    
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';
    const text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, MAX_ELEMENT_TEXT_LENGTH);
    const href = tag === 'a' ? (el.href || '').slice(0, MAX_HREF_LENGTH) : '';

    const elementData = {
      idx,
      tag,
      type,
      text,
      href,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      box: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
    indexedElements.push(elementData);

    if (highlight && badgeContainer) {
      const badge = document.createElement('div');
      badge.className = 'quillan-badge';
      badge.textContent = idx;
      badge.style.cssText = `
        position: absolute;
        top: ${elementData.box.top - 6}px;
        left: ${elementData.box.left - 6}px;
        background: #00e5ff;
        color: #050811;
        font-family: monospace;
        font-size: 11px;
        font-weight: 800;
        padding: 1px 4px;
        border-radius: 3px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.6);
        border: 1px solid #ffffff;
        pointer-events: none;
        z-index: 2147483647;
      `;
      badgeContainer.appendChild(badge);
      el.style.outline = '2px solid rgba(0, 229, 255, 0.6)';
    }

    idx++;
  });

  return indexedElements;
}

function clearElementHighlights() {
  if (badgeContainer) {
    badgeContainer.remove();
    badgeContainer = null;
  }
  document.querySelectorAll('[data-quillan-idx]').forEach(el => {
    el.style.outline = '';
    el.removeAttribute('data-quillan-idx');
  });
}

// ─── ACTION SIMULATION PRIMITIVES ───────────────────────────────────────────
function simulateClick(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

function clickElementByIdx(idx, selector) {
  let el = null;
  if (idx !== undefined && idx !== null) {
    el = document.querySelector(`[data-quillan-idx="${idx}"]`);
  }
  if (!el && selector) {
    el = document.querySelector(selector);
  }
  if (!el) return { success: false, error: `Element [${idx || selector}] not found` };

  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    simulateClick(el);
    return { success: true, clicked: el.tagName.toLowerCase(), text: (el.innerText || el.value || '').slice(0, 40) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function typeElementByIdx(idx, selector, text, pressEnter = false) {
  let el = null;
  if (idx !== undefined && idx !== null) {
    el = document.querySelector(`[data-quillan-idx="${idx}"]`);
  }
  if (!el && selector) {
    el = document.querySelector(selector);
  }
  if (!el) return { success: false, error: `Element [${idx || selector}] not found` };

  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    simulateClick(el);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (pressEnter) {
      const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
      el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
      el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
      el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
      if (el.form) el.form.submit();
    }

    return { success: true, typed: text };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function scrollPage(direction = 'down', amount = 400) {
  const delta = direction === 'up' ? -amount : amount;
  window.scrollBy({ top: delta, behavior: 'smooth' });
  return { ok: true, scrolled: delta, scrollY: window.scrollY };
}

// ─── NATIVE CHESS.COM & LICHESS DRIVER ──────────────────────────────────────
function extractChessBoardState() {
  const map = {};
  const list = [];

  // Chess.com DOM pattern
  document.querySelectorAll('[class*="square-"]').forEach(el => {
    const cls = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
    if (!cls.includes('piece')) return;
    const m = cls.match(/piece\s+([wb])([pnbrqk])\s+square-(\d)(\d)\b/);
    if (!m) return;
    const sq = 'abcdefgh'[(+m[3]) - 1] + m[4];
    map[sq] = m[1] + m[2];
    list.push({ sq, color: m[1], type: m[2] });
  });

  // Lichess cg-board pattern
  if (list.length === 0) {
    document.querySelectorAll('cg-board piece').forEach(el => {
      const cls = el.className || '';
      const parentSq = el.parentElement?.getAttribute('data-square') || '';
      const m = cls.match(/([wb])([pnbrqk])/);
      if (m && parentSq) {
        map[parentSq] = m[1] + m[2];
        list.push({ sq: parentSq, color: m[1], type: m[2] });
      }
    });
  }

  return { count: Object.keys(map).length, map, list };
}

function executeChessMove(fromSq, toSq) {
  const anyPiece = document.querySelector('[class*="piece"][class*="square-"]');
  if (!anyPiece) return { success: false, error: 'No active chess board element found' };

  try {
    const pr = anyPiece.getBoundingClientRect();
    const size = pr.width;
    let originX = pr.left, originY = pr.top;
    try {
      const rawTf = getComputedStyle(anyPiece).transform;
      if (rawTf && rawTf !== 'none') {
        const tf = new DOMMatrixReadOnly(rawTf);
        originX = pr.left - tf.e;
        originY = pr.top - tf.f;
      }
    } catch {}
    const cc = s => ({ col: 'abcdefgh'.indexOf(s[0]) + 1, row: +s[1] });
    const f = cc(fromSq), t = cc(toSq);

    const fx = originX + size * (f.col - 0.5);
    const fy = originY + size * (8 - f.row + 0.5);
    const tx = originX + size * (t.col - 0.5);
    const ty = originY + size * (8 - t.row + 0.5);

    // Dispatch move click simulation
    const clickAt = (cx, cy) => {
      const target = document.elementFromPoint(cx, cy) || document.body;
      const opts = { bubbles: true, clientX: cx, clientY: cy };
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
    };

    clickAt(fx, fy);
    setTimeout(() => {
      clickAt(tx, ty);
    }, 250);

    return { success: true, move: `${fromSq} -> ${toSq}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Signal readiness
if (document.readyState === 'complete') {
  chrome.runtime.sendMessage({ action: 'pageReady', url: window.location.href }).catch(() => {});
} else {
  window.addEventListener('load', () => {
    chrome.runtime.sendMessage({ action: 'pageReady', url: window.location.href }).catch(() => {});
  });
}
