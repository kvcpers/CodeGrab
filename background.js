// background.js — CodeGrab Service Worker
// Polls Gmail API for new security-code emails and broadcasts to content scripts.

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const POLL_MINUTES = 0.5; // every 30 seconds

// ---------------------------------------------------------------------------
// Code-extraction patterns (ordered highest → lowest confidence)
// ---------------------------------------------------------------------------
const PATTERNS = [
  // "verification code: 123456" / "security code — 8392" / "auth code: AB3F92"
  /(?:verification|security|authentication|auth|login|access|confirmation|one[\s\-]time|otp|2fa|two[\s\-]factor)\s+(?:code|pin|password|passcode)\s*[:\-–—]\s*([A-Z0-9]{4,8})/gi,
  // "your code is 123456" / "your OTP is 482910"
  /your\s+(?:code|otp|pin|password)\s+(?:is|:)\s*([A-Z0-9]{4,8})/gi,
  // "enter this code: AB3F92" / "use code 123456"
  /(?:enter|use)\s+(?:this\s+)?(?:code|otp|pin)\s*[:\-–—]?\s*([A-Z0-9]{4,8})/gi,
  // "OTP: 482910" standalone label
  /\botp\s*[:\-–—]\s*([0-9]{4,8})\b/gi,
  // generic "code: XXXXX"
  /\bcode\s*[:\-–—]\s*([A-Z0-9]{4,8})\b/gi,
  // bold/isolated 6-digit number (most common OTP format)
  /\b([0-9]{6})\b/g,
  // 4-digit PIN
  /\b([0-9]{4})\b/g,
];

// Subject-line keywords that identify security-code emails
const SUBJECT_KEYWORDS = [
  'verification', 'verify', 'otp', 'one-time', 'one time',
  'security code', 'auth code', 'login code', 'access code',
  'confirmation code', '2fa', 'two-factor', 'two factor',
  'sign-in code', 'signin code', 'sign in code', 'passcode',
  'your code', 'reset code', 'temporary password',
];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    isAuthenticated: false,
    pollingEnabled: true,
    processedIds: [],
    lastCodeDetected: null,
  });
});

chrome.runtime.onStartup.addListener(restorePolling);

async function restorePolling() {
  const { isAuthenticated, pollingEnabled } = await store('get', ['isAuthenticated', 'pollingEnabled']);
  if (isAuthenticated && pollingEnabled !== false) startPolling();
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  dispatch(msg).then(respond).catch(err => respond({ error: err.message }));
  return true; // keep channel open
});

async function dispatch(msg) {
  switch (msg.action) {
    case 'authenticate':   return authenticate();
    case 'signOut':        await signOut(); return { success: true };
    case 'getStatus':      return store('get', ['isAuthenticated', 'pollingEnabled', 'lastCodeDetected']);
    case 'togglePolling': {
      const { pollingEnabled } = await store('get', ['pollingEnabled']);
      const next = !pollingEnabled;
      await store('set', { pollingEnabled: next });
      if (next) startPolling(); else chrome.alarms.clear('pollGmail');
      return { pollingEnabled: next };
    }
    case 'manualCheck':  return checkForNewCodes();
    case 'testCode': {
      // Inject a fake code for UI testing
      const fakeCode = { code: '847291', sender: 'Google', subject: 'Your sign-in code', timestamp: Date.now() };
      await store('set', { lastCodeDetected: fakeCode });
      await broadcastCode(fakeCode);
      return { success: true };
    }
    default: return { error: 'unknown action' };
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function authenticate() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: true }, async token => {
      const err = chrome.runtime.lastError;
      if (err || !token) {
        const msg = err?.message || (token ? null : 'No token returned');
        console.error('[CodeGrab] Auth error:', msg);
        await store('set', { isAuthenticated: false });
        return resolve({ success: false, error: msg || 'Unknown error' });
      }
      // Seed processedIds with current inbox so we don't fire on old emails
      await store('set', { isAuthenticated: true });
      await seedProcessedIds(token);
      startPolling();
      resolve({ success: true });
    });
  });
}

async function signOut() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, token => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' }).catch(() => {});
        });
      }
      store('set', { isAuthenticated: false, processedIds: [], lastCodeDetected: null });
      chrome.alarms.clear('pollGmail');
      resolve();
    });
  });
}

// Mark all currently-existing recent emails as already seen so we don't
// fire false alerts when the user first signs in.
async function seedProcessedIds(token) {
  const data = await gmailFetch(`/users/me/messages?maxResults=20&q=${encodeURIComponent('in:inbox newer_than:10m')}`, token);
  if (!data?.messages) return;
  const ids = data.messages.map(m => m.id);
  await store('set', { processedIds: ids });
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
function startPolling() {
  chrome.alarms.clear('pollGmail', () => {
    chrome.alarms.create('pollGmail', { delayInMinutes: 0.05, periodInMinutes: POLL_MINUTES });
  });
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'pollGmail') return;
  const { isAuthenticated, pollingEnabled } = await store('get', ['isAuthenticated', 'pollingEnabled']);
  if (isAuthenticated && pollingEnabled !== false) checkForNewCodes();
});

