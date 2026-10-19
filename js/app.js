/* triagepilot-ai UI — browser only. TriagePilot classifier comes from js/classifier.js */
(function () {
  'use strict';

  var LS_KEY = 'triagepilot.v1';
  var LS_SNIPPETS = 'triagepilot.snippets.v1';

  var state = {
    emails: [],        // {id, from, subject, body, category, label, confidence, reason, receivedAt, handled, snoozedUntil, taskDue}
    selectedId: null,
    tone: 'professional',
    business: 'TriagePilot Demo Co.',
    filterCat: '',     // (legacy, unused — splits replaced it)
    split: '',         // split-inbox tab: '' | 'focus' | 'fyi' | 'spam' | 'snoozed' | 'tasks'
    query: '',         // inbox search text
    senderFilter: null,// sender bundle view: full "from" string, or null
    hideHandled: false,// show only open (unhandled) emails
    checked: {},       // bulk-selection map id -> true
    snippets: [],      // reply snippets [{name, text}]
    learned: null      // learned keyword rules {urgent:[], reply:[], fyi:[], spam:[]}
  };

  var AGING_MS = 4 * 60 * 60 * 1000; // urgent + open + older than 4h = aging

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        emails: state.emails, tone: state.tone, business: state.business,
        learned: TriagePilot.getLearnedRules(),
        senders: TriagePilot.getSenderLists(),
        senderMemory: TriagePilot.getSenderMemory()
      }));
      localStorage.setItem(LS_SNIPPETS, JSON.stringify(state.snippets));
    } catch (e) { /* storage unavailable */ }
  }

  function loadState() {
    try {
      var sn = JSON.parse(localStorage.getItem(LS_SNIPPETS) || 'null');
      if (Array.isArray(sn)) {
        state.snippets = sn.filter(function (s) { return s && s.name && s.text; }).slice(0, 50);
      }
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
        if (s.senderMemory) TriagePilot.setSenderMemory(s.senderMemory);
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

  /* Split-inbox counts + inbox-zero meter. Splits: '' (all), focus, fyi, spam, snoozed, tasks. */
  function splitCounts() {
    var c = { all: 0, focus: 0, fyi: 0, spam: 0, snoozed: 0, tasks: 0 };
    state.emails.forEach(function (e) {
      if (TriagePilot.taskState(e)) c.tasks++;
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
    ['all', 'focus', 'fyi', 'spam', 'snoozed', 'tasks'].forEach(function (k) {
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
    var sent = TriagePilot.sentCount(state.emails);
    var tasks = state.emails.filter(function (e) { return !!TriagePilot.taskState(e); });
    var overdue = tasks.filter(function (e) { return TriagePilot.taskState(e).overdue; }).length;
    $('digest').innerHTML =
      '<strong>' + total + '</strong> emails triaged' +
      (total ? ' &nbsp;·&nbsp; <em>' + open + ' open</em>' : '') +
      (sent ? ' &nbsp;·&nbsp; <em>' + sent + ' ' + (sent === 1 ? 'reply' : 'replies') + ' sent</em>' : '') +
      (tasks.length ? ' &nbsp;·&nbsp; <em>' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's') + '</em>' : '') +
      (overdue ? ' &nbsp;·&nbsp; <em class="ticker-alert">' + overdue + ' overdue</em>' : '') +
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
    if (state.senderFilter) pool = TriagePilot.emailsFromSender(pool, state.senderFilter);
    var shown = TriagePilot.filterEmails(pool, state.query, '');
    if (state.hideHandled) shown = shown.filter(function (e) { return !e.handled; });
    return shown.slice().sort(function (a, b) {
      if (state.split === 'tasks') {
        var da = TriagePilot.taskState(a), db = TriagePilot.taskState(b);
        var d = (da ? da.due : Infinity) - (db ? db.due : Infinity);
        if (d) return d;
      }
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

  /* Shortwave-style sender bundle banner: the queue is showing one sender's mail. */
  function renderSenderBanner() {
    var el = $('senderBanner');
    if (!el) return;
    if (!state.senderFilter) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    var n = TriagePilot.emailsFromSender(state.emails, state.senderFilter).length;
    el.classList.remove('hidden');
    el.innerHTML =
      '<span class="bundle-ic" aria-hidden="true">▣</span>' +
      '<span><strong>Sender bundle</strong> — all mail from ' + escapeHtml(state.senderFilter) +
      ' (' + n + ' email' + (n === 1 ? '' : 's') + '). Bulk actions below apply to this sender.</span>' +
      '<button id="senderClear" class="btn-ghost tiny">Clear bundle</button>';
    $('senderClear').addEventListener('click', function () {
      state.senderFilter = null;
      renderDigest();
      renderList();
    });
  }

  function senderInitial(from) {
    var m = /^([^<(@]+)/.exec(String(from || '').trim());
    var name = (m ? m[1] : String(from || '')).trim();
    return (name.charAt(0) || '?').toUpperCase();
  }

  function renderList() {
    renderSplits();
    renderSenderBanner();
    var sorted = sortedShown();
    var html = sorted.map(function (e) {
      var sz = TriagePilot.snoozeRemaining(e);
      var ts = TriagePilot.taskState(e);
      return '<div class="email' + (e.id === state.selectedId ? ' sel' : '') + (e.handled ? ' done' : '') + (sz ? ' snoozed-row' : '') + '" data-id="' + e.id + '" data-cat="' + e.category + '">' +
        '<input type="checkbox" class="bulk-check" data-check="' + e.id + '"' + (state.checked[e.id] ? ' checked' : '') + ' aria-label="Select email">' +
        '<div class="email-top"><span class="pill ' + badgeClass(e.category) + '">' + escapeHtml(e.label) + '</span>' +
        '<span class="conf">' + escapeHtml(e.confidence) + '</span>' +
        (agingEmail(e) ? '<span class="aging">aging</span>' : '') +
        (ts ? '<span class="task-tag' + (ts.overdue ? ' overdue' : '') + '">' + escapeHtml(ts.label) + '</span>' : '') +
        (sz ? '<span class="snooze-tag">snoozed ' + escapeHtml(sz) + '</span>' : '') +
        (e.sentAt ? '<span class="replied-tag">replied</span>' : '') +
        (e.handled ? '<span class="done-tag">handled</span>' : '') + '</div>' +
        '<div class="email-subj">' + escapeHtml(e.subject) + '</div>' +
        '<button class="sender-link" data-sender="' + escapeHtml(e.from) + '" title="Open sender bundle — all mail from this sender">' +
        '<span class="avatar" aria-hidden="true">' + escapeHtml(senderInitial(e.from)) + '</span>' +
        '<span class="sender-name">' + escapeHtml(e.from) + '</span></button></div>';
    }).join('');
    if (!html) {
      html = state.emails.length
        ? '<p class="empty">No emails match this filter. <button id="clearFilter" class="btn-ghost tiny">Clear filter</button></p>'
        : '<p class="empty">No emails yet. Load the sample inbox or paste one in.</p>';
    }
    $('inbox').innerHTML = html;
    var cf = $('clearFilter');
    if (cf) cf.addEventListener('click', function () {
      state.split = ''; state.query = ''; state.senderFilter = null; $('searchBox').value = '';
      renderDigest(); renderList();
    });
    Array.prototype.forEach.call($('inbox').querySelectorAll('.sender-link'), function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        state.senderFilter = btn.getAttribute('data-sender');
        renderDigest();
        renderList();
      });
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
    var CIRC = 163.4;
    var ts = TriagePilot.taskState(e);
    var snippetOpts = state.snippets.map(function (s) {
      return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</option>';
    }).join('');
    var senderAct = TriagePilot.senderAction(e.from);
    $('detail').innerHTML =
      '<div class="dossier" data-cat="' + e.category + '">' +
      '<div class="dossier-head">' +
      '<div class="dossier-titles"><p class="kicker">Case file</p><h3>' + escapeHtml(e.subject) + '</h3>' +
      '<div class="meta">From: ' + escapeHtml(e.from) + '</div></div>' +
      '<div class="conf-ring" title="' + escapeHtml(e.confidence) + ' confidence">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="ring-bg"/>' +
      '<circle cx="32" cy="32" r="26" class="ring-fg" stroke-dashoffset="' +
      (CIRC * (1 - meterPct / 100)).toFixed(1) + '"/></svg>' +
      '<span class="ring-num">' + meterPct + '</span></div>' +
      '</div>' +
      '<div class="classif">' +
      '<div class="classif-row"><span class="pill ' + badgeClass(e.category) + '">' + escapeHtml(e.label) + '</span>' +
      '<span class="conf">' + escapeHtml(e.confidence) + ' confidence</span></div>' +
      (ts ? '<p class="task-line' + (ts.overdue ? ' overdue' : '') + '"><strong>Task:</strong> ' + escapeHtml(ts.label) + '</p>' : '') +
      '<p class="reason"><strong>Why:</strong> ' + escapeHtml(e.reason) + '</p>' +
      (e.sentAt ? '<p class="sent-line">Reply sent — resolved ' + escapeHtml(new Date(e.sentAt).toLocaleString()) + '.</p>' : '') +
      '</div>' +
      '<p class="body">' + escapeHtml(e.body) + '</p>' +
      '<div class="action-ledger">' +
      '<div class="ledger-group"><p class="ledger-label">Triage</p><div class="ledger-row">' +
      '<button id="handledBtn" class="action">' + (e.handled ? 'Reopen' : 'Mark handled') + ' <span class="kbd">m</span></button>' +
      '<button id="fixLabel" class="action" title="Cycle to the next label">Wrong label? → ' + TriagePilot.LABELS[TriagePilot.nextCategory(e.category)] + '</button>' +
      '<button id="delEmail" class="action danger">Delete</button>' +
      '</div></div>' +
      '<div class="ledger-group"><p class="ledger-label">Reply</p><div class="ledger-row">' +
      '<label>Tone: <select id="tone">' +
      '<option value="professional"' + (state.tone === 'professional' ? ' selected' : '') + '>Professional</option>' +
      '<option value="friendly"' + (state.tone === 'friendly' ? ' selected' : '') + '>Friendly</option>' +
      '</select></label> ' +
      '<button id="draftBtn" class="action hot">Draft reply</button>' +
      '<button id="mailtoBtn" class="action">Open in email app</button>' +
      '</div><div class="ledger-row snippet-row">' +
      '<select id="snippetPick" aria-label="Choose a snippet"><option value="">Insert snippet…</option>' + snippetOpts + '</select>' +
      '<button id="snippetInsert" class="action small">Insert</button>' +
      '<button id="snippetSave" class="action small">Save draft as snippet</button>' +
      '<button id="snippetDel" class="action small">Delete</button>' +
      '</div>' +
      '<textarea id="draft" rows="8" placeholder="Your draft will appear here — edit it freely."></textarea>' +
      '<div class="ledger-row"><button id="copyBtn" class="action">Copy draft</button> ' +
      '<button id="sentBtn" class="action"' + (e.sentAt ? ' disabled title="Already marked sent"' : '') + '>Reply sent</button> ' +
      '<span id="copied"></span></div>' +
      '</div>' +
      '<div class="ledger-group"><p class="ledger-label">Sender</p><div class="ledger-row">' +
      '<button id="senderBundle" class="action small">All from sender <span class="kbd">u</span></button> ' +
      (senderAct === 'spam'
        ? '<button id="unlistSender" class="action small">Unblock</button>'
        : '<button id="blockSender" class="action small">Block <span class="kbd">b</span></button>') + ' ' +
      (senderAct === 'trust'
        ? '<button id="unlistSender2" class="action small">Untrust</button>'
        : '<button id="trustSender" class="action small">Trust</button>') +
      '</div></div>' +
      '<div class="ledger-group"><p class="ledger-label">Snooze</p><div class="ledger-row">' +
      '<button id="sz1h" class="action small">1 hour</button> ' +
      '<button id="sz4h" class="action small">4 hours</button> ' +
      '<button id="szTomorrow" class="action small">Tomorrow</button> ' +
      (TriagePilot.isAwake(e) ? '' : '<button id="unsnooze" class="action small">Unsnooze</button>') +
      '</div></div>' +
      '<div class="ledger-group"><p class="ledger-label">Task</p><div class="ledger-row">' +
      '<button id="taskToday" class="action small">Due today <span class="kbd">t</span></button>' +
      '<button id="taskTomorrow" class="action small">Due tomorrow</button>' +
      '<button id="taskWeek" class="action small">Due next week</button>' +
      '<input type="date" id="taskDate" class="date-pick" aria-label="Pick a due date" title="Pick a due date">' +
      '<button id="taskClear" class="action small"' + (ts ? '' : ' disabled') + '>Clear task</button>' +
      '</div></div>' +
      '</div>' +
      '</div>';
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
    $('sentBtn').addEventListener('click', function () {
      // Sent-tracking: closes the loop — the email is resolved and counted
      // in the digest, and the snooze loop never has to resurface it.
      state.emails = TriagePilot.markSent(state.emails, e.id);
      saveState();
      renderDigest();
      renderList();
      selectEmail(e.id);
      var c = $('copied');
      if (c) { c.textContent = 'Reply marked sent — email resolved.'; }
    });
    $('fixLabel').addEventListener('click', function () {
      teachCorrection(e, TriagePilot.nextCategory(e.category));
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
    // tasks (Missive-style commitments on any email)
    function applyTask(dueMs) {
      state.emails = TriagePilot.withTaskDue(state.emails, e.id, dueMs);
      saveState(); renderDigest(); renderList(); selectEmail(e.id);
    }
    function endOfDay(offsetDays) {
      var d = new Date();
      d.setHours(23, 59, 0, 0);
      return d.getTime() + offsetDays * 24 * 60 * 60 * 1000;
    }
    $('taskToday').addEventListener('click', function () { applyTask(endOfDay(0)); });
    $('taskTomorrow').addEventListener('click', function () { applyTask(endOfDay(1)); });
    $('taskWeek').addEventListener('click', function () { applyTask(endOfDay(7)); });
    $('taskDate').addEventListener('change', function (ev) {
      if (!ev.target.value) return;
      var d = new Date(ev.target.value + 'T23:59:00');
      if (!isNaN(d.getTime())) applyTask(d.getTime());
    });
    var tc = $('taskClear');
    if (tc && !tc.disabled) tc.addEventListener('click', function () {
      state.emails = TriagePilot.clearTaskDue(state.emails, e.id);
      saveState(); renderDigest(); renderList(); selectEmail(e.id);
    });
    // snippets (Superhuman/Missive canned replies)
    function snippetByName(name) {
      return state.snippets.filter(function (s) { return s.name === name; })[0] || null;
    }
    $('snippetInsert').addEventListener('click', function () {
      var pick = $('snippetPick');
      if (!pick || !pick.value) return;
      var s = snippetByName(pick.value);
      if (s) $('draft').value = TriagePilot.applySnippet($('draft').value, s.text);
    });
    $('snippetSave').addEventListener('click', function () {
      var text = $('draft').value.trim();
      if (!text) { alert('Write or generate a draft first.'); return; }
      var name = prompt('Name this snippet (e.g. "Urgent apology", "Quote follow-up"):');
      if (!name) return;
      state.snippets = TriagePilot.addSnippet(state.snippets, name, text);
      saveState();
      selectEmail(e.id); // re-render to refresh the snippet list
    });
    $('snippetDel').addEventListener('click', function () {
      var pick = $('snippetPick');
      if (!pick || !pick.value) return;
      if (!confirm('Delete snippet "' + pick.value + '"?')) return;
      state.snippets = TriagePilot.removeSnippet(state.snippets, pick.value);
      saveState();
      selectEmail(e.id);
    });
    // sender bundle: drop into this sender's mail
    $('senderBundle').addEventListener('click', function () {
      state.senderFilter = e.from;
      renderDigest();
      renderList();
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

  /**
   * Teach the triager from a manual correction. Two kinds of learning:
   *  1. distinctive keywords for the category (learnCorrection), and
   *  2. per-sender memory — future mail from this sender files the same way.
   * Returns the learned keywords (for the "Learned N keywords" copy).
   */
  function teachCorrection(email, category) {
    email.category = category;
    email.label = TriagePilot.LABELS[category];
    var learned = TriagePilot.learnCorrection(category, email.subject, email.body);
    TriagePilot.rememberSender(category, email.from);
    var bits = ['Manually corrected by you to ' + email.label + '.'];
    if (learned.length) bits.push('Learned ' + learned.length + ' keyword' + (learned.length === 1 ? '' : 's') + ' for ' + email.label + '.');
    bits.push('Sender remembered — future mail from them files as ' + email.label + '.');
    email.reason = bits.join(' ');
    email.confidence = 'high';
    return learned;
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

  function renderLearnNote() {
    var el = document.getElementById('learnNote');
    if (!el) return;
    var n = learnedCount();
    var memN = Object.keys(TriagePilot.getSenderMemory()).length;
    var bits = [];
    if (n) bits.push('learned ' + n + ' keyword' + (n === 1 ? '' : 's'));
    if (memN) bits.push('remembers ' + memN + ' sender' + (memN === 1 ? '' : 's'));
    el.innerHTML = bits.length
      ? '<span class="muted">Classifier ' + bits.join(' and ') + ' from your corrections.</span> ' +
        '<button id="resetLearn" class="btn-ghost tiny">Reset learned rules</button>'
      : '<span class="muted">Tip: press <span class="kbd">?</span> for keyboard shortcuts. Correcting a label teaches the classifier.</span> ' +
        '<button id="showKeys" class="btn-ghost tiny">Shortcuts</button>';
    var rb = document.getElementById('resetLearn');
    if (rb) rb.addEventListener('click', function () {
      if (!confirm('Forget all learned keywords and per-sender memory? Built-in rules and sender lists stay.')) return;
      TriagePilot.resetLearnedRules();
      TriagePilot.resetSenderMemory();
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
    teachCorrection(e, cat);
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

  function taskDueSelected(offsetDays) {
    var e = selectedEmail();
    if (!e) return;
    var d = new Date();
    d.setHours(23, 59, 0, 0);
    state.emails = TriagePilot.withTaskDue(state.emails, e.id, d.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    saveState(); renderDigest(); renderList(); selectEmail(e.id);
  }

  function senderBundleSelected() {
    var e = selectedEmail();
    if (!e) return;
    state.senderFilter = e.from;
    renderDigest();
    renderList();
  }

  function insertSnippetText(text) {
    var d = $('draft');
    if (!d) return;
    d.value = TriagePilot.applySnippet(d.value, text);
    d.focus();
  }

  var STATIC_COMMANDS = [
    { name: 'Go to: All', hint: 'split', run: function () { state.split = ''; renderSplits(); renderList(); } },
    { name: 'Go to: Focus', hint: 'split', run: function () { state.split = 'focus'; renderSplits(); renderList(); } },
    { name: 'Go to: FYI', hint: 'split', run: function () { state.split = 'fyi'; renderSplits(); renderList(); } },
    { name: 'Go to: Spam', hint: 'split', run: function () { state.split = 'spam'; renderSplits(); renderList(); } },
    { name: 'Go to: Snoozed', hint: 'split', run: function () { state.split = 'snoozed'; renderSplits(); renderList(); } },
    { name: 'Go to: Tasks', hint: 'split', run: function () { state.split = 'tasks'; renderSplits(); renderList(); } },
    { name: 'Mark handled / reopen', hint: 'm', run: function () { toggleHandled(state.selectedId); } },
    { name: 'Snooze 1 hour', hint: 'snooze', run: function () { snoozeSelected(3600000); } },
    { name: 'Snooze 4 hours', hint: 'snooze', run: function () { snoozeSelected(4 * 3600000); } },
    { name: 'Snooze until tomorrow 9am', hint: 'snooze', run: function () { snoozeTomorrow(); } },
    { name: 'Make task: due today', hint: 't', run: function () { taskDueSelected(0); } },
    { name: 'Make task: due tomorrow', hint: 'task', run: function () { taskDueSelected(1); } },
    { name: 'Make task: due next week', hint: 'task', run: function () { taskDueSelected(7); } },
    { name: 'Clear task', hint: 'task', run: function () {
      var e = selectedEmail();
      if (!e) return;
      state.emails = TriagePilot.clearTaskDue(state.emails, e.id);
      saveState(); renderDigest(); renderList(); selectEmail(e.id);
    } },
    { name: 'Open sender bundle', hint: 'u', run: function () { senderBundleSelected(); } },
    { name: 'Clear sender bundle', hint: 'sender', run: function () { state.senderFilter = null; renderDigest(); renderList(); } },
    { name: 'Label: Urgent', hint: '1', run: function () { shortcutRecategorize('urgent'); } },
    { name: 'Label: Needs reply', hint: '2', run: function () { shortcutRecategorize('reply'); } },
    { name: 'Label: FYI', hint: '3', run: function () { shortcutRecategorize('fyi'); } },
    { name: 'Label: Spam', hint: '4', run: function () { shortcutRecategorize('spam'); } },
    { name: 'Block sender', hint: 'b', run: function () { clickBtn('blockSender'); } },
    { name: 'Trust sender', hint: '', run: function () { clickBtn('trustSender'); } },
    { name: 'Delete email', hint: 'd', run: function () { clickBtn('delEmail'); } },
    { name: 'Clear spam', hint: '', run: function () { clearSpam(); } },
    { name: 'Load sample inbox', hint: '', run: function () { loadSamples(); } },
    { name: 'Sync Gmail inbox', hint: 'gmail', run: function () { if (gmailToken) gmailSync(); } },
    { name: 'Toggle keyboard shortcuts', hint: '?', run: function () { toggleKeyHelp(); } }
  ];

  /* Dynamic command list: static commands + one "Insert snippet: <name>"
   * command per saved snippet (Superhuman-style snippet access). */
  function getCommands() {
    var cmds = STATIC_COMMANDS.slice();
    state.snippets.forEach(function (s) {
      cmds.push({
        name: 'Insert snippet: ' + s.name, hint: 'snippet',
        run: (function (text) { return function () { insertSnippetText(text); }; })(s.text)
      });
    });
    return cmds;
  }

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
    var cmds = getCommands();
    cmdkItems = cmds.filter(function (c) {
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
      else if (k === 't' || k === 'T') taskDueSelected(0);
      else if (k === 'u' || k === 'U') senderBundleSelected();
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

  /* ---------- Gmail connection (OAuth 2.0, read-only; expansion) ----------
   * The access token lives in this variable only — never localStorage,
   * never sent anywhere except googleapis.com. The client ID comes from
   * the user's local config/gmail.local.js (gitignored), never hardcoded.
   */
  var gmailToken = null;
  var gmailSyncing = false;

  function gmailConfigured() {
    return typeof TriagePilotGmail !== 'undefined' && TriagePilotGmail.isConfigured();
  }

  function gmailStatus(msg, isError) {
    var el = $('gmailStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  function renderGmailBox() {
    var show = function (id, on) { var el = $(id); if (el) el.classList.toggle('hidden', !on); };
    if (!gmailConfigured()) {
      show('gmailSetup', true);
      show('gmailConnectWrap', false);
      show('gmailSyncWrap', false);
      return;
    }
    show('gmailSetup', false);
    show('gmailConnectWrap', !gmailToken);
    show('gmailSyncWrap', !!gmailToken);
  }

  function gmailSync() {
    if (!gmailToken || gmailSyncing) return;
    gmailSyncing = true;
    var btn = $('gmailSync');
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
    gmailStatus('Reading your recent inbox…');
    TriagePilotGmail.syncInbox(gmailToken, { maxResults: 25 })
      .then(function (incoming) {
        var fresh = TriagePilotGmail.dedupByGmailId(state.emails, incoming);
        fresh.forEach(function (e) { triage(e); state.emails.unshift(e); });
        gmailStatus(fresh.length
          ? 'Synced ' + fresh.length + ' new email' + (fresh.length === 1 ? '' : 's') + ' — triaged.'
          : 'Inbox up to date — no new emails.', false);
        saveState();
        renderDigest();
        renderList();
        if (state.emails.length) selectEmail(state.emails[0].id);
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Sync failed.';
        if (err && err.status === 401) {
          msg = 'Token expired — click Disconnect, then Connect Gmail again.';
        }
        gmailStatus(msg, true);
      })
      .then(function () {
        gmailSyncing = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Sync inbox'; }
      });
  }

  function initGmail() {
    if (typeof TriagePilotGmail === 'undefined') return; // gmail.js missing — optional module
    renderGmailBox();
    var connect = $('gmailConnect');
    if (connect) connect.addEventListener('click', function () {
      gmailStatus('');
      TriagePilotGmail.requestAccessToken(
        function (token) {
          gmailToken = token;
          renderGmailBox();
          gmailStatus('Connected. Click "Sync inbox" to pull your recent mail.', false);
        },
        function (err) { gmailStatus((err && err.message) || 'Connection failed.', true); }
      );
    });
    var sync = $('gmailSync');
    if (sync) sync.addEventListener('click', gmailSync);
    var disc = $('gmailDisconnect');
    if (disc) disc.addEventListener('click', function () {
      var token = gmailToken;
      gmailToken = null;
      renderGmailBox();
      if (token) {
        TriagePilotGmail.revokeToken(token).then(function () {
          gmailStatus('Disconnected — token forgotten and revoked with Google.', false);
        });
      }
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
    initGmail();
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
