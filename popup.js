// Configuration constants
const API = 'http://127.0.0.1:7777';
const MAX_TRANSCRIPT_LENGTH = 200;
const MAX_STORAGE_HISTORY = 20;
const MAX_HISTORY_CONTEXT = 6;
const STREAM_TIMEOUT_STANDARD = 60000;
const STREAM_TIMEOUT_FULLDIVE = 240000;
const PAGE_CONTENT_MAX_LENGTH = 9000;
const YOUTUBE_RESULTS_MAX = 16;
const GOOGLE_LINKS_MAX = 12;
const SEARCH_QUERY_MAX_LENGTH = 80;
const TAB_NAVIGATION_DELAY_MS = 3800;
const YOUTUBE_NAVIGATION_DELAY_MS = 4200;
const RETRY_DELAY_MS = 900;

// sidePanel behavior is set by background service worker; popup should not call it
// (calling here can throw "No tab with id" in popup context)

const log = document.getElementById('log');
const input = document.getElementById('q');
const send = document.getElementById('send');
const modeSel = document.getElementById('mode');
const saveBtn = document.getElementById('saveBtn');
const histBtn = document.getElementById('histBtn');
const cleanMcpBtn = document.getElementById('cleanMcpBtn');
const panelBtn = document.getElementById('panelBtn');
const keyBtn = document.getElementById('keyBtn');
const memline = document.getElementById('memline');
const historyPanel = document.getElementById('historyPanel');
const councilBadge = document.getElementById('councilBadge');

const explainBtn = document.getElementById('explainBtn');
const scrapeBtn = document.getElementById('scrapeBtn');
const indexBtn = document.getElementById('indexBtn');
const chessBtn = document.getElementById('chessBtn');
const taskBtn = document.getElementById('taskBtn');

let history = [];
let transcript = [];
let busy = false;
let marksActive = false;

// Simple markdown formatter
function renderMarkdown(raw) {
  let text = String(raw || '');
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/\[⚙️ ([^\]]+)\]/g, '<span style="color:var(--gold); font-size:11.5px; font-weight:600;">[⚙️ $1]</span>');

  const parts = text.split(/(<pre>[\s\S]*?<\/pre>)/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith('<pre>')) {
      parts[i] = parts[i].replace(/\n/g, '<br>');
    }
  }
  return parts.join('');
}

function add(cls, text, isHtml = false) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  if (isHtml) d.innerHTML = text;
  else d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

function updateBadge(routeOrModel) {
  if (!councilBadge) return;
  if (routeOrModel === 'code' || /code|python|js|bug/i.test(routeOrModel)) councilBadge.textContent = 'C9-CODEWEAVER';
  else if (/browser|web|page|url/i.test(routeOrModel)) councilBadge.textContent = 'C28-NAVIGATOR';
  else if (/tool|action|click|type/i.test(routeOrModel)) councilBadge.textContent = 'C19-ARTIFEX';
  else if (/chess|move|game/i.test(routeOrModel)) councilBadge.textContent = 'C33-PREDATOR';
  else if (/architect/i.test(routeOrModel)) councilBadge.textContent = 'C25-TECHNE';
  else if (/fulldive/i.test(routeOrModel)) councilBadge.textContent = 'C6-LOGOS';
  else councilBadge.textContent = 'C0-SOVEREIGN';
}

function track(role, text) {
  transcript.push({ role, text });
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) transcript = transcript.slice(-MAX_TRANSCRIPT_LENGTH);
}

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
  return j;
}

function refreshMemoryLine() {
  api('/api/memory').then(j => {
    if (j.memories) memline.textContent = `🧠 ${j.memories.length} memories`;
  }).catch(() => { memline.textContent = ''; });
}

