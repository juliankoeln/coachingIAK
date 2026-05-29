// app.js – CoachBoard v4

// Guard: make sure Firebase is ready before anything runs
if (typeof firebase === 'undefined') {
  console.error('Firebase not loaded!');
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function randomCode() { return Math.random().toString(36).substring(2,7).toUpperCase(); }
function getUrlParam(n) { return new URLSearchParams(window.location.search).get(n); }
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function toast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── State ─────────────────────────────────────────────────────────────────
let sessionCode   = null, sessionRef  = null;
let myName        = null, myId        = null;
let isModerator   = false, isDisplay  = false;
let phaseListener = null, answersListener = null, votesListener = null;

// Poll state
let pollQuestions   = [];   // [{text, type, options:[]}]
let pollCurrentIdx  = 0;
let pollLiveListener = null;

// ─── MOD TOPBAR ────────────────────────────────────────────────────────────
function showModTopbar() {
  document.getElementById('mod-topbar').style.display = 'flex';
  document.getElementById('btn-topbar-welcome').onclick = goToWelcome;
  document.getElementById('btn-topbar-poll').onclick    = () => showPollEditor();
  document.getElementById('btn-topbar-preset').onclick  = () => showPresetManager();
}
function goToWelcome() {
  sessionRef.child('phase').set('welcome');
  showScreen('screen-mod-welcome-edit');
}

// ─── DISPLAY MODE ──────────────────────────────────────────────────────────
isDisplay = getUrlParam('display') === '1';
if (isDisplay) {
  sessionCode = getUrlParam('code');
  if (!sessionCode) {
    document.body.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:40px;font-size:20px;">⚠️ Kein Session-Code in der URL.</div>';
  } else {
    sessionRef = db.ref('sessions/' + sessionCode);
    document.body.classList.add('display-mode');
    showScreen('screen-display');
    document.getElementById('display-content').innerHTML = `<div class="display-centered"><div class="waiting-icon" style="margin:0 auto 20px;"></div><div style="color:var(--muted);font-size:24px;">Verbinde mit Session…</div></div>`;
    watchDisplayPhase();
  }
}

function watchDisplayPhase() {
  sessionRef.on('value', snap => {
    const s = snap.val();
    if (!s) {
      document.getElementById('display-content').innerHTML = `
        <div class="display-centered">
          <div class="display-big-emoji">⚠️</div>
          <div class="display-big-title" style="font-size:36px;">Session nicht gefunden</div>
          <div class="display-big-sub">Bitte neuen Beamer-Link von der Moderatorin holen.</div>
        </div>`;
      return;
    }
    const p = s.phase;
    if      (p === 'welcome')     showDisplayWelcome(s.welcome || {});
    else if (p === 'lobby')       showDisplayLobby(s);
    else if (p === 'input')       showDisplayInput(s);
    else if (p === 'voting')      showDisplayVoting(s);
    else if (p === 'results')     showDisplayResultsIce(s);
    else if (p === 'poll_active') showDisplayPollActive(s);
    else if (p === 'poll_done')   showDisplayPollDone(s);
  });
}

function setDC(html) { document.getElementById('display-content').innerHTML = html; }

function showDisplayWelcome(w) {
  const font       = w.font || 'DM Serif Display';
  const logoHtml   = w.logo
    ? `<img src="${w.logo}" style="max-height:140px;max-width:320px;object-fit:contain;border-radius:12px;margin-bottom:28px;" />`
    : `<div class="display-welcome-emoji">${w.emoji||'✦'}</div>`;
  setDC(`<div class="display-welcome">
    ${logoHtml}
    <div class="display-welcome-title" style="font-family:'${font}',serif,sans-serif;">${w.title||'Willkommen'}</div>
    <div class="display-welcome-sub">${w.subtitle||''}</div>
  </div>`);
}

function showDisplayLobby(s) {
  const parts = s.participants || {};
  const chips = Object.values(parts).map(p=>`<div class="display-chip"><span class="chip-dot"></span>${p.name}</div>`).join('');
  const url   = window.location.origin + window.location.pathname + '?join=' + s.code;
  setDC(`<div class="display-lobby">
    <div class="display-lobby-left">
      <div class="display-label">Session beitreten</div>
      <div id="display-qr"></div>
      <div class="display-code">${s.code}</div>
    </div>
    <div class="display-lobby-right">
      <div class="display-label">Verbunden (${Object.keys(parts).length})</div>
      <div class="display-chips">${chips||'<span style="color:var(--muted)">Warten…</span>'}</div>
    </div>
  </div>`);
  setTimeout(()=>{
    const el=document.getElementById('display-qr');
    if(el&&el.children.length===0) new QRCode(el,{text:url,width:180,height:180,colorDark:'#0f0e17',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
  },100);
}

function showDisplayInput(s) {
  const a=Object.keys(s.answers||{}).length, t=Object.keys(s.participants||{}).length;
  setDC(`<div class="display-centered">
    <div class="display-big-emoji">🤔</div>
    <div class="display-big-title">Nobody is Perfect</div>
    <div class="display-big-sub">Schreib eine überraschende Wahrheit über dich</div>
    <div class="display-progress-pill">${a} von ${t} eingegangen</div>
  </div>`);
}

function showDisplayVoting(s) {
  const v=Object.keys(s.votes||{}).length, t=Object.keys(s.participants||{}).length;
  setDC(`<div class="display-centered">
    <div class="display-big-emoji">🗳️</div>
    <div class="display-big-title">Wer hat was geschrieben?</div>
    <div class="display-big-sub">Tippe auf eurem Handy den Namen der Person</div>
    <div class="display-progress-pill">${v} von ${t} haben abgestimmt</div>
  </div>`);
}

function showDisplayResultsIce(s) {
  const answers=s.answers||{}, votes=s.votes||{}, parts=s.participants||{};
  const nm={}; Object.entries(parts).forEach(([id,p])=>nm[id]=p.name);
  const items=Object.entries(answers).map(([aid,ans])=>{
    const cg=[], wg=[];
    Object.entries(votes).forEach(([vid,vv])=>{
      const g=vv[aid]; if(!g) return;
      if(g===aid) cg.push(nm[vid]||'?'); else wg.push({voter:nm[vid]||'?',guessed:nm[g]||'?'});
    });
    return {name:nm[aid]||'?',text:ans.text,cg,wg};
  });
  const cards=items.map((it,i)=>{
    const emoji=it.cg.length===0?'🕵️':it.cg.length===Object.keys(votes).length?'😅':'🎯';
    return `<div class="display-result-card" style="animation-delay:${i*.12}s">
      <div class="display-result-text">"${it.text}"</div>
      <div class="display-result-author">${emoji} <strong>${it.name}</strong>
        <span class="display-result-score">${it.cg.length} von ${Object.keys(votes).length} erraten</span></div>
      ${it.cg.length?`<div class="display-result-correct">✓ ${it.cg.join(', ')}</div>`:''}
      ${it.wg.length?`<div class="display-result-wrong">✗ ${it.wg.map(w=>`${w.voter} → ${w.guessed}`).join(', ')}</div>`:''}
    </div>`;
  }).join('');
  setDC(`<div class="display-results"><div class="display-results-title">🎉 Auflösung</div><div class="display-results-grid">${cards}</div></div>`);
}

// ─── DISPLAY: POLL ACTIVE ──────────────────────────────────────────────────
function showDisplayPollActive(s) {
  const poll = s.poll || {};
  const questions = poll.questions || [];
  const idx = poll.currentIdx || 0;
  const q = questions[idx];
  if (!q) return;

  const pollAnswers = (s.pollAnswers || {})[idx] || {};
  const totalParts  = Object.keys(s.participants || {}).length;
  const totalVotes  = Object.keys(pollAnswers).length;

  // Count per option
  const counts = buildCounts(q, pollAnswers);
  const maxVal  = Math.max(...Object.values(counts), 1);

  const bars = Object.entries(counts).map(([label, count]) => {
    const pct = Math.round((count / maxVal) * 100);
    const pctOfTotal = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    return `<div class="display-bar-row">
      <div class="display-bar-label">${label}</div>
      <div class="display-bar-track">
        <div class="display-bar-fill" style="width:${pct}%;"></div>
      </div>
      <div class="display-bar-val">${count} <span style="color:var(--muted);font-size:14px;">(${pctOfTotal}%)</span></div>
    </div>`;
  }).join('');

  setDC(`<div class="display-poll">
    <div class="display-poll-header">
      <div class="display-label">FRAGE ${idx+1} VON ${questions.length}</div>
      <div class="display-poll-q">${q.text}</div>
    </div>
    <div class="display-poll-bars">${bars}</div>
    <div class="display-progress-pill" style="margin-top:20px;">${totalVotes} von ${totalParts} haben geantwortet</div>
  </div>`);
}

function showDisplayPollDone(s) {
  setDC(`<div class="display-centered">
    <div class="display-big-emoji">✅</div>
    <div class="display-big-title">Umfrage abgeschlossen</div>
    <div class="display-big-sub">Danke für eure Antworten!</div>
  </div>`);
}

// ─── Helper: count votes per option ────────────────────────────────────────
function buildCounts(q, pollAnswers) {
  const counts = {};
  if (q.type === 'scale') {
    for (let i=1;i<=5;i++) counts[String(i)] = 0;
  } else if (q.type === 'yesno') {
    counts['Ja'] = 0; counts['Nein'] = 0;
  } else if (q.type === 'choice') {
    (q.options||[]).forEach(o => counts[o] = 0);
  }
  Object.values(pollAnswers).forEach(a => {
    if (counts[a] !== undefined) counts[a]++;
  });
  return counts;
}

// ─── MODERATOR: Create Session ─────────────────────────────────────────────
if (!isDisplay) {
  const btnCreate = document.getElementById('btn-create-session');
  if (btnCreate) btnCreate.addEventListener('click', () => {
    sessionCode = randomCode();
    isModerator = true;
    sessionRef  = db.ref('sessions/' + sessionCode);
    sessionRef.set({
      code:sessionCode, createdAt:Date.now(), phase:'welcome',
      welcome:{emoji:'✦',title:'Willkommen',subtitle:''},
      participants:{}, answers:{}, votes:{}
    }).then(() => {
      // Only show UI after Firebase confirms the session is written
      showModTopbar();
      showModeratorWelcomeEdit();
    });
    setTimeout(()=>sessionRef.remove(), 8*60*60*1000);
  });
}

// ─── MOD: Welcome Editor ───────────────────────────────────────────────────
let welcomeLogoBase64 = null;
let welcomeFont = 'DM Serif Display';

function showModeratorWelcomeEdit() {
  showScreen('screen-mod-welcome-edit');
  const url = window.location.origin + window.location.pathname + '?display=1&code=' + sessionCode;
  document.getElementById('display-url-link').href = url;
  document.getElementById('display-url-text').textContent = url;

  ['welcome-emoji','welcome-title','welcome-subtitle'].forEach(id =>
    document.getElementById(id).oninput = saveWelcome);

  // ── Font selector ──
  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      welcomeFont = btn.dataset.font;
      saveWelcome();
    };
  });

  // ── Logo upload ──
  const fileInput   = document.getElementById('logo-file-input');
  const preview     = document.getElementById('logo-preview');
  const placeholder = document.getElementById('logo-placeholder');
  const removeBtn   = document.getElementById('btn-remove-logo');

  document.getElementById('btn-choose-logo').onclick = () => fileInput.click();
  document.getElementById('logo-upload-area').onclick = () => fileInput.click();

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast('Bild max. 500KB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      welcomeLogoBase64 = ev.target.result;
      preview.src = welcomeLogoBase64;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
      removeBtn.style.display = 'inline-flex';
      // Hide emoji when logo is set
      document.getElementById('welcome-emoji').value = '';
      saveWelcome();
    };
    reader.readAsDataURL(file);
  };

  removeBtn.onclick = () => {
    welcomeLogoBase64 = null;
    preview.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'block';
    removeBtn.style.display = 'none';
    fileInput.value = '';
    saveWelcome();
  };

  document.getElementById('btn-save-welcome').onclick = () => {
    saveWelcome(); sessionRef.child('phase').set('welcome');
    toast('Willkommensscreen ist live!','success');
  };
  document.getElementById('btn-go-lobby').onclick = () => {
    saveWelcome(); sessionRef.child('phase').set('lobby'); showModeratorLobby();
  };
  document.getElementById('btn-open-presets').onclick = () => showPresetManager();
}

