/* triagepilot-ai UI — browser only. TriagePilot classifier comes from js/classifier.js */
(function () {
  'use strict';

  var LS_KEY = 'triagepilot.v1';

  var state = {
    emails: [],        // {id, from, subject, body, category, label, confidence, reason, receivedAt, handled, snoozedUntil}
    selectedId: null,
    tone: 'professional',
    business: 'TriagePilot Demo Co.',
    filterCat: '',     // (legacy, unused — splits replaced it)
    split: '',         // split-inbox tab: '' | 'focus' | 'fyi' | 'spam' | 'snoozed'
    query: '',         // inbox search text
    hideHandled: false,// show only open (unhandled) emails
    checked: {},       // bulk-selection map id -> true
    learned: null      // learned keyword rules {urgent:[], reply:[], fyi:[], spam:[]}
  };

  var AGING_MS = 4 * 60 * 60 * 1000; // urgent + open + older than 4h = aging

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        emails: state.emails, tone: state.tone, business: state.business,
        learned: TriagePilot.getLearnedRules(),
        senders: TriagePilot.getSenderLists()
      }));
    } catch (e) { /* storage unavailable */ }
  }

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s && Array.isArray(s.emails)) {
        state.emails = s.emails.map(function (e) {
          if (!e.receivedAt) e.receivedAt = Date.now();
          if (typeof e.handled !== 'boolean') e.handled = false;
          return e;
        });
        if (s.tone) state.tone = s.tone;
        if (s.business) state.business = s.business;
        if (s.learned) { state.learned = s.learned; TriagePilot.setLearnedRules(s.learned); }
        if (s.senders) TriagePilot.setSenderLists(s.senders);
        return true;
      }
    } catch (e) { /* fresh start */ }
    return false;
  }

  function $(id) { return document.getElementById(id); }

  function badgeClass(cat) {
    return { urgent: 'b-urgent', reply: 'b-reply', fyi: 'b-fyi', spam: 'b-spam' }[cat] || 'b-fyi';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function triage(email) {
    var r = TriagePilot.classifyWithSender(email.subject, email.body, email.from);
    email.category = r.category;
    email.label = r.label;
    email.confidence = r.confidence;
    email.reason = r.reason;
  }

  function agingEmail(e) {
    return e.category === 'urgent' && !e.handled &&
      (Date.now() - (e.receivedAt || Date.now())) > AGING_MS;
  }

  /* Split-inbox counts + inbox-zero meter. Splits: '' (all), focus, fyi, spam, snoozed. */
  function splitCounts() {
    var c = { all: 0, focus: 0, fyi: 0, spam: 0, snoozed: 0 };
    state.emails.forEach(function (e) {
      var awake = TriagePilot.isAwake(e);
      if (!awake) { c.snoozed++; return; }
      c.all++;
      if (e.category === 'urgent' || e.category === 'reply') c.focus++;
      else if (e.category === 'fyi') c.fyi++;
      else if (e.category === 'spam') c.spam++;
    });
    return c;
  }

  function renderSplits() {
    var c = splitCounts();
    ['all', 'focus', 'fyi', 'spam', 'snoozed'].forEach(function (k) {
      var b = $('split-' + k);
      if (b) b.textContent = c[k];
    });
    Array.prototype.forEach.call(document.querySelectorAll('.split'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-split') === state.split);
    });
    var zm = $('zeroMeter');
    if (zm) {
      var open = state.emails.filter(function (e) { return !e.handled && TriagePilot.isAwake(e); }).length;
      zm.textContent = open === 0 && state.emails.length
        ? '✓ inbox zero'
        : (open ? open + ' to zero' : '');
      zm.classList.toggle('done', open === 0 && state.emails.length > 0);
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll('.split'), function (t) {
    t.addEventListener('click', function () {
      var s = t.getAttribute('data-split');
      state.split = (state.split === s) ? '' : s;
      renderSplits();
      renderList();
    });
  });

  function renderDigest() {
    var open = 0, snoozed = 0;
    state.emails.forEach(function (e) {
      if (!e.handled) open++;
      if (!TriagePilot.isAwake(e)) snoozed++;
    });
    var total = state.emails.length;
    $('digest').innerHTML =
      '<strong>' + total + '</strong> emails triaged' +
      (total ? ' &nbsp;·&nbsp; <em>' + open + ' open</em>' : '') +
      (snoozed ? ' &nbsp;·&nbsp; <em>' + snoozed + ' snoozed</em>' : '') +
      (total ? ' &nbsp;<button id="copyDigest" class="btn-ghost tiny" title="Copy summary">Copy summary</button>' : '');
    var cp = $('copyDigest');
    if (cp) cp.addEventListener('click', function () {
      var text = TriagePilot.digestText(state.emails);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
      }
      cp.textContent = 'Copied!';
      setTimeout(function () { cp.textContent = 'Copy summary'; }, 1500);
    });
    renderSplits();
  }

  function sortedShown() {
    var order = { urgent: 0, reply: 1, fyi: 2, spam: 3 };
    var pool = TriagePilot.applySplit(state.emails, state.split);
    var shown = TriagePilot.filterEmails(pool, state.query, '');
    if (state.hideHandled) shown = shown.filter(function (e) { return !e.handled; });
    return shown.slice().sort(function (a, b) {
      return (order[a.category] - order[b.category]) || a.id.localeCompare(b.id);
    });
  }

  function checkedIds() {
    return Object.keys(state.checked).filter(function (id) { return state.checked[id]; });
  }

  function renderBulk() {
    var bar = $('bulkBar');
    if (!bar) return;
    var ids = checkedIds();
    if (!ids.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    var n = ids.length;
    bar.innerHTML =
      '<strong>' + n + ' selected</strong>' +
      '<button class="action" data-bulk="handled">Mark handled</button>' +
      '<button class="action" data-bulk="reopen">Reopen</button>' +
      '<button class="action" data-bulk="urgent">Label urgent</button>' +
      '<button class="action" data-bulk="reply">Label needs-reply</button>' +
      '<button class="action" data-bulk="fyi">Label FYI</button>' +
      '<button class="action" data-bulk="spam">Label spam</button>' +
      '<button class="action danger" data-bulk="delete">Delete</button>' +
      '<button class="action" data-bulk="clear">Clear selection</button>';
    Array.prototype.forEach.call(bar.querySelectorAll('[data-bulk]'), function (b) {
      b.addEventListener('click', function () { runBulk(b.getAttribute('data-bulk')); });
    });
  }

  function runBulk(op) {
    var ids = checkedIds();
    if (!ids.length) return;
    if (op === 'delete') {
      if (!confirm('Delete ' + ids.length + ' selected email' + (ids.length === 1 ? '' : 's') + '?')) return;
      state.emails = TriagePilot.bulkRemove(state.emails, ids);
      if (state.selectedId && ids.indexOf(state.selectedId) !== -1) {
        state.selectedId = null;
        $('detail').innerHTML = '<p class="empty">Select an email from the queue to open its dossier and draft a reply.</p>';
      }
    } else if (op === 'handled') {
      state.emails = TriagePilot.bulkSetHandled(state.emails, ids, true);
    } else if (op === 'reopen') {
      state.emails = TriagePilot.bulkSetHandled(state.emails, ids, false);
    } else if (op === 'clear') {
      state.checked = {};
    } else {
      state.emails = TriagePilot.bulkRelabel(state.emails, ids, op);
    }
    if (op !== 'clear') state.checked = {};
    saveState();
    renderDigest();
    renderList();
    renderSenderNote();
  }

  function renderList() {
    renderSplits();
    var sorted = sortedShown();
    var html = sorted.map(function (e) {
      var sz = TriagePilot.snoozeRemaining(e);
      return '<div class="email' + (e.id === state.selectedId ? ' sel' : '') + (e.handled ? ' done' : '') + (sz ? ' snoozed-row' : '') + '" data-id="' + e.id + '" data-cat="' + e.category + '">' +
        '<input type="checkbox" class="bulk-check" data-check="' + e.id + '"' + (state.checked[e.id] ? ' checked' : '') + ' aria-label="Select email">' +
        '<div class="email-top"><span class="pill ' + badgeClass(e.category) + '">' + escapeHtml(e.label) + '</span>' +
        '<span class="conf">' + escapeHtml(e.confidence) + '</span>' +
        (agingEmail(e) ? '<span class="aging">aging</span>' : '') +
        (sz ? '<span class="snooze-tag">snoozed ' + escapeHtml(sz) + '</span>' : '') +
        (e.handled ? '<span class="done-tag">handled</span>' : '') + '</div>' +
        '<div class="email-subj">' + escapeHtml(e.subject) + '</div>' +
        '<div class="email-from">' + escapeHtml(e.from) + '</div></div>';
    }).join('');
    if (!html) {
      html = state.emails.length
        ? '<p class="empty">No emails match this filter. <button id="clearFilter" class="btn-ghost tiny">Clear filter</button></p>'
        : '<p class="empty">No emails yet. Load the sample inbox or paste one in.</p>';
    }
    $('inbox').innerHTML = html;
    var cf = $('clearFilter');
    if (cf) cf.addEventListener('click', function () {
      state.split = ''; state.query = ''; $('searchBox').value = '';
      renderDigest(); renderList();
    });
    Array.prototype.forEach.call($('inbox').querySelectorAll('.bulk-check'), function (cb) {
      cb.addEventListener('click', function (ev) { ev.stopPropagation(); });
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-check');
        if (cb.checked) state.checked[id] = true; else delete state.checked[id];
        renderBulk();
      });
    });
    Array.prototype.forEach.call($('inbox').querySelectorAll('.email'), function (el) {
      el.addEventListener('click', function () { selectEmail(el.getAttribute('data-id')); });
    });
    renderBulk();
  }

  function selectEmail(id) {
    state.selectedId = id;
    renderList();
    var e = state.emails.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var meterPct = { high: 95, medium: 65, low: 30 }[e.confidence] || 30;
    $('detail').innerHTML =
      '<h3>' + escapeHtml(e.subject) + '</h3>' +
      '<div class="meta">From: ' + escapeHtml(e.from) + '</div>' +
      '<div class="classif">' +
      '<div class="classif-row"><span class="pill ' + badgeClass(e.category) + '">' + escapeHtml(e.label) + '</span>' +
      '<span class="conf">' + escapeHtml(e.confidence) + ' confidence</span></div>' +
      '<div class="meter"><i style="width:' + meterPct + '%"></i></div>' +
      '<p class="reason"><strong>Why:</strong> ' + escapeHtml(e.reason) + '</p>' +
      '</div>' +
      '<p class="body">' + escapeHtml(e.body) + '</p>' +
      '<div class="draft-actions">' +
      '<label>Tone: <select id="tone">' +
      '<option value="professional"' + (state.tone === 'professional' ? ' selected' : '') + '>Professional</option>' +
      '<option value="friendly"' + (state.tone === 'friendly' ? ' selected' : '') + '>Friendly</option>' +
      '</select></label> ' +
      '<button id="draftBtn" class="action hot">Draft reply</button>' +
      '<button id="mailtoBtn" class="action">Open in email app</button>' +
      '<button id="handledBtn" class="action">' + (e.handled ? 'Reopen' : 'Mark handled') + ' <span class="kbd">m</span></button>' +
      '<button id="fixLabel" class="action" title="Cycle to the next label">Wrong label? → ' + TriagePilot.LABELS[TriagePilot.nextCategory(e.category)] + '</button>' +
      '<button id="delEmail" class="action danger">Delete</button>' +
      '</div>' +
      '<div class="snooze-actions">' +
      '<span class="muted">Snooze:</span> ' +
      '<button id="sz1h" class="action small">1 hour</button> ' +
      '<button id="sz4h" class="action small">4 hours</button> ' +
      '<button id="szTomorrow" class="action small">Tomorrow</button> ' +
      (TriagePilot.isAwake(e) ? '' : '<button id="unsnooze" class="action small">Unsnooze</button>') +
      '</div>' +
      '<div class="sender-actions">' +
      '<span class="muted">Sender:</span> ' +
      (TriagePilot.senderAction(e.from) === 'spam'
        ? '<button id="unlistSender" class="action small">Unblock</button>'
        : '<button id="blockSender" class="action small">Block <span class="kbd">b</span></button>') + ' ' +
      (TriagePilot.senderAction(e.from) === 'trust'
        ? '<button id="unlistSender2" class="action small">Untrust</button>'
        : '<button id="trustSender" class="action small">Trust</button>') +
      '</div>' +
      '<textarea id="draft" rows="10" placeholder="Your draft will appear here — edit it freely."></textarea>' +
      '<button id="copyBtn" class="action">Copy draft</button> <span id="copied"></span>';
    $('tone').addEventListener('change', function (ev) { state.tone = ev.target.value; saveState(); });
    $('draftBtn').addEventListener('click', function () {
      $('draft').value = TriagePilot.draftReply(e, state.tone, state.business);
    });
    $('mailtoBtn').addEventListener('click', function () {
      var text = $('draft').value || TriagePilot.draftReply(e, state.tone, state.business);
      var addr = (e.from.match(/<([^>]+)>/) || [])[1] || '';
      window.location.href = 'mailto:' + encodeURIComponent(addr) +
        '?subject=' + encodeURIComponent('Re: ' + e.subject) +
        '&body=' + encodeURIComponent(text);
    });
    $('copyBtn').addEventListener('click', function () {
      var ta = $('draft');
      ta.select();
      try { document.execCommand('copy'); } catch (err) { /* clipboard fallback below */ }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).catch(function () {});
      }
      $('copied').textContent = 'Copied!';
      setTimeout(function () { $('copied').textContent = ''; }, 1500);
    });
    $('fixLabel').addEventListener('click', function () {
      e.category = TriagePilot.nextCategory(e.category);
      e.label = TriagePilot.LABELS[e.category];
      // Teach the classifier from this correction so future emails improve.
      var learned = TriagePilot.learnCorrection(e.category, e.subject, e.body);
      e.reason = 'Manually corrected by you to ' + e.label + '.' +
        (learned.length ? ' Learned ' + learned.length + ' keyword' + (learned.length === 1 ? '' : 's') + ' for ' + e.label + '.' : '');
      e.confidence = 'high';
      saveState();
      renderDigest();
      renderList();
      selectEmail(e.id);
      renderLearnNote();
    });
    $('handledBtn').addEventListener('click', function () { toggleHandled(e.id); });
    // snooze
    var HOUR = 60 * 60 * 1000;
    function snoozeFor(ms) {
      e.snoozedUntil = Date.now() + ms;
      saveState(); renderDigest(); renderList(); selectEmail(e.id);
    }
    $('sz1h').addEventListener('click', function () { snoozeFor(HOUR); });
    $('sz4h').addEventListener('click', function () { snoozeFor(4 * HOUR); });
    $('szTomorrow').addEventListener('click', function () {
      var t = new Date(); t.setHours(9, 0, 0, 0);
      if (t.getTime() <= Date.now()) t = new Date(t.getTime() + 24 * 60 * 60 * 1000);
      e.snoozedUntil = t.getTime();
      saveState(); renderDigest(); renderList(); selectEmail(e.id);
    });
    var un = $('unsnooze');
    if (un) un.addEventListener('click', function () {
      e.snoozedUntil = 0; saveState(); renderDigest(); renderList(); selectEmail(e.id);
    });
    // sender lists
    function refreshAfterSender(key) {
      saveState(); renderDigest(); renderList(); renderSenderNote();
      selectEmail(e.id);
    }
    var bl = $('blockSender');
    if (bl) bl.addEventListener('click', function () {
      if (!confirm('Block this sender? Future emails from them file as spam.')) return;
      TriagePilot.listSender('blocked', e.from);
      triage(e); // re-triage with the new list applied
      refreshAfterSender();
    });
    var tr = $('trustSender');
    if (tr) tr.addEventListener('click', function () {
      TriagePilot.listSender('trusted', e.from);
      triage(e);
      refreshAfterSender();
    });
    ['unlistSender', 'unlistSender2'].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener('click', function () {
        TriagePilot.unlistSender(e.from);
        triage(e);
        refreshAfterSender();
      });
    });
    $('delEmail').addEventListener('click', function () {
      if (!confirm('Delete this email from the inbox?')) return;
      state.emails = state.emails.filter(function (x) { return x.id !== e.id; });
      state.selectedId = null;
      saveState();
      renderDigest();
      renderList();
      $('detail').innerHTML = '<p class="empty">Select an email from the queue to open its dossier and draft a reply.</p>';
    });
  }

  function addEmail(from, subject, body) {
    var email = {
      id: 'm' + Date.now() + Math.floor(Math.random() * 1000),
      from: from || 'Unknown <unknown@example.com>',
      subject: subject || '(no subject)',
      body: body || '',
      receivedAt: Date.now(),
      handled: false
    };
    triage(email);
    state.emails.unshift(email);
    saveState();
    renderDigest();
    renderList();
    selectEmail(email.id);
  }

  function clearSpam() {
    var n = state.emails.filter(function (e) { return e.category === 'spam'; }).length;
    if (!n) { alert('No spam in the inbox.'); return; }
    if (!confirm('Delete ' + n + ' spam email' + (n === 1 ? '' : 's') + '?')) return;
    if (state.selectedId) {
      var sel = state.emails.filter(function (x) { return x.id === state.selectedId; })[0];
      if (sel && sel.category === 'spam') state.selectedId = null;
    }
    state.emails = state.emails.filter(function (e) { return e.category !== 'spam'; });
    saveState();
    renderDigest();
    renderList();
    if (!state.selectedId) {
      $('detail').innerHTML = '<p class="empty">Select an email from the queue to open its dossier and draft a reply.</p>';
    }
  }

  function loadSamples() {
    fetch('data/samples.json')
      .then(function (r) { return r.json(); })
      .then(function (samples) {
        state.emails = samples.map(function (s) {
          var e = { id: s.id, from: s.from, subject: s.subject, body: s.body, receivedAt: Date.now(), handled: false };
          triage(e);
          return e;
        });
        state.split = '';
        saveState();
        renderDigest();
        renderList();
        if (state.emails.length) selectEmail(state.emails[0].id);
      })
      .catch(function () {
        $('inbox').innerHTML = '<p class="empty">Could not load sample inbox (fetch needs http). Run via a local server: <code>npx serve .</code></p>';
      });
  }

  function toggleHandled(id) {
    var e = state.emails.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    e.handled = !e.handled;
    saveState();
    renderDigest();
    renderList();
    if (state.selectedId === id) selectEmail(id);
  }

  function learnedCount() {
    var r = TriagePilot.getLearnedRules();
    return Object.keys(r).reduce(function (n, c) { return n + r[c].length; }, 0);
  }

  function renderSenderNote() {
    var el = $('senderNote');
    if (!el) return;
    var lists = TriagePilot.getSenderLists();
    function rows(kind, items) {
      if (!items.length) return '';
      return items.map(function (k) {
        return '<span class="sender-chip">' + escapeHtml(k) +
          ' <button data-kind="' + kind + '" data-key="' + escapeHtml(k) + '" class="btn-ghost tiny" title="Remove">×</button></span>';
      }).join(' ');
    }
    var total = lists.blocked.length + lists.trusted.length;
    el.innerHTML = total
      ? '<div class="sender-lists"><div><strong>Blocked (' + lists.blocked.length + '):</strong> ' +
        (rows('blocked', lists.blocked) || '<span class="muted">none</span>') + '</div>' +
        '<div><strong>Trusted (' + lists.trusted.length + '):</strong> ' +
        (rows('trusted', lists.trusted) || '<span class="muted">none</span>') + '</div></div>'
      : '<span class="muted">Sender lists: block or trust a sender from any email&rsquo;s dossier to auto-file future mail.</span>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-key]'), function (b) {
      b.addEventListener('click', function () {
        TriagePilot.unlistSender(b.getAttribute('data-key'));
        saveState(); renderSenderNote();
      });
    });
  }

  function renderLearnNote() {    var el = document.getElementById('learnNote');
    if (!el) return;
    var n = learnedCount();
    el.innerHTML = n
      ? '<span class="muted">Classifier learned ' + n + ' keyword' + (n === 1 ? '' : 's') + ' from your corrections.</span> ' +
        '<button id="resetLearn" class="btn-ghost tiny">Reset learned rules</button>'
      : '<span class="muted">Tip: press <span class="kbd">?</span> for keyboard shortcuts. Correcting a label teaches the classifier.</span> ' +
        '<button id="showKeys" class="btn-ghost tiny">Shortcuts</button>';
    var rb = document.getElementById('resetLearn');
    if (rb) rb.addEventListener('click', function () {
      if (!confirm('Forget all learned keywords? Built-in rules stay.')) return;
      TriagePilot.resetLearnedRules();
      saveState();
      renderLearnNote();
    });
    var sk = document.getElementById('showKeys');
    if (sk) sk.addEventListener('click', toggleKeyHelp);
  }

  function toggleKeyHelp() {
    var el = document.getElementById('keyHelp');
    if (el) el.classList.toggle('hidden');
  }

  function moveSelection(dir) {
    var sorted = sortedShown();
    if (!sorted.length) return;
    var idx = -1;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].id === state.selectedId) { idx = i; break; }
    }
    var next = sorted[Math.min(sorted.length - 1, Math.max(0, idx + dir))];
    if (next) selectEmail(next.id);
  }

  function shortcutRecategorize(cat) {
    var e = state.emails.filter(function (x) { return x.id === state.selectedId; })[0];
    if (!e) return;
    e.category = cat;
    e.label = TriagePilot.LABELS[cat];
    var learned = TriagePilot.learnCorrection(cat, e.subject, e.body);
    e.reason = 'Manually corrected by you to ' + e.label + '.' +
      (learned.length ? ' Learned ' + learned.length + ' keyword' + (learned.length === 1 ? '' : 's') + '.' : '');
    e.confidence = 'high';
    saveState();
    renderDigest();
    renderList();
    selectEmail(e.id);
    renderLearnNote();
  }

  /* ---------- command palette (Ctrl/Cmd+K, Superhuman-style) ---------- */
  function selectedEmail() {
    return state.emails.filter(function (x) { return x.id === state.selectedId; })[0] || null;
  }

  function snoozeSelected(ms) {
    var e = selectedEmail();
    if (!e) return;
    e.snoozedUntil = Date.now() + ms;
    saveState(); renderDigest(); renderList(); selectEmail(e.id);
  }

  function snoozeTomorrow() {
    var e = selectedEmail();
    if (!e) return;
    var t = new Date(); t.setHours(9, 0, 0, 0);
    if (t.getTime() <= Date.now()) t = new Date(t.getTime() + 24 * 60 * 60 * 1000);
    e.snoozedUntil = t.getTime();
    saveState(); renderDigest(); renderList(); selectEmail(e.id);
  }

  function clickBtn(id) {
    var b = document.getElementById(id);
    if (b) b.click();
  }

  var COMMANDS = [
    { name: 'Go to: All', hint: 'split', run: function () { state.split = ''; renderSplits(); renderList(); } },
    { name: 'Go to: Focus', hint: 'split', run: function () { state.split = 'focus'; renderSplits(); renderList(); } },
    { name: 'Go to: FYI', hint: 'split', run: function () { state.split = 'fyi'; renderSplits(); renderList(); } },
    { name: 'Go to: Spam', hint: 'split', run: function () { state.split = 'spam'; renderSplits(); renderList(); } },
    { name: 'Go to: Snoozed', hint: 'split', run: function () { state.split = 'snoozed'; renderSplits(); renderList(); } },
    { name: 'Mark handled / reopen', hint: 'm', run: function () { toggleHandled(state.selectedId); } },
    { name: 'Snooze 1 hour', hint: 'snooze', run: function () { snoozeSelected(3600000); } },
    { name: 'Snooze 4 hours', hint: 'snooze', run: function () { snoozeSelected(4 * 3600000); } },
    { name: 'Snooze until tomorrow 9am', hint: 'snooze', run: function () { snoozeTomorrow(); } },
    { name: 'Label: Urgent', hint: '1', run: function () { shortcutRecategorize('urgent'); } },
    { name: 'Label: Needs reply', hint: '2', run: function () { shortcutRecategorize('reply'); } },
    { name: 'Label: FYI', hint: '3', run: function () { shortcutRecategorize('fyi'); } },
    { name: 'Label: Spam', hint: '4', run: function () { shortcutRecategorize('spam'); } },
    { name: 'Block sender', hint: 'b', run: function () { clickBtn('blockSender'); } },
    { name: 'Trust sender', hint: '', run: function () { clickBtn('trustSender'); } },
    { name: 'Delete email', hint: 'd', run: function () { clickBtn('delEmail'); } },
    { name: 'Clear spam', hint: '', run: function () { clearSpam(); } },
    { name: 'Load sample inbox', hint: '', run: function () { loadSamples(); } },
    { name: 'Toggle keyboard shortcuts', hint: '?', run: function () { toggleKeyHelp(); } }
  ];

  var cmdkIndex = 0, cmdkItems = [];

  function openCmdk() {
    $('cmdk').classList.remove('hidden');
    $('cmdk-input').value = '';
    renderCmdk('');
    setTimeout(function () { $('cmdk-input').focus(); }, 0);
  }

  function closeCmdk() {
    $('cmdk').classList.add('hidden');
  }

  function cmdkNorm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function renderCmdk(q) {
    var needle = cmdkNorm(q);
    cmdkItems = COMMANDS.filter(function (c) {
      return !needle || cmdkNorm(c.name + ' ' + c.hint).indexOf(needle) !== -1;
    });
    cmdkIndex = Math.min(cmdkIndex, Math.max(0, cmdkItems.length - 1));
    if (!cmdkItems.length) cmdkIndex = 0;
    $('cmdk-list').innerHTML = cmdkItems.length
      ? cmdkItems.map(function (c, i) {
          return '<div class="cmdk-item' + (i === cmdkIndex ? ' active' : '') + '" data-i="' + i + '">' +
            '<span>' + escapeHtml(c.name) + '</span>' +
            (c.hint ? '<span class="kbd">' + escapeHtml(c.hint) + '</span>' : '') + '</div>';
        }).join('')
      : '<div class="cmdk-empty">No matching command.</div>';
    Array.prototype.forEach.call($('cmdk-list').querySelectorAll('.cmdk-item'), function (el) {
      el.addEventListener('click', function () {
        var c = cmdkItems[parseInt(el.getAttribute('data-i'), 10)];
        closeCmdk();
        if (c) c.run();
      });
    });
  }

  function initCmdk() {
    document.addEventListener('keydown', function (ev) {
      var isK = (ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey);
      if (isK) {
        ev.preventDefault();
        $('cmdk').classList.contains('hidden') ? openCmdk() : closeCmdk();
        return;
      }
      if ($('cmdk').classList.contains('hidden')) return;
      if (ev.key === 'Escape') { closeCmdk(); ev.preventDefault(); }
      else if (ev.key === 'ArrowDown') { cmdkIndex = Math.min(cmdkItems.length - 1, cmdkIndex + 1); renderCmdk($('cmdk-input').value); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { cmdkIndex = Math.max(0, cmdkIndex - 1); renderCmdk($('cmdk-input').value); ev.preventDefault(); }
      else if (ev.key === 'Enter') {
        var c = cmdkItems[cmdkIndex];
        closeCmdk();
        if (c) c.run();
        ev.preventDefault();
      }
    });
    $('cmdk-input').addEventListener('input', function (ev) {
      cmdkIndex = 0;
      renderCmdk(ev.target.value);
    });
    $('cmdk').addEventListener('click', function (ev) {
      if (ev.target === $('cmdk')) closeCmdk();
    });
  }

  function initShortcuts() {
    document.addEventListener('keydown', function (ev) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var k = ev.key;
      var handled = true;
      if (k === 'j' || k === 'J' || k === 'ArrowDown') moveSelection(1);
      else if (k === 'k' || k === 'K' || k === 'ArrowUp') moveSelection(-1);
      else if (k === '1') shortcutRecategorize('urgent');
      else if (k === '2') shortcutRecategorize('reply');
      else if (k === '3') shortcutRecategorize('fyi');
      else if (k === '4') shortcutRecategorize('spam');
      else if (k === 'm' || k === 'M') toggleHandled(state.selectedId);
      else if (k === 'b' || k === 'B') {
        var b = document.getElementById('blockSender');
        if (b) b.click(); else handled = false;
      }
      else if (k === 'd' || k === 'D') {
        var b = document.getElementById('delEmail');
        if (b) b.click(); else handled = false;
      } else if (k === '?') toggleKeyHelp();
      else handled = false;
      if (handled && k !== '?') { /* selection changes re-render anyway */ }
      if (handled) ev.preventDefault();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('loadSamples').addEventListener('click', loadSamples);
    $('searchBox').addEventListener('input', function (ev) {
      state.query = ev.target.value;
      renderList();
    });
    $('clearSpam').addEventListener('click', clearSpam);
    $('addBtn').addEventListener('click', function () {
      var from = $('fFrom').value.trim();
      var subject = $('fSubject').value.trim();
      var body = $('fBody').value.trim();
      if (!subject && !body) { alert('Add a subject or body first.'); return; }
      addEmail(from, subject, body);
      $('fFrom').value = ''; $('fSubject').value = ''; $('fBody').value = '';
    });
    $('bizName').addEventListener('input', function (ev) {
      state.business = ev.target.value.trim() || 'TriagePilot Demo Co.';
      saveState();
    });
    var hb = $('hideHandled');
    if (hb) hb.addEventListener('change', function (ev) {
      state.hideHandled = ev.target.checked;
      renderList();
    });
    initShortcuts();
    initCmdk();
    renderLearnNote();
    renderSenderNote();
    var restored = loadState();
    if (restored) {
      $('bizName').value = state.business === 'TriagePilot Demo Co.' ? '' : state.business;
    }
    renderDigest();
    renderList();
  });
})();