// Detect queries that refer to current tab — auto-inject real page text so model is grounded
function isPageDeictic(msg) {
  const l = String(msg).toLowerCase();
  return /\b(this|that|current)\b.{0,18}\b(video|page|tab|site|article|youtube|watching)\b/i.test(l) ||
    /\bwhat('?s| is) (this|that) video\b/i.test(l) ||
    /\ball about\b/i.test(l) && /\bvideo\b/i.test(l) ||
    /\bexplain (this|that) (video|page)\b/i.test(l);
}
function isVideoSearchQuery(msg) {
  const l = String(msg).toLowerCase();
  return /\b(find|search|show|get|recommend|suggest|give)\b.{0,42}\bvideos?\b/i.test(l) ||
    /\b(find|search|show|get|recommend|suggest|give)\b.{0,42}\byoutube\b/i.test(l) ||
    /\b(similar|another|related)\b.{0,32}\bvideos?\b/i.test(l) ||
    /\bmore (explained|detailed|beginner|simple)\b.{0,20}\bvideos?\b/i.test(l) ||
    /related videos?/i.test(l);
}
function isUseCurrentSearchIntent(msg) {
  // Typo-tolerant: "seach" -> "search", catches "use this search", "in my tab ask it", "ask brave"
  const raw = String(msg).toLowerCase();
  const l = raw.replace(/\bseach\b/g, 'search');
  return /\buse this search\b/i.test(l) ||
    /\buse this seach\b/i.test(raw) ||
    /\bin my tab ask it\b/i.test(l) ||
    /\bask brave\b/i.test(l) ||
    (/\buse this\b/i.test(l) && /\bsearch\b/i.test(l)) ||
    (/\bcan you use this\b/i.test(l) && /search/i.test(l));
}
async function handleUseCurrentSearch(msg) {
  if (busy) return;
  // Extract query — "about quillan ronin" -> "quillan ronin", tolerant of typo "seach"
  const normalized = String(msg).toLowerCase().replace(/\bseach\b/g, 'search');
  let q = 'quillan ronin';
  let m = normalized.match(/search[^a-z]*.*?about\s+["']?([^"'\n?]+)["']?/i);
  if (m) q = m[1].trim().replace(/\bseach\b/g,'').slice(0, SEARCH_QUERY_MAX_LENGTH);
  else if (/quillan/i.test(msg)) q = 'quillan ronin';
  else if (m = msg.match(/about\s+["']?([^"'\n?]+)["']?/i)) q = m[1].trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  add('user', msg); track('user', msg);
  add('sys', `⌨️ Using this tab's search box to search for: "${q}"…`);
  const tab = await getActiveTab();
  try {
    const rs = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (txt) => {
        const sels = [
          'input[name="q"]','textarea[name="q"]','input[type="search"]','textarea[aria-label*="Search"]',
          'input#search','ytd-searchbox input','div[contenteditable="true"]','input','textarea'
        ];
        let el=null; for(const s of sels){ el=document.querySelector(s); if(el && el.offsetParent) break; }
        if(!el) return {success:false, error:'search box not found on this page', hint: document.documentElement.innerHTML.slice(0,800)};
        el.scrollIntoView({block:'center'}); el.focus();
        if(el.isContentEditable){ el.textContent=txt; el.dispatchEvent(new InputEvent('input',{bubbles:true})); }
        else { el.value=txt; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
        const ev={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true};
        el.dispatchEvent(new KeyboardEvent('keydown',ev)); el.dispatchEvent(new KeyboardEvent('keypress',ev)); el.dispatchEvent(new KeyboardEvent('keyup',ev));
        if(el.form) try{el.form.submit();}catch{}
        // Also try clicking search button as fallback
        const btn = document.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="Search"]');
        if(btn) setTimeout(()=>btn.click(),150);
        return {success:true, selector: el.tagName+(el.id?'#'+el.id:''), typed:txt};
      },
      args: [q]
    });
    const r = rs?.[0]?.result;
    if (r?.success) {
      add('sys', `✅ Typed "${q}" into ${r.selector} + Enter`);
      await new Promise(r=>setTimeout(r, TAB_NAVIGATION_DELAY_MS));
      const page = await fetchPageForGrounding();
      const prompt = `User said "${msg}" — I used THIS TAB's search box (not YouTube) to search for "${q}" and pressed Enter. Current page after:\nTITLE: ${page.title}\nURL: ${page.url}\nTEXT:\n${(page.text||'').slice(0, PAGE_CONTENT_MAX_LENGTH)}\n\nTask: summarize REAL results for "${q}" from above page text using ONLY what you see. Do NOT invent GitHub/academic database results.`;
      await streamAsk(prompt, `🔍 This-tab search: ${q}`);
    } else {
      add('quillan', `Couldn't find search box on this page: ${r?.error} — will navigate via URL fallback.`);
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      await chrome.tabs.update(tab.id, {url});
    }
  } catch(e){ add('quillan','Type failed: '+e.message); }
}
function isGoogleSearchIntent(msg) {
  const l = String(msg).toLowerCase().replace(/\bseach\b/g, 'search');
  // General web search — default to Google unless explicitly video/youtube
  return /\btype into google\b/i.test(l) ||
    /\bsearch.*google\b/i.test(l) ||
    /\bgoogle.*search\b/i.test(l) ||
    /\bask google\b/i.test(l) ||
    /\btype and ask google\b/i.test(l) ||
    (/\bsearch about\b/i.test(l) && /quillan/i.test(l)) ||
    /google and search about/i.test(l) ||
    // General agent: any "search about X" without video -> Google (typo-tolerant)
    (/\bsearch.*about\b/i.test(l) && !/\bvideo|youtube\b/i.test(l)) ||
    (/\bsearch for\b/i.test(l) && /quillan/i.test(l) && !/\bvideo|youtube\b/i.test(l));
}
async function handleGoogleSearch(msg) {
  if (busy) return;
  // Extract query — e.g. "quillan ronin" from "type into google and search about quillan ronin"
  let q = 'quillan-ronin';
  let m = msg.match(/search about\s+["']?([^"'\n?]+)["']?/i);
  if (m) q = m[1].trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  else if (/quillan/i.test(msg)) q = 'quillan ronin';
  else { m = msg.match(/google\s+search\s+["']?([^"'\n]+)["']?/i); if (m) q = m[1].trim().slice(0, SEARCH_QUERY_MAX_LENGTH); }
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  add('user', msg); track('user', msg);
  const tab0 = await getActiveTab();
  const isGoogleHome = /google\.com\/?(\?.*)?$/.test(tab0.url||'') && !/google\.com\/search/.test(tab0.url||'');
  if (isGoogleHome) {
    add('sys', `⌨️ Google homepage detected — typing "${q}" into its search box…`);
    try {
      const rs = await chrome.scripting.executeScript({
        target: { tabId: tab0.id },
        func: (txt) => {
          const sels = ['textarea[name="q"]','input[name="q"]','textarea[aria-label*="Search"]','input[type="search"]','textarea'];
          let el=null; for(const s of sels){ el=document.querySelector(s); if(el && el.offsetParent) break; }
          if(!el) el=document.querySelector('input, textarea');
          if(!el) return {success:false, error:'google search box not found'};
          el.scrollIntoView({block:'center'}); el.focus();
          if(el.isContentEditable){ el.textContent=txt; el.dispatchEvent(new InputEvent('input',{bubbles:true})); }
          else { el.value=txt; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
          const ev={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true};
          el.dispatchEvent(new KeyboardEvent('keydown',ev)); el.dispatchEvent(new KeyboardEvent('keypress',ev)); el.dispatchEvent(new KeyboardEvent('keyup',ev));
          if(el.form) try{el.form.submit();}catch{}
          return {success:true, typed:txt};
        },
        args: [q]
      });
      if (rs?.[0]?.result?.success) {
        add('sys', `✅ Typed "${q}" + Enter into Google search box`);
        await new Promise(r=>setTimeout(r, TAB_NAVIGATION_DELAY_MS));
        let text='', title='';
        try { const d=await chrome.tabs.sendMessage(tab0.id,{action:'getPageContent'}); text=d?.text||''; title=d?.title||''; }
        catch { try{ const r2=await chrome.scripting.executeScript({target:{tabId:tab0.id},func:()=>({title:document.title,text:(document.body?.innerText||'').slice(0,PAGE_CONTENT_MAX_LENGTH)})}); text=r2?.[0]?.result?.text||''; title=r2?.[0]?.result?.title||'';}catch{} }
        add('sys', `📄 Google results: ${title} — reading…`);
        const links = await collectGoogleLinks(tab0.id);
        const linksBlock = links.map((v,i)=> `${i+1}. "${v.title}" — ${v.href}`).join('\n');
        const prompt = `User asked to Google search about "${q}" and I typed it into the Google homepage search box and pressed Enter (single-tab). Current page after typing:\nTITLE: ${title}\nURL: ${tab0.url}\nTEXT:\n${(text||'').slice(0,6000)}\n\nREAL GOOGLE LINKS:\n${linksBlock||'(none)'}\n\nTask: summarize REAL Google results for "${q}" using ONLY above.`;
        await streamAsk(prompt, `⌨️ Google typed: ${q}`);
        return;
      }
    } catch {}
    add('sys', `Typing failed — falling back to URL navigation…`);
  }
  add('sys', `🔍 Navigating Google in current tab for: "${q}"…`);
  const tab = tab0;
  await chrome.tabs.update(tab.id, { url });
  await new Promise(r=>setTimeout(r, TAB_NAVIGATION_DELAY_MS));
  let text='', title='';
  try { const d=await chrome.tabs.sendMessage(tab.id,{action:'getPageContent'}); text=d?.text||''; title=d?.title||''; }
  catch { try{ const rs=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({title:document.title,text:(document.body?.innerText||'').slice(0,PAGE_CONTENT_MAX_LENGTH)})}); text=rs?.[0]?.result?.text||''; title=rs?.[0]?.result?.title||'';}catch{} }
  add('sys', `📄 Google results: ${title} — reading…`);
  const links = await collectGoogleLinks(tab.id);
  const linksBlock = links.map((v,i)=> `${i+1}. "${v.title}" — ${v.href}`).join('\n');
  const prompt = `User asked to Google search about "${q}" (typed into Google, not YouTube). I navigated current Brave tab to ${url}.\nREAL Google results page text (first ${PAGE_CONTENT_MAX_LENGTH} chars):\n${(text||'').slice(0,PAGE_CONTENT_MAX_LENGTH)}\n\nREAL GOOGLE LINKS extracted:\n${linksBlock || '(none)'}\n\nTask: summarize REAL Google results for "${q}" using ONLY text/links above. If Wikipedia/GitHub appears, mention it. Do NOT invent YouTube videos for a Google search.`;
  await streamAsk(prompt, `🔍 Google search: ${q}`);
}
async function collectGoogleLinks(tabId){
  try{
    const rs=await chrome.scripting.executeScript({target:{tabId},func:()=>{
      const out=[]; const seen=new Set();
      document.querySelectorAll('a[href^="http"]').forEach(a=>{
        const href=a.href; if(seen.has(href)) return; if(href.includes('google.com/search')||href.includes('google.com/url')) return;
        const title=(a.textContent||'').trim().replace(/\s+/g,' ').slice(0,100);
        if(!title||title.length<4) return;
        // Only keep likely result links (in #search)
        if(!a.closest('#search, #rso')) return;
        seen.add(href); out.push({title,href});
      });
      return out.slice(0, GOOGLE_LINKS_MAX);
    }});
    return rs?.[0]?.result || [];
  } catch {
    return [];
  }
}

