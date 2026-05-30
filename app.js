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

  const menuBtn  = document.getElementById('btn-topbar-menu');
  const dropdown = document.getElementById('topbar-dropdown');
  if (!menuBtn || !dropdown) return;

  // Toggle on click
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
  };
  // Close on outside click
  document.addEventListener('click', () => { dropdown.style.display = 'none'; });

  // Wire all menu items
  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';
      const a = item.dataset.action;
      if      (a === 'nobody')       startIcebreakerFromMenu('nobody');
      else if (a === 'twotruths')    startIcebreakerFromMenu('twotruths');
      else if (a === 'cards')        showCardsEditor();
      else if (a === 'bingo')        showBingoEditor();
      else if (a === 'whoknows')     showWhoKnows();
      else if (a === 'poll')         showPollEditor();
      else if (a === 'team')         showTeamEditor();
      else if (a === 'welcome-edit') goToWelcomeEditor();
      else if (a === 'lobby')        showModeratorLobby();
      else if (a === 'preset')       showPresetManager();
    };
  });
}

function startIcebreakerFromMenu(game) {
  sessionRef.update({answers:null,votes:null}).then(() => {
    if (game === 'nobody') {
      sessionRef.child('phase').set('input');
      showScreen('screen-mod-waiting');
      if (typeof showDemoHelper === 'function') showDemoHelper('input');
      watchAnswers();
    } else if (game === 'twotruths') {
      startTwoTruths();
    }
  });
}
function goToWelcome() {
  // Just push phase to Firebase - all participant phones flip to welcome screen
  // Mod stays on current screen (no editor forced open)
  sessionRef.child('phase').set('welcome');
  toast('Willkommensscreen aktiv auf allen Handys ✓', 'success');
}

