#!/usr/bin/env bash
# triagepilot-ai smoke tests — fast sanity checks. Exit non-zero on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL - $1"; }

# 1-6: required files exist
for f in index.html css/style.css js/classifier.js js/app.js data/samples.json README.md; do
  if [ -f "$f" ]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 7-8: JS syntax valid
for f in js/classifier.js js/app.js; do
  if node --check "$f" >/dev/null 2>&1; then ok "syntax valid: $f"; else bad "syntax error: $f"; fi
done

# 9: samples.json is valid JSON with 10 entries
if node -e "const s=require('./data/samples.json'); if(!Array.isArray(s)||s.length!==10) process.exit(1)" 2>/dev/null; then
  ok "samples.json: valid JSON with 10 emails"
else
  bad "samples.json: must be valid JSON with exactly 10 emails"
fi

# 10: classifier loads in node
if node -e "const T=require('./js/classifier.js'); if(typeof T.classify!=='function'||typeof T.draftReply!=='function') process.exit(1)" 2>/dev/null; then
  ok "classifier loads in node with classify + draftReply"
else
  bad "classifier failed to load in node"
fi

# 11: every sample gets a valid category
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json');
const cats=new Set(T.CATEGORIES);
for(const e of s){ const r=T.classify(e.subject,e.body); if(!cats.has(r.category)) process.exit(1); }
" 2>/dev/null; then
  ok "every sample email gets a valid category"
else
  bad "some sample email got an invalid category"
fi

# 12-14: key samples classified as expected
check_expected() {
  node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json');
const e=s.find(x=>x.id==='$1');
if(!e||T.classify(e.subject,e.body).category!=='$2') process.exit(1);
" 2>/dev/null
}
if check_expected e1 urgent; then ok "burst-pipe email -> urgent"; else bad "burst-pipe email not urgent"; fi
if check_expected e6 spam;   then ok "crypto email -> spam";       else bad "crypto email not spam"; fi
if check_expected e3 reply;  then ok "quote request -> needs reply"; else bad "quote request misclassified"; fi

# 15: draftReply works for every category x both tones
if node -e "
const T=require('./js/classifier.js');
for(const c of T.CATEGORIES) for(const t of ['professional','friendly']){
  const d=T.draftReply({from:'A B <a@b.com>',subject:'s',body:'b',category:c},t,'Biz');
  if(typeof d!=='string'||d.length<20) process.exit(1);
}
" 2>/dev/null; then
  ok "draftReply returns usable drafts for all categories x tones"
else
  bad "draftReply failed for some category/tone"
fi

# 16: confidence is always high|medium|low
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json');
for(const e of s){ const r=T.classify(e.subject,e.body); if(!/^(high|medium|low)$/.test(r.confidence)) process.exit(1); }
" 2>/dev/null; then
  ok "confidence is always high/medium/low"
else
  bad "confidence value out of range"
fi

# 17: new classifier API (filterEmails, nextCategory, digestText)
if node -e "
const T=require('./js/classifier.js');
['filterEmails','nextCategory','digestText'].forEach(f=>{if(typeof T[f]!=='function')process.exit(1)});
" 2>/dev/null; then
  ok "classifier exports filterEmails + nextCategory + digestText"
else
  bad "classifier missing new API"
fi

# 18: filterEmails — query + category combos over the sample inbox
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json').map(e=>({id:e.id,from:e.from,subject:e.subject,body:e.body,category:T.classify(e.subject,e.body).category}));
const q=T.filterEmails(s,'flood','');
if(!q.length||!q.every(e=>(e.subject+e.body).toLowerCase().includes('flood')))process.exit(1);
const spam=T.filterEmails(s,'','spam');
if(spam.length<1||!spam.every(e=>e.category==='spam'))process.exit(1);
const combo=T.filterEmails(s,'quote','reply');
if(combo.length!==1||combo[0].id!=='e3')process.exit(1);
if(T.filterEmails(s,'','').length!==10)process.exit(1);
if(T.filterEmails(s,'zzz-no-match','').length!==0)process.exit(1);
" 2>/dev/null; then
  ok "filterEmails narrows by query, category, and both"