// ---------------------------------------------------------------------------
// Core: fetch new emails and look for codes
// ---------------------------------------------------------------------------
async function checkForNewCodes() {
  const token = await getToken();
  if (!token) return { found: false, reason: 'not_authenticated' };

  const { processedIds = [] } = await store('get', ['processedIds']);

  // Query Gmail: unread inbox messages from last 3 minutes
  const q = encodeURIComponent('is:unread in:inbox newer_than:3m');
  const data = await gmailFetch(`/users/me/messages?maxResults=10&q=${q}`, token);
  if (!data?.messages?.length) return { found: false };

  // Deduplicate
  const fresh = data.messages.filter(m => !processedIds.includes(m.id));
  if (!fresh.length) return { found: false };

  // Mark as processed immediately (prevent re-processing on next poll)
  const updated = [...processedIds, ...fresh.map(m => m.id)].slice(-100);
  await store('set', { processedIds: updated });

  // Examine each fresh message
  for (const msg of fresh.slice(0, 5)) {
    const result = await processMessage(msg.id, token);
    if (result) {
      await store('set', { lastCodeDetected: result });
      await broadcastCode(result);
      return { found: true, ...result };
    }
  }

  return { found: false };
}

async function processMessage(id, token) {
  const msg = await gmailFetch(`/users/me/messages/${id}?format=full`, token);
  if (!msg?.payload) return null;

  const headers = msg.payload.headers || [];
  const subject  = getHeader(headers, 'subject');
  const from     = getHeader(headers, 'from');
  const sender   = parseSenderName(from);
  const bodyText = extractText(msg.payload);

  if (!looksLikeCodeEmail(subject, bodyText)) return null;

  const code = extractCode(subject + ' ' + bodyText);
  if (!code) return null;

  return { code, sender, subject, timestamp: Date.now(), messageId: id };
}

// ---------------------------------------------------------------------------
// Broadcast to content scripts
// ---------------------------------------------------------------------------
async function broadcastCode(info) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || /^(chrome|chrome-extension|about|data):/.test(tab.url)) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'showCode',
        code: info.code,
        sender: info.sender,
        subject: info.subject,
      });
    } catch (_) { /* content script not ready in this tab */ }
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
function extractCode(text) {
  const norm = text.replace(/\s+/g, ' ');
  for (const pat of PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(norm)) !== null) {
      const candidate = m[1]?.trim();
      if (!candidate || candidate.length < 4 || candidate.length > 8) continue;
      // Must be numeric-only OR alphanumeric (contains digits)
      if (/^\d+$/.test(candidate) || (/[0-9]/.test(candidate) && /[A-Z]/i.test(candidate))) {
        return candidate.toUpperCase();
      }
    }
  }
  return null;
}

function looksLikeCodeEmail(subject, body) {
  const t = (subject + ' ' + body).toLowerCase();
  return SUBJECT_KEYWORDS.some(kw => t.includes(kw));
}

function parseSenderName(from) {
  if (!from) return 'Unknown';
  // "Display Name <email@domain.com>"
  const nameMatch = from.match(/^"?([^"<]+?)"?\s*</);
  if (nameMatch?.[1]?.trim()) return nameMatch[1].trim();
  // plain email — use domain name as label
  const domainMatch = from.match(/@([^.>\s]+)/);
  if (domainMatch?.[1]) {
    const d = domainMatch[1];
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return from.split('@')[0] || 'Unknown';
}

function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractText(payload) {
  let out = '';
  const visit = part => {
    if (!part) return;
    if (part.body?.data) {
      let decoded = b64decode(part.body.data);
      if (part.mimeType === 'text/html') {
        decoded = decoded
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
          .replace(/\s+/g, ' ');
      }
      out += ' ' + decoded;
    }
    part.parts?.forEach(visit);
  };
  visit(payload);
  return out;
}

function b64decode(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function getToken() {
  return new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, token => {
      resolve(chrome.runtime.lastError ? null : token);
    });
  });
}

async function gmailFetch(path, token) {
  try {
    const res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      chrome.identity.removeCachedAuthToken({ token }, () => {});
      await store('set', { isAuthenticated: false });
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function store(op, data) {
  return new Promise(resolve => {
    if (op === 'get') chrome.storage.local.get(data, resolve);
    else chrome.storage.local.set(data, () => resolve());
  });
}