function goToWelcomeEditor() {
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
    else if (p === 'team_active')       showDisplayTeam(s);
    else if (p === 'team_done')         showDisplayTeamDone(s);
    else if (p === 'cards_active')      showDisplayCards(s);
    else if (p === 'twotruths_input')   showDisplayTwoTruthsInput(s);
    else if (p === 'twotruths_vote')    showDisplayTwoTruthsVote(s);
    else if (p === 'bingo_collect')        showDisplayBingoCollect(s);
    else if (p === 'whoknows_collect')     showDisplayBingoCollect(s);
    else if (p === 'whoknows_active')      showDisplayWhoKnows(s);
    else if (p === 'bingo_active')        showDisplayBingo(s);
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

let _displayTimerInterval = null;
let _displayTimerSeconds  = 0;

function showDisplayTeam(s) {
  const team = s.team || {};
  const c    = (team.challenges || [])[team.currentIdx || 0];
  if (!c) return;

  // Render static structure once (timer updated separately)
  const scores  = team.scores || {};
  const sorted  = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  const scoreBar = sorted.map(([name, pts], i) =>
    `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
      <div style="font-size:16px;font-weight:700;width:24px;color:var(--muted);">${i+1}</div>
      <div style="flex:1;font-size:18px;">${name}</div>
      <div style="font-weight:700;font-size:20px;color:var(--accent);">${pts} Pkt</div>
    </div>`).join('');

  setDC(`<div class="display-team">
    <div class="display-team-left">
      <div class="display-label">CHALLENGE ${(team.currentIdx||0)+1} VON ${team.challenges.length}</div>
      <div class="display-team-q">${c.text}</div>
      <div id="display-team-timer" style="font-size:clamp(40px,6vw,80px);font-weight:700;color:var(--text);margin-top:20px;font-family:monospace;">--:--</div>
      <div style="color:var(--muted);font-size:16px;margin-top:4px;">⏱ ${c.minutes} Min · ★ ${c.points} Punkte</div>
    </div>
    <div class="display-team-right">
      <div class="display-label">PUNKTE</div>
      ${scoreBar || '<div style="color:var(--muted)">Noch keine Punkte</div>'}
    </div>
  </div>`);

  // Start local countdown on beamer
  clearInterval(_displayTimerInterval);
  _displayTimerSeconds = team.timerSeconds || c.minutes * 60;
  updateDisplayTimer();

  if (team.timerRunning) {
    _displayTimerInterval = setInterval(() => {
      _displayTimerSeconds--;
      updateDisplayTimer();
      if (_displayTimerSeconds <= 0) clearInterval(_displayTimerInterval);
    }, 1000);
  }
}

function updateDisplayTimer() {
  const el = document.getElementById('display-team-timer');
  if (!el) return;
  const m   = Math.floor(Math.max(0, _displayTimerSeconds) / 60);
  const s   = Math.max(0, _displayTimerSeconds) % 60;
  el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  el.style.color = _displayTimerSeconds <= 30 ? 'var(--accent3)' : _displayTimerSeconds <= 60 ? 'var(--accent)' : 'var(--text)';
}

function showDisplayTeamDone(s) {
  const scores = (s.team || {}).scores || {};
  const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  const rows = sorted.map(([name,pts],i) => `
    <div style="display:flex;align-items:center;gap:16px;padding:16px 20px;border-radius:var(--r);margin-bottom:10px;
      background:${i===0?'rgba(232,197,71,.1)':'var(--surface)'};
      border:1px solid ${i===0?'rgba(232,197,71,.4)':'var(--border)'};animation:fadeUp .3s ease ${i*.1}s both;">
      <div style="font-size:28px;font-weight:700;width:36px;color:${i===0?'var(--accent)':'var(--muted)'};">${i+1}</div>
      <div style="flex:1;font-size:clamp(18px,3vw,28px);font-weight:${i===0?600:400};">${name} ${i===0?'👑':''}</div>
      <div style="font-size:clamp(20px,3vw,32px);font-weight:700;color:${i===0?'var(--accent)':'var(--text)'};">${pts} Pkt</div>
    </div>`).join('');
  setDC(`<div class="display-results">
    <div class="display-results-title">🏆 Endergebnis</div>
    ${rows}
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

  // Icebreaker selector
  let selectedIcebreaker = null;
  document.querySelectorAll('.icebreaker-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.icebreaker-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedIcebreaker = card.dataset.game;
      const cnt = parseInt(document.getElementById('participant-count').textContent) || 0;
      document.getElementById('btn-start-icebreaker').disabled = cnt < 2;
    });
  });

  document.getElementById('btn-start-icebreaker').onclick = () => {
    if (!selectedIcebreaker) { toast('Bitte erst ein Spiel wählen', 'error'); return; }
    if (selectedIcebreaker === 'nobody') {
      sessionRef.update({answers:null,votes:null}).then(()=>{
        sessionRef.child('phase').set('input');
        showScreen('screen-mod-waiting');
        watchAnswers();
      });
    } else if (selectedIcebreaker === 'twotruths') {
      startTwoTruths();
    } else if (selectedIcebreaker === 'cards') {
      showCardsEditor();
    } else if (selectedIcebreaker === 'bingo') {
      showBingoEditor();
    }
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
// Poll editor state – module level so closures stay clean
let pollSelectedType  = 'scale';
let pollChoiceOptions = [];

function renderChoiceOptions() {
  const list = document.getElementById('poll-options-list');
  if (!list) return;
  list.innerHTML = '';
  pollChoiceOptions.forEach((opt, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;';
    row.innerHTML = `<input type="text" value="${opt}" placeholder="Option ${i+1}" style="flex:1;margin-bottom:0;" />
      <button class="btn btn-ghost" style="padding:6px 10px;flex-shrink:0;">✕</button>`;
    row.querySelector('input').oninput = e => { pollChoiceOptions[i] = e.target.value; };
    row.querySelector('button').onclick = () => { pollChoiceOptions.splice(i, 1); renderChoiceOptions(); };
    list.appendChild(row);
  });
}

function showPollEditor() {
  showScreen('screen-mod-poll-editor');

  // Reset input fields but keep loaded questions
  pollSelectedType  = 'scale';
  pollChoiceOptions = [];
  document.getElementById('poll-q-text').value = '';
  document.getElementById('poll-choice-options').style.display = 'none';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  const defaultTypeBtn = document.querySelector('.type-btn[data-type="scale"]');
  if (defaultTypeBtn) defaultTypeBtn.classList.add('active');
  renderChoiceOptions();
  renderPollQuestionList();

  // Type selector
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pollSelectedType = btn.dataset.type;
      document.getElementById('poll-choice-options').style.display =
        pollSelectedType === 'choice' ? 'block' : 'none';
    };
  });

  // Add option
  document.getElementById('btn-add-option').onclick = () => {
    pollChoiceOptions.push(''); renderChoiceOptions();
  };

  // Add question
  document.getElementById('btn-add-question').onclick = () => {
    const text = document.getElementById('poll-q-text').value.trim();
    if (!text) { toast('Bitte Fragetext eingeben', 'error'); return; }
    if (pollSelectedType === 'choice' && pollChoiceOptions.filter(o => o.trim()).length < 2) {
      toast('Mindestens 2 Optionen nötig', 'error'); return;
    }
    pollQuestions.push({
      text,
      type: pollSelectedType,
      options: pollSelectedType === 'choice' ? [...pollChoiceOptions.filter(o => o.trim())] : []
    });
    document.getElementById('poll-q-text').value = '';
    pollChoiceOptions = []; renderChoiceOptions();
    renderPollQuestionList();
    toast('Frage hinzugefügt ✓', 'success');
  };

  document.getElementById('btn-poll-start').onclick = startPollLive;

  const clearBtn = document.getElementById('btn-poll-clear');
  if (clearBtn) clearBtn.onclick = () => {
    if (pollQuestions.length === 0 || confirm('Alle Fragen löschen?')) {
      pollQuestions.splice(0, pollQuestions.length);
      renderPollQuestionList();
      toast('Fragen geleert', 'info');
    }
  };
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
        ${(q.options||[]).length ? `<span style="color:var(--muted);font-size:12px;margin-left:8px;">${q.options.join(' · ')}</span>` : ''}
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

  document.getElementById('btn-poll-restart').onclick = () => { pollQuestions.splice(0, pollQuestions.length); showPollEditor(); };
}

// ─── PARTICIPANT: Join ──────────────────────────────────────────────────────
if (!isDisplay) {
  const joinCode = getUrlParam('join');
  if (joinCode) {
    isModerator = false;
    sessionCode = joinCode.length<=8 ? joinCode.toUpperCase() : joinCode.split('/').pop().toUpperCase();
    showScreen('screen-join');
    document.getElementById('session-code-join').textContent = sessionCode;
  } else if (!isModerator && !isDisplay) {
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
  if (phaseListener) sessionRef.off('value', phaseListener);
  phaseListener = sessionRef.on('value', snap => {
    const session = snap.val() || {};
    const phase = session.phase;
    if      (phase==='welcome')           showParticipantWelcome();
    else if (phase==='lobby')             showParticipantLobby();
    else if (phase==='input')             showParticipantInput();
    else if (phase==='voting')            showParticipantVoting();
    else if (phase==='results')           showParticipantResultsOnPhone();
    else if (phase==='poll_active')       watchParticipantPoll();
    else if (phase==='poll_done')         showScreen('screen-participant-idle');
    else if (phase==='team_active')       watchParticipantTeam();
    else if (phase==='team_done')         showScreen('screen-participant-idle');
    else if (phase==='cards_active')      showParticipantCard(session);
    else if (phase==='twotruths_input')   showParticipantTwoTruthsInput();
    else if (phase==='twotruths_vote')    showParticipantTwoTruthsVote(session);
    else if (phase==='bingo_collect')      showParticipantBingoSubmit();
    else if (phase==='whoknows_collect')   showParticipantBingoSubmit();
    else if (phase==='whoknows_active')    watchParticipantWhoKnows();
    else if (phase==='whoknows_done')      showScreen('screen-participant-idle');
    else if (phase==='bingo_active')      showParticipantBingo(session);
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
  if (pPollIdxListener) sessionRef.child('poll').off('value', pPollIdxListener);
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

let _presetReturnScreen = 'screen-mod-welcome-edit';

function showPresetManager(returnScreen) {
  _presetReturnScreen = returnScreen || document.querySelector('.screen.active')?.id || 'screen-mod-welcome-edit';
  showScreen('screen-preset-manager');
  loadPresetList();
  document.getElementById('btn-save-preset').onclick = saveCurrentAsPreset;
  document.getElementById('btn-preset-back').onclick  = () => showScreen(_presetReturnScreen);
}

function saveCurrentAsPreset() {
  const name = document.getElementById('preset-name-input').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben', 'error'); return; }

  // Read welcome from Firebase (source of truth, not DOM fields that may be hidden)
  sessionRef.child('welcome').once('value', snap => {
    const w = snap.val() || {};
    const preset = {
      name,
      savedAt: Date.now(),
      welcome: {
        emoji:    w.emoji    || '',
        title:    w.title    || 'Willkommen',
        subtitle: w.subtitle || '',
        font:     w.font     || 'DM Serif Display',
        logo:     w.logo     || null
      },
      pollQuestions:  pollQuestions.slice(),
      teamChallenges: teamChallenges.slice()
    };

    const key = name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
    presetsRef.child(key).set(preset).then(() => {
      toast(`"${name}" gespeichert · ${pollQuestions.length} Frage${pollQuestions.length!==1?'n':''} ✓`, 'success');
      document.getElementById('preset-name-input').value = '';
      loadPresetList();
    });
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
          <div style="color:var(--muted);font-size:12px;">${date} · ${(preset.pollQuestions||[]).length} Umfrage-Fragen · ${(preset.teamChallenges||[]).length} Challenges</div>
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
  const loaded = preset.pollQuestions || [];
  pollQuestions.splice(0, pollQuestions.length);
  loaded.forEach(q => pollQuestions.push(q));

  // Load team challenges
  const loadedTeam = preset.teamChallenges || [];
  teamChallenges.splice(0, teamChallenges.length);
  loadedTeam.forEach(c => teamChallenges.push(c));

  if (sessionRef) saveWelcome();

  const qCount = pollQuestions.length;
  toast(`"${preset.name}" geladen · ${qCount} Frage${qCount!==1?'n':''} ✓`, 'success');

  // Open poll editor if questions loaded, else team editor if challenges, else welcome
  if (pollQuestions.length > 0) {
    showPollEditor();
  } else if (teamChallenges.length > 0) {
    showTeamEditor();
  } else {
    showScreen('screen-mod-welcome-edit');
  }
}

// ══════════════════════════════════════════════════════════════
// TEAMSPIEL
// ══════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────
let teamChallenges   = [];   // [{text, minutes, points}]
let teamAssignments  = {};   // { teamName: [participantId, ...] }
let teamScores       = {};   // { teamName: points }
let teamCurrentIdx   = 0;
let teamTimerInterval = null;
let teamTimerSeconds  = 0;
let teamTimerRunning  = false;

// ─── Open Editor ──────────────────────────────────────────────
function showTeamEditor() {
  showScreen('screen-mod-team-editor');
  // Don't reset teamChallenges – may be loaded from preset
  teamAssignments = {};
  teamScores      = {};

  renderTeamChallengeList();
  renderTeamAssignment();

  // Random shuffle
  document.getElementById('btn-team-random').onclick = () => {
    const count = parseInt(document.getElementById('team-count-input').value) || 2;
    shuffleTeams(count);
  };

  // Manual assign
  document.getElementById('btn-team-manual').onclick = () => {
    const count = parseInt(document.getElementById('team-count-input').value) || 2;
    showManualTeamAssignment(count);
  };

  // Team count change → re-render
  document.getElementById('team-count-input').oninput = () => {
    if (Object.keys(teamAssignments).length > 0) {
      const count = parseInt(document.getElementById('team-count-input').value) || 2;
      shuffleTeams(count);
    }
  };

  // Add challenge
  document.getElementById('btn-add-challenge').onclick = () => {
    const text    = document.getElementById('challenge-text').value.trim();
    const minutes = parseInt(document.getElementById('challenge-time').value)  || 5;
    const points  = parseInt(document.getElementById('challenge-points').value) || 10;
    if (!text) { toast('Bitte Aufgabe eingeben', 'error'); return; }
    teamChallenges.push({ text, minutes, points });
    document.getElementById('challenge-text').value = '';
    renderTeamChallengeList();
    toast('Challenge hinzugefügt ✓', 'success');
  };

  document.getElementById('btn-team-start').onclick = startTeamGame;
}

// ─── Random Shuffle ────────────────────────────────────────────
async function shuffleTeams(count) {
  const snap = await sessionRef.child('participants').once('value');
  const parts = Object.values(snap.val() || {});
  if (parts.length < count) { toast(`Zu wenig Teilnehmer für ${count} Teams`, 'error'); return; }

  // Fisher-Yates shuffle
  const shuffled = [...parts].sort(() => Math.random() - .5);
  teamAssignments = {};
  const teamNames = ['🔴 Team Rot', '🔵 Team Blau', '🟢 Team Grün', '🟡 Team Gelb', '🟣 Team Lila', '🟠 Team Orange'];
  for (let i = 0; i < count; i++) teamAssignments[teamNames[i]] = [];
  shuffled.forEach((p, i) => teamAssignments[teamNames[i % count]].push(p));

  renderTeamAssignment();
  checkTeamStartReady();
}

// ─── Manual Assignment ─────────────────────────────────────────
async function showManualTeamAssignment(count) {
  const snap  = await sessionRef.child('participants').once('value');
  const parts = Object.values(snap.val() || {});
  const teamNames = ['🔴 Team Rot', '🔵 Team Blau', '🟢 Team Grün', '🟡 Team Gelb', '🟣 Team Lila', '🟠 Team Orange'].slice(0, count);

  // Init empty teams
  teamAssignments = {};
  teamNames.forEach(n => teamAssignments[n] = []);

  const container = document.getElementById('team-assignment-display');
  container.innerHTML = `
    <div style="color:var(--muted);font-size:13px;margin-bottom:12px;">Klick auf einen Namen um sein Team zu wechseln:</div>
    <div id="manual-team-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;"></div>
  `;

  function renderManualGrid() {
    const grid = document.getElementById('manual-team-grid');
    if (!grid) return;
    grid.innerHTML = '';
    teamNames.forEach((tname, ti) => {
      const col = document.createElement('div');
      col.className = 'card';
      col.style.cssText = 'padding:12px;background:var(--surface2);';
      col.innerHTML = `<div style="font-weight:600;margin-bottom:8px;font-size:13px;">${tname}</div>
        <div class="manual-members"></div>`;
      const membersEl = col.querySelector('.manual-members');
      (teamAssignments[tname] || []).forEach(p => {
        const chip = document.createElement('div');
        chip.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:var(--surface);border-radius:6px;margin-bottom:4px;font-size:13px;';
        chip.innerHTML = `<span>${p.name}</span>`;
        // Click to move to next team
        chip.style.cursor = 'pointer';
        chip.onclick = () => {
          // Click a member to move them to next team
          const curIdx = teamNames.indexOf(tname);
          const nextTeam = teamNames[(curIdx + 1) % teamNames.length];
          teamAssignments[tname] = teamAssignments[tname].filter(x => x.id !== p.id);
          teamAssignments[nextTeam].push(p);
          renderManualGrid();
          checkTeamStartReady();
        };
        membersEl.appendChild(chip);
      });
      grid.appendChild(col);
    });

    // Unassigned
    const assigned = Object.values(teamAssignments).flat().map(p => p.id);
    const unassigned = parts.filter(p => !assigned.includes(p.id));
    if (unassigned.length > 0) {
      const unCol = document.createElement('div');
      unCol.className = 'card';
      unCol.style.cssText = 'padding:12px;border-color:var(--accent3);';
      unCol.innerHTML = `<div style="font-weight:600;margin-bottom:8px;font-size:13px;color:var(--accent3);">Nicht zugeteilt</div>`;
      unassigned.forEach(p => {
        const chip = document.createElement('div');
        chip.style.cssText = 'padding:4px 8px;background:var(--surface2);border-radius:6px;margin-bottom:4px;font-size:13px;cursor:pointer;';
        chip.textContent = p.name;
        chip.onclick = () => {
          // Add unassigned to smallest team
          const smallest = teamNames.reduce((a,b) =>
            (teamAssignments[a]||[]).length <= (teamAssignments[b]||[]).length ? a : b);
          teamAssignments[smallest].push(p);
          renderManualGrid();
          checkTeamStartReady();
        };
        unCol.appendChild(chip);
      });
      grid.appendChild(unCol);
    }
  }

  // Start with all participants unassigned
  renderManualGrid();
  checkTeamStartReady();
}

// ─── Render Team Assignment (after shuffle) ────────────────────
function renderTeamAssignment() {
  const container = document.getElementById('team-assignment-display');
  if (Object.keys(teamAssignments).length === 0) {
    container.innerHTML = '<div class="muted" style="font-size:13px;">Noch keine Teams eingeteilt.</div>';
    return;
  }
  const cards = Object.entries(teamAssignments).map(([name, members]) => `
    <div style="background:var(--surface2);border-radius:var(--r-sm);padding:10px 14px;flex:1;min-width:120px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;">${name}</div>
      ${members.map(p => `<div style="font-size:12px;color:var(--muted);padding:2px 0;">${p.name}</div>`).join('')}
    </div>`).join('');
  container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;">${cards}</div>`;
}

// ─── Render Challenge List ─────────────────────────────────────
function renderTeamChallengeList() {
  const list = document.getElementById('team-challenge-list');
  list.innerHTML = '';
  document.getElementById('btn-team-start').disabled =
    teamChallenges.length === 0 || Object.keys(teamAssignments).length === 0;

  teamChallenges.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:12px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;';
    card.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:4px;">${i+1}. ${c.text.substring(0,80)}${c.text.length>80?'…':''}</div>
        <div style="display:flex;gap:10px;">
          <span class="badge" style="background:var(--surface2);color:var(--muted);">⏱ ${c.minutes} Min</span>
          <span class="badge" style="background:var(--surface2);color:var(--accent);">★ ${c.points} Punkte</span>
        </div>
      </div>
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;">✕</button>`;
    card.querySelector('button').onclick = () => { teamChallenges.splice(i,1); renderTeamChallengeList(); };
    list.appendChild(card);
  });
}

