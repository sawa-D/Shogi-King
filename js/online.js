'use strict';
/* =====================================================================
   オンライン対戦（Cloudflare の対戦サーバーとつなぐ部分）
   - ルームを作る／ルームコードで参加する
   - 操作はサーバーへ送り、サーバーから届いた盤面（自分に見せてよい情報だけ）を表示する
   - 通信が切れたら自動で再接続する（60秒以内に戻れば続きから）
   ===================================================================== */
const ONLINE = {
  // 対戦サーバーのURL（デプロイ後に表示される https://〜.workers.dev を入れる）
  SERVER: 'https://shogi-king-server.sawa-d.workers.dev',
};
// 動作確認用：ページのURLに ?server=http://127.0.0.1:8787 を付けると、そのサーバーを使う
try { const q = new URLSearchParams(location.search).get('server'); if(q) ONLINE.SERVER = q.replace(/\/$/, ''); } catch(e){}

const ONLINE_PID_KEY = 'shogiking.pid', ONLINE_NAME_KEY = 'shogiking.name';
const net = { ws:null, code:null, leaving:false, retry:0, retryTimer:null, room:null, offset:0, connecting:false };

// 端末ごとのID（名前とは別。再接続のときに同じ人だとわかるように使う）
function onlinePid(){
  try {
    let id = localStorage.getItem(ONLINE_PID_KEY);
    if(!id){
      id = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join(''));
      localStorage.setItem(ONLINE_PID_KEY, id);
    }
    return id;
  } catch(e){ return (window.__pid = window.__pid || 'tmp-' + Math.random().toString(36).slice(2)); }
}
function onlineName(){ try { return localStorage.getItem(ONLINE_NAME_KEY) || ''; } catch(e){ return ''; } }
function saveOnlineName(n){ try { localStorage.setItem(ONLINE_NAME_KEY, n); } catch(e){} }
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const isOnline = () => !!(match && match.mode === 'online');
const netReady = () => !!(net.ws && net.ws.readyState === 1);
const serverNow = () => Date.now() + net.offset;

/* ---------- 画面：名前とルームコード ---------- */
function showOnlineMenu(msg){
  const configured = !!ONLINE.SERVER;
  showOverlay(`<h2>オンライン対戦</h2>
    ${configured ? '' : '<p class="warn-text">対戦サーバーがまだ設定されていません（js/online.js の SERVER）</p>'}
    <div class="form">
      <label for="olName">名前</label>
      <input id="olName" maxlength="12" placeholder="12文字まで" value="${escapeHtml(onlineName())}" autocomplete="nickname">
    </div>
    <div class="btns"><button class="primary" id="olCreate" ${configured ? '' : 'disabled'}>ルームを作る</button></div>
    <div class="or">または</div>
    <div class="form">
      <label for="olCode">ルームコード（6桁）</label>
      <input id="olCode" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="off">
    </div>
    <div class="btns"><button class="primary" id="olJoin" ${configured ? '' : 'disabled'}>参加する</button>
      <button id="olBack">戻る</button></div>
    <p id="olMsg" class="warn-text">${msg ? escapeHtml(msg) : ''}</p>`);
  const nameOk = () => {
    const n = $('#olName').value.trim();
    if(!n){ $('#olMsg').textContent = '名前を入れてください'; $('#olName').focus(); return null; }
    saveOnlineName(n); return n;
  };
  $('#olCreate').onclick = async () => {
    if(!nameOk()) return;
    $('#olCreate').disabled = true; $('#olMsg').textContent = 'ルームを作っています…';
    try {
      const res = await fetch(ONLINE.SERVER + '/rooms', { method:'POST' });
      const data = await res.json();
      if(!res.ok || !data.code) throw new Error(data.error || 'ルームを作れませんでした');
      connectRoom(data.code);
      showWaiting(data.code);
    } catch(e){
      $('#olCreate').disabled = false;
      $('#olMsg').textContent = 'サーバーにつながりませんでした。通信状態を確かめてください';
    }
  };
  $('#olJoin').onclick = () => {
    if(!nameOk()) return;
    const code = $('#olCode').value.replace(/\D/g, '');
    if(code.length !== 6){ $('#olMsg').textContent = 'ルームコードは6桁の数字です'; return; }
    connectRoom(code);
    showOverlay(`<h2>接続中…</h2><p>ルーム ${code} に参加しています</p>
      <div class="btns"><button id="olCancel">やめる</button></div>`);
    $('#olCancel').onclick = () => { leaveOnline(); showOnlineMenu(); };
  };
  $('#olBack').onclick = showTitle;
}

function showWaiting(code){
  showOverlay(`<h2>相手を待っています</h2>
    <p>このルームコードを相手に伝えてください</p>
    <div class="room-code">${code}</div>
    <div class="btns"><button class="primary" id="wcCopy">コードをコピー</button><button id="wcCancel">やめる</button></div>
    <p class="hint">LINEなどでコードを送るために、ほかのアプリに切り替えても大丈夫です</p>`);
  $('#wcCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(code); showToast('コピーしました'); }
    catch(e){ showToast('コピーできませんでした。コードを手で入力してもらってください', true); }
  };
  $('#wcCancel').onclick = () => { leaveOnline(); showOnlineMenu(); };
}