function saveWelcome() {
  sessionRef.child('welcome').set({
    title:    document.getElementById('welcome-title').value.trim()    || 'Willkommen',
    subtitle: document.getElementById('welcome-subtitle').value.trim() || '',
    emoji:    document.getElementById('welcome-emoji').value.trim()    || '',
    font:     welcomeFont || 'DM Serif Display',
    logo:     welcomeLogoBase64 || null
  });
}

// ─── MOD: Lobby ────────────────────────────────────────────────────────────
function showModeratorLobby() {
  showScreen('screen-mod-lobby');
  const joinUrl = window.location.origin + window.location.pathname + '?join=' + sessionCode;
  document.getElementById('join-url').textContent = joinUrl;
  const qrC = document.getElementById('qr-code');
  qrC.innerHTML = '';
  new QRCode(qrC,{text:joinUrl,width:200,height:200,colorDark:'#0f0e17',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});
  document.getElementById('session-code-display').textContent = sessionCode;

  sessionRef.child('participants').on('value', snap => {
    const parts = snap.val() || {};
    renderParticipantList(parts);
    const cnt = Object.keys(parts).length;
    document.getElementById('participant-count').textContent = cnt;
    document.getElementById('btn-start-icebreaker').disabled = cnt < 2;
  });

  document.getElementById('btn-start-icebreaker').onclick = () => {
    sessionRef.update({answers:null,votes:null}).then(()=>{
      sessionRef.child('phase').set('input');
      showScreen('screen-mod-waiting');
      watchAnswers();
    });
  };
  document.getElementById('btn-copy-link').onclick = () =>
    navigator.clipboard.writeText(joinUrl).then(()=>toast('Link kopiert!','success'));
}

