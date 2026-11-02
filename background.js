// Configuration constants
const SERVER_URL = 'http://localhost:7777';
const AGENT_ID = 'quillan-ronin';
const DEFAULT_POLL_DELAY = 400;
const ACTIVE_POLL_DELAY = 250;
const MAX_POLL_DELAY = 1200;
const POLL_TIMEOUT = 1500;
const RESULT_TIMEOUT = 5000;
const KEEPALIVE_INTERVAL_MINUTES = 0.4;
const TAB_UPDATE_DEBOUNCE_MS = 500;
const MAX_HISTORY_LENGTH = 200;
const MAX_STORAGE_HISTORY = 20;

let pollingInterval = null;
let autonomyEnabled = new Set(); // Set of tab IDs with autonomy enabled
let offscreenDocumentCreated = false;
// In-memory cache for faster access — MUST be before any function that uses it (TDZ fix)
const tabContextCache = new Map();

// Keep service worker alive via polling loop + alarm fallback
let pollDelay = DEFAULT_POLL_DELAY;
let idleStreak = 0;

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  console.log('[Quillan Extension] Installed successfully');
  await ensureOffscreenDocument();
  await initializeTabContext();
  startPolling();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  console.log('[Quillan Extension] Started');
  await ensureOffscreenDocument();
  await initializeTabContext();
  startPolling();
});

// MV3 service workers suspend after ~30s — alarm wakes us to resume polling + heartbeat
try {
  chrome.alarms?.create('quillan-keepalive', { periodInMinutes: KEEPALIVE_INTERVAL_MINUTES });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === 'quillan-keepalive') {
      if (!pollingInterval) {
        console.log('[Quillan Extension] Keepalive alarm — restarting poll');
        idleStreak = 0; pollDelay = DEFAULT_POLL_DELAY;
        startPolling();
      } else {
        // heartbeat log to keep worker alive
        chrome.storage.local.get(['_hb']).catch(()=>{});
      }
    }
  });
  // Also restart polling on any tab navigation (catches suspend after idle)
  chrome.webNavigation?.onCompleted.addListener(() => { if (!pollingInterval) startPolling(); });
} catch {}

// Track tab changes for context awareness (debounced for performance)
let updateTimeout = new Map();
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  if (updateTimeout.has(tabId)) clearTimeout(updateTimeout.get(tabId));
  updateTimeout.set(tabId, setTimeout(() => updateTabContext(tabId), TAB_UPDATE_DEBOUNCE_MS));
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    if (updateTimeout.has(tabId)) clearTimeout(updateTimeout.get(tabId));
    updateTimeout.set(tabId, setTimeout(() => updateTabContext(tabId), TAB_UPDATE_DEBOUNCE_MS));
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (updateTimeout.has(tabId)) clearTimeout(updateTimeout.get(tabId));
  updateTimeout.delete(tabId);
  await removeTabContext(tabId);
});

// Listen for messages to control polling and autonomy
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startPolling') {
    startPolling();
    sendResponse({ status: 'polling started' });
  } else if (request.action === 'stopPolling') {
    stopPolling();
    sendResponse({ status: 'polling stopped' });
  } else if (request.action === 'enableAutonomy') {
    enableAutonomy(request.tabId);
    sendResponse({ status: 'autonomy enabled' });
  } else if (request.action === 'disableAutonomy') {
    disableAutonomy(request.tabId);
    sendResponse({ status: 'autonomy disabled' });
  } else if (request.action === 'getTabContext') {
    getTabContext(request.tabId).then(context => sendResponse(context));
    return true; // async response
  } else if (request.action === 'getAllTabContexts') {
    getAllTabContexts().then(contexts => sendResponse(contexts));
    return true; // async response
  }
  // Handle content-script readiness signal
  if (request.action === 'pageReady') {
    if (sender.tab?.id) updateTabContext(sender.tab.id);
    sendResponse({ ok: true });
    return true;
  }
  return true;
});