function checkTeamStartReady() {
  const allAssigned = Object.values(teamAssignments).every(t => t.length > 0);
  document.getElementById('btn-team-start').disabled =
    teamChallenges.length === 0 || Object.keys(teamAssignments).length === 0 || !allAssigned;
}

// ─── Start Game ────────────────────────────────────────────────
function startTeamGame() {
  teamCurrentIdx = 0;
  teamScores = {};
  Object.keys(teamAssignments).forEach(t => teamScores[t] = 0);

  // Save to Firebase
  sessionRef.child('team').set({
    challenges:   teamChallenges,
    assignments:  teamAssignments,
    scores:       teamScores,
    currentIdx:   0,
    timerRunning: false,
    timerSeconds: teamChallenges[0].minutes * 60,
    phase:        'challenge'
  });
  sessionRef.child('phase').set('team_active');
  showTeamLive();
}

// ─── Live Screen ───────────────────────────────────────────────
function showTeamLive() {
  showScreen('screen-mod-team-live');
  const c = teamChallenges[teamCurrentIdx];
  document.getElementById('team-live-cnum').textContent   = teamCurrentIdx + 1;
  document.getElementById('team-live-ctotal').textContent = teamChallenges.length;
  document.getElementById('team-live-title').textContent  = c.text;

  teamTimerSeconds = c.minutes * 60;
  teamTimerRunning = false;
  updateTimerDisplay('team-live-timer', teamTimerSeconds);

  // Update Firebase
  sessionRef.child('team').update({
    currentIdx:   teamCurrentIdx,
    timerRunning: false,
    timerSeconds: teamTimerSeconds,
    phase:        'challenge'
  });

  renderTeamLiveCards();

  // Timer toggle
  document.getElementById('btn-team-timer-toggle').onclick = toggleTeamTimer;

  // Next challenge
  document.getElementById('btn-team-next-challenge').onclick = () => {
    clearInterval(teamTimerInterval);
    teamTimerRunning = false;
    if (teamCurrentIdx < teamChallenges.length - 1) {
      teamCurrentIdx++;
      showTeamLive();
    } else {
      endTeamGame();
    }
  };
  document.getElementById('btn-team-next-challenge').textContent =
    teamCurrentIdx < teamChallenges.length - 1 ? 'Nächste Challenge →' : 'Spiel beenden 🏆';

  document.getElementById('btn-team-end-game').onclick = endTeamGame;
}