function renderParticipantList(parts) {
  const list = document.getElementById('participant-list');
  list.innerHTML = '';
  Object.values(parts).forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'participant-chip';
    chip.innerHTML = `<span class="chip-dot"></span>${p.name}`;
    list.appendChild(chip);
  });
}

// ─── MOD: Icebreaker ──────────────────────────────────────────────────────
function watchAnswers() {
  if (answersListener) sessionRef.child('answers').off('value', answersListener);
  answersListener = sessionRef.child('answers').on('value', snap => {
    const a = snap.val() || {};
    const cnt = Object.keys(a).length;
    sessionRef.child('participants').once('value', ps => {
      const t = Object.keys(ps.val()||{}).length;
      document.getElementById('answer-progress').textContent = `${cnt} von ${t} Antworten eingegangen`;
      document.getElementById('btn-start-voting').disabled = cnt < 2;
    });
  });
  document.getElementById('btn-start-voting').onclick = () => {
    sessionRef.child('phase').set('voting');
    showScreen('screen-mod-voting');
    watchVotingProgress();
  };
}

function watchVotingProgress() {
  if (votesListener) sessionRef.child('votes').off('value', votesListener);
  votesListener = sessionRef.child('votes').on('value', vs => {
    const v = vs.val() || {};
    sessionRef.child('participants').once('value', ps => {
      const t = Object.keys(ps.val()||{}).length;
      document.getElementById('voting-progress').textContent = `${Object.keys(v).length} von ${t} haben abgestimmt`;
      document.getElementById('btn-show-results').disabled = Object.keys(v).length < 1;
    });
  });
  document.getElementById('btn-show-results').onclick = () => {
    sessionRef.child('phase').set('results');
    showModResults();
  };
}