else
  bad "filterEmails broken"
fi

# 19: nextCategory cycles urgent->reply->fyi->spam->urgent
if node -e "
const T=require('./js/classifier.js');
const seq=['urgent','reply','fyi','spam']; let c='urgent';
for(const want of ['reply','fyi','spam','urgent']){ c=T.nextCategory(c); if(c!==want)process.exit(1); }
if(T.nextCategory('bogus')!=='urgent')process.exit(1);
" 2>/dev/null; then
  ok "nextCategory cycles labels for manual correction"
else
  bad "nextCategory cycle broken"
fi

# 20: digestText summarizes counts + lists action items
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json').map(e=>({from:e.from,subject:e.subject,category:T.classify(e.subject,e.body).category}));
const d=T.digestText(s);
if(!/^10 emails triaged: \d+ urgent, \d+ need reply, \d+ FYI, \d+ spam\$/.test(d.split('\n')[0]))process.exit(1);
if(!d.includes('[Urgent]'))process.exit(1);
" 2>/dev/null; then
  ok "digestText renders countable one-line summary"
else
  bad "digestText broken"
fi

# 21: UI wiring — search, clear-spam, persistence, correction hooks
missing=""
for id in searchBox clearSpam; do grep -q "id=\"$id\"" index.html || missing="$missing #$id"; done
for n in saveState loadState filterCat nextCategory clearSpam searchBox digestText; do
  grep -q "$n" js/app.js || missing="$missing $n"
done
if [ -z "$missing" ]; then ok "app.js wires search/filter/persistence/correction UI"; else bad "missing wiring:$missing"; fi

# 22: classifier exports the learning API
if node -e "
const T=require('./js/classifier.js');
['learnCorrection','setLearnedRules','getLearnedRules','resetLearnedRules'].forEach(f=>{if(typeof T[f]!=='function')process.exit(1)});
" 2>/dev/null; then
  ok "classifier exports learnCorrection + set/get/resetLearnedRules"
else
  bad "classifier missing learning API"
fi

# 23: learnCorrection teaches a distinctive word, then classify uses it
if node -e "
const T=require('./js/classifier.js');
T.resetLearnedRules();
const before=T.classify('Zylophone status','How is the zylophone holding up?').category;
if(before==='urgent') process.exit(1); // must not be urgent yet
const fresh=T.learnCorrection('urgent','Zylophone calibration overdue','The zylophone calibration is overdue, please advise.');
if(!fresh.includes('zylophone')) process.exit(1);
const after=T.classify('Zylophone status','How is the zylophone holding up?');
if(after.category!=='urgent') process.exit(1);
if(!/learned/i.test(after.reason)) process.exit(1);
T.resetLearnedRules();
if(T.getLearnedRules().urgent.length!==0) process.exit(1);
" 2>/dev/null; then
  ok "learnCorrection teaches keywords and classify honors them"
else
  bad "classifier learning broken"
fi

# 24: UI wiring — handled state, aging, keyboard shortcuts, learned-rule note
missing=""
for id in hideHandled keyHelp learnNote; do grep -q "id=\"$id\"" index.html || missing="$missing #$id"; done
for n in toggleHandled agingEmail initShortcuts renderLearnNote handledBtn moveSelection; do
  grep -q "$n" js/app.js || missing="$missing $n"
done
grep -q '\.aging' css/style.css || missing="$missing css:.aging"
if [ -z "$missing" ]; then ok "app.js wires handled/aging/shortcuts/learning UI"; else bad "missing wiring:$missing"; fi

