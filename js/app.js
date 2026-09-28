/* triagepilot-ai UI — browser only. TriagePilot classifier comes from js/classifier.js */
(function () {
  'use strict';

  var state = {
    emails: [],        // {id, from, subject, body, category, label, confidence, reason}
    selectedId: null,
    tone: 'professional',
    business: 'TriagePilot Demo Co.'
  };

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
    $('digest').innerHTML =
      '<strong>' + total + '</strong> emails triaged &nbsp;·&nbsp; ' +
      '<span class="pill b-urgent">' + counts.urgent + ' urgent</span> ' +
      '<span class="pill b-reply">' + counts.reply + ' need replies</span> ' +
      '<span class="pill b-fyi">' + counts.fyi + ' FYI</span> ' +
      '<span class="pill b-spam">' + counts.spam + ' spam</span>' +
      (total ? ' &nbsp;·&nbsp; <em>' + action + ' need your attention</em>' : '');
  }

  function renderList() {
    var order = { urgent: 0, reply: 1, fyi: 2, spam: 3 };
    var sorted = state.emails.slice().sort(function (a, b) {
      return (order[a.category] - order[b.category]) || a.id.localeCompare(b.id);
    });
    var html = sorted.map(function (e) {
      return '<div class="email' + (e.id === state.selectedId ? ' sel' : '') + '" data-id="' + e.id + '" data-cat="' + e.category + '">' +
        '<div class="email-top"><span class="pill ' + badgeClass(e.category) + '">' + escapeHtml(e.label) + '</span>' +
        '<span class="conf">' + escapeHtml(e.confidence) + '</span></div>' +
        '<div class="email-subj">' + escapeHtml(e.subject) + '</div>' +
        '<div class="email-from">' + escapeHtml(e.from) + '</div></div>';
    }).join('');
    $('inbox').innerHTML = html || '<p class="empty">No emails yet. Load the sample inbox or paste one in.</p>';
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
      '</div>' +
      '<textarea id="draft" rows="10" placeholder="Your draft will appear here — edit it freely."></textarea>' +
      '<button id="copyBtn" class="action">Copy draft</button> <span id="copied"></span>';
    $('tone').addEventListener('change', function (ev) { state.tone = ev.target.value; });
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
    renderDigest();
    renderList();
    selectEmail(email.id);
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
    });
    renderDigest();
    renderList();
  });
})();
