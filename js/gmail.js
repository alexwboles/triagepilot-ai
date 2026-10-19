/* triagepilot-ai — Gmail connection via free OAuth 2.0 (read-only scope).
 *
 * Browser + Node module (same UMD shape as js/classifier.js).
 * The user's own Google Cloud OAuth client ID is supplied at runtime through
 * the local, gitignored file config/gmail.local.js:
 *
 *     window.TRIAGEPILOT_GMAIL = { clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com' };
 *
 * NOTHING credential-shaped lives in this file — no client ID, no secret,
 * no token. Access tokens are held in browser memory only (never localStorage)
 * and every API call accepts an injectable fetch so tests can mock the whole
 * Google API surface without real credentials.
 *
 * OAuth flow (browser only): Google Identity Services token model.
 *   - scope requested: https://www.googleapis.com/auth/gmail.readonly
 *   - GIS delivers an access token; this module then calls the Gmail REST API.
 * A client SECRET is never needed for a pure browser app (GIS token flow);
 * the config file may still carry one for a future server component, but this
 * module will never read it.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TriagePilotGmail = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
  var GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var DEFAULT_MAX = 25;

  // ---------------------------------------------------------------------------
  // Config — supplied by the user at runtime, never hardcoded here.
  // ---------------------------------------------------------------------------

  /** Read the local runtime config ({clientId}). null when not configured. */
  function getConfig() {
    var c = root_config();
    if (!c || typeof c.clientId !== 'string' || !c.clientId.trim()) return null;
    return { clientId: c.clientId.trim() };
  }

  function root_config() {
    try {
      if (typeof window !== 'undefined' && window.TRIAGEPILOT_GMAIL) return window.TRIAGEPILOT_GMAIL;
      if (typeof globalThis !== 'undefined' && globalThis.TRIAGEPILOT_GMAIL) return globalThis.TRIAGEPILOT_GMAIL;
    } catch (e) { /* sandboxed */ }
    return undefined;
  }

  /** True when a client ID has been supplied (the only requirement). */
  function isConfigured() { return getConfig() !== null; }

  // ---------------------------------------------------------------------------
  // OAuth — browser only, Google Identity Services token flow.
  // ---------------------------------------------------------------------------

  function ensureGis() {
    return new Promise(function (resolve, reject) {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        reject(new Error('OAuth requires a browser (Google Identity Services).'));
        return;
      }
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve(window.google.accounts.oauth2);
        return;
      }
      var existing = document.querySelector('script[data-tp-gis]');
      if (existing && !existing.dataset.tpGisLoaded) {
        existing.addEventListener('load', function () {
          if (window.google && window.google.accounts) resolve(window.google.accounts.oauth2);
          else reject(new Error('Google Identity Services failed to load.'));
        });
        existing.addEventListener('error', function () {
          reject(new Error('Could not load Google Identity Services — check the network connection.'));
        });
        return;
      }
      var s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.setAttribute('data-tp-gis', '1');
      s.addEventListener('load', function () {
        s.dataset.tpGisLoaded = '1';
        if (window.google && window.google.accounts) resolve(window.google.accounts.oauth2);
        else reject(new Error('Google Identity Services failed to load.'));
      });
      s.addEventListener('error', function () {
        reject(new Error('Could not load Google Identity Services — check the network connection.'));
      });
      document.head.appendChild(s);
    });
  }

  /**
   * Open the Google consent popup and resolve with an access token string.
   * The token is returned to the caller — this module never stores it.
   * Rejects if not configured or if the user closes/denies the popup.
   */
  function requestAccessToken(onToken, onError) {
    var cfg = getConfig();
    if (!cfg) {
      (onError || function () {})(new Error(
        'Gmail is not configured yet. Follow docs/GMAIL-SETUP.md, then add your ' +
        'client ID to config/gmail.local.js (see config/gmail.local.example.js).'));
      return;
    }
    ensureGis().then(function (oauth2) {
      var client = oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: GMAIL_SCOPE,
        callback: function (resp) {
          if (resp && resp.access_token) onToken(resp.access_token);
          else (onError || function () {})(new Error('Google returned no access token.'));
        }
      });
      client.requestAccessToken({ prompt: 'consent' });
    }).catch(function (err) { (onError || function () {})(err); });
  }

  /**
   * Revoke a token with Google and forget it. Best-effort: resolves regardless.
   */
  function revokeToken(accessToken, fetchFn) {
    var f = fetchFn || defaultFetch();
    if (!f || !accessToken) return Promise.resolve();
    return f('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(accessToken), { method: 'POST' })
      .then(function () { /* revoked */ }, function () { /* network hiccup — still forget it */ });
  }

  // ---------------------------------------------------------------------------
  // Gmail REST API (fetchFn injectable for tests)
  // ---------------------------------------------------------------------------

  function defaultFetch() {
    if (typeof fetch === 'function') return fetch;
    try {
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
    } catch (e) { /* ignore */ }
    return null;
  }

  function apiFetch(accessToken, path, fetchFn) {
    var f = fetchFn || defaultFetch();
    if (!f) return Promise.reject(new Error('No fetch available.'));
    return f(GMAIL_API + path, {
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var err = new Error('Gmail API error ' + res.status + ': ' + text.slice(0, 200));
          err.status = res.status;
          throw err;
        });
      }
      return res.json();
    });
  }

  /**
   * List recent message ids. Returns Promise<[ {id, threadId} ]>.
   * `opts.q` is a Gmail search query (default: newer mail first);
   * `opts.maxResults` caps the batch (default 25, Gmail max 500).
   */
  function listRecentMessages(accessToken, opts, fetchFn) {
    opts = opts || {};
    var max = Math.min(500, Math.max(1, opts.maxResults || DEFAULT_MAX));
    var q = opts.q || 'in:inbox newer_than:30d';
    var path = '/users/me/messages?maxResults=' + max + '&q=' + encodeURIComponent(q);
    return apiFetch(accessToken, path, fetchFn).then(function (data) {
      return (data.messages || []).map(function (m) { return { id: m.id, threadId: m.threadId }; });
    });
  }

  /** Fetch one full message: {id, threadId, from, subject, date, snippet, body}. */
  function getMessageFull(accessToken, id, fetchFn) {
    return apiFetch(accessToken, '/users/me/messages/' + encodeURIComponent(id) +
      '?format=full', fetchFn).then(parseGmailMessage);
  }

  // ---------------------------------------------------------------------------
  // Parsing: Gmail's JSON message -> plain email shape.
  // ---------------------------------------------------------------------------

  function b64urlDecode(s) {
    var b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return bin;
  }

  function stripHtml(html) {
    return String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function headerValue(headers, name) {
    var lower = String(name).toLowerCase();
    for (var i = 0; i < (headers || []).length; i++) {
      if (String(headers[i].name).toLowerCase() === lower) return headers[i].value || '';
    }
    return '';
  }

  /** Prefer text/plain; fall back to stripped text/html. Pure. */
  function extractBody(payload) {
    if (!payload) return '';
    var plain = null, html = null;
    function walk(part) {
      if (!part) return;
      var mime = String(part.mimeType || '').toLowerCase();
      var data = part.body && part.body.data;
      if (mime === 'text/plain' && data && plain === null) plain = b64urlDecode(data);
      else if (mime === 'text/html' && data && html === null) html = b64urlDecode(data);
      (part.parts || []).forEach(walk);
    }
    walk(payload);
    if (plain) return plain.trim();
    if (html) return stripHtml(html);
    return '';
  }

  /**
   * Parse a Gmail API full message into {id, threadId, from, subject, date,
   * snippet, body, receivedAt}. Pure — this is what tests exercise.
   */
  function parseGmailMessage(msg) {
    var headers = (msg.payload && msg.payload.headers) || [];
    var internal = Number(msg.internalDate) || Date.now();
    return {
      id: msg.id,
      threadId: msg.threadId,
      from: headerValue(headers, 'From') || '(unknown sender)',
      subject: headerValue(headers, 'Subject') || '(no subject)',
      date: headerValue(headers, 'Date'),
      snippet: msg.snippet || '',
      body: extractBody(msg.payload),
      receivedAt: internal
    };
  }

  /**
   * Map a parsed Gmail message to the TriagePilot email shape used by the app
   * and classifier. Id is namespaced so Gmail imports never collide with
   * pasted or sample emails.
   */
  function mapGmailMessage(msg) {
    return {
      id: 'gmail:' + msg.id,
      gmailId: msg.id,
      gmailThreadId: msg.threadId,
      from: msg.from,
      subject: msg.subject,
      body: msg.body || msg.snippet || '',
      receivedAt: msg.receivedAt,
      handled: false
    };
  }

  /** Drop incoming emails whose gmailId is already in the inbox. Pure. */
  function dedupByGmailId(existing, incoming) {
    var seen = {};
    (existing || []).forEach(function (e) { if (e.gmailId) seen[e.gmailId] = true; });
    return (incoming || []).filter(function (e) { return !e.gmailId || !seen[e.gmailId]; });
  }

  /**
   * One-shot sync: list recent messages, fetch each, parse + map.
   * Fetches run with a small concurrency limit so a 25-mail sync makes
   * a bounded number of in-flight requests.
   * Returns Promise<[triage-ready email]>, in Gmail's newest-first order.
   */
  function syncInbox(accessToken, opts, fetchFn) {
    opts = opts || {};
    var concurrency = Math.min(8, Math.max(1, opts.concurrency || 5));
    return listRecentMessages(accessToken, opts, fetchFn).then(function (list) {
      var results = new Array(list.length);
      var next = 0;
      function worker() {
        if (next >= list.length) return Promise.resolve();
        var i = next++;
        return getMessageFull(accessToken, list[i].id, fetchFn)
          .then(function (msg) { results[i] = mapGmailMessage(msg); })
          .then(worker);
      }
      var workers = [];
      for (var w = 0; w < Math.min(concurrency, list.length); w++) workers.push(worker());
      return Promise.all(workers).then(function () {
        return results.filter(Boolean);
      });
    });
  }

  return {
    GMAIL_API: GMAIL_API,
    GMAIL_SCOPE: GMAIL_SCOPE,
    DEFAULT_MAX: DEFAULT_MAX,
    getConfig: getConfig,
    isConfigured: isConfigured,
    requestAccessToken: requestAccessToken,
    revokeToken: revokeToken,
    listRecentMessages: listRecentMessages,
    getMessageFull: getMessageFull,
    parseGmailMessage: parseGmailMessage,
    mapGmailMessage: mapGmailMessage,
    extractBody: extractBody,
    stripHtml: stripHtml,
    b64urlDecode: b64urlDecode,
    dedupByGmailId: dedupByGmailId,
    syncInbox: syncInbox
  };
});
