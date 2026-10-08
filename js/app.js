/* triagepilot-ai UI — browser only. TriagePilot classifier comes from js/classifier.js */
(function () {
  'use strict';

  var LS_KEY = 'triagepilot.v1';

  var state = {
    emails: [],        // {id, from, subject, body, category, label, confidence, reason}
    selectedId: null,
    tone: 'professional',
    business: 'TriagePilot Demo Co.',
    filterCat: '',     // category filter from digest pills
    query: ''          // inbox search text
  };

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        emails: state.emails, tone: state.tone, business: state.business
      }));
    } catch (e) { /* storage unavailable */ }
  }

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s && Array.isArray(s.emails)) {
        state.emails = s.emails;
        if (s.tone) state.tone = s.tone;
        if (s.business) state.business = s.business;
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
    var r = TriagePilot.classify(email.subject, email.body);
    email.category = r.category;
    email.label = r.label;
    email.confidence = r.confidence;
    email.reason = r.reason;
  }

  function renderDigest() {
    var counts = { urgent: 0, reply: 0, fyi: 0, spam: 0 };
    state.emails.forEach(function (e) { counts[e.category]++; });
    var total = state.emails.length;
    var action = counts.urgent + counts.reply;
    function pill(cat, n, word) {
      var on = state.filterCat === cat ? ' on' : '';
      return '<button class="pill ' + badgeClass(cat) + on + '" data-filter="' + cat +
        '" title="Filter inbox: ' + word + '">' + n + ' ' + word + '</button>';
    }
    $('digest').innerHTML =
      '<strong>' + total + '</strong> emails triaged &nbsp;·&nbsp; ' +
      pill('urgent', counts.urgent, 'urgent') + ' ' +
      pill('reply', counts.reply, 'need replies') + ' ' +
      pill('fyi', counts.fyi, 'FYI') + ' ' +
      pill('spam', counts.spam, 'spam') +
      (total ? ' &nbsp;·&nbsp; <em>' + action + ' need your attention</em>' : '') +
      (total ? ' &nbsp;<button id="copyDigest" class="btn-ghost tiny" title="Copy summary">Copy summary</button>' : '');
    Array.prototype.forEach.call($('digest').querySelectorAll('[data-filter]'), function (b) {
      b.addEventListener('click', function () {
        var cat = b.getAttribute('data-filter');
        state.filterCat = (state.filterCat === cat) ? '' : cat;
        renderDigest();
        renderList();
      });
    });
    var cp = $('copyDigest');
    if (cp) cp.addEventListener('click', function () {
      var text = TriagePilot.digestText(state.emails);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
      }
      cp.textContent = 'Copied!';
      setTimeout(function () { cp.textContent = 'Copy summary'; }, 1500);
    });
  }

  function renderList() {
    var order = { urgent: 0, reply: 1, fyi: 2, spam: 3 };
    var shown = TriagePilot.filterEmails(state.emails, state.query, state.filterCat);
    var sorted = shown.slice().sort(function (a, b) {
      return (order[a.category] - order[b.category]) || a.id.localeCompare(b.id);
    });
    var html = sorted.map(function (e) {
      return '<div class="email' + (e.id === state.selectedId ? ' sel' : '') + '" data-id="' + e.id + '" data-cat="' + e.category + '">' +
        '<div class="email-top"><span class="pill ' + badgeClass(e.category) + '">' + escapeHtml(e.label) + '</span>' +
        '<span class="conf">' + escapeHtml(e.confidence) + '</span></div>' +
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
      state.filterCat = ''; state.query = ''; $('searchBox').value = '';
      renderDigest(); renderList();
    });
    Array.prototype.forEach.call($('inbox').querySelectorAll('.email'), function (el) {
      el.addEventListener('click', function () { selectEmail(el.getAttribute('data-id')); });
    });
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
      '<button id="fixLabel" class="action" title="Cycle to the next label">Wrong label? → ' + TriagePilot.LABELS[TriagePilot.nextCategory(e.category)] + '</button>' +
      '<button id="delEmail" class="action danger">Delete</button>' +
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
      e.reason = 'Manually corrected by you to ' + e.label + '.';
      e.confidence = 'high';
      saveState();
      renderDigest();
      renderList();
      selectEmail(e.id);
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
      body: body || ''
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
          var e = { id: s.id, from: s.from, subject: s.subject, body: s.body };
          triage(e);
          return e;
        });
        state.filterCat = '';
        saveState();
        renderDigest();
        renderList();
        if (state.emails.length) selectEmail(state.emails[0].id);
      })
      .catch(function () {
        $('inbox').innerHTML = '<p class="empty">Could not load sample inbox (fetch needs http). Run via a local server: <code>npx serve .</code></p>';
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
    var restored = loadState();
    if (restored) {
      $('bizName').value = state.business === 'TriagePilot Demo Co.' ? '' : state.business;
    }
    renderDigest();
    renderList();
  });
})();