async function showModResults() {
  showScreen('screen-mod-results');
  const [as, vs, ps] = await Promise.all([
    sessionRef.child('answers').once('value'),
    sessionRef.child('votes').once('value'),
    sessionRef.child('participants').once('value')
  ]);
  const answers=as.val()||{}, votes=vs.val()||{}, parts=ps.val()||{};
  const nm={}; Object.entries(parts).forEach(([id,p])=>nm[id]=p.name);
  const items=Object.entries(answers).map(([aid,ans])=>{
    const cg=[],wg=[];
    Object.entries(votes).forEach(([vid,vv])=>{
      const g=vv[aid]; if(!g) return;
      if(g===aid) cg.push(nm[vid]||'?'); else wg.push({voter:nm[vid]||'?',guessed:nm[g]||'?'});
    });
    return {name:nm[aid]||'?',answer:ans.text,cg,wg};
  });
  const container=document.getElementById('results-container');
  container.innerHTML='';
  items.forEach((it,i)=>{
    const card=document.createElement('div'); card.className='result-card'; card.style.animationDelay=i*.1+'s';
    const emoji=it.cg.length===0?'🕵️':it.cg.length===Object.keys(votes).length?'😅':'🎯';
    card.innerHTML=`<div class="result-answer">"${it.answer}"</div>
      <div class="result-reveal">${emoji} <strong>${it.name}</strong>
        <span class="result-score">${it.cg.length} von ${Object.keys(votes).length} erraten</span></div>
      ${it.cg.length?`<div class="result-guessers correct">✓ Richtig: ${it.cg.join(', ')}</div>`:''}
      ${it.wg.length?`<div class="result-guessers wrong">✗ Dachten: ${it.wg.map(w=>`${w.voter}→${w.guessed}`).join(', ')}</div>`:''}`;
    container.appendChild(card);
  });
  document.getElementById('btn-new-round').onclick = () => {
    sessionRef.update({answers:null,votes:null}).then(()=>{
      sessionRef.child('phase').set('welcome');
      showModeratorWelcomeEdit();
      toast('Zurück zum Willkommensscreen','success');
    });
  };
}

// ─── MOD: POLL EDITOR ──────────────────────────────────────────────────────
function showPollEditor() {
  showScreen('screen-mod-poll-editor');
  pollQuestions = [];
  renderPollQuestionList();

  // Type selector
  let selectedType = 'scale';
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
      document.getElementById('poll-choice-options').style.display = selectedType==='choice' ? 'block' : 'none';
    };
  });

  // Choice options builder
  let choiceOptions = [];
  function renderChoiceOptions() {
    const list = document.getElementById('poll-options-list');
    list.innerHTML = '';
    choiceOptions.forEach((opt,i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;';
      row.innerHTML = `<input type="text" value="${opt}" placeholder="Option ${i+1}" style="flex:1;margin-bottom:0;" />
        <button class="btn btn-ghost" style="padding:6px 10px;flex-shrink:0;">✕</button>`;
      row.querySelector('input').oninput = e => choiceOptions[i] = e.target.value;
      row.querySelector('button').onclick = () => { choiceOptions.splice(i,1); renderChoiceOptions(); };
      list.appendChild(row);
    });
  }
  document.getElementById('btn-add-option').onclick = () => {
    choiceOptions.push(''); renderChoiceOptions();
  };

  // Add question
  document.getElementById('btn-add-question').onclick = () => {
    const text = document.getElementById('poll-q-text').value.trim();
    if (!text) { toast('Bitte Fragetext eingeben','error'); return; }
    if (selectedType==='choice' && choiceOptions.filter(o=>o.trim()).length < 2) {
      toast('Mindestens 2 Optionen nötig','error'); return;
    }
    pollQuestions.push({ text, type: selectedType, options: selectedType==='choice' ? [...choiceOptions.filter(o=>o.trim())] : [] });
    document.getElementById('poll-q-text').value = '';
    choiceOptions = []; renderChoiceOptions();
    renderPollQuestionList();
    toast('Frage hinzugefügt ✓','success');
  };

  document.getElementById('btn-poll-start').onclick = startPollLive;
}