function isPromptModelIntent(msg) {
  const l = String(msg).toLowerCase();
  return /\bprompt.*about (yourself|quillan)\b/i.test(l) ||
    /\btype a message to it\b/i.test(l) ||
    (/\bask.*about quillan\b/i.test(l) && /google|ai mode/i.test(l)) ||
    (/\bprompt\b/i.test(l) && /\bopen tab\b/i.test(l));
}
async function handlePromptModel(msg) {
  if (busy) { setTimeout(()=>{ busy=false; send.disabled=false; }, 3000); return; }
  add('user', msg); track('user', msg);
  add('sys','⌨️ Typing into AI prompt box on OPEN tab (per guide, not navigating)…');
  const tab = await getActiveTab();
  // Try 2-pass: first try prompt box, if not found try clicking AI Mode chip then retry
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const rs = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (promptText, isRetry) => {
          // Pass 1: try all prompt selectors; Pass 2: click AI Mode / Ask button first
          if (isRetry) {
            const candidates = [...document.querySelectorAll('button, a, div[role="button"]')];
            const aiBtn = candidates.find(b => /AI Mode|Ask|Gemini|Search.*AI/i.test(b.textContent||'') && b.offsetParent);
            if (aiBtn) { aiBtn.scrollIntoView({block:'center'}); aiBtn.click(); }
          }
          const sels = [
            'div[contenteditable="true"]', 'textarea[name="q"]','textarea[aria-label*="Ask"]','input[name="q"]',
            'div[role="textbox"]','textarea','input[type="search"]','input#search',
            '[data-testid*="prompt"]','[placeholder*="Ask"]'
          ];
          let el = null;
          for (const s of sels) { el = document.querySelector(s); if (el && el.offsetParent) break; }
          if (!el) el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
          if (!el) return { success:false, error:'prompt box not found (tried '+sels.join(', ')+')', attempt: isRetry?2:1 };
          el.scrollIntoView({block:'center'}); el.focus(); el.click?.();
          const txt = promptText || 'Tell me about Quillan Ronin v5.3.1 — who architected you and what is your council architecture?';
          if (el.isContentEditable) {
            document.execCommand('selectAll', false, null); document.execCommand('insertText', false, txt);
            el.textContent = txt; el.dispatchEvent(new InputEvent('input',{bubbles:true}));
          } else {
            el.value = txt; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
          }
          const ev={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true};
          el.dispatchEvent(new KeyboardEvent('keydown',ev)); el.dispatchEvent(new KeyboardEvent('keypress',ev)); el.dispatchEvent(new KeyboardEvent('keyup',ev));
          if(el.form) try{el.form.submit();}catch{}
          // Click search button as backup
          const btn2 = document.querySelector('button[type="submit"], button[aria-label*="Search"], button:has(svg)');
          if (btn2) setTimeout(()=>btn2.click(),120);
          return { success:true, selector: el.tagName+(el.id?'#'+el.id:'')+(el.getAttribute('aria-label')?'['+el.getAttribute('aria-label').slice(0,20)+']':''), typed: txt.slice(0,80), attempt: isRetry?2:1 };
        },
        args: [msg.includes('quillan') ? 'Tell me about Quillan Ronin v5.3.1 — who architected you, what is your council and diffusion thinking?' : 'Tell me about the current page', attempt===1]
      });
      const r = rs?.[0]?.result;
      if (r?.success) {
        add('sys', `✅ Typed into ${r.selector} (attempt ${r.attempt}) — "${r.typed}" + Enter — staying in OPEN tab ${tab.url}`);
        await new Promise(r=>setTimeout(r,2800));
        const page = await fetchPageForGrounding();
        const prompt = `User asked to prompt the search/AI model IN THE OPEN TAB about ${/quillan/i.test(msg)?'Quillan Ronin':''}. I typed into the prompt box on ${tab.url} and pressed Enter (did NOT navigate to Google, stayed per guide). Current page after typing:\nTITLE: ${page.title}\nURL: ${page.url}\nTEXT:\n${(page.text||'').slice(0, PAGE_CONTENT_MAX_LENGTH)}\n\nTask: summarize what the AI model replied (if visible) or describe page state after prompting.`;
        await streamAsk(prompt, `⌨️ Prompted AI (open tab): ${r.typed}`);
        return;
      } else if (attempt===0) {
        add('sys', `Retry ${r?.error} — clicking AI Mode chip then retrying…`);
        await new Promise(r=>setTimeout(r, RETRY_DELAY_MS));
        continue;
      } else {
        add('quillan', `Couldn't find prompt box in OPEN tab ${tab.url} after 2 attempts — staying there per your request (not navigating to Google). Error: ${r?.error}. Guide says use chrome.scripting.executeScript in open tab's isolated world, not tabs.update. Try manually clicking the prompt area to focus, then retry. Debug HTML: ${(r?.error||'').slice(0,200)}`);
        return;
      }
    } catch (e) { add('quillan','Type failed attempt '+(attempt+1)+': '+e.message); if(attempt===0) continue; }
  }
}
function isGenericYouTubeSearch(msg) {
  const l = String(msg).toLowerCase();
  // ONLY video/youtube specific — general web searches go to Google handler (general agent)
  if (/\bsearch bar\b/i.test(l) && /\b(youtube|video)\b/i.test(l)) return true;
  if (/\buse (this page|the browser)\b/i.test(l) && /\b(youtube|video)\b/i.test(l)) return true;
  if (/\bsearch.*youtube\b/i.test(l)) return true;
  if (/\byoutube.*search\b/i.test(l)) return true;
  if (/\bsearch.*video\b/i.test(l)) return true;
  if (l.trim() === 'go ahead' && transcript.slice(-2).some(t=>/quillan-ronin.*video|video.*quillan/i.test(t.text||''))) return true;
  return false;
}
function extractYouTubeQuery(msg, fallbackTitle) {
  let m = msg.match(/search for\s+["']?([^"'.,?\n]+)["']?/i);
  if (m) return m[1].trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  if (/quillan-ronin/i.test(msg)) return 'quillan-ronin';
  m = msg.match(/["']([^"']+quillan[^"']+)["']/i);
  if (m) return m[1].trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  // fallback to last topic
  return (fallbackTitle || '').slice(0, SEARCH_QUERY_MAX_LENGTH) || 'quillan-ronin';
}
// Keep last real YouTube results for "pick a video" follow-ups
let lastYouTubeResults = []; // [{title, href, channel}]
let lastSearchTabId = null;
async function collectYouTubeLinks(tabId) {
  try {
    const rs = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const out = [];
        const seen = new Set();
        // YouTube search results: anchor with /watch?v=
        document.querySelectorAll('a[href*="/watch?v="]').forEach(a => {
          const href = a.href.split('&')[0]; // strip &pp etc
          if (!href.includes('watch?v=')) return;
          if (seen.has(href)) return;
          seen.add(href);
          // Title: prefer #video-title, else anchor text, else title attr
          let title = (a.getAttribute('title') || a.textContent || '').trim().replace(/\s+/g,' ').slice(0,120);
          if (!title || title.length < 3) {
            const r = a.closest('ytd-video-renderer');
            title = r?.querySelector('#video-title')?.textContent?.trim().slice(0,120) || title;
          }
          if (!title || title.length < 3) return;
          const channel = a.closest('ytd-video-renderer')?.querySelector('#channel-name a')?.textContent?.trim().slice(0,40) || '';
          out.push({ title, href, channel });
        });
        return out.slice(0, YOUTUBE_RESULTS_MAX);
      }
    });
    return rs?.[0]?.result || [];
  } catch { return []; }
}
async function handleGenericYouTubeSearch(originalMsg) {
  if (busy) return;
  const current = await fetchPageForGrounding();
  const fallback = (current?.title || '').replace(/\s*-\s*YouTube\s*$/i,'').trim();
  const query = extractYouTubeQuery(originalMsg, fallback);
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  add('user', originalMsg);
  track('user', originalMsg);
  add('sys', `🔍 Searching YouTube in current tab for: "${query}"…`);
  // SINGLE-TAB MODE: reuse the tab you're on (don't spam new tabs)
  let tab = await getActiveTab();
  try { await chrome.tabs.update(tab.id, { url: searchUrl }); } catch { tab = await chrome.tabs.create({ url: searchUrl, active:true }); }
  lastSearchTabId = tab.id;
  await new Promise(r => setTimeout(r, YOUTUBE_NAVIGATION_DELAY_MS));
  let text = '', title = '';
  try { const d = await chrome.tabs.sendMessage(tab.id, { action:'getPageContent' }); text = d?.text||''; title = d?.title||''; }
  catch {
    try { const rs = await chrome.scripting.executeScript({ target:{tabId: tab.id}, func:()=>({ title: document.title, text: (document.body?.innerText||'').slice(0,9000)}) }); text = rs?.[0]?.result?.text||''; title = rs?.[0]?.result?.title||''; } catch {}
  }
  // Also collect structured links with real hrefs — retry once if YouTube lazy-loads
  lastYouTubeResults = await collectYouTubeLinks(tab.id);
  if (!lastYouTubeResults.length) { await new Promise(r=>setTimeout(r,1500)); lastYouTubeResults = await collectYouTubeLinks(tab.id); }
  if (!text && !lastYouTubeResults.length) { add('quillan','⚠️ Results not readable yet. Opened: '+searchUrl); return; }
  // Filter hallucinated discography: if query is quillan-ronin and no real JDXX results, don't invent
  const hasReal = lastYouTubeResults.length > 0;
  add('sys', `📄 Found: ${title} — ${lastYouTubeResults.length} videos linked — summarizing real results…`);
  const linksBlock = lastYouTubeResults.map((v,i)=> `${i+1}. "${v.title}" — ${v.channel||'unknown channel'} — ${v.href}`).join('\n');
  const antiHall = `ANTI-HALLUCINATION: You are Quillan-Ronin v5.3.1. NEVER invent discography, song titles, JDXX tracks, playlists, or watch URLs. Copy hrefs EXACTLY from REAL VIDEO LINKS below. If LINKS is empty or shows 0 results for "${query}", reply "No YouTube results found for '${query}' in the page I just read" — do NOT invent fake videos like "Neon Parallax" or "Elemental Avionics".`;
  const prompt = `User asked: ${originalMsg}\nContext: prior page was ${current?.title||''} @ ${current?.url||''}\nI just searched YouTube for "${query}" and opened ${searchUrl} IN THE SAME TAB.\n${antiHall}\nREAL results page text (first 6000 chars):\n${text.slice(0,6000)}\n\nREAL VIDEO LINKS extracted from DOM (use ONLY these exact hrefs, NEVER invent VIDEO_ID):\n${hasReal ? linksBlock : '(EMPTY — no watch?v links found, so there are NO videos to list)'}\n\nTask: ${hasReal ? 'list REAL videos from LINKS above (copy href exactly). Pick ONE to recommend (first).' : `state no results found for "${query}" and ask if user wants to try different query.`}`;
  await streamAsk(prompt, `🔍 YouTube search: ${query}`);
}
function isPickPlayIntent(msg) {
  const l = String(msg).toLowerCase();
  return /\b(pick|choose|select).{0,30}\bvideo\b/i.test(l) ||
    /\b(play|listen to).{0,20}\b(this|that|one|it)\b/i.test(l) ||
    /\bthe one you (want|would like)\b/i.test(l) ||
    /\byou (pick|choose|select)\b/i.test(l) ||
    l.trim() === 'ok go ahead' || l.trim() === 'go ahead' || l.trim() === 'pl' || /^go ahead\b/i.test(l);
}
async function handlePickAndPlay(originalMsg) {
  if (!lastYouTubeResults.length) {
    add('sys','No prior YouTube search to pick from — doing fresh quillan-ronin search…');
    return handleGenericYouTubeSearch('quillan-ronin');
  }
  // Try to match explicit title mentioned by LLM/user, else pick most relevant (first)
  let pick = lastYouTubeResults[0];
  const low = String(originalMsg).toLowerCase();
  // If LLM previously suggested "Gravity lock" and user says to play it, honor that
  for (const v of lastYouTubeResults) {
    const tLow = v.title.toLowerCase();
    if (low.includes(tLow.slice(0,12).toLowerCase()) || /gravity lock/i.test(low) && /gravity lock/i.test(v.title)) { pick = v; break; }
  }
  // For "pick a video you would like me to hear" — agent picks (prefer first with most signal)
  add('user', originalMsg);
  track('user', originalMsg);
  add('sys', `▶️ Opening picked video in same tab: "${pick.title}" — ${pick.href}`);
  try {
    // SINGLE-TAB: navigate the current/search tab to the video
    const curTab = lastSearchTabId ? { id: lastSearchTabId } : await getActiveTab();
    await chrome.tabs.update(curTab.id, { url: pick.href });
    add('quillan', `▶️ Playing **${pick.title}**${pick.channel?` — ${pick.channel}`:''}\n${pick.href}\n\nStaying in same tab as requested. If it didn't autoplay, click play.`, true);
  } catch (e) {
    add('quillan', `Failed to open video: ${e.message} — try ${pick.href}`);
  }
}
async function handleVideoSearch(originalMsg) {
  if (busy) return;
  const current = await fetchPageForGrounding();
  let topic = (current?.title || '').replace(/\s*-\s*YouTube\s*$/i,'').replace(/^Ex-NASA dev reveals his\s*/i,'').trim();
  if (!topic) topic = 'agentic engineering workflow';
  const userHint = originalMsg.toLowerCase().includes('explained better') ? ' explained simply' : ' explained';
  const query = (topic + userHint).slice(0, 90);
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  add('user', originalMsg);
  track('user', originalMsg);
  add('sys', `🔍 Searching YouTube in current tab for: "${query}"…`);
  // SINGLE-TAB MODE
  let searchTab = await getActiveTab();
  try { await chrome.tabs.update(searchTab.id, { url: searchUrl }); } catch { searchTab = await chrome.tabs.create({ url: searchUrl, active:true }); }
  lastSearchTabId = searchTab.id;
  await new Promise(r => setTimeout(r, YOUTUBE_NAVIGATION_DELAY_MS));
  let resultsText = '', resultsTitle = '';
  try { const data = await chrome.tabs.sendMessage(searchTab.id, { action: 'getPageContent' }); resultsText = data?.text||''; resultsTitle = data?.title||''; } catch {
    try { const rs = await chrome.scripting.executeScript({ target:{tabId: searchTab.id}, func:()=>({ title: document.title, text: (document.body?.innerText||'').slice(0,9000)}) }); resultsText = rs?.[0]?.result?.text||''; resultsTitle = rs?.[0]?.result?.title||''; } catch {}
  }
  lastYouTubeResults = await collectYouTubeLinks(searchTab.id);
  if (!lastYouTubeResults.length) { await new Promise(r=>setTimeout(r,1500)); lastYouTubeResults = await collectYouTubeLinks(searchTab.id); }
  if (!resultsText && !lastYouTubeResults.length) { add('quillan','⚠️ YouTube results page not readable yet. Opened: '+searchUrl); return; }
  const antiHall2 = `ANTI-HALLUCINATION: NEVER invent discography/songs. Use ONLY hrefs below. If EMPTY, say no results.`;
  add('sys', `📄 Found results: ${resultsTitle} — ${lastYouTubeResults.length} videos — summarizing…`);
  const linksBlock = lastYouTubeResults.map((v,i)=> `${i+1}. "${v.title}" — ${v.channel||''} — ${v.href}`).join('\n');
  const prompt = `User was watching: ${current?.title||'(unknown)'} @ ${current?.url||''}\nUser asked: ${originalMsg}\n\nI just searched YouTube for "${query}" and opened ${searchUrl} IN SAME TAB.\n${antiHall2}\nREAL results page text (first 6000 chars):\n${resultsText.slice(0,6000)}\n\nREAL VIDEO LINKS (use ONLY these exact hrefs, NEVER placeholder VIDEO_ID):\n${lastYouTubeResults.length ? linksBlock : '(EMPTY — no videos found)'}\n\nTask: ${lastYouTubeResults.length ? 'list 4-5 REAL videos from LINKS above (copy href exactly) with 1-line why each matches. Mark most beginner-friendly.' : `say no results found for "${query}"`}`;
  await streamAsk(prompt, `🔍 YouTube search: ${query}`);
}
async function fetchPageForGrounding() {
  try {
    const tab = await getActiveTab();
    // Try content-script first (fastest, works on https pages)
    try {
      const data = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
      if (data && data.text) return data;
    } catch {}
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
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
            text: extracted.replace(/\n{3,}/g, '\n\n').slice(0, 10000)
          };
        }
      });
      if (results?.[0]?.result?.text) return results[0].result;
    } catch {}
    return { title: tab.title || '', url: tab.url || '', text: '' };
  } catch { return null; }
}

