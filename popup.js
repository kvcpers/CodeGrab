// popup.js — CodeGrab popup controller

document.addEventListener('DOMContentLoaded', () => {
  showPane('loading');

  // Load current status from background
  chrome.runtime.sendMessage({ action: 'getStatus' }, res => {
    if (res?.isAuthenticated) {
      renderMain(res);
    } else {
      showPane('auth');
    }
  });

  // ── Sign in ──────────────────────────────────────────────────────────────
  document.getElementById('btn-signin').addEventListener('click', () => {
    const btn = document.getElementById('btn-signin');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    chrome.runtime.sendMessage({ action: 'authenticate' }, res => {
      if (res?.success) {
        chrome.runtime.sendMessage({ action: 'getStatus' }, status => renderMain(status || {}));
      } else {
        btn.disabled = false;
        btn.innerHTML = signinBtnHTML();
        alert(`Sign-in failed: ${res?.error || 'Unknown error'}.\n\nMake sure your OAuth client_id is set in manifest.json.`);
      }
    });
  });

  // ── Sign out ─────────────────────────────────────────────────────────────
  document.getElementById('btn-signout').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'signOut' }, () => showPane('auth'));
  });

  // ── Toggle polling ───────────────────────────────────────────────────────
  document.getElementById('toggle-poll').addEventListener('change', () => {
    chrome.runtime.sendMessage({ action: 'togglePolling' }, res => {
      setStatusActive(res?.pollingEnabled !== false);
    });
  });

  // ── Manual check ─────────────────────────────────────────────────────────
  document.getElementById('btn-check').addEventListener('click', () => {
    const btn = document.getElementById('btn-check');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    chrome.runtime.sendMessage({ action: 'manualCheck' }, res => {
      btn.disabled = false;
      btn.innerHTML = checkBtnHTML();
      if (res?.found) {
        showCodeCard(res.code, res.sender, Date.now());
      } else {
        flashStatus('No new codes found');
      }
    });
  });

});

// ---------------------------------------------------------------------------
function renderMain(data) {
  showPane('main');
  setStatusActive(data.pollingEnabled !== false);

  if (data.lastCodeDetected) {
    const { code, sender, timestamp } = data.lastCodeDetected;
    showCodeCard(code, sender, timestamp);
  }
}

function showPane(name) {
  ['loading', 'auth', 'main'].forEach(id => {
    document.getElementById(`s-${id}`).classList.toggle('hidden', id !== name);
  });
}

function setStatusActive(active) {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('lbl-status');
  const sub   = document.getElementById('lbl-sub');
  const tog   = document.getElementById('toggle-poll');

  dot.classList.toggle('paused', !active);
  label.textContent = active ? 'Monitoring Gmail' : 'Monitoring paused';
  sub.textContent   = active ? 'Checking every 30 s' : 'Toggle to resume';
  tog.checked = active;
}

function showCodeCard(code, sender, timestamp) {
  document.getElementById('lbl-code').textContent = code;
  document.getElementById('lbl-from').textContent = sender ? `from ${sender}` : '';
  document.getElementById('lbl-time').textContent = formatAge(timestamp);
  document.getElementById('card-code').classList.remove('hidden');
}

function formatAge(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function flashStatus(msg) {
  const el = document.getElementById('lbl-status');
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = prev; }, 2500);
}

function signinBtnHTML() {
  return `<svg class="google-g" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908C16.658 14.013 17.64 11.705 17.64 9.2z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg> Sign in with Google`;
}

function checkBtnHTML() {
  return `<svg viewBox="0 0 16 16" fill="none" width="13" height="13">
    <path d="M2.5 2.5v4h4M13.5 8A5.5 5.5 0 112.93 5.07" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg> Check now`;
}