// Offscreen document management
async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;
  
  try {
    // Check if offscreen document already exists
    if (chrome.runtime.getContexts) {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });
      if (existingContexts.length > 0) {
        offscreenDocumentCreated = true;
        return;
      }
    }
    
    // Create offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS', 'DOM_PARSER'],
      justification: 'Heavy processing and DOM operations for AI assistant functionality'
    });
    
    offscreenDocumentCreated = true;
    console.log('[Quillan Extension] Offscreen document created');
  } catch (error) {
    console.error('[Quillan Extension] Error creating offscreen document:', error);
  }
}

// Tab Context Management
async function initializeTabContext() {
  try {
    const tabs = await chrome.tabs.query({});
    // Process in parallel for performance
    await Promise.all(tabs.map(tab => updateTabContext(tab.id)));
  } catch (error) {
    console.error('[Quillan Extension] Error initializing tab context:', error);
  }
}

async function updateTabContext(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;
    
    // Check if tab is ready (not loading)
    if (tab.status === 'loading') {
      // Tab is still loading, skip this update
      return;
    }
    
    const context = {
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || '',
      favIconUrl: tab.favIconUrl || '',
      active: tab.active,
      status: tab.status || 'complete',
      windowId: tab.windowId,
      lastUpdated: new Date().toISOString(),
      interactionCount: 0,
      pageContent: null,
      autonomyEnabled: autonomyEnabled.has(tabId)
    };
    
    // Get existing context from cache to preserve interaction count
    const existing = tabContextCache.get(tabId);
    if (existing) {
      context.interactionCount = existing.interactionCount || 0;
      context.pageContent = existing.pageContent || null;
    }
    
    // Update cache
    tabContextCache.set(tabId, context);
    
    // Persist to storage asynchronously (don't wait)
    chrome.storage.local.set({ [`tab_${tabId}`]: context }).catch(err => {
      console.error(`[Quillan Extension] Storage error for tab ${tabId}:`, err);
    });
  } catch (error) {
    console.error(`[Quillan Extension] Error updating tab ${tabId} context:`, error);
  }
}

async function getTabContext(tabId) {
  try {
    // Check cache first
    if (tabContextCache.has(tabId)) {
      return tabContextCache.get(tabId);
    }
    
    const result = await chrome.storage.local.get([`tab_${tabId}`]);
    const context = result[`tab_${tabId}`] || null;
    
    // Cache the result
    if (context) {
      tabContextCache.set(tabId, context);
    }
    
    return context;
  } catch (error) {
    console.error(`[Quillan Extension] Error getting tab ${tabId} context:`, error);
    return null;
  }
}

async function getAllTabContexts() {
  try {
    // Return cached contexts for performance
    const contexts = {};
    for (const [tabId, context] of tabContextCache) {
      contexts[`tab_${tabId}`] = context;
    }
    return contexts;
  } catch (error) {
    console.error('[Quillan Extension] Error getting all tab contexts:', error);
    return {};
  }
}

async function removeTabContext(tabId) {
  try {
    await chrome.storage.local.remove([`tab_${tabId}`]);
    tabContextCache.delete(tabId);
    autonomyEnabled.delete(tabId);
    if (updateTimeout.has(tabId)) { clearTimeout(updateTimeout.get(tabId)); updateTimeout.delete(tabId); }
    console.log(`[Quillan Extension] Removed context for tab ${tabId}`);
  } catch (error) {
    console.error(`[Quillan Extension] Error removing tab ${tabId} context:`, error);
  }
}

async function updatePageContent(tabId, content) {
  try {
    const context = await getTabContext(tabId);
    if (context) {
      context.pageContent = content;
      context.lastUpdated = new Date().toISOString();
      context.interactionCount = (context.interactionCount || 0) + 1;
      await chrome.storage.local.set({ [`tab_${tabId}`]: context });
    }
  } catch (error) {
    console.error(`[Quillan Extension] Error updating page content for tab ${tabId}:`, error);
  }
}

// Autonomy Control
function enableAutonomy(tabId) {
  autonomyEnabled.add(tabId);
  console.log(`[Quillan Extension] Autonomy enabled for tab ${tabId}`);
}

function disableAutonomy(tabId) {
  autonomyEnabled.delete(tabId);
  console.log(`[Quillan Extension] Autonomy disabled for tab ${tabId}`);
}

function isAutonomyEnabled(tabId) {
  return autonomyEnabled.has(tabId);
}