// Ultra-fast streaming chat via Server-Sent Events (SSE)
async function streamAsk(messageText, displayOverride) {
  if (!messageText || busy) return;
  // Client-side grounding: if question is about "this video/page", fetch tab text and append
  let groundedMessage = messageText;
  if (isPageDeictic(messageText)) {
    add('sys', '🔍 Reading current tab to answer about this video/page…');
    const page = await fetchPageForGrounding();
    if (page && page.text) {
      groundedMessage += `\n\n[ACTIVE TAB — ${page.title} @ ${page.url}]\n${page.text.slice(0, PAGE_CONTENT_MAX_LENGTH)}\n[END TAB]`;
    } else if (page && page.title) {
      groundedMessage += `\n\n[ACTIVE TAB — ${page.title} @ ${page.url}]\n(No extractable text — page may be protected)`;
    }
  }
  busy = true; send.disabled = true;
  // ensure busy always clears even on abort — use try/finally
  let _busyCleared = false;
  const clearBusy = () => { if (!_busyCleared) { _busyCleared = true; busy = false; send.disabled = false; log.scrollTop = log.scrollHeight; } };
  updateBadge(messageText);

  add('user', displayOverride || (messageText.length > 300 ? messageText.slice(0, 300) + '…' : messageText));
  track('user', displayOverride || messageText);

  const t = add('quillan cursor', '');
  let fullText = '';

  try {
    const res = await fetch(API + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: groundedMessage,
        mode: modeSel.value,
        history: history.slice(-MAX_HISTORY_CONTEXT)
      }),
      signal: AbortSignal.timeout(modeSel.value === 'fulldive' ? STREAM_TIMEOUT_FULLDIVE : STREAM_TIMEOUT_STANDARD)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    let renderPending = false;
    const scheduleRender = () => {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => {
        t.innerHTML = renderMarkdown(fullText);
        log.scrollTop = log.scrollHeight;
        renderPending = false;
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.delta) {
              fullText += data.delta;
              scheduleRender();
            } else if (data.tool) {
              fullText += `\n\n[⚙️ ${data.tool}: ${data.result}]`;
              scheduleRender();
            }
          } catch {}
        }
      }
    }

    t.innerHTML = renderMarkdown(fullText);
    t.classList.remove('cursor');

    if (!fullText) t.textContent = '(empty)';
    track('assistant', fullText);
    history.push({ role: 'user', content: groundedMessage }, { role: 'assistant', content: fullText });
    if (history.length > MAX_STORAGE_HISTORY) history = history.slice(-MAX_STORAGE_HISTORY);
    refreshMemoryLine();
  } catch (e) {
    // Port 7777 is not running: Seamlessly fall back to direct Cloud API (NVIDIA NIM / Nemotron-3 Super)
    try {
      t.innerHTML = '<span style="color:var(--dim); font-size:11px;">⚡ Connecting to Cloud NIM Core...</span>';
      const stored = await chrome.storage.local.get(['nvidia_api_key']).catch(() => ({}));
      const apiKey = stored?.nvidia_api_key || "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";
      const cloudRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "nvidia/nemotron-3-super-120b-a12b",
          messages: [
            {
              role: "system",
              content: "You are Quillan-Ronin v5.4.0 ONI Sovereign Assistant. Decompose queries through the 9-Vector Semantic Prism and provide mathematically rigorous, actionable, and structured insights."
            },
            { role: "user", content: groundedMessage }
          ],
          temperature: 0.2,
          max_tokens: 2048
        })
      });

      if (!cloudRes.ok) {
        throw new Error(`Cloud API returned ${cloudRes.status}: ${await cloudRes.text()}`);
      }

      const cdata = await cloudRes.json();
      fullText = cdata.choices?.[0]?.message?.content || "(no output)";
      t.innerHTML = renderMarkdown(fullText);
      t.classList.remove('cursor');
      track('assistant', fullText);
      history.push({ role: 'user', content: groundedMessage }, { role: 'assistant', content: fullText });
    } catch (cloudErr) {
      t.classList.remove('cursor');
      t.innerHTML = `<span style="color:var(--red);">⚠️ Connection error: ${e.message}</span><br><span style="font-size:11px; color:var(--dim);">Local worker offline & Cloud fallback failed: ${cloudErr.message}</span>`;
    }
  } finally { clearBusy(); }
}