function renderPollQuestionList() {
  const list = document.getElementById('poll-question-list');
  list.innerHTML = '';
  document.getElementById('btn-poll-start').disabled = pollQuestions.length === 0;

  pollQuestions.forEach((q,i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:14px 18px;margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;';
    const typeLabel = {scale:'📊 Skala',yesno:'👍 Ja/Nein',choice:'🔘 Auswahl'}[q.type];
    card.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:4px;">${i+1}. ${q.text}</div>
        <span class="badge" style="background:var(--surface2);color:var(--muted);font-size:11px;">${typeLabel}</span>
        ${q.options.length ? `<span style="color:var(--muted);font-size:12px;margin-left:8px;">${q.options.join(' · ')}</span>` : ''}
      </div>
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;flex-shrink:0;" data-idx="${i}">✕</button>`;
    card.querySelector('button').onclick = () => { pollQuestions.splice(i,1); renderPollQuestionList(); };
    list.appendChild(card);
  });
}

// ─── MOD: POLL LIVE ────────────────────────────────────────────────────────
function startPollLive() {
  pollCurrentIdx = 0;
  // Save questions to Firebase
  sessionRef.child('poll').set({ questions: pollQuestions, currentIdx: 0 });
  sessionRef.child('pollAnswers').remove();
  sessionRef.child('phase').set('poll_active');
  showPollLiveScreen();
}

function showPollLiveScreen() {
  showScreen('screen-mod-poll-live');
  const q = pollQuestions[pollCurrentIdx];
  document.getElementById('poll-live-qnum').textContent   = pollCurrentIdx + 1;
  document.getElementById('poll-live-qtotal').textContent = pollQuestions.length;
  document.getElementById('poll-live-question').textContent = q.text;

  // Update Firebase currentIdx
  sessionRef.child('poll/currentIdx').set(pollCurrentIdx);

  // Listen to live answers for this question
  if (pollLiveListener) sessionRef.child('pollAnswers/' + pollCurrentIdx).off('value', pollLiveListener);
  pollLiveListener = sessionRef.child('pollAnswers/' + pollCurrentIdx).on('value', snap => {
    const pollAnswers = snap.val() || {};
    const totalVotes  = Object.keys(pollAnswers).length;
    document.getElementById('poll-live-count').textContent = totalVotes;
    renderLiveBars(q, pollAnswers);
  });

  // Navigation buttons
  document.getElementById('btn-poll-prev-q').disabled = pollCurrentIdx === 0;
  document.getElementById('btn-poll-prev-q').onclick = () => {
    if (pollCurrentIdx > 0) { pollCurrentIdx--; showPollLiveScreen(); }
  };
  document.getElementById('btn-poll-next-q').onclick = () => {
    if (pollCurrentIdx < pollQuestions.length - 1) {
      pollCurrentIdx++;
      showPollLiveScreen();
    } else {
      endPoll();
    }
  };
  document.getElementById('btn-poll-next-q').textContent =
    pollCurrentIdx < pollQuestions.length - 1 ? 'Nächste Frage →' : 'Umfrage beenden ✓';
  document.getElementById('btn-poll-end').onclick = endPoll;
}