function startPolling() {
  if (pollingInterval) return;
  
  const scheduleNext = () => {
    pollingInterval = setTimeout(async () => {
      await pollCommands();
      pollingInterval = null;
      startPolling();
    }, pollDelay);
  };
  scheduleNext();
}

function stopPolling() {
  if (pollingInterval) {
    clearTimeout(pollingInterval);
    pollingInterval = null;
  }
}

async function pollCommands() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT);
    
    const response = await fetch(`${SERVER_URL}/api/ext/poll?agentId=${AGENT_ID}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    if (!response.ok) {
      pollDelay = 3000;
      return;
    }
    
    const command = await response.json();
    if (command && command.op) {
      idleStreak = 0;
      pollDelay = ACTIVE_POLL_DELAY; // High speed when active commands are streaming
      console.log('[Quillan Extension] Received command:', command);
      const result = await executeCommand(command);
      await sendResult(command.id, result);
    } else {
      idleStreak++;
      if (idleStreak > 8) {
        pollDelay = Math.min(MAX_POLL_DELAY, DEFAULT_POLL_DELAY + (idleStreak - 8) * 80); // Gentle backoff, stays responsive for Brave single-tab
      } else {
        pollDelay = DEFAULT_POLL_DELAY;
      }
    }
  } catch (error) {
    pollDelay = 900; // Quick retry, don't blackout Brave tab
  }
}


async function executeCommand(cmd) {
  const { op, params = {} } = cmd;
  const tabId = params.tabId || await getActiveTabId();
  
  try {
    switch (op) {
      case 'navigate':
        return await navigate(tabId, params.url);
      case 'openTab':
        return await openNewTab(params.url);
      case 'eval':
        return await evaluate(tabId, params.expression);
      case 'read':
        return await readPage(tabId);
      case 'indexElements':
        return await indexPageElements(tabId, params.highlight);
      case 'click':
        return await clickElement(tabId, params.selector, params.idx);
      case 'type':
        return await typeElement(tabId, params.selector, params.idx, params.text, params.pressEnter);
      case 'scroll':
        return await scrollPage(tabId, params.direction, params.amount);
      case 'screenshot':
        return await captureScreenshot(tabId);
      case 'ping':
        return { status: 'alive', agentId: AGENT_ID, timestamp: new Date().toISOString() };
      case 'getContext':
        return await getTabContext(tabId);
      case 'getAllContexts':
        return await getAllTabContexts();
      case 'enableAutonomy':
        enableAutonomy(tabId);
        return { status: 'autonomy enabled', tabId };
      case 'disableAutonomy':
        disableAutonomy(tabId);
        return { status: 'autonomy disabled', tabId };
      case 'isAutonomyEnabled':
        return { autonomyEnabled: isAutonomyEnabled(tabId), tabId };
      // ── Fully web use + browser computer use APIs ──
      case 'captureTab':
        return await captureTabMedia(tabId);
      case 'captureDesktop':
        return await captureDesktopMedia(params.sources);
      case 'getCookies':
        return await getCookies(tabId, params.url);
      case 'setCookie':
        return await setCookie(params.cookie);
      case 'getHistory':
        return await getHistory(params.query);
      case 'getBookmarks':
        return await getBookmarks();
      case 'createBookmark':
        return await createBookmark(params.title, params.url);
      case 'getDownloads':
        return await getDownloads(params.query);
      case 'getTopSites':
        return await getTopSites();
      case 'getSessions':
        return await getSessions();
      case 'manageWindows':
        return await manageWindows(params);
      case 'pageCapture':
        return await capturePageMHTML(tabId);
      case 'contentSettings':
        return await handleContentSettings(params);
      default:
        return { error: `Unknown operation: ${op}` };
    }
  } catch (error) {
    return { error: error.message };
  }
}

async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  } catch (error) {
    console.error('[Quillan Extension] Error getting active tab:', error);
    return null;
  }
}

async function navigate(tabId, url) {
  if (tabId) {
    await chrome.tabs.update(tabId, { url });
  } else {
    await chrome.tabs.create({ url });
  }
  return { success: true, url };
}

async function openNewTab(url) {
  const tab = await chrome.tabs.create({ url });
  return { success: true, url, tabId: tab.id };
}

async function evaluate(tabId, expression) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');
  
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (expr) => {
        try {
          if (typeof expr !== 'string') return { error: 'Expression must be a string' };
          // Guarded execution under strict mode without global eval
          const runExpr = new Function('"use strict"; return (' + expr + ')');
          return { value: String(runExpr()) };
        }
        catch (e) { return { error: e.message }; }
      },
      args: [expression]
    });
    return results?.[0]?.result || { error: 'No execution result' };
  } catch (err) {
    // Fallback to debugger API if scripting fails
    try {
      await chrome.debugger.attach({ tabId: targetTabId }, '1.3');
      const result = await chrome.debugger.sendCommand(
        { tabId: targetTabId },
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true }
      );
      return { result: result.result?.value };
    } finally {
      try { await chrome.debugger.detach({ tabId: targetTabId }); } catch {}
    }
  }
}

async function readPage(tabId) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');

  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'getPageContent' });
    if (response && response.text) {
      await updatePageContent(targetTabId, response.text);
      return response;
    }
  } catch (e) {}
  
  // Fallback via scripting API
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => {
        let extracted = (document.body ? document.body.innerText : '') || (document.documentElement ? document.documentElement.innerText : '');
        const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || '';
        const metaTitle = document.querySelector('meta[property="og:title"]')?.content || document.title;
        if (!extracted || extracted.trim().length < 50) {
          const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, a, li')).map(el => el.innerText?.trim()).filter(Boolean);
          extracted = headings.join('\n');
        }
        if (metaDesc && !extracted.includes(metaDesc)) extracted = `[META DESCRIPTION: ${metaDesc}]\n\n` + extracted;
        return {
          title: metaTitle || document.title || 'Untitled Page',
          url: location.href,
          text: extracted.replace(/\n{3,}/g, '\n\n').slice(0, 12000)
        };
      }
    });
    const content = results?.[0]?.result;
    if (content) await updatePageContent(targetTabId, content.text);
    return content || { text: '' };
  } catch (err) {
    return { error: err.message };
  }
}

async function indexPageElements(tabId, highlight = false) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');

  try {
    return await chrome.tabs.sendMessage(targetTabId, { action: 'indexInteractiveElements', highlight });
  } catch (e) {
    return { error: 'Content script not reachable on this tab (chrome:// or protected page)' };
  }
}

async function clickElement(tabId, selector, idx) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');

  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'clickElement', selector, idx });
    if (response) return response;
  } catch (e) {}

  // Fallback via scripting
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (sel, index) => {
        let el = (index !== undefined && index !== null) ? document.querySelector(`[data-quillan-idx="${index}"]`) : null;
        if (!el && sel) el = document.querySelector(sel);
        if (!el) return { success: false, error: 'Element not found' };
        el.scrollIntoView({ block: 'center' });
        el.focus();
        el.click();
        return { success: true };
      },
      args: [selector, idx]
    });
    return results?.[0]?.result || { success: false };
  } catch (err) {
    return { error: err.message };
  }
}

async function typeElement(tabId, selector, idx, text, pressEnter) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');

  try {
    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'typeElement', selector, idx, text, pressEnter });
    if (response) return response;
  } catch (e) {}

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: (sel, index, val, doEnter) => {
        let el = (index !== undefined && index !== null) ? document.querySelector(`[data-quillan-idx="${index}"]`) : null;
        if (!el && sel) {
          // Fallback: try multiple selectors for generic inputs
          const cands = sel.split(',').map(s=>s.trim()).filter(Boolean);
          for (const c of cands) { el = document.querySelector(c); if (el) break; }
          if (!el) el = document.querySelector('input[type="search"], input[name="q"], textarea[name="q"], textarea, input#search, ytd-searchbox input, [contenteditable="true"]');
        }
        if (!el) return { success: false, error: 'Element not found for '+sel };
        el.scrollIntoView({ block: 'center' });
        el.focus();
        // Handle contenteditable vs input
        if (el.isContentEditable) {
          el.textContent = val;
          el.dispatchEvent(new InputEvent('input', { bubbles:true }));
        } else {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (doEnter) {
          const opts = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true };
          el.dispatchEvent(new KeyboardEvent('keydown', opts));
          el.dispatchEvent(new KeyboardEvent('keypress', opts));
          el.dispatchEvent(new KeyboardEvent('keyup', opts));
          if (el.form) try { el.form.submit(); } catch {}
        }
        return { success: true, typed: val.slice(0,40), selector: sel };
      },
      args: [selector, idx, text, !!pressEnter]
    });
    return results?.[0]?.result || { success: false };
  } catch (err) {
    return { error: err.message };
  }
}

async function scrollPage(tabId, direction = 'down', amount = 400) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');

  try {
    return await chrome.tabs.sendMessage(targetTabId, { action: 'scrollTo', direction, amount });
  } catch (e) {
    return { error: e.message };
  }
}

async function captureScreenshot(tabId) {
  const targetTabId = tabId || await getActiveTabId();
  if (!targetTabId) throw new Error('No active tab');
  
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return { screenshot: dataUrl };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Fully web use: tabCapture / desktopCapture / cookies / history / bookmarks / etc. ──
async function captureTabMedia(tabId) {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId || await getActiveTabId() });
    return { streamId, success: true };
  } catch (e) { return { error: e.message }; }
}
async function captureDesktopMedia(sources = ['screen','window','tab']) {
  return new Promise(resolve => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(sources, null, (streamId) => {
        if (!streamId) return resolve({ error: 'user cancelled picker' });
        resolve({ streamId, success: true });
      });
    } catch (e) { resolve({ error: e.message }); }
  });
}
async function getCookies(tabId, url) {
  try {
    const tab = tabId ? await chrome.tabs.get(tabId) : null;
    const targetUrl = url || tab?.url || 'https://google.com';
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    return { cookies, count: cookies.length };
  } catch (e) { return { error: e.message }; }
}
async function setCookie(cookie) {
  try { const c = await chrome.cookies.set(cookie); return { cookie: c, success:true }; } catch(e){ return {error:e.message}; }
}
async function getHistory(query = { text:'', maxResults: 10 }) {
  try { const h = await chrome.history.search(query); return { history: h }; } catch(e){ return {error:e.message}; }
}
async function getBookmarks() {
  try { const b = await chrome.bookmarks.getTree(); return { bookmarks: b }; } catch(e){ return {error:e.message}; }
}
async function createBookmark(title, url) {
  try { const b = await chrome.bookmarks.create({ title, url }); return { bookmark:b, success:true }; } catch(e){ return {error:e.message}; }
}
async function getDownloads(query = {}) {
  try { const d = await chrome.downloads.search(query); return { downloads:d.slice(0,20) }; } catch(e){ return {error:e.message}; }
}
async function getTopSites() {
  try { const s = await chrome.topSites.get(); return { topSites:s }; } catch(e){ return {error:e.message}; }
}
async function getSessions() {
  try { const s = await chrome.sessions.getRecentlyClosed({ maxResults: 10 }); return { sessions:s }; } catch(e){ return {error:e.message}; }
}
async function manageWindows(params = {}) {
  try {
    if (params.create) return await chrome.windows.create(params.create);
    if (params.update) return await chrome.windows.update(params.windowId, params.update);
    const wins = await chrome.windows.getAll({ populate:true });
    return { windows:wins };
  } catch(e){ return {error:e.message}; }
}
async function capturePageMHTML(tabId) {
  try {
    const blob = await chrome.pageCapture.saveAsMHTML({ tabId: tabId || await getActiveTabId() });
    // blob is object, convert to base64 size hint only
    return { success:true, size: blob.size || 0, type: blob.type };
  } catch(e){ return {error:e.message}; }
}
async function handleContentSettings(params) {
  try {
    if (!params.contentType) return { error:'contentType required' };
    const r = await chrome.contentSettings[params.contentType].get({ primaryUrl: params.primaryUrl || 'https://google.com/*' });
    return r;
  } catch(e){ return {error:e.message}; }
}

async function sendResult(commandId, result) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESULT_TIMEOUT);
    
    await fetch(`${SERVER_URL}/api/ext/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId, result, agentId: AGENT_ID }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
  } catch (error) {
    console.error('[Quillan Extension] Send result error:', error);
  }
}