// ─── ACTIVE TAB BROWSER CAPABILITIES ────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab available');
  return tab;
}

async function explainPage() {
  if (busy) return;
  updateBadge('browser');
  add('sys', 'Reading active page content...');
  try {
    const tab = await getActiveTab();
    let pageData;
    try {
      pageData = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContent' });
    } catch {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 10000) })
      });
      pageData = results?.[0]?.result;
    }

    if (!pageData || !pageData.title) throw new Error('Page cannot be read (browser-internal page)');
    const prompt = `Explain this webpage clearly and concisely.\n\nTITLE: ${pageData.title}\nURL: ${pageData.url}\n\nPAGE CONTENT:\n${pageData.text}`;
    await streamAsk(prompt, `📄 Explain page: ${pageData.title}`);
  } catch (err) {
    add('quillan', `Could not read page: ${err.message}`);
  }
}

async function deepScrapePage() {
  if (busy) return;
  updateBadge('browser');
  add('sys', 'Extracting structured headings and interactive tree...');
  try {
    const tab = await getActiveTab();
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'getPageStructure' });
    if (res?.structure) {
      const st = res.structure;
      const formatted = `### 🔍 Structured Page Overview: **${st.title}**\n**URL**: ${st.url}\n**Interactive Elements**: ${st.interactiveCount}\n**Headings**:\n${st.headings.map(h => `- [${h.level.toUpperCase()}] ${h.text}`).join('\n') || 'None'}\n\n**Sample Interactive Nodes**:\n${st.interactiveSample.slice(0, 10).map(i => `- [${i.idx}] <${i.tag}> ${i.text || i.href}`).join('\n')}`;
      add('quillan', renderMarkdown(formatted), true);
    }
  } catch (err) {
    add('quillan', `Scrape failed: ${err.message}`);
  }
}