function renderTeamLiveCards() {
  const container = document.getElementById('team-live-teams');
  container.innerHTML = '';
  const c = teamChallenges[teamCurrentIdx];

  Object.entries(teamAssignments).forEach(([tname, members]) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;';
    card.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:2px;">${tname}</div>
        <div style="color:var(--muted);font-size:12px;">${members.map(p=>p.name).join(', ')}</div>
      </div>
      <div style="font-weight:700;color:var(--accent);font-size:18px;min-width:60px;text-align:right;">${teamScores[tname] || 0} Pkt</div>
      <button class="btn btn-ghost" style="font-size:12px;padding:6px 10px;" data-action="minus">−</button>
      <button class="btn btn-success" style="font-size:12px;padding:6px 12px;" data-action="plus">+${c.points} ★</button>
    `;
    card.querySelector('[data-action="plus"]').onclick = () => {
      teamScores[tname] = (teamScores[tname] || 0) + c.points;
      sessionRef.child('team/scores').set(teamScores);
      renderTeamLiveCards();
      toast(`${tname}: +${c.points} Punkte!`, 'success');
    };
    card.querySelector('[data-action="minus"]').onclick = () => {
      teamScores[tname] = Math.max(0, (teamScores[tname] || 0) - c.points);
      sessionRef.child('team/scores').set(teamScores);
      renderTeamLiveCards();
      toast(`${tname}: −${c.points} Punkte`, 'info');
    };
    container.appendChild(card);
  });
}

// ─── Timer ─────────────────────────────────────────────────────
function toggleTeamTimer() {
  if (teamTimerRunning) {
    clearInterval(teamTimerInterval);
    teamTimerRunning = false;
    document.getElementById('btn-team-timer-toggle').textContent = '▶ Timer fortsetzen';
    sessionRef.child('team/timerRunning').set(false);
  } else {
    teamTimerRunning = true;
    document.getElementById('btn-team-timer-toggle').textContent = '⏸ Timer pausieren';
    sessionRef.child('team/timerRunning').set(true);
    sessionRef.child('team/timerSeconds').set(teamTimerSeconds);
    teamTimerInterval = setInterval(() => {
      teamTimerSeconds--;
      updateTimerDisplay('team-live-timer', teamTimerSeconds);
      if (teamTimerSeconds <= 0) {
        clearInterval(teamTimerInterval);
        teamTimerRunning = false;
        document.getElementById('btn-team-timer-toggle').textContent = '▶ Timer starten';
        sessionRef.child('team/timerRunning').set(false);
        toast('⏰ Zeit ist um!', 'info');
      }
      // Sync every 5s to Firebase so participant screens stay in sync
      if (teamTimerSeconds % 5 === 0) sessionRef.child('team/timerSeconds').set(teamTimerSeconds);
    }, 1000);
  }
}

function updateTimerDisplay(elId, seconds) {
  const el = document.getElementById(elId);
  if (!el) return;
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  el.style.color = seconds <= 30 ? 'var(--accent3)' : seconds <= 60 ? 'var(--accent)' : 'var(--text)';
}

// ─── End Game ──────────────────────────────────────────────────
function endTeamGame() {
  clearInterval(teamTimerInterval);
  sessionRef.child('team/phase').set('finished');
  sessionRef.child('phase').set('team_done');
  showTeamFinalScores();
}

function showTeamFinalScores() {
  showScreen('screen-mod-team-results');
  const sorted = Object.entries(teamScores).sort((a,b) => b[1] - a[1]);
  const container = document.getElementById('team-final-scores');
  container.innerHTML = '';
  sorted.forEach(([name, pts], i) => {
    const card = document.createElement('div');
    card.style.cssText = `display:flex;align-items:center;gap:14px;padding:14px 18px;
      border-radius:var(--r);margin-bottom:10px;
      background:${i===0?'rgba(232,197,71,.1)':'var(--surface)'};
      border:1px solid ${i===0?'rgba(232,197,71,.4)':'var(--border)'};
      animation:fadeUp .3s ease ${i*.08}s both;`;
    card.innerHTML = `
      <div style="width:32px;height:32px;border-radius:50%;background:${i===0?'var(--accent)':'var(--surface2)'};
        display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;
        color:${i===0?'#0f0e17':'var(--muted)'};">${i+1}</div>
      <div style="flex:1;font-weight:${i===0?600:400};">${name} ${i===0?'👑':''}</div>
      <div style="font-weight:700;font-size:20px;color:${i===0?'var(--accent)':'var(--text)'};">${pts} Pkt</div>`;
    container.appendChild(card);
  });
  document.getElementById('btn-team-new-game').onclick = () => showTeamEditor();
}

// ─── PARTICIPANT: Team Phase Watcher ──────────────────────────
function watchParticipantTeam() {
  sessionRef.child('team').on('value', snap => {
    const team = snap.val();
    if (!team) return;

    // Find my team
    const myTeamEntry = Object.entries(team.assignments || {})
      .find(([, members]) => members.some(p => p.id === myId));
    const myTeamName    = myTeamEntry ? myTeamEntry[0] : '?';
    const myTeamMembers = myTeamEntry ? myTeamEntry[1] : [];

    if (team.phase === 'finished') {
      showParticipantTeamResults(team.scores || {});
      return;
    }

    if (team.phase === 'waiting') {
      showParticipantTeamWait(myTeamName, myTeamMembers);
      return;
    }

    const c = (team.challenges || [])[team.currentIdx || 0];
    if (!c) return;

    // Show challenge screen
    showScreen('screen-participant-team-challenge');
    document.getElementById('p-challenge-badge').textContent  = `Challenge ${(team.currentIdx||0)+1} von ${team.challenges.length}`;
    document.getElementById('p-challenge-text').textContent   = c.text;
    document.getElementById('p-challenge-team').textContent   = myTeamName;
    document.getElementById('p-challenge-members').textContent = myTeamMembers.map(p=>p.name).join(', ');

    // Timer sync
    updateTimerDisplay('p-challenge-timer', team.timerSeconds || c.minutes * 60);

    // If timer is running, animate it locally
    if (team.timerRunning) {
      let localSeconds = team.timerSeconds || 0;
      clearInterval(window._pTimerInterval);
      window._pTimerInterval = setInterval(() => {
        localSeconds--;
        updateTimerDisplay('p-challenge-timer', localSeconds);
        if (localSeconds <= 0) clearInterval(window._pTimerInterval);
      }, 1000);
    } else {
      clearInterval(window._pTimerInterval);
    }
  });
}

function showParticipantTeamWait(teamName, members) {
  showScreen('screen-participant-team-wait');
  document.getElementById('p-team-name').textContent    = teamName;
  document.getElementById('p-team-members').textContent = members.map(p=>p.name).join(', ');
}

function showParticipantTeamResults(scores) {
  showScreen('screen-participant-team-results');
  const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  const container = document.getElementById('p-team-final-scores');
  container.innerHTML = '';
  sorted.forEach(([name, pts], i) => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:12px;padding:10px 14px;
      border-radius:var(--r-sm);margin-bottom:8px;
      background:${i===0?'rgba(232,197,71,.1)':'var(--surface2)'};
      animation:fadeUp .3s ease ${i*.07}s both;`;
    row.innerHTML = `
      <div style="width:24px;text-align:center;font-weight:700;color:var(--muted);">${i+1}</div>
      <div style="flex:1;font-weight:${i===0?600:400};">${name} ${i===0?'👑':''}</div>
      <div style="font-weight:700;color:${i===0?'var(--accent)':'var(--text)'};">${pts} Pkt</div>`;
    container.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════════
// ICEBREAKER: PERSÖNLICHKEITSKARTEN
// ══════════════════════════════════════════════════════════════

const DEFAULT_CARDS = [
  'Was war dein mutigster Moment im letzten Jahr?',
  'Welche Fähigkeit würdest du gerne über Nacht erlernen?',
  'Was würdest du tun, wenn du einen Tag lang unsichtbar wärst?',
  'Was war das beste Feedback, das du je bekommen hast?',
  'Wer hat dich beruflich am meisten geprägt und warum?',
  'Was ist deine unerwartete Superkraft im Team?',
  'Welches Buch oder welcher Film hat deine Sichtweise verändert?',
  'Was tust du wenn du dich gestresst fühlst?',
  'Was war dein größter Fehler aus dem du gelernt hast?',
  'Ich bin eher Morgen- oder Abendmensch – und wie merkt man das?',
  'Was motiviert dich wirklich bei der Arbeit?',
  'Was würdest du deinem jüngeren Ich raten?',
];

let personalityCards = [];

function showCardsEditor() {
  personalityCards = [...DEFAULT_CARDS];
  showScreen('screen-mod-cards-editor');
  renderCardsList();

  document.getElementById('btn-load-default-cards').onclick = () => {
    personalityCards = [...DEFAULT_CARDS];
    renderCardsList();
    toast('Beispielkarten geladen ✓', 'success');
  };

  document.getElementById('btn-add-card').onclick = () => {
    const text = document.getElementById('card-text-input').value.trim();
    if (!text) { toast('Bitte Text eingeben', 'error'); return; }
    personalityCards.push(text);
    document.getElementById('card-text-input').value = '';
    renderCardsList();
    toast('Karte hinzugefügt ✓', 'success');
  };

  document.getElementById('btn-cards-start').onclick = startCardsGame;
}

function renderCardsList() {
  const list = document.getElementById('cards-list');
  list.innerHTML = '';
  document.getElementById('btn-cards-start').disabled = personalityCards.length === 0;

  personalityCards.forEach((text, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;';
    card.innerHTML = `
      <div style="flex:1;font-size:13px;">${i+1}. ${text}</div>
      <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px;flex-shrink:0;">✕</button>`;
    card.querySelector('button').onclick = () => {
      personalityCards.splice(i, 1); renderCardsList();
    };
    list.appendChild(card);
  });
}

async function startCardsGame() {
  const snap  = await sessionRef.child('participants').once('value');
  const parts = Object.values(snap.val() || {});

  // Shuffle cards and assign one per participant
  const shuffled = [...personalityCards].sort(() => Math.random() - .5);
  const assignments = {};
  parts.forEach((p, i) => {
    assignments[p.id] = shuffled[i % shuffled.length];
  });

  sessionRef.child('cards').set({ assignments, cards: personalityCards });
  sessionRef.child('phase').set('cards_active');
  showCardsLive(parts, assignments);
}

function showCardsLive(parts, assignments) {
  showScreen('screen-mod-cards-live');

  // Show overview of who got what
  const overview = document.getElementById('mod-cards-overview');
  overview.innerHTML = '';
  parts.forEach(p => {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:12px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;';
    row.innerHTML = `
      <div style="font-weight:600;min-width:100px;">${p.name}</div>
      <div style="color:var(--muted);font-size:13px;font-style:italic;">"${assignments[p.id]}"</div>`;
    overview.appendChild(row);
  });

  document.getElementById('btn-cards-end').onclick = () => {
    sessionRef.child('phase').set('welcome');
    goToWelcome();
    toast('Icebreaker beendet', 'info');
  };
}

// ── Display: cards ──────────────────────────────────────────────
function showDisplayTwoTruthsInput(s) {
  const count = Object.keys(s.ttStatements || {}).length;
  const total = Object.keys(s.participants || {}).length;
  setDC(`<div class="display-centered">
    <div class="display-big-emoji">🎭</div>
    <div class="display-big-title">2 Wahrheiten, 1 Lüge</div>
    <div class="display-big-sub">Schreib 2 wahre und 1 falsche Aussage über dich</div>
    <div class="display-progress-pill">${count} von ${total} eingegangen</div>
  </div>`);
}

function showDisplayCards(s) {
  setDC(`<div class="display-centered">
    <div class="display-big-emoji">🃏</div>
    <div class="display-big-title">Persönlichkeitskarten</div>
    <div class="display-big-sub">Schaut auf euer Handy und lest eure Karte vor.</div>
  </div>`);
}

// ── Participant: cards ──────────────────────────────────────────
function showParticipantCard(s) {
  const cards = s.cards || {};
  const myCard = (cards.assignments || {})[myId];
  if (!myCard) return;
  document.getElementById('p-card-text').textContent = myCard;
  showScreen('screen-participant-card');
}


// ══════════════════════════════════════════════════════════════
// ICEBREAKER: 2 WAHRHEITEN, 1 LÜGE
// ══════════════════════════════════════════════════════════════

let ttPersonList    = [];   // [{id, name, statements:[s1,s2,s3], lieIndex}]
let ttCurrentPerson = 0;    // which person we're voting on
let ttVoteListener  = null;

function startTwoTruths() {
  sessionRef.update({ ttStatements: null, ttVotes: null });
  sessionRef.child('phase').set('twotruths_input');
  showScreen('screen-mod-twotruths-waiting');
  if (typeof showDemoHelper === 'function') showDemoHelper('twotruths_input');
  watchTwoTruthsInput();
}

function watchTwoTruthsInput() {
  sessionRef.child('ttStatements').on('value', snap => {
    const statements = snap.val() || {};
    const count = Object.keys(statements).length;
    sessionRef.child('participants').once('value', ps => {
      const total = Object.keys(ps.val() || {}).length;
      document.getElementById('twotruths-input-progress').textContent =
        `${count} von ${total} eingegangen`;
      document.getElementById('btn-twotruths-start-voting').disabled = count < 2;
    });
  });

  document.getElementById('btn-twotruths-start-voting').onclick = async () => {
    const [stSnap, psSnap] = await Promise.all([
      sessionRef.child('ttStatements').once('value'),
      sessionRef.child('participants').once('value')
    ]);
    const statements = stSnap.val() || {};
    const parts      = psSnap.val() || {};
    const nameMap    = {};
    Object.entries(parts).forEach(([id,p]) => nameMap[id] = p.name);

    // Build person list – only those who submitted
    ttPersonList = Object.entries(statements).map(([id, data]) => ({
      id, name: nameMap[id] || '?',
      statements: data.statements,
      lieIndex:   data.lieIndex
    }));
    ttCurrentPerson = 0;

    sessionRef.child('ttVotes').remove();
    sessionRef.child('phase').set('twotruths_vote');
    sessionRef.child('ttCurrentPerson').set(ttCurrentPerson);
    showTwoTruthsVoteScreen();
  };
}

function showTwoTruthsVoteScreen() {
  showScreen('screen-mod-twotruths-vote');
  const person = ttPersonList[ttCurrentPerson];
  document.getElementById('tt-person-num').textContent   = ttCurrentPerson + 1;
  document.getElementById('tt-person-total').textContent = ttPersonList.length;
  document.getElementById('tt-person-name').textContent  = person.name;

  // Show statements (shuffled so position doesn't give away lie)
  const stDisplay = document.getElementById('tt-statements-display');
  stDisplay.innerHTML = '';
  person.statements.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:14px 18px;margin-bottom:8px;font-family:var(--font-d);font-size:18px;font-style:italic;';
    card.innerHTML = `<span style="color:var(--muted);font-size:13px;font-style:normal;margin-right:8px;">${i+1}.</span>"${s}"`;
    stDisplay.appendChild(card);
  });

  // Live vote listener
  if (ttVoteListener) sessionRef.child('ttVotes/' + ttCurrentPerson).off('value', ttVoteListener);
  ttVoteListener = sessionRef.child('ttVotes/' + ttCurrentPerson).on('value', snap => {
    const votes = snap.val() || {};
    const total = Object.keys(votes).length;
    document.getElementById('tt-vote-count').textContent = total;

    // Count per statement index
    const counts = [0, 0, 0];
    Object.values(votes).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
    const maxVal = Math.max(...counts, 1);

    const barsEl = document.getElementById('tt-vote-bars');
    barsEl.innerHTML = '';
    counts.forEach((cnt, i) => {
      const pct    = Math.round((cnt / maxVal) * 100);
      const pctTot = total > 0 ? Math.round((cnt / total) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'live-bar-row';
      row.innerHTML = `
        <div class="live-bar-label">${i+1}</div>
        <div class="live-bar-track"><div class="live-bar-fill" style="width:${pct}%;"></div></div>
        <div class="live-bar-val">${cnt} <span class="muted" style="font-size:12px;">${pctTot}%</span></div>`;
      barsEl.appendChild(row);
    });
  });

  document.getElementById('btn-tt-next-person').onclick = () => showTwoTruthsReveal();
  document.getElementById('btn-tt-next-person').textContent = 'Auflösung →';
}

function showTwoTruthsReveal() {
  if (ttVoteListener) sessionRef.child('ttVotes/' + ttCurrentPerson).off('value', ttVoteListener);
  showScreen('screen-mod-twotruths-reveal');
  const person = ttPersonList[ttCurrentPerson];

  const content = document.getElementById('tt-reveal-content');
  content.innerHTML = '';

  person.statements.forEach((s, i) => {
    const isLie = i === person.lieIndex;
    const card = document.createElement('div');
    card.style.cssText = `padding:16px 20px;border-radius:var(--r);margin-bottom:10px;
      background:${isLie ? 'rgba(249,123,107,.1)' : 'rgba(93,223,176,.1)'};
      border:2px solid ${isLie ? 'var(--accent3)' : 'var(--success)'};
      animation:fadeUp .3s ease ${i*.1}s both;`;
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="font-size:20px;">${isLie ? '❌' : '✓'}</span>
        <span style="font-weight:700;color:${isLie ? 'var(--accent3)' : 'var(--success)'};">
          ${isLie ? 'Die Lüge!' : 'Wahr'}
        </span>
      </div>
      <div style="font-family:var(--font-d);font-size:18px;font-style:italic;">"${s}"</div>`;
    content.appendChild(card);
  });

  const isLast = ttCurrentPerson >= ttPersonList.length - 1;
  document.getElementById('btn-tt-next-reveal').textContent = isLast ? 'Fertig ✓' : 'Nächste Person →';
  document.getElementById('btn-tt-next-reveal').onclick = () => {
    if (isLast) {
      sessionRef.child('phase').set('welcome');
      goToWelcome();
    } else {
      ttCurrentPerson++;
      sessionRef.child('ttCurrentPerson').set(ttCurrentPerson);
      sessionRef.child('phase').set('twotruths_vote');
      showTwoTruthsVoteScreen();
    }
  };
  document.getElementById('btn-tt-end').onclick = () => {
    sessionRef.child('phase').set('welcome');
    goToWelcome();
  };
}

// ── Display: Two Truths ─────────────────────────────────────────
function showDisplayTwoTruthsVote(s) {
  const idx    = s.ttCurrentPerson || 0;
  const parts  = s.participants || {};
  const stmts  = (s.ttStatements || {})[Object.keys(parts)[idx]];
  const votes  = (s.ttVotes || {})[idx] || {};
  const total  = Object.keys(votes).length;

  // Get person name
  sessionRef.child('participants/' + Object.keys(parts)[idx]).once('value', snap => {
    const name = snap.val()?.name || '?';
    const counts = [0,0,0];
    Object.values(votes).forEach(v => { if(counts[v]!==undefined) counts[v]++; });
    const maxVal = Math.max(...counts, 1);
    const bars = counts.map((cnt,i) => {
      const pct = Math.round((cnt/maxVal)*100);
      return `<div class="display-bar-row">
        <div class="display-bar-label">Aussage ${i+1}</div>
        <div class="display-bar-track"><div class="display-bar-fill" style="width:${pct}%;"></div></div>
        <div class="display-bar-val">${cnt}</div>
      </div>`;
    }).join('');

    const stmtCards = stmts ? stmts.statements.map((s,i) =>
      `<div style="font-size:clamp(16px,2vw,22px);margin-bottom:10px;padding:10px 16px;background:var(--surface);border-radius:var(--r-sm);">
        <span style="color:var(--muted);margin-right:8px;">${i+1}.</span>"${s}"
      </div>`).join('') : '';

    setDC(`<div class="display-poll" style="max-width:800px;">
      <div class="display-poll-header">
        <div class="display-label">2 WAHRHEITEN, 1 LÜGE · ${name}</div>
        <div class="display-poll-q" style="font-size:clamp(20px,3vw,36px);">Welche Aussage ist die Lüge?</div>
      </div>
      <div style="margin:16px 0;">${stmtCards}</div>
      <div class="display-poll-bars">${bars}</div>
      <div class="display-progress-pill" style="margin-top:16px;">${total} Stimmen</div>
    </div>`);
  });
}

// ── Participant: two truths submit ──────────────────────────────
function showParticipantTwoTruthsInput() {
  // Reset fields
  ['tt-input-1','tt-input-2','tt-input-3'].forEach(id => document.getElementById(id).value = '');
  document.querySelectorAll('.lie-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('btn-tt-submit').disabled = true;
  let selectedLie = null;

  showScreen('screen-participant-twotruths-input');

  // Lie selector
  document.querySelectorAll('.lie-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.lie-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedLie = parseInt(btn.dataset.lie);
      checkTTReady();
    };
  });

  ['tt-input-1','tt-input-2','tt-input-3'].forEach(id =>
    document.getElementById(id).oninput = checkTTReady);

  function checkTTReady() {
    const s1 = document.getElementById('tt-input-1').value.trim();
    const s2 = document.getElementById('tt-input-2').value.trim();
    const s3 = document.getElementById('tt-input-3').value.trim();
    document.getElementById('btn-tt-submit').disabled = !(s1 && s2 && s3 && selectedLie !== null);
  }

  document.getElementById('btn-tt-submit').onclick = () => {
    const statements = [
      document.getElementById('tt-input-1').value.trim(),
      document.getElementById('tt-input-2').value.trim(),
      document.getElementById('tt-input-3').value.trim()
    ];
    sessionRef.child('ttStatements/' + myId).set({ statements, lieIndex: selectedLie });
    showScreen('screen-participant-twotruths-wait');
  };
}

function showParticipantTwoTruthsVote(s) {
  const idx    = s.ttCurrentPerson || 0;
  const stmts  = (s.ttStatements || {})[Object.keys(s.participants || {})[idx]];
  if (!stmts) return;

  // Don't vote on your own statements
  const personId = Object.keys(s.participants || {})[idx];
  if (personId === myId) {
    showScreen('screen-participant-twotruths-wait');
    return;
  }

  showScreen('screen-participant-twotruths-vote');
  document.getElementById('p-tt-person-name').textContent = (s.participants[personId]?.name || '?') + '\'s Aussagen';
  document.getElementById('p-tt-vote-sent').style.display = 'none';

  const opts = document.getElementById('p-tt-vote-options');
  opts.innerHTML = '';
  opts.style.display = 'block';

  stmts.statements.forEach((stmt, i) => {
    const btn = document.createElement('button');
    btn.className = 'poll-choice-btn';
    btn.innerHTML = `<span style="color:var(--muted);margin-right:8px;">${i+1}.</span>"${stmt}"`;
    btn.onclick = () => {
      sessionRef.child('ttVotes/' + idx + '/' + myId).set(i);
      opts.style.display = 'none';
      document.getElementById('p-tt-vote-sent').style.display = 'block';
    };
    opts.appendChild(btn);
  });
}

// ══════════════════════════════════════════════════════════════
// ICEBREAKER: TEAM-BINGO
// ══════════════════════════════════════════════════════════════

const BINGO_DEFAULTS = [
  'Hat mehr als 2 Haustiere',
  'Kann ein Instrument spielen',
  'War schon mal im Ausland berufstätig',
  'Trinkt keinen Kaffee',
  'Hat einen Marathon gelaufen',
  'Spricht mehr als 2 Sprachen',
  'Hat schon mal auf einer Bühne gestanden',
  'Kocht leidenschaftlich gerne',
  'Hat ein ungewöhnliches Hobby',
  'Ist Frühaufsteher (vor 6 Uhr)',
  'Hat schon mal ein Ehrenamt ausgeübt',
  'Ist mit dem Fahrrad zur Arbeit gefahren',
  'Hat schon mal ein Buch gelesen das sein Leben verändert hat',
  'Kann jonglieren',
  'Hat mehr als 3 Geschwister',
  'War schon mal auf einem anderen Kontinent',
  'Hat schon mal etwas selbst gebaut oder genäht',
  'Meditiert regelmäßig',
  'Hat schon mal eine Sprache gelernt und wieder vergessen',
  'Ist in einer anderen Stadt aufgewachsen als jetzt',
];

let bingoStatements = [];
let bingoSize       = 3;
let bingoListener   = null;

function showBingoEditor() {
  bingoStatements = [...BINGO_DEFAULTS];
  bingoSize = 3;
  showScreen('screen-mod-bingo-editor');
  renderBingoStatementsList();
  updateBingoSizeInfo();

  // Size buttons
  document.querySelectorAll('.bingo-size-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.bingo-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      bingoSize = parseInt(btn.dataset.size);
      updateBingoSizeInfo();
    };
  });

  document.getElementById('btn-load-bingo-defaults').onclick = () => {
    bingoStatements = [...BINGO_DEFAULTS];
    renderBingoStatementsList();
    toast('Beispiele geladen ✓', 'success');
  };

  document.getElementById('btn-add-bingo-statement').onclick = () => {
    const text = document.getElementById('bingo-statement-input').value.trim();
    if (!text) { toast('Bitte Text eingeben', 'error'); return; }
    bingoStatements.push(text);
    document.getElementById('bingo-statement-input').value = '';
    renderBingoStatementsList();
    toast('Aussage hinzugefügt ✓', 'success');
  };

  document.getElementById('btn-bingo-start').onclick = startBingo;
}

function updateBingoSizeInfo() {
  const needed = bingoSize * bingoSize;
  document.getElementById('bingo-min-count').textContent = needed;
  document.getElementById('bingo-current-count').textContent = bingoStatements.length;
  document.getElementById('btn-bingo-start').disabled = bingoStatements.length < needed;
}

function renderBingoStatementsList() {
  const list = document.getElementById('bingo-statements-list');
  list.innerHTML = '';
  updateBingoSizeInfo();

  bingoStatements.forEach((text, i) => {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'padding:8px 14px;margin-bottom:6px;display:flex;align-items:center;gap:10px;';
    row.innerHTML = `
      <div style="flex:1;font-size:13px;">${i+1}. ${text}</div>
      <button class="btn btn-ghost" style="padding:3px 8px;font-size:12px;">✕</button>`;
    row.querySelector('button').onclick = () => {
      bingoStatements.splice(i, 1); renderBingoStatementsList();
    };
    list.appendChild(row);
  });
}

// ─── Start Bingo ───────────────────────────────────────────────
async function startBingo() {
  const snap  = await sessionRef.child('participants').once('value');
  const parts = Object.values(snap.val() || {});
  const needed = bingoSize * bingoSize;

  // Generate unique shuffled grid per participant
  const grids = {};
  parts.forEach(p => {
    const shuffled = [...bingoStatements].sort(() => Math.random() - .5).slice(0, needed);
    grids[p.id] = shuffled;
  });

  await sessionRef.child('bingo').set({
    size:       bingoSize,
    statements: bingoStatements,
    grids,
    checked:    {},   // participantId → [index, index, ...]
    bingos:     {},   // participantId → timestamp
  });

  sessionRef.child('phase').set('bingo_active');
  showBingoLive();
}

// ─── Mod: Live ─────────────────────────────────────────────────
function showBingoLive() {
  showScreen('screen-mod-bingo-live');

  if (bingoListener) sessionRef.child('bingo').off('value', bingoListener);
  bingoListener = sessionRef.child('bingo').on('value', snap => {
    const bingo = snap.val();
    if (!bingo) return;
    renderBingoProgress(bingo);
  });

  document.getElementById('btn-bingo-end').onclick = () => {
    if (bingoListener) sessionRef.child('bingo').off('value', bingoListener);
    sessionRef.child('phase').set('welcome');
    goToWelcome();
    toast('Bingo beendet', 'info');
  };
}

function renderBingoProgress(bingo) {
  const grids   = bingo.grids   || {};
  const checked = bingo.checked || {};
  const bingos  = bingo.bingos  || {};
  const size    = bingo.size    || 3;

  // Bingo count
  const bingoCount = Object.keys(bingos).length;
  document.getElementById('bingo-bingo-count').textContent = bingoCount;

  // Bingo shouts
  const shoutsEl = document.getElementById('bingo-shouts');
  shoutsEl.innerHTML = '';
  Object.entries(bingos).sort((a,b)=>a[1]-b[1]).forEach(([pid, ts], i) => {
    sessionRef.child('participants/' + pid).once('value', pSnap => {
      const name = pSnap.val()?.name || '?';
      const div = document.createElement('div');
      div.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 16px;
        border-radius:var(--r-sm);margin-bottom:6px;
        background:rgba(232,197,71,.1);border:1px solid rgba(232,197,71,.4);
        animation:pop .4s ease;`;
      div.innerHTML = `<span style="font-size:24px;">🎉</span>
        <span style="font-weight:600;">${name}</span>
        <span class="badge badge-yellow">#${i+1}</span>`;
      shoutsEl.appendChild(div);
    });
  });

  // Progress per participant
  const progressEl = document.getElementById('bingo-progress-list');
  progressEl.innerHTML = '';
  Object.entries(grids).forEach(([pid, grid]) => {
    const myChecked = checked[pid] || [];
    const pct = Math.round((myChecked.length / (size * size)) * 100);
    const hasBingo = !!bingos[pid];

    sessionRef.child('participants/' + pid).once('value', pSnap => {
      const name = pSnap.val()?.name || '?';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';
      row.innerHTML = `
        <div style="width:80px;font-size:13px;font-weight:${hasBingo?600:400};
          color:${hasBingo?'var(--accent)':'var(--text)'};">${name}</div>
        <div style="flex:1;height:20px;background:var(--surface2);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${hasBingo?'var(--accent)':'var(--accent2)'};
            border-radius:99px;transition:width .4s;"></div>
        </div>
        <div style="font-size:12px;color:var(--muted);width:36px;">${myChecked.length}/${size*size}</div>
        ${hasBingo ? '<span style="font-size:16px;">🎉</span>' : ''}`;
      progressEl.appendChild(row);
    });
  });
}