# 25: UI wiring — bulk bar, snooze + sender buttons, sender-list panel
missing=""
for id in bulkBar senderNote; do grep -q "id=\"$id\"" index.html || missing="$missing #$id"; done
for n in renderBulk runBulk checkedIds applySplit renderSplits snoozeRemaining classifyWithSender listSender unlistSender senderAction bulkRemove bulkSetHandled bulkRelabel renderSenderNote blockSender trustSender unsnooze; do
  grep -q "$n" js/app.js || missing="$missing $n"
done
for n in isAwake visibleEmails applySplit snoozeRemaining senderAction listSender unlistSender setSenderLists getSenderLists classifyWithSender bulkRemove bulkSetHandled bulkRelabel; do
  grep -q "$n" js/classifier.js || missing="$missing classifier:$n"
done
for c in bulk-bar snoozed-row snooze-tag snooze-actions sender-actions sender-note sender-chip; do
  grep -q "\.$c" css/style.css || missing="$missing css:.$c"
done
if [ -z "$missing" ]; then ok "app.js wires bulk actions, snooze, sender lists"; else bad "missing wiring:$missing"; fi


# 26: expansion files exist
for f in js/gmail.js config/gmail.local.example.js docs/GMAIL-SETUP.md .gitignore; do
  if [ -f "$f" ]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 27: gmail.js syntax valid
if node --check js/gmail.js >/dev/null 2>&1; then ok "syntax valid: js/gmail.js"; else bad "syntax error: js/gmail.js"; fi

# 28: gmail.js loads in node with the full API + read-only scope
if node -e "
const G=require('./js/gmail.js');
['getConfig','isConfigured','requestAccessToken','revokeToken','listRecentMessages','getMessageFull','parseGmailMessage','mapGmailMessage','extractBody','stripHtml','dedupByGmailId','syncInbox'].forEach(f=>{if(typeof G[f]!=='function')process.exit(1)});
if(G.GMAIL_SCOPE!=='https://www.googleapis.com/auth/gmail.readonly')process.exit(1);
" 2>/dev/null; then
  ok "gmail.js exports OAuth + REST + parsing API, read-only scope"
else
  bad "gmail.js API broken"
fi

# 29: no hardcoded credentials anywhere in the app
leak=""
# a plausible real Google client ID (digits-id.apps.googleusercontent.com), not the YOUR_CLIENT_ID placeholder
grep -qE "[0-9]{8,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com" js/gmail.js js/app.js js/classifier.js config/gmail.local.example.js && leak="$leak real-client-id"
grep -qiE "client_secret|AIza[0-9A-Za-z_-]{20}" js/gmail.js js/app.js js/classifier.js && leak="$leak js:secret-pattern"
if [ -z "$leak" ]; then ok "no hardcoded credentials in shipped JS"; else bad "credential leak:$leak"; fi

# 30: example config is a placeholder; the real local config is never committed
missing=""
grep -q "YOUR_CLIENT_ID" config/gmail.local.example.js || missing="$missing example:placeholder"
[ -f "config/gmail.local.js" ] && missing="$missing real-config-committed"
grep -q "config/gmail.local.js" .gitignore || missing="$missing gitignore"
if [ -z "$missing" ]; then ok "config template is a placeholder, local config gitignored + absent"; else bad "config problem:$missing"; fi

# 31: index.html — Gmail box ids + script tags
missing=""
for id in gmailBox gmailSetup gmailConnectWrap gmailConnect gmailSyncWrap gmailSync gmailDisconnect gmailStatus; do
  grep -q "id=\"$id\"" index.html || missing="$missing #$id"
done
grep -q 'src="js/gmail.js"' index.html || missing="$missing gmail.js-script"
grep -q 'src="config/gmail.local.js"' index.html || missing="$missing config-script"
if [ -z "$missing" ]; then ok "index.html wires the Gmail box + module scripts"; else bad "missing wiring:$missing"; fi