async function toggleSetOfMarks() {
  if (busy) return;
  updateBadge('tool');
  try {
    const tab = await getActiveTab();
    marksActive = !marksActive;
    if (marksActive) {
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'indexInteractiveElements', highlight: true });
      indexBtn.classList.add('active');
      add('sys', `🎯 Set-of-Marks active: Tagged ${res?.elements?.length || 0} interactive elements.`);
    } else {
      await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
      indexBtn.classList.remove('active');
      add('sys', '🎯 Set-of-Marks cleared.');
    }
  } catch (err) {
    add('quillan', `Marks toggle failed: ${err.message}`);
  }
}

async function playChessTurn() {
  if (busy) return;
  updateBadge('chess');
  add('sys', '♟️ Reading active board & computing best move...');
  try {
    const tab = await getActiveTab();
    
    // 1. Read board directly from tab DOM
    let board = null;
    try {
      board = await chrome.tabs.sendMessage(tab.id, { action: 'chessReadBoard' });
    } catch {}

    if (!board || !board.map || Object.keys(board.map).length < 4) {
      add('quillan', '⚔️ No active chess board detected on current tab. Open Chess.com or Lichess in this browser.');
      return;
    }

    add('sys', `♟️ Authoritative board read: ${board.count} pieces on screen. Consulting Predator engine...`);
    
    // 2. Call Quillan backend for best move
    const res = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'play and win this match' })
    });

    if (res.reply) {
      add('quillan', renderMarkdown(res.reply), true);
    }
  } catch (err) {
    add('quillan', `Chess move error: ${err.message}`);
  }
}