/* ---------- 通信 ---------- */
function connectRoom(code){
  clearTimeout(net.retryTimer);
  if(net.ws){ const old = net.ws; net.ws = null; try { old.close(); } catch(e){} }
  net.code = code; net.leaving = false; net.connecting = true;
  let ws;
  try { ws = new WebSocket(ONLINE.SERVER.replace(/^http/, 'ws') + `/rooms/${code}/ws`); }
  catch(e){ net.connecting = false; scheduleReconnect(); return; }
  net.ws = ws;
  ws.onopen = () => {
    if(net.ws !== ws) return;
    net.connecting = false; net.retry = 0;
    ws.send(JSON.stringify({ t:'hello', pid: onlinePid(), name: onlineName() || '名無し', deck: deckFor('online', 0) }));
  };
  ws.onmessage = e => { if(net.ws === ws) onServerMessage(JSON.parse(e.data)); };
  ws.onclose = e => {
    if(net.ws !== ws) return;
    net.ws = null; net.connecting = false;
    if(net.leaving || [4001, 4003, 4004, 4005].includes(e.code)) return;   // 自分で抜けた・満員・期限切れ など
    scheduleReconnect();
  };
}
function scheduleReconnect(){
  if(!net.code || net.leaving) return;
  clearTimeout(net.retryTimer);
  const delay = Math.min(1000 * 2 ** net.retry, 5000); net.retry++;
  net.retryTimer = setTimeout(() => { if(!net.ws && net.code && !net.leaving) connectRoom(net.code); }, delay);
  if(st) render();
}
// アプリに戻ってきたら、すぐにつなぎ直す
document.addEventListener('visibilitychange', () => {
  if(!document.hidden && net.code && !net.leaving && !net.ws){ net.retry = 0; connectRoom(net.code); }
});
// 自分から抜ける（対局中なら降参になる）
function leaveOnline(){
  net.leaving = true;
  clearTimeout(net.retryTimer);
  if(net.ws){ try { net.ws.send(JSON.stringify({ t:'leave' })); } catch(e){} const ws = net.ws; net.ws = null; setTimeout(() => { try { ws.close(); } catch(e){} }, 100); }
  net.code = null; net.room = null;
}
function sendAction(action){
  if(!netReady()){ setPrompt('接続が切れています。再接続を待ってください', true); render(); return false; }
  const { p, ...rest } = action;
  net.ws.send(JSON.stringify({ t:'action', action: rest }));
  ui.pending = true; render();
  return true;
}

/* ---------- サーバーからのメッセージ ---------- */
function onServerMessage(m){
  if(m.t === 'error'){
    ui.pending = false;
    if(['notfound', 'full', 'deck'].includes(m.code)){ leaveOnline(); showOnlineMenu(m.message); return; }
    if(st && isOnline()){ setPrompt(m.message, true); render(); }
    else showToast(m.message, true);
    return;
  }
  if(m.t === 'closed'){ leaveOnline(); if(!st || isOnline()) toTitle(); showToast(m.message || 'ルームが閉じられました', true); return; }
  if(m.t !== 'state') return;

  net.room = m.room; net.offset = m.now - Date.now();
  if(!m.view){                                    // まだ相手が来ていない
    if(!isOnline()) showWaiting(m.room.code);
    return;
  }
  const started = m.events.some(e => e.type === 'start');
  const firstView = !isOnline();
  if(firstView || started){
    match = { mode:'online', you: m.room.you, names: [], log: [] };
    if(started) log('対局開始！');
    else log('対局に再接続しました');
    hideOverlay(); clearSel();
    if(!m.view.over) startBgm();
  }
  match.you = m.room.you;
  match.names = m.room.players.map(p => p.name);
  st = m.view;
  ui.pending = false;
  handleEvents(m.events);
  if(m.events.some(e => e.type === 'turnStart')) clearSel();
  startClockTick();
  render();
  if(st.over && (m.events.some(e => e.type === 'gameOver') || firstView)) setTimeout(() => { if(isOnline() && st.over) showResult(); }, 400);
  else if(st.over && $('#rmWait')) showResult();  // 再戦待ちの表示を更新
}

/* ---------- 相手の接続状態 ---------- */
// 相手が切断中なら、あと何秒で相手の負けか
function opponentDisconnectText(){
  if(!isOnline() || !net.room || !st || st.over) return '';
  const opp = net.room.players[1 - match.you];
  if(!opp || opp.connected || !opp.discAt) return '';
  return `相手の接続が切れました。再接続を待っています（あと${Math.max(0, Math.ceil((opp.discAt + net.room.disconnectLimitMs - serverNow())/1000))}秒で相手の負け）`;
}