# 32: css — gmail + sent-tracking styles
missing=""
for c in gmail-box gmail-row gmail-status sent-line replied-tag; do
  grep -q "\.$c" css/style.css || missing="$missing css:.$c"
done
if [ -z "$missing" ]; then ok "css styles the Gmail box + sent tracking"; else bad "missing css:$missing"; fi

# 33: app.js — Gmail flow + sent tracking + sender-memory teaching wired
missing=""
for n in gmailToken gmailConfigured initGmail gmailSync renderGmailBox markSent sentBtn rememberSender teachCorrection revokeToken; do
  grep -q "$n" js/app.js || missing="$missing $n"
done
if [ -z "$missing" ]; then ok "app.js wires Gmail connect/sync, sent tracking, sender memory"; else bad "missing wiring:$missing"; fi

# 34: classifier exports per-sender memory + sent tracking API
if node -e "
const T=require('./js/classifier.js');
['memoryFor','rememberSender','setSenderMemory','getSenderMemory','resetSenderMemory','markSent','sentCount'].forEach(f=>{if(typeof T[f]!=='function')process.exit(1)});
" 2>/dev/null; then
  ok "classifier exports sender-memory + sent-tracking API"
else
  bad "classifier missing memory/sent API"
fi

# 35: gmail local config never read as a secret — getConfig only returns a clientId
if node -e "
const G=require('./js/gmail.js');
if(G.getConfig()!==null)process.exit(1); // nothing configured in node
" 2>/dev/null; then
  ok "gmail.getConfig is null without a user-supplied config"
else
  bad "gmail.getConfig should be null when unconfigured"
fi


# 36: classifier exports the v2 API (tasks, sender bundles, snippets)
if node -e "
const T=require('./js/classifier.js');
['senderKeys','emailsFromSender','taskState','withTaskDue','clearTaskDue','taskCount','addSnippet','removeSnippet','applySnippet'].forEach(f=>{if(typeof T[f]!=='function')process.exit(1)});
" 2>/dev/null; then
  ok "classifier exports tasks + sender-bundle + snippet API"
else
  bad "classifier missing v2 API"
fi

# 37: UI wiring — tasks, sender bundle, snippets
missing=""
for id in senderBanner senderClear snippetPick taskDate taskToday taskTomorrow taskWeek taskClear senderBundle; do
  grep -q "id=\"$id\"" index.html js/app.js || missing="$missing #$id"
done
grep -q 'id="split-tasks"' index.html || missing="$missing #split-tasks"
for n in taskDueSelected senderBundleSelected insertSnippetText getCommands renderSenderBanner senderInitial withTaskDue clearTaskDue taskState emailsFromSender addSnippet removeSnippet applySnippet; do
  grep -q "$n" js/app.js || missing="$missing $n"
done
grep -q 'data-split="tasks"' index.html || missing="$missing tasks-tab"
if [ -z "$missing" ]; then ok "app.js wires tasks, sender bundles, snippets"; else bad "missing wiring:$missing"; fi

# 38: css styles the v2 surfaces (no border-radius anywhere)
missing=""
for c in task-tag sender-banner sender-link avatar dossier conf-ring ring-fg action-ledger ledger-group ledger-label task-line date-pick; do
  grep -q "\\.$c" css/style.css || missing="$missing css:.$c"
done
if grep "border-radius" css/style.css | grep -qv "pill::before"; then missing="$missing border-radius-present"; fi
if [ -z "$missing" ]; then ok "css styles v2 surfaces, zero border-radius"; else bad "missing css:$missing"; fi

# 39: v2 audit doc present, covers all three competitors
if grep -q "Superhuman" REDESIGN-AUDIT.md && grep -q "Shortwave" REDESIGN-AUDIT.md && grep -q "Missive" REDESIGN-AUDIT.md; then
  ok "REDESIGN-AUDIT.md covers Superhuman + Shortwave + Missive"
else
  bad "REDESIGN-AUDIT.md missing competitor coverage"
fi

echo ""
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