// ─── Display: Bingo ────────────────────────────────────────────
function showDisplayBingoCollect(s) {
  const subs  = s.bingoSubmissions || {};
  const count = Object.values(subs).flatMap(s => s.statements||[]).length;
  const parts = Object.keys(s.participants||{}).length;
  setDC(`<div class="display-centered">
    <div class="display-big-emoji">🎯</div>
    <div class="display-big-title">Bingo-Aussagen einreichen</div>
    <div class="display-big-sub">Schreib 1–3 Dinge über dich die andere nicht wissen!</div>
    <div class="display-progress-pill" style="margin-top:20px;">${count} Aussagen von ${Object.keys(subs).length} Personen</div>
  </div>`);
}

function showDisplayBingo(s) {
  const bingo  = s.bingo || {};
  const bingos = bingo.bingos || {};
  const count  = Object.keys(bingos).length;

  setDC(`<div class="display-centered">
    <div style="font-size:clamp(60px,10vw,120px);margin-bottom:16px;">🎯</div>
    <div class="display-big-title">Team-Bingo</div>
    <div class="display-big-sub">Geh durch den Raum – finde Menschen die zu deinen Feldern passen!</div>
    ${count > 0 ? `<div class="display-progress-pill" style="margin-top:20px;background:rgba(232,197,71,.15);color:var(--accent);border-color:var(--accent);">🎉 ${count}× Bingo!</div>` : ''}
  </div>`);
}