async function runAutonomousGoal() {
  const goal = prompt('Enter autonomous browsing goal for Quillan:');
  if (!goal || !goal.trim()) return;

  add('user', `⚡ Goal: ${goal.trim()}`);
  add('sys', '⚔️ Initializing autonomous browser loop...');
  updateBadge('browser');

  try {
    const tab = await getActiveTab();
    // Index page state
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'indexInteractiveElements', highlight: true });
    const elements = res?.elements || [];

    const promptText = `AUTONOMOUS BROWSER GOAL: ${goal.trim()}\nCURRENT PAGE: ${tab.title} (${tab.url})\n\nVISIBLE INTERACTIVE NODES (${elements.length}):\n${elements.slice(0, 30).map(e => `[${e.idx}] <${e.tag}> "${e.text}" ${e.href ? `href=${e.href}` : ''}`).join('\n')}\n\nDECIDE THE NEXT ACTION TO ADVANCE THIS GOAL.`;
    await streamAsk(promptText, `⚡ Executing Goal: ${goal.trim()}`);
  } catch (e) {
    await streamAsk(`Perform this browser task: ${goal.trim()}`);
  }
}

// ─── TOOLBAR & EVENT LISTENERS ──────────────────────────────────────────────
explainBtn.addEventListener('click', explainPage);
scrapeBtn.addEventListener('click', deepScrapePage);
indexBtn.addEventListener('click', toggleSetOfMarks);
chessBtn.addEventListener('click', playChessTurn);
taskBtn.addEventListener('click', runAutonomousGoal);

