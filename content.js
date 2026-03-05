// content.js — CodeGrab Content Script
// Receives code notifications from the background worker and shows the overlay.

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__codeGrabInjected) return;
  window.__codeGrabInjected = true;

  let overlayEl = null;
  let dismissTimer = null;
  let lastFocusedInput = null;

  // -------------------------------------------------------------------------
  // Track focused input fields
  // -------------------------------------------------------------------------
  document.addEventListener('focusin', e => {
    if (isFillinput(e.target)) lastFocusedInput = e.target;
  }, true);

  // Keep the reference alive when user clicks inside the overlay
  document.addEventListener('focusout', e => {
    // Don't clear — we need it for autofill even after focus moves to overlay button
  }, true);

  // -------------------------------------------------------------------------
  // Message listener
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'showCode') {
      showOverlay(msg.code, msg.sender, msg.subject);
      sendResponse({ ok: true });
    }
    if (msg.action === 'ping') {
      sendResponse({ alive: true });
    }
  });

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------
  function showOverlay(code, sender, subject) {
    removeOverlay();

    // Only show if tab is visible (skip background tabs — they'll show when focused)
    // We still inject the overlay so it's ready; visibility class controls opacity.

    overlayEl = document.createElement('div');
    overlayEl.id = 'cg-overlay';
    overlayEl.setAttribute('data-codegrab', 'true');
    overlayEl.innerHTML = buildHTML(code, sender);

    positionOverlay(overlayEl);
    document.body.appendChild(overlayEl);

    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => overlayEl?.classList.add('cg-in')));

    // Dismiss button
    overlayEl.querySelector('.cg-x').addEventListener('click', e => {
      e.stopPropagation();
      removeOverlay();
    });

    // Autofill button
    overlayEl.querySelector('.cg-fill').addEventListener('click', e => {
      e.stopPropagation();
      doAutofill(code);
    });

    // Clicking the code itself also autofills
    overlayEl.querySelector('.cg-code').addEventListener('click', e => {
      e.stopPropagation();
      doAutofill(code);
    });

    // Auto-dismiss after 30 s
    dismissTimer = setTimeout(removeOverlay, 30_000);
  }

  function buildHTML(code, sender) {
    return `
      <div class="cg-card">
        <div class="cg-top">
          <div class="cg-icon-wrap">
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="2" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M7 18h6M10 15v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M5.5 7.5h3M11.5 7.5H14.5M5.5 10.5H7.5M9.5 10.5H11M13 10.5H14.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="cg-meta">
            <span class="cg-eyebrow">Security Code</span>
            <span class="cg-from">${esc(sender)}</span>
          </div>
          <button class="cg-x" aria-label="Dismiss">&#x2715;</button>
        </div>
        <div class="cg-body">
          <div class="cg-code-row">
            <span class="cg-code" title="Click to autofill">${esc(code)}</span>
            <button class="cg-fill">
              <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                <path d="M6 3H4a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1V4a1 1 0 00-1-1h-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <rect x="5.5" y="1.5" width="5" height="3" rx="1" stroke="currentColor" stroke-width="1.3"/>
              </svg>
              Autofill
            </button>
          </div>
          <div class="cg-bar"><div class="cg-bar-fill"></div></div>
        </div>
      </div>`;
  }

  function positionOverlay(el) {
    el.style.cssText = 'position:fixed;z-index:2147483647;';

    const input = lastFocusedInput && document.contains(lastFocusedInput) ? lastFocusedInput : null;

    if (input) {
      const r = input.getBoundingClientRect();
      const W = 284;
      let top = r.top - 80;
      let left = r.left;

      // Flip below input if not enough room above
      if (top < 8) top = r.bottom + 8;
      // Clamp horizontally
      if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
      if (left < 8) left = 8;

      el.style.top = top + 'px';
      el.style.left = left + 'px';
    } else {
      // Default: top-right corner
      el.style.top = '18px';
      el.style.right = '18px';
    }
  }

  function removeOverlay() {
    clearTimeout(dismissTimer);
    dismissTimer = null;
    if (!overlayEl) return;
    overlayEl.classList.remove('cg-in');
    overlayEl.classList.add('cg-out');
    const el = overlayEl;
    overlayEl = null;
    setTimeout(() => el.parentNode?.removeChild(el), 280);
  }

  // -------------------------------------------------------------------------
  // Autofill
  // -------------------------------------------------------------------------
  function doAutofill(code) {
    // 1. Copy to clipboard first (always works)
    copyToClipboard(code);

    // 2. Fill the focused input if available
    const target = lastFocusedInput && document.contains(lastFocusedInput)
      ? lastFocusedInput
      : document.querySelector('input[type="text"],input[type="number"],input[type="tel"],input:not([type]),input[autocomplete*="one-time"]');

    if (target) {
      target.focus();
      // Use native setter to trigger React/Vue synthetic events
      const setter = Object.getOwnPropertyDescriptor(
        target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      );
      setter?.set ? setter.set.call(target, code) : (target.value = code);

      ['input', 'change'].forEach(type =>
        target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
      );
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      showToast('✓ Code filled & copied');
    } else {
      showToast('✓ Code copied to clipboard');
    }

    removeOverlay();
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => execCopy(text));
    } else {
      execCopy(text);
    }
  }

  function execCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  // -------------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------------
  function showToast(msg) {
    const old = document.getElementById('cg-toast');
    if (old) old.remove();

    const t = document.createElement('div');
    t.id = 'cg-toast';
    t.setAttribute('data-codegrab', 'true');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('cg-toast-in')));
    setTimeout(() => {
      t.classList.remove('cg-toast-in');
      setTimeout(() => t.remove(), 260);
    }, 2200);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function isFillinput(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (el.contentEditable === 'true') return true;
    if (tag !== 'input') return false;
    const skip = new Set(['submit','button','image','file','checkbox','radio','range','color','hidden','reset']);
    return !skip.has((el.type || 'text').toLowerCase());
  }

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }
})();