// ─── Participant: Bingo ────────────────────────────────────────
let pBingoChecked = [];
let pBingoGrid    = [];
let pBingoSize    = 3;
let pBingoListener = null;

function showParticipantBingo(s) {
  const bingo = s.bingo || {};
  pBingoSize    = bingo.size || 3;
  pBingoGrid    = (bingo.grids || {})[myId] || [];
  pBingoChecked = [...((bingo.checked || {})[myId] || [])];

  renderParticipantBingoGrid();
  showScreen('screen-participant-bingo');

  // Listen for external updates (e.g. if mod resets)
  if (pBingoListener) sessionRef.child('bingo/checked/' + myId).off('value', pBingoListener);
  pBingoListener = sessionRef.child('bingo/checked/' + myId).on('value', snap => {
    pBingoChecked = snap.val() || [];
    renderParticipantBingoGrid();
  });

  document.getElementById('btn-p-bingo').onclick = () => {
    sessionRef.child('bingo/bingos/' + myId).set(Date.now());
    showScreen('screen-participant-bingo-won');
  };
}

function renderParticipantBingoGrid() {
  const grid = document.getElementById('p-bingo-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${pBingoSize}, 1fr)`;

  pBingoGrid.forEach((text, i) => {
    const cell = document.createElement('div');
    const isChecked = pBingoChecked.includes(i);
    cell.className = 'bingo-cell' + (isChecked ? ' checked' : '');
    cell.textContent = text;
    cell.onclick = () => toggleBingoCell(i);
    grid.appendChild(cell);
  });

  // Check for bingo
  const hasBingo = checkBingoWin();
  const bingoBtn = document.getElementById('btn-p-bingo');
  bingoBtn.style.display = hasBingo ? 'flex' : 'none';
  document.getElementById('p-bingo-status').textContent =
    hasBingo ? '🎉 Du hast Bingo!' : 'Geh durch den Raum!';
}

function toggleBingoCell(idx) {
  if (pBingoChecked.includes(idx)) {
    pBingoChecked = pBingoChecked.filter(i => i !== idx);
  } else {
    pBingoChecked = [...pBingoChecked, idx];
  }
  sessionRef.child('bingo/checked/' + myId).set(pBingoChecked);
  renderParticipantBingoGrid();
}

function checkBingoWin() {
  const s = pBingoSize;
  const c = pBingoChecked;

  // Rows
  for (let r = 0; r < s; r++) {
    if ([...Array(s)].every((_, col) => c.includes(r * s + col))) return true;
  }
  // Columns
  for (let col = 0; col < s; col++) {
    if ([...Array(s)].every((_, r) => c.includes(r * s + col))) return true;
  }
  // Diagonal \
  if ([...Array(s)].every((_, i) => c.includes(i * s + i))) return true;
  // Diagonal /
  if ([...Array(s)].every((_, i) => c.includes(i * s + (s - 1 - i)))) return true;

  return false;
}

// ══════════════════════════════════════════════════════════════
// BINGO: EINREICHUNGS-FLOW
// ══════════════════════════════════════════════════════════════

let bingoSelectedStatements = []; // statements chosen by mod for the game
let bingoSubmissionListener = null;

// ─── Override showBingoEditor to add collect option ────────────
// Patch the start button to offer two modes
const _origShowBingoEditor = showBingoEditor;
showBingoEditor = function() {
  _origShowBingoEditor();

  // Replace start button with two options
  const startBtn = document.getElementById('btn-bingo-start');
  if (startBtn) {
    // Wrap in container with two buttons
    const wrapper = startBtn.parentNode;
    const collectBtn = document.createElement('button');
    collectBtn.className = 'btn btn-accent2 btn-full';
    collectBtn.style.cssText = 'margin-bottom:8px;justify-content:center;background:var(--accent2);color:#fff;';
    collectBtn.id = 'btn-bingo-collect';
    collectBtn.innerHTML = '👥 Teilnehmer einladen Aussagen einzureichen';
    wrapper.insertBefore(collectBtn, startBtn);

    // Relabel start button
    startBtn.textContent = '📚 Mit eigenen Aussagen starten →';

    collectBtn.onclick = startBingoCollection;
  }
};

// ─── Phase 1: Collect submissions ──────────────────────────────
async function startBingoCollection() {
  await sessionRef.child('bingoSubmissions').remove();
  sessionRef.child('phase').set('bingo_collect');
  if (typeof showDemoHelper === 'function') showDemoHelper('bingo_collect');
  showBingoCollectScreen();
}

function showBingoCollectScreen() {
  showScreen('screen-mod-bingo-collect');

  if (bingoSubmissionListener) sessionRef.child('bingoSubmissions').off('value', bingoSubmissionListener);
  bingoSubmissionListener = sessionRef.child('bingoSubmissions').on('value', snap => {
    const subs = snap.val() || {};
    // Count total statements
    const allStatements = Object.values(subs).flatMap(s => s.statements || []);
    const count = allStatements.length;
    const participantCount = Object.keys(subs).length;

    document.getElementById('bingo-submission-count').textContent = count;
    document.getElementById('bingo-submission-progress').textContent =
      `${participantCount} Teilnehmer haben ${count} Aussagen eingereicht`;
    document.getElementById('btn-bingo-to-selection').disabled = count < 1;
  });

  document.getElementById('btn-bingo-to-selection').onclick = () => showBingoSelectionScreen();
  document.getElementById('btn-bingo-skip-collect').onclick = () => {
    // Go straight to editor with default statements
    if (bingoSubmissionListener) sessionRef.child('bingoSubmissions').off('value', bingoSubmissionListener);
    sessionRef.child('phase').set('welcome');
    showBingoEditor();
  };
}

// ─── Phase 2: Mod selects statements ───────────────────────────
async function showBingoSelectionScreen() {
  if (bingoSubmissionListener) sessionRef.child('bingoSubmissions').off('value', bingoSubmissionListener);
  showScreen('screen-mod-bingo-select');

  bingoSelectedStatements = [];
  const needed = bingoSize * bingoSize;
  document.getElementById('bingo-select-min').textContent  = needed;
  document.getElementById('bingo-select-size').textContent = `${bingoSize}×${bingoSize}`;

  // Load submissions
  const snap = await sessionRef.child('bingoSubmissions').once('value');
  const subs = snap.val() || {};
  const submitted = []; // [{text, authorName}]

  const psSnap = await sessionRef.child('participants').once('value');
  const parts  = psSnap.val() || {};
  const nameMap = {};
  Object.entries(parts).forEach(([id,p]) => nameMap[id] = p.name);

  Object.entries(subs).forEach(([pid, data]) => {
    (data.statements || []).forEach(text => {
      if (text.trim()) submitted.push({ text: text.trim(), author: nameMap[pid] || '?' });
    });
  });

  // Tab counts
  document.getElementById('tab-submitted-count').textContent = submitted.length;
  document.getElementById('tab-defaults-count').textContent  = bingoStatements.length;

  // Tab switching
  document.querySelectorAll('.bingo-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.bingo-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('bingo-select-submitted').style.display =
        btn.dataset.tab === 'submitted' ? 'block' : 'none';
      document.getElementById('bingo-select-defaults').style.display =
        btn.dataset.tab === 'defaults' ? 'block' : 'none';
    };
  });

  function updateSelectionCount() {
    const cnt = bingoSelectedStatements.length;
    document.getElementById('bingo-selected-count').textContent = `${cnt} ausgewählt`;
    document.getElementById('btn-bingo-confirm-selection').disabled = cnt < needed;
  }

  function renderSelectPanel(containerId, items, isSubmitted) {
    const panel = document.getElementById(containerId);
    panel.innerHTML = '';
    items.forEach((item, i) => {
      const text   = isSubmitted ? item.text   : item;
      const author = isSubmitted ? item.author : null;
      const card = document.createElement('div');
      card.className = 'bingo-select-item';
      card.dataset.text = text;
      card.innerHTML = `
        <div style="flex:1;">
          <div style="font-size:14px;">${text}</div>
          ${author ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">von ${author}</div>` : ''}
        </div>
        <span class="bingo-select-check">✓</span>`;
      card.onclick = () => {
        const idx = bingoSelectedStatements.indexOf(text);
        if (idx > -1) {
          bingoSelectedStatements.splice(idx, 1);
          card.classList.remove('selected');
        } else {
          bingoSelectedStatements.push(text);
          card.classList.add('selected');
        }
        updateSelectionCount();
      };
      panel.appendChild(card);
    });
  }

  renderSelectPanel('bingo-select-submitted', submitted, true);
  renderSelectPanel('bingo-select-defaults', bingoStatements, false);
  updateSelectionCount();

  document.getElementById('btn-bingo-confirm-selection').onclick = async () => {
    bingoStatements = [...bingoSelectedStatements];
    await startBingo();
  };
}

// ─── Participant: submit bingo statements ──────────────────────
function showParticipantBingoSubmit() {
  // Reset fields
  ['bingo-sub-1','bingo-sub-2','bingo-sub-3'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('btn-bingo-submit-statements').disabled = true;

  showScreen('screen-participant-bingo-submit');

  document.getElementById('bingo-sub-1').oninput =
  document.getElementById('bingo-sub-2').oninput =
  document.getElementById('bingo-sub-3').oninput = () => {
    const s1 = document.getElementById('bingo-sub-1').value.trim();
    document.getElementById('btn-bingo-submit-statements').disabled = !s1;
  };

  document.getElementById('btn-bingo-submit-statements').onclick = () => {
    const statements = [
      document.getElementById('bingo-sub-1').value.trim(),
      document.getElementById('bingo-sub-2').value.trim(),
      document.getElementById('bingo-sub-3').value.trim(),
    ].filter(s => s);

    sessionRef.child('bingoSubmissions/' + myId).set({ statements });
    showScreen('screen-participant-bingo-submitted');
  };
}

// ══════════════════════════════════════════════════════════════
// KENNT IHR EURE KOLLEGEN?
// ══════════════════════════════════════════════════════════════

let wkStatements    = []; // [{text, authorId, authorName}]
let wkCurrentIdx    = 0;
let wkScores        = {}; // participantId → correct count
let wkVoteListener  = null;

async function showWhoKnows() {
  // Reuse bingo submissions if available, otherwise collect fresh
  const snap = await sessionRef.child('bingoSubmissions').once('value');
  const subs = snap.val();

  if (subs && Object.keys(subs).length > 1) {
    // Use existing submissions
    await buildWhoKnowsFromSubmissions(subs);
  } else {
    // Collect fresh submissions
    await sessionRef.child('bingoSubmissions').remove();
    sessionRef.child('phase').set('whoknows_collect');
    showWhoKnowsCollect();
  }
}

function showWhoKnowsCollect() {
  // Reuse bingo collect screen with different heading
  showScreen('screen-mod-bingo-collect');
  document.querySelector('#screen-mod-bingo-collect h2') &&
    (document.querySelector('#screen-mod-bingo-collect h2').textContent = '🔍 Kennt ihr eure Kollegen?');

  if (bingoSubmissionListener) sessionRef.child('bingoSubmissions').off('value', bingoSubmissionListener);
  bingoSubmissionListener = sessionRef.child('bingoSubmissions').on('value', snap => {
    const subs = snap.val() || {};
    const count = Object.values(subs).flatMap(s => s.statements||[]).length;
    document.getElementById('bingo-submission-count').textContent = count;
    document.getElementById('bingo-submission-progress').textContent =
      `${Object.keys(subs).length} Teilnehmer · ${count} Aussagen`;
    document.getElementById('btn-bingo-to-selection').disabled = Object.keys(subs).length < 2;
  });

  document.getElementById('btn-bingo-to-selection').textContent = 'Spiel starten →';
  document.getElementById('btn-bingo-to-selection').onclick = async () => {
    if (bingoSubmissionListener) sessionRef.child('bingoSubmissions').off('value', bingoSubmissionListener);
    const snap = await sessionRef.child('bingoSubmissions').once('value');
    await buildWhoKnowsFromSubmissions(snap.val() || {});
  };
  document.getElementById('btn-bingo-skip-collect').style.display = 'none';
}

async function buildWhoKnowsFromSubmissions(subs) {
  const psSnap = await sessionRef.child('participants').once('value');
  const parts  = psSnap.val() || {};
  const nameMap = {};
  Object.entries(parts).forEach(([id,p]) => nameMap[id] = p.name);

  wkStatements = [];
  Object.entries(subs).forEach(([pid, data]) => {
    (data.statements||[]).forEach(text => {
      if (text.trim()) wkStatements.push({
        text: text.trim(), authorId: pid, authorName: nameMap[pid]||'?'
      });
    });
  });
  // Shuffle
  wkStatements.sort(() => Math.random() - .5);

  wkCurrentIdx = 0;
  wkScores = {};
  Object.keys(parts).forEach(id => wkScores[id] = 0);

  await sessionRef.child('whoknows').set({
    statements: wkStatements,
    currentIdx: 0,
    phase: 'vote'
  });
  sessionRef.child('phase').set('whoknows_active');
  showWhoKnowsLive();
}

function showWhoKnowsLive() {
  showScreen('screen-mod-whoknows-live');
  const stmt = wkStatements[wkCurrentIdx];
  document.getElementById('wk-q-num').textContent   = wkCurrentIdx + 1;
  document.getElementById('wk-q-total').textContent = wkStatements.length;
  document.getElementById('wk-statement').textContent = `"${stmt.text}"`;

  sessionRef.child('whoknows').update({ currentIdx: wkCurrentIdx, phase: 'vote' });

  // Live votes
  if (wkVoteListener) sessionRef.child('whoknows/votes/' + wkCurrentIdx).off('value', wkVoteListener);
  wkVoteListener = sessionRef.child('whoknows/votes/' + wkCurrentIdx).on('value', async snap => {
    const votes    = snap.val() || {};
    const voteCount = Object.keys(votes).length;
    document.getElementById('wk-vote-count').textContent = voteCount;

    // Count per candidate
    const psSnap = await sessionRef.child('participants').once('value');
    const parts  = psSnap.val() || {};
    const nameMap = {};
    Object.entries(parts).forEach(([id,p]) => nameMap[id] = p.name);

    const counts = {};
    Object.values(parts).forEach(p => counts[p.id||Object.keys(parts).find(k=>parts[k]===p)] = 0);
    Object.entries(parts).forEach(([id]) => counts[id] = 0);
    Object.values(votes).forEach(v => { if(counts[v]!==undefined) counts[v]++; });

    const maxVal = Math.max(...Object.values(counts), 1);
    const barsEl = document.getElementById('wk-live-bars');
    barsEl.innerHTML = '';
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([pid, cnt]) => {
      const pct = Math.round((cnt/maxVal)*100);
      const row = document.createElement('div');
      row.className = 'live-bar-row';
      row.innerHTML = `
        <div class="live-bar-label" style="width:80px;text-align:right;font-size:12px;">${nameMap[pid]||'?'}</div>
        <div class="live-bar-track"><div class="live-bar-fill" style="width:${pct}%;"></div></div>
        <div class="live-bar-val">${cnt}</div>`;
      barsEl.appendChild(row);
    });
  });

  document.getElementById('btn-wk-reveal').onclick = showWhoKnowsReveal;
  document.getElementById('btn-wk-prev').disabled = wkCurrentIdx === 0;
  document.getElementById('btn-wk-prev').onclick = () => {
    if (wkCurrentIdx > 0) { wkCurrentIdx--; showWhoKnowsLive(); }
  };
  document.getElementById('btn-wk-next').onclick = () => {
    if (wkCurrentIdx < wkStatements.length - 1) { wkCurrentIdx++; showWhoKnowsLive(); }
    else endWhoKnows();
  };
  document.getElementById('btn-wk-next').textContent =
    wkCurrentIdx < wkStatements.length - 1 ? 'Nächste Aussage →' : 'Auswertung 🏆';
  document.getElementById('btn-wk-end').onclick = endWhoKnows;
}

async function showWhoKnowsReveal() {
  if (wkVoteListener) sessionRef.child('whoknows/votes/' + wkCurrentIdx).off('value', wkVoteListener);
  showScreen('screen-mod-whoknows-reveal');

  const stmt   = wkStatements[wkCurrentIdx];
  const vSnap  = await sessionRef.child('whoknows/votes/' + wkCurrentIdx).once('value');
  const psSnap = await sessionRef.child('participants').once('value');
  const votes  = vSnap.val()  || {};
  const parts  = psSnap.val() || {};
  const nameMap = {};
  Object.entries(parts).forEach(([id,p]) => nameMap[id] = p.name);

  // Award points
  Object.entries(votes).forEach(([voterId, guessedId]) => {
    if (guessedId === stmt.authorId) {
      wkScores[voterId] = (wkScores[voterId]||0) + 1;
    }
  });
  sessionRef.child('whoknows/scores').set(wkScores);
  sessionRef.child('whoknows/phase').set('reveal');

  const correctGuessers = Object.entries(votes)
    .filter(([,g]) => g === stmt.authorId)
    .map(([vid]) => nameMap[vid]||'?');
  const wrongGuessers = Object.entries(votes)
    .filter(([,g]) => g !== stmt.authorId)
    .map(([vid, gid]) => `${nameMap[vid]||'?'} → ${nameMap[gid]||'?'}`);

  const content = document.getElementById('wk-reveal-content');
  content.innerHTML = `
    <div class="card card-glow" style="text-align:center;margin-bottom:16px;">
      <div style="font-family:var(--font-d);font-size:22px;font-style:italic;margin-bottom:16px;">"${stmt.text}"</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:4px;">Das war</div>
      <div style="font-family:var(--font-d);font-size:32px;color:var(--accent);">${stmt.authorName}</div>
    </div>
    ${correctGuessers.length ? `<div class="result-guessers correct" style="margin-bottom:8px;">✓ Richtig: ${correctGuessers.join(', ')}</div>` : ''}
    ${wrongGuessers.length   ? `<div class="result-guessers wrong">✗ Falsch: ${wrongGuessers.join(' · ')}</div>` : ''}
  `;

  const isLast = wkCurrentIdx >= wkStatements.length - 1;
  document.getElementById('btn-wk-reveal-next').textContent = isLast ? 'Auswertung 🏆' : 'Nächste Aussage →';
  document.getElementById('btn-wk-reveal-next').onclick = () => {
    if (isLast) endWhoKnows();
    else { wkCurrentIdx++; showWhoKnowsLive(); }
  };
  document.getElementById('btn-wk-reveal-end').onclick = endWhoKnows;
}

function endWhoKnows() {
  sessionRef.child('phase').set('whoknows_done');
  showWhoKnowsFinalScores();
}

function showWhoKnowsFinalScores() {
  showScreen('screen-mod-whoknows-results');
  const sorted = Object.entries(wkScores).sort((a,b)=>b[1]-a[1]);

  // Get names async
  sessionRef.child('participants').once('value', snap => {
    const parts = snap.val() || {};
    const nameMap = {};
    Object.entries(parts).forEach(([id,p]) => nameMap[id] = p.name);

    const container = document.getElementById('wk-final-scores');
    container.innerHTML = '';
    sorted.forEach(([pid, pts], i) => {
      const card = document.createElement('div');
      card.style.cssText = `display:flex;align-items:center;gap:14px;padding:14px 18px;
        border-radius:var(--r);margin-bottom:10px;
        background:${i===0?'rgba(232,197,71,.1)':'var(--surface)'};
        border:1px solid ${i===0?'rgba(232,197,71,.4)':'var(--border)'};
        animation:fadeUp .3s ease ${i*.08}s both;`;
      card.innerHTML = `
        <div style="width:32px;height:32px;border-radius:50%;
          background:${i===0?'var(--accent)':'var(--surface2)'};
          display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:14px;color:${i===0?'#0f0e17':'var(--muted)'};">${i+1}</div>
        <div style="flex:1;font-weight:${i===0?600:400};">${nameMap[pid]||'?'} ${i===0?'👑':''}</div>
        <div style="font-weight:700;font-size:18px;color:${i===0?'var(--accent)':'var(--text)'};">${pts} ✓</div>`;
      container.appendChild(card);
    });
  });
  document.getElementById('btn-wk-new').onclick = () => showWhoKnows();
}

// ── Participant: Who Knows ──────────────────────────────────────
let wkParticipantListener = null;

function watchParticipantWhoKnows() {
  if (wkParticipantListener) sessionRef.child('whoknows').off('value', wkParticipantListener);
  wkParticipantListener = sessionRef.child('whoknows').on('value', async snap => {
    const wk = snap.val();
    if (!wk) return;

    if (wk.phase === 'reveal') {
      // Show result
      const myVote   = ((wk.votes||{})[wk.currentIdx]||{})[myId];
      const stmt     = (wk.statements||[])[wk.currentIdx];
      const correct  = myVote === stmt?.authorId;
      document.getElementById('p-wk-result-emoji').textContent = correct ? '🎯' : '😅';
      document.getElementById('p-wk-result-title').textContent = correct ? 'Richtig!' : 'Nicht ganz…';
      document.getElementById('p-wk-result-text').textContent  =
        `Das war ${stmt?.authorName||'?'}`;
      showScreen('screen-participant-whoknows-result');
      return;
    }

    const idx  = wk.currentIdx || 0;
    const stmt = (wk.statements||[])[idx];
    if (!stmt) return;

    // Don't vote on own statement
    if (stmt.authorId === myId) {
      showScreen('screen-participant-twotruths-wait'); // reuse wait screen
      return;
    }

    // Already voted?
    const myVote = ((wk.votes||{})[idx]||{})[myId];
    if (myVote) {
      showScreen('screen-participant-twotruths-wait');
      return;
    }

    showScreen('screen-participant-whoknows');
    document.getElementById('p-wk-num').textContent       = idx + 1;
    document.getElementById('p-wk-statement').textContent = stmt.text;
    document.getElementById('p-wk-sent').style.display    = 'none';

    const optsEl = document.getElementById('p-wk-options');
    optsEl.innerHTML = '';
    optsEl.style.display = 'block';

    // Load participants as options (exclude self and author)
    const psSnap = await sessionRef.child('participants').once('value');
    const parts  = psSnap.val() || {};
    Object.entries(parts)
      .filter(([id]) => id !== myId)
      .forEach(([id, p]) => {
        const btn = document.createElement('button');
        btn.className = 'poll-choice-btn';
        btn.textContent = p.name;
        btn.onclick = () => {
          sessionRef.child('whoknows/votes/' + idx + '/' + myId).set(id);
          optsEl.style.display = 'none';
          document.getElementById('p-wk-sent').style.display = 'block';
        };
        optsEl.appendChild(btn);
      });
  });
}

// ── Display: Who Knows ─────────────────────────────────────────
function showDisplayWhoKnows(s) {
  const wk   = s.whoknows || {};
  const idx  = wk.currentIdx || 0;
  const stmt = (wk.statements||[])[idx];
  if (!stmt) return;

  const votes  = (wk.votes||{})[idx] || {};
  const total  = Object.keys(votes).length;

  if (wk.phase === 'reveal') {
    setDC(`<div class="display-centered">
      <div class="display-big-emoji">🎯</div>
      <div class="display-big-title" style="font-style:italic;">"${stmt.text}"</div>
      <div class="display-big-sub" style="margin-top:16px;">→ <strong style="color:var(--accent);font-size:clamp(20px,3vw,36px);">${stmt.authorName}</strong></div>
    </div>`);
    return;
  }

  setDC(`<div class="display-poll" style="max-width:800px;">
    <div class="display-poll-header">
      <div class="display-label">AUSSAGE ${idx+1} VON ${(wk.statements||[]).length} · 🔍 KENNT IHR EURE KOLLEGEN?</div>
      <div class="display-poll-q" style="font-style:italic;">"${stmt.text}"</div>
    </div>
    <div class="display-progress-pill" style="margin-top:20px;">${total} Stimmen</div>
  </div>`);
}


// ══════════════════════════════════════════════════════════════
// DEMO-MODUS
// ══════════════════════════════════════════════════════════════

const DEMO_NAMES = ['Anna K.', 'Bernd M.', 'Clara S.', 'David R.', 'Eva L.'];
let demoMode = false;
let demoParticipantRefs = [];

async function startDemoMode() {
  demoMode     = true;
  isModerator  = true;   // set synchronously so screen-home guard works
  sessionCode  = randomCode();
  sessionRef  = db.ref('sessions/' + sessionCode);

  await sessionRef.set({
    code: sessionCode, createdAt: Date.now(), phase: 'lobby',
    welcome: { emoji: '🧪', title: 'Demo-Session', subtitle: 'Test-Modus aktiv' },
    participants: {}, answers: {}, votes: {}
  });

  setTimeout(() => sessionRef.remove(), 2 * 60 * 60 * 1000);

  // Add fake participants
  demoParticipantRefs = [];
  for (const name of DEMO_NAMES) {
    const id  = 'demo_' + name.replace(/\W/g,'') + '_' + Date.now();
    const ref = sessionRef.child('participants/' + id);
    await ref.set({ id, name, joinedAt: Date.now(), demo: true });
    ref.onDisconnect().remove();
    demoParticipantRefs.push({ id, name, ref });
  }

  showModTopbar();
  showModeratorLobby();
  toast('🧪 Demo-Modus · 5 Fake-Teilnehmer verbunden', 'success');
}

// Demo: auto-fill Nobody is Perfect answers
async function demoFillAnswers() {
  const answers = [
    'Ich habe mal einen Weltrekord aufgestellt.',
    'Ich spreche fließend Klingonisch.',
    'Ich war mal auf dem Mond.',
    'Ich habe 3 Katzen namens Kant, Hegel und Nietzsche.',
    'Ich kann rückwärts Fahrrad fahren während ich jongliere.'
  ];
  for (let i = 0; i < demoParticipantRefs.length; i++) {
    const { id } = demoParticipantRefs[i];
    await sessionRef.child('answers/' + id).set({ text: answers[i], authorId: id });
    await new Promise(r => setTimeout(r, 300));
  }
  toast('🧪 Demo: Antworten wurden automatisch ausgefüllt', 'success');
}

// Demo: auto-fill Two Truths statements
async function demoFillTwoTruths() {
  const sets = [
    { s: ['Ich war mal Profi-Schachspieler', 'Ich habe 3 Sprachen gelernt', 'Ich besitze ein Pferd'], lie: 2 },
    { s: ['Ich koche leidenschaftlich', 'Ich habe in Tokyo gelebt', 'Ich bin ein Frühaufsteher'], lie: 0 },
    { s: ['Ich kann jonglieren', 'Ich war nie im Ausland', 'Ich spiele Gitarre'], lie: 1 },
    { s: ['Ich lese 2 Bücher pro Monat', 'Ich laufe Marathons', 'Ich esse kein Gemüse'], lie: 2 },
    { s: ['Ich meditiere täglich', 'Ich habe mal auf einer Bühne gespielt', 'Ich schlafe 10h pro Nacht'], lie: 2 },
  ];
  for (let i = 0; i < demoParticipantRefs.length; i++) {
    const { id } = demoParticipantRefs[i];
    const set = sets[i];
    await sessionRef.child('ttStatements/' + id).set({ statements: set.s, lieIndex: set.lie });
    await new Promise(r => setTimeout(r, 300));
  }
  toast('🧪 Demo: Aussagen automatisch ausgefüllt', 'success');
}

// Demo: auto-fill bingo/whoknows submissions
async function demoFillSubmissions() {
  const submissionSets = [
    ['Ich habe mal in Japan gearbeitet', 'Ich kann Gebärdensprache'],
    ['Ich besitze ein Einhorn-Kostüm', 'Ich bin mit dem Fahrrad durch Europa gefahren'],
    ['Ich habe 5 Geschwister', 'Ich war schon mal auf einem anderen Kontinent'],
    ['Ich meditiere jeden Morgen', 'Ich spreche 4 Sprachen'],
    ['Ich habe mal auf einer Theaterbühne gestanden', 'Ich koche jeden Sonntag für Familie'],
  ];
  for (let i = 0; i < demoParticipantRefs.length; i++) {
    const { id } = demoParticipantRefs[i];
    await sessionRef.child('bingoSubmissions/' + id).set({ statements: submissionSets[i] });
    await new Promise(r => setTimeout(r, 300));
  }
  toast('🧪 Demo: Einreichungen automatisch ausgefüllt', 'success');
}

// Demo: auto-vote (random)
async function demoAutoVote(path, options) {
  for (const { id } of demoParticipantRefs) {
    const randomOption = options[Math.floor(Math.random() * options.length)];
    await sessionRef.child(path + '/' + id).set(randomOption);
    await new Promise(r => setTimeout(r, 200));
  }
  toast('🧪 Demo: Abstimmung simuliert', 'success');
}

// Wire demo button on home screen
if (!isDisplay) {
  const demoBtn = document.getElementById('btn-demo-mode');
  if (demoBtn) demoBtn.addEventListener('click', () => {
    isModerator = true; // guard against screen-home flash
    startDemoMode();
  });
}

// Show demo helper panel when in demo mode
function showDemoHelper(context) {
  if (!demoMode) return;
  const existing = document.getElementById('demo-helper');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'demo-helper';
  panel.style.cssText = `position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
    background:rgba(15,14,23,.95);border:1px solid var(--accent3);border-radius:var(--r);
    padding:12px 16px;z-index:999;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    max-width:90vw;box-shadow:0 4px 24px rgba(249,123,107,.2);`;

  panel.innerHTML = `<span style="font-size:12px;color:var(--accent3);font-weight:600;">🧪 DEMO</span>`;

  const actions = {
    'input':           { label: 'Antworten füllen', fn: demoFillAnswers },
    'twotruths_input': { label: 'Aussagen füllen',  fn: demoFillTwoTruths },
    'bingo_collect':   { label: 'Einreichungen füllen', fn: demoFillSubmissions },
    'whoknows_collect':{ label: 'Einreichungen füllen', fn: demoFillSubmissions },
  };

  if (actions[context]) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.style.cssText = 'font-size:12px;padding:5px 12px;';
    btn.textContent = actions[context].label;
    btn.onclick = actions[context].fn;
    panel.appendChild(btn);
  }

  document.body.appendChild(panel);
}