cleanMcpBtn.addEventListener('click', async () => {
  add('sys', 'Cleaning orphaned MCP node/python processes...');
  try {
    const r = await api('/api/mcp/clean', { method: 'POST' });
    add('sys', `🧹 MCP cleanup complete. Stopped ${r.stoppedServers} servers.`);
  } catch (e) {
    add('sys', `Cleanup error: ${e.message}`);
  }
});

send.addEventListener('click', () => {
  const txt = input.value.trim();
  if (!txt) return;
  input.value = '';
  if (isUseCurrentSearchIntent(txt)) { handleUseCurrentSearch(txt); return; }
  if (isGoogleSearchIntent(txt)) { handleGoogleSearch(txt); return; }
  if (isPromptModelIntent(txt)) { handlePromptModel(txt); return; }
  if (isPickPlayIntent(txt)) { handlePickAndPlay(txt); return; }
  if (isVideoSearchQuery(txt)) { handleVideoSearch(txt); return; }
  if (isGenericYouTubeSearch(txt)) { handleGenericYouTubeSearch(txt); return; }
  streamAsk(txt);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send.click();
  }
});

panelBtn.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (chrome.sidePanel) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    }
  } catch {}
});

histBtn.addEventListener('click', async () => {
  if (historyPanel.style.display === 'block') {
    historyPanel.style.display = 'none';
    return;
  }
  historyPanel.innerHTML = '<div style="color:var(--dim); font-size:11px;">Loading sessions...</div>';
  historyPanel.style.display = 'block';
  try {
    const j = await api('/api/chats');
    historyPanel.innerHTML = '<div style="font-size:11px; font-weight:700; margin-bottom:6px; color:var(--cyan);">Saved Sessions</div>';
    if (!j.chats?.length) {
      historyPanel.innerHTML += '<div style="color:var(--dim); font-size:11px;">No saved sessions yet.</div>';
      return;
    }
    j.chats.forEach(c => {
      const row = document.createElement('div');
      row.className = 'chatrow';
      row.innerHTML = `<b>${c.title}</b><span>${new Date(c.savedAt).toLocaleString()} · ${c.turns} turns</span>`;
      row.onclick = async () => {
        const full = await api('/api/chats/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: c.id })
        });
        historyPanel.style.display = 'none';
        log.innerHTML = '';
        (full.messages || []).forEach(m => add(m.role === 'user' ? 'user' : 'quillan', renderMarkdown(m.text || m.content), true));
      };
      historyPanel.appendChild(row);
    });
  } catch (e) {
    historyPanel.innerHTML = `<div style="color:var(--red);">Error: ${e.message}</div>`;
  }
});

saveBtn.addEventListener('click', async () => {
  if (!transcript.length) { add('sys', 'Nothing to save yet'); return; }
  const title = prompt('Session title:', transcript[0]?.text?.slice(0, 30) || 'Quillan Session');
  if (!title) return;
  try {
    await api('/api/chats/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages: transcript })
    });
    add('sys', '💾 Session saved successfully');
  } catch (e) {
    add('sys', 'Save failed: ' + e.message);
  }
});

if (keyBtn) {
  keyBtn.addEventListener('click', async () => {
    const current = await chrome.storage.local.get(['nvidia_api_key']).catch(() => ({}));
    const key = prompt('Enter your NVIDIA NIM or OpenAI-compatible API Key:', current?.nvidia_api_key || '');
    if (key !== null) {
      await chrome.storage.local.set({ nvidia_api_key: key.trim() });
      add('sys', '🔑 API Key updated successfully in browser storage.');
    }
  });
}

input.focus();
refreshMemoryLine();
updateBadge('init');