function renderLiveBars(q, pollAnswers) {
  const counts  = buildCounts(q, pollAnswers);
  const total   = Object.values(counts).reduce((a,b)=>a+b,0);
  const maxVal  = Math.max(...Object.values(counts), 1);
  const container = document.getElementById('poll-live-bars');
  container.innerHTML = '';

  Object.entries(counts).forEach(([label, count]) => {
    const pct    = Math.round((count / maxVal) * 100);
    const pctTot = total > 0 ? Math.round((count / total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'live-bar-row';
    row.innerHTML = `
      <div class="live-bar-label">${label}</div>
      <div class="live-bar-track">
        <div class="live-bar-fill" style="width:${pct}%;"></div>
      </div>
      <div class="live-bar-val">${count} <span class="muted" style="font-size:12px;">${pctTot}%</span></div>`;
    container.appendChild(row);
  });
}

function endPoll() {
  if (pollLiveListener) sessionRef.child('pollAnswers/' + pollCurrentIdx).off('value', pollLiveListener);
  sessionRef.child('phase').set('poll_done');
  showPollSummary();
}

async function showPollSummary() {
  showScreen('screen-mod-poll-summary');
  const [pollSnap, answersSnap] = await Promise.all([
    sessionRef.child('poll').once('value'),
    sessionRef.child('pollAnswers').once('value')
  ]);
  const poll    = pollSnap.val() || {};
  const allAnswers = answersSnap.val() || {};
  const questions  = poll.questions || [];

  const container = document.getElementById('poll-summary-container');
  container.innerHTML = '';

  questions.forEach((q, i) => {
    const pollAnswers = allAnswers[i] || {};
    const counts  = buildCounts(q, pollAnswers);
    const total   = Object.values(counts).reduce((a,b)=>a+b,0);
    const maxVal  = Math.max(...Object.values(counts), 1);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '16px';
    card.style.animationDelay = i * .08 + 's';

    const bars = Object.entries(counts).map(([label,count]) => {
      const pct    = Math.round((count/maxVal)*100);
      const pctTot = total > 0 ? Math.round((count/total)*100) : 0;
      return `<div class="live-bar-row">
        <div class="live-bar-label">${label}</div>
        <div class="live-bar-track"><div class="live-bar-fill" style="width:${pct}%;"></div></div>
        <div class="live-bar-val">${count} <span class="muted" style="font-size:12px;">${pctTot}%</span></div>
      </div>`;
    }).join('');

    card.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;font-size:13px;color:var(--muted);">FRAGE ${i+1}</div>
      <div style="font-family:var(--font-d);font-size:18px;margin-bottom:16px;line-height:1.3;">${q.text}</div>
      ${bars}
      <div style="color:var(--muted);font-size:12px;margin-top:10px;">${total} Antworten</div>`;
    container.appendChild(card);
  });

  document.getElementById('btn-poll-restart').onclick = () => showPollEditor();
}

// ─── PARTICIPANT: Join ──────────────────────────────────────────────────────
if (!isDisplay) {
  const joinCode = getUrlParam('join');
  if (joinCode) {
    isModerator = false;
    sessionCode = joinCode.length<=8 ? joinCode.toUpperCase() : joinCode.split('/').pop().toUpperCase();
    showScreen('screen-join');
    document.getElementById('session-code-join').textContent = sessionCode;
  } else if (!isModerator) {
    showScreen('screen-home');
  }

  const btnJoin = document.getElementById('btn-join');
  if (btnJoin) btnJoin.addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    if (!name) { toast('Bitte gib deinen Namen ein','error'); return; }
    myName = name;
    myId   = Date.now().toString(36) + Math.random().toString(36).substr(2);
    sessionRef = db.ref('sessions/' + sessionCode);
    sessionRef.once('value', snap => {
      if (!snap.exists()) { toast('Session nicht gefunden!','error'); return; }
      const ref = sessionRef.child('participants/' + myId);
      ref.set({id:myId,name:myName,joinedAt:Date.now()});
      ref.onDisconnect().remove();
      watchSessionPhase();
    });
  });
}

// ─── PARTICIPANT: Watch Phase ──────────────────────────────────────────────
function watchSessionPhase() {
  if (phaseListener) sessionRef.child('phase').off('value', phaseListener);
  phaseListener = sessionRef.child('phase').on('value', snap => {
    const phase = snap.val();
    if      (phase==='welcome')     showParticipantWelcome();
    else if (phase==='lobby')       showParticipantLobby();
    else if (phase==='input')       showParticipantInput();
    else if (phase==='voting')      showParticipantVoting();
    else if (phase==='results')     showParticipantResultsOnPhone();
    else if (phase==='poll_active') watchParticipantPoll();
    else if (phase==='poll_done')   showScreen('screen-participant-idle');
  });
}

function showParticipantWelcome() {
  sessionRef.child('welcome').once('value', snap => {
    const w = snap.val() || {};
    const font = w.font || 'DM Serif Display';

    // Logo or Emoji
    const logoWrap  = document.getElementById('p-welcome-logo-wrap');
    const emojiEl   = document.getElementById('p-welcome-emoji');
    if (w.logo) {
      document.getElementById('p-welcome-logo').src = w.logo;
      logoWrap.style.display  = 'block';
      emojiEl.style.display   = 'none';
    } else {
      emojiEl.textContent     = w.emoji || '✦';
      emojiEl.style.display   = 'block';
      logoWrap.style.display  = 'none';
    }

    // Title with chosen font
    const titleEl = document.getElementById('p-welcome-title');
    titleEl.textContent = w.title || 'Willkommen';
    titleEl.style.fontFamily = `'${font}', serif, sans-serif`;

    document.getElementById('p-welcome-sub').textContent  = w.subtitle || '';
    document.getElementById('p-welcome-name').textContent = myName;
  });
  showScreen('screen-participant-welcome');
}

function showParticipantLobby() {
  showScreen('screen-participant-lobby');
  document.getElementById('p-name-display').textContent = myName;
  sessionRef.child('participants').on('value', snap => {
    document.getElementById('p-participant-count').textContent = Object.keys(snap.val()||{}).length + ' Teilnehmer verbunden';
  });
}

function showParticipantInput() {
  const ta=document.getElementById('input-answer'), btn=document.getElementById('btn-submit-answer');
  ta.value=''; ta.disabled=false; btn.disabled=false; btn.textContent='Abschicken ✓';
  myVotes={}; showScreen('screen-participant-input');
}

const btnSubmitAnswer = document.getElementById('btn-submit-answer');
if (btnSubmitAnswer) btnSubmitAnswer.addEventListener('click', () => {
  const answer = document.getElementById('input-answer').value.trim();
  if (!answer) { toast('Bitte schreib etwas!','error'); return; }
  sessionRef.child('answers/'+myId).set({text:answer,authorId:myId});
  btnSubmitAnswer.disabled=true;
  document.getElementById('input-answer').disabled=true;
  showScreen('screen-participant-answer-sent');
});

async function showParticipantVoting() {
  showScreen('screen-participant-voting'); myVotes={};
  const [as,ps]=await Promise.all([sessionRef.child('answers').once('value'),sessionRef.child('participants').once('value')]);
  const answers=as.val()||{}, parts=ps.val()||{};
  const nameList=Object.entries(parts).filter(([id])=>id!==myId).map(([id,p])=>({id,name:p.name}));
  renderVotingCards(answers,nameList);
}

let myVotes={};
function renderVotingCards(answers,nameList) {
  const container=document.getElementById('voting-cards'); container.innerHTML=''; myVotes={};
  const other=Object.entries(answers).filter(([id])=>id!==myId);
  other.forEach(([aid,ans],i)=>{
    const card=document.createElement('div'); card.className='voting-card'; card.style.animationDelay=i*.08+'s';
    card.innerHTML=`<div class="voting-answer-text">"${ans.text}"</div>
      <div class="voting-question">Wer hat das geschrieben?</div>
      <div class="name-options">${nameList.map(p=>`<button class="name-btn" data-answer="${aid}" data-guess="${p.id}">${p.name}</button>`).join('')}</div>`;
    container.appendChild(card);
  });
  container.querySelectorAll('.name-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      container.querySelectorAll(`.name-btn[data-answer="${btn.dataset.answer}"]`).forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      myVotes[btn.dataset.answer]=btn.dataset.guess;
      checkAllVoted(other.length);
    });
  });
  const submitBtn=document.getElementById('btn-submit-votes');
  submitBtn.disabled=true; submitBtn.textContent=`Noch ${other.length} offen…`;
  submitBtn.onclick=()=>{ sessionRef.child('votes/'+myId).set(myVotes); submitBtn.disabled=true; showScreen('screen-participant-voted'); };
}
function checkAllVoted(total) {
  const cnt=Object.keys(myVotes).length, btn=document.getElementById('btn-submit-votes');
  btn.disabled=cnt<total; btn.textContent=cnt<total?`Noch ${total-cnt} offen…`:'Abstimmung abschicken ✓';
}

async function showParticipantResultsOnPhone() {
  showScreen('screen-participant-results');
  const [as,vs,ps]=await Promise.all([
    sessionRef.child('answers').once('value'),
    sessionRef.child('votes').once('value'),
    sessionRef.child('participants').once('value')
  ]);
  const answers=as.val()||{}, votes=vs.val()||{}, parts=ps.val()||{};
  const nm={}; Object.entries(parts).forEach(([id,p])=>nm[id]=p.name);
  const myVR=votes[myId]||{};
  const items=Object.entries(answers).map(([aid,ans])=>{
    const isMe=aid===myId;
    const cg=[]; Object.entries(votes).forEach(([vid,vv])=>{ if(vv[aid]===aid) cg.push(nm[vid]||'?'); });
    return {name:nm[aid]||'?',text:ans.text,cg,isMe,iGuessed:myVR[aid]===aid};
  });
  const container=document.getElementById('p-results-container'); container.innerHTML='';
  items.forEach((it,i)=>{
    const card=document.createElement('div'); card.className='result-card'; card.style.animationDelay=i*.08+'s';
    const badge=it.isMe
      ? `<span class="badge badge-yellow" style="margin-bottom:8px;">Das warst du!</span>`
      : it.iGuessed
        ? `<span class="badge badge-success" style="margin-bottom:8px;">Richtig erraten ✓</span>`
        : `<span class="badge" style="margin-bottom:8px;background:var(--accent3)22;color:var(--accent3);">Nicht erraten ✗</span>`;
    card.innerHTML=`${badge}<div class="result-answer">"${it.text}"</div>
      <div class="result-reveal" style="font-size:14px;">→ <strong>${it.name}</strong>
        <span class="result-score">${it.cg.length} haben es erraten</span></div>`;
    container.appendChild(card);
  });
  setTimeout(()=>{
    const pa=document.getElementById('p-put-away');
    pa.style.display='block'; pa.style.animation='fadeUp .5s ease';
    setTimeout(()=>showScreen('screen-participant-idle'), 5000);
  }, 8000);
}

// ─── PARTICIPANT: Poll ─────────────────────────────────────────────────────
let pPollIdxListener = null;
let pPollAnswered = {}; // idx → answer (so we don't re-show after already answered)

function watchParticipantPoll() {
  // Watch for currentIdx changes → render that question
  if (pPollIdxListener) sessionRef.child('poll/currentIdx').off('value', pPollIdxListener);
  pPollIdxListener = sessionRef.child('poll').on('value', snap => {
    const poll = snap.val();
    if (!poll) return;
    const idx = poll.currentIdx || 0;
    const q   = (poll.questions || [])[idx];
    if (!q) return;

    // Already answered this one? Show wait screen
    if (pPollAnswered[idx] !== undefined) {
      showScreen('screen-participant-poll-wait');
      return;
    }
    renderParticipantPollQuestion(q, idx, poll.questions.length);
  });
}

function renderParticipantPollQuestion(q, idx, total) {
  showScreen('screen-participant-poll');
  document.getElementById('p-poll-badge').textContent = `Frage ${idx+1} von ${total}`;
  document.getElementById('p-poll-question').textContent = q.text;
  document.getElementById('p-poll-sent').style.display = 'none';

  const optionsEl = document.getElementById('p-poll-options');
  optionsEl.innerHTML = '';
  optionsEl.style.display = 'block';

  if (q.type === 'scale') {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';
    [1,2,3,4,5].forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'poll-scale-btn';
      btn.textContent = v;
      btn.onclick = () => submitPollAnswer(idx, String(v), optionsEl);
      row.appendChild(btn);
    });
    // Labels below
    const labels = document.createElement('div');
    labels.style.cssText = 'display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:8px;';
    labels.innerHTML = '<span>Gar nicht</span><span>Sehr</span>';
    optionsEl.appendChild(row);
    optionsEl.appendChild(labels);
  } else if (q.type === 'yesno') {
    ['Ja','Nein'].forEach(label => {
      const btn = document.createElement('button');
      btn.className = 'poll-choice-btn';
      btn.textContent = label === 'Ja' ? '👍 Ja' : '👎 Nein';
      btn.onclick = () => submitPollAnswer(idx, label, optionsEl);
      optionsEl.appendChild(btn);
    });
  } else if (q.type === 'choice') {
    (q.options||[]).forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'poll-choice-btn';
      btn.textContent = opt;
      btn.onclick = () => submitPollAnswer(idx, opt, optionsEl);
      optionsEl.appendChild(btn);
    });
  }
}

function submitPollAnswer(idx, value, optionsEl) {
  pPollAnswered[idx] = value;
  sessionRef.child('pollAnswers/' + idx + '/' + myId).set(value);
  optionsEl.style.display = 'none';
  document.getElementById('p-poll-sent').style.display = 'block';
}

// ─── VORBEREITUNG: Preset speichern & laden ────────────────────────────────
// Presets werden unter db/presets/<name> gespeichert – unabhängig von Sessions.
// So kann man zu Hause vorbereiten und morgen einfach laden.

const presetsRef = db.ref('presets');

function showPresetManager() {
  showScreen('screen-preset-manager');
  loadPresetList();

  document.getElementById('btn-save-preset').onclick = saveCurrentAsPreset;
  document.getElementById('btn-preset-back').onclick  = () => showScreen('screen-mod-welcome-edit');
}

function saveCurrentAsPreset() {
  const name = document.getElementById('preset-name-input').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben', 'error'); return; }

  const preset = {
    name,
    savedAt: Date.now(),
    welcome: {
      emoji:    document.getElementById('welcome-emoji').value.trim()    || '',
      title:    document.getElementById('welcome-title').value.trim()    || 'Willkommen',
      subtitle: document.getElementById('welcome-subtitle').value.trim() || '',
      font:     welcomeFont    || 'DM Serif Display',
      logo:     welcomeLogoBase64 || null
    },
    pollQuestions: pollQuestions || []
  };

  const key = name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  presetsRef.child(key).set(preset).then(() => {
    toast('Preset gespeichert ✓', 'success');
    document.getElementById('preset-name-input').value = '';
    loadPresetList();
  });
}

function loadPresetList() {
  const list = document.getElementById('preset-list');
  list.innerHTML = '<div class="muted" style="font-size:13px;">Lädt…</div>';

  presetsRef.once('value', snap => {
    const presets = snap.val() || {};
    list.innerHTML = '';

    if (Object.keys(presets).length === 0) {
      list.innerHTML = '<div class="muted" style="font-size:13px;">Noch keine gespeicherten Vorbereitungen.</div>';
      return;
    }

    Object.entries(presets).sort((a,b) => b[1].savedAt - a[1].savedAt).forEach(([key, preset]) => {
      const date = new Date(preset.savedAt).toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'});
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:12px;';
      card.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600;margin-bottom:2px;">${preset.welcome.emoji} ${preset.name}</div>
          <div style="color:var(--muted);font-size:12px;">${date} · ${(preset.pollQuestions||[]).length} Umfrage-Fragen</div>
        </div>
        <button class="btn btn-primary btn-sm" style="font-size:12px;padding:6px 14px;">Laden</button>
        <button class="btn btn-ghost" style="font-size:12px;padding:6px 10px;">🗑</button>
      `;
      card.querySelectorAll('button')[0].onclick = () => loadPreset(preset);
      card.querySelectorAll('button')[1].onclick = () => {
        if (confirm('Preset löschen?')) presetsRef.child(key).remove().then(() => loadPresetList());
      };
      list.appendChild(card);
    });
  });
}

function loadPreset(preset) {
  const w = preset.welcome || {};
  document.getElementById('welcome-emoji').value    = w.emoji    || '';
  document.getElementById('welcome-title').value    = w.title    || '';
  document.getElementById('welcome-subtitle').value = w.subtitle || '';

  // Restore font
  welcomeFont = w.font || 'DM Serif Display';
  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === welcomeFont);
  });

  // Restore logo
  const preview     = document.getElementById('logo-preview');
  const placeholder = document.getElementById('logo-placeholder');
  const removeBtn   = document.getElementById('btn-remove-logo');
  if (w.logo) {
    welcomeLogoBase64     = w.logo;
    preview.src           = w.logo;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    removeBtn.style.display   = 'inline-flex';
  } else {
    welcomeLogoBase64         = null;
    preview.src               = '';
    preview.style.display     = 'none';
    placeholder.style.display = 'block';
    removeBtn.style.display   = 'none';
  }

  // Load poll questions
  pollQuestions = preset.pollQuestions || [];

  if (sessionRef) saveWelcome();
  toast(`"${preset.name}" geladen ✓`, 'success');
  showScreen('screen-mod-welcome-edit');
}
