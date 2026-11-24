'use strict';
/* =====================================================================
   対局の進行（この端末の中で遊ぶ対局：CPU戦・2人対戦）
   - 操作をエンジン（Engine.apply）に渡し、返ってきたイベントでログ・効果音・画面を更新する
   - オンライン対戦では、Engine.apply の代わりにサーバーへ操作を送る形になる
   ===================================================================== */
const { ROWS, COLS } = Engine;
document.documentElement.style.setProperty('--cols', COLS);
document.documentElement.style.setProperty('--rows', ROWS);
const $ = s => document.querySelector(s);

let st = null;      // 対局の状態（エンジンの state）
let match = null;   // この端末側の情報 { mode:'cpu'|'2p', log:[] }
let ui = { sel:null, targets:[], prompt:'', warn:false, action:null, handoff:false, cpuBusy:false, pending:false };
let sleep = ms => new Promise(res => setTimeout(res, ms));

const pname = p => {
  if(match.mode === 'cpu') return p===0 ? 'あなた' : 'CPU';
  if(match.mode === 'online') return p===match.you ? 'あなた' : ((match.names && match.names[p]) || '相手');
  return p===0 ? 'プレイヤー1' : 'プレイヤー2';
};
// この端末で操作するプレイヤー（2人対戦では手番の人）
const mySeat = () => match.mode === 'online' ? match.you : match.mode === '2p' ? st.cur : 0;
function log(msg){ match.log.unshift(msg); match.log = match.log.slice(0,4); }

// 各プレイヤーが使うデッキ：CPUは標準デッキ、人はMyデッキ
function deckFor(mode, p){
  if(mode==='cpu' && p===1) return CONFIG.DECK;
  const my = loadMyDeck();
  return my && !Engine.deckErrors(my.cards).length ? my.cards : CONFIG.DECK;
}

function newGame(mode, first){
  const { state, events } = Engine.createGame({
    decks: [deckFor(mode,0), deckFor(mode,1)], first, seed: Math.floor(Math.random() * 2**32), now: Date.now(),
  });
  st = state; match = { mode, log: [] };
  log('対局開始！');
  hideOverlay();
  startBgm();
  handleEvents(events);
  afterTurnStart();
  startClockTick();
}

/* ---------- イベント → ログ・効果音 ---------- */
const N = k => CARDS[k].name;
function describe(ev){
  const who = ev.p !== undefined ? pname(ev.p) : '';
  switch(ev.type){
    case 'turnStart': return `${who}のターン（マナ${ev.mana}）`;
    case 'deckEmpty': return `${who}の山札が切れているため引けません`;
    case 'pass':      return `${who}：動かせる駒がないためパス`;
    case 'summon':    return ev.ambush ? `${who}：${N(ev.card)}を伏兵として送り込んだ！` : `${who}：${N(ev.card)}を援軍に出した`;
    case 'move':
      if(!ev.captured) return `${who}：${N(ev.piece)}が移動した`;
      if(ev.captured === 'king') return `${who}が王を討ち取った！`;
      return `${who}：${N(ev.piece)}が${N(ev.captured)}を倒した（手札へ）`;
    case 'launch':
      if(!ev.captured) return `${who}：砲兵が歩兵を撃ち出した`;
      if(ev.captured === 'king') return `${who}：砲撃で王を討ち取った！`;
      return `${who}：砲撃！歩兵が${N(ev.captured)}を倒して散った（手札へ）`;
    case 'bound': return `${N(ev.piece)}は縛られた！次のターン動けない`;
    case 'command':
      switch(ev.card){
        case 'shingun': return `${who}：【進軍】駒をもう1回動かせる`;
        case 'fukuhei': return `${who}：【伏兵】次の援軍を陣の外に出せる`;
        case 'hokyu':   return `${who}：【補給】カードを${ev.drawn}枚引いた`;
        case 'tettai':  return `${who}：【撤退】${N(ev.piece)}を手札に戻した`;
        case 'rakurai': return `${who}：【落雷】${N(ev.piece)}を破壊した`;
        case 'ryuka':   return `${who}：【龍化】飛車が龍になった！`;
        case 'toppu':   return `${who}：【突風】${ev.pieces.map(N).join('と')}を左へ動かした`;
      }
      return `${who}：【${N(ev.card)}】`;
    case 'gameOver':
      if(ev.reason === 'resign')  return `${pname(1-ev.winner)}が降参した`;
      if(ev.reason === 'timeout') return `${pname(1-ev.winner)}の持ち時間が切れた`;
      return null;
  }
  return null;
}
function handleEvents(events){
  for(const ev of events){
    const m = describe(ev); if(m) log(m);
    if(ev.type === 'move' || ev.type === 'launch') playSe('move');
    if(ev.type === 'gameOver') stopBgm();
  }
}

/* ---------- 操作 ---------- */
// 今の手番のプレイヤーとして操作する。失敗したら理由を表示して false
function dispatch(action){
  if(!st || st.over) return false;
  if(match.mode === 'online') return sendAction(action);     // オンラインはサーバーが審判
  const res = Engine.apply(st, { ...action, p: st.cur }, Date.now());
  if(!res.ok){ setPrompt(res.error, true); render(); return false; }
  handleEvents(res.events);
  if(res.events.some(e => e.type === 'turnStart')) afterTurnStart();
  return true;
}
// 動かせる駒がないときだけ使えるパス
function passTurn(){ dispatch({ type:'endTurn' }); }

function afterTurnStart(){
  clearSel();
  if(match.mode === 'cpu' && st.cur === 1){
    ui.cpuBusy = true; render();
    const g = st;
    setTimeout(() => { if(st === g) runCpu().catch(e => { if(e !== 'abort') throw e; }); }, 650);
  }
  else if(match.mode === '2p'){ render(); showHandoff(); }
  else { render(); if(!st.over) showTurnBanner(); }
}

// CPUのターン：次の操作を1つずつ聞いて、少し間をあけながら実行する（駒を動かすと自動でターンが終わる）
async function runCpu(){
  const g = st, seat = st.cur;
  while(st === g && !st.over && st.cur === seat){
    const a = Cpu.nextAction(st, seat);
    const res = Engine.apply(st, a, Date.now());
    if(!res.ok){ Engine.forfeit(st, seat, 'resign'); break; }   // 念のため（通常は起きない）
    handleEvents(res.events);
    render();
    if(st.cur === seat) await sleep(550);
    if(st !== g) throw 'abort';
  }
  ui.cpuBusy = false;
  if(st.over){ render(); showResult(); } else afterTurnStart();
}

/* ---------- 持ち時間（この端末で遊ぶ対局） ---------- */
// 画面の時計を0.25秒ごとに更新し、時間切れを判定する。オンラインではサーバーが判定する
let clockTimer = null;
const clockNow = () => (match && match.mode === 'online') ? serverNow() : Date.now();
function startClockTick(){
  if(clockTimer) return;
  clockTimer = setInterval(() => {
    if(!st || !match){ clearInterval(clockTimer); clockTimer = null; return; }
    updateClocks();
    if(match.mode !== 'online' && !st.over && !ui.handoff && Engine.isTimeUp(st, Date.now())){
      const g = st;
      handleEvents(Engine.forfeit(st, st.cur, 'timeout').events);
      ui.cpuBusy = false; clearSel(); render();
      setTimeout(() => { if(st === g) showResult(); }, 400);
    }
  }, 250);
}
const fmtTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
// バーに出す時計：手番の人は「このターンの残り秒数 / 持ち時間」、相手は持ち時間だけ
function clockHtml(p){
  if(!st || !st.clock) return '';
  const info = Engine.clockInfo(st, clockNow()); if(!info) return '';
  const bank = `<span class="bank${info.bank[p] < 60000 ? ' low' : ''}">${fmtTime(info.bank[p])}</span>`;
  if(st.over || st.cur !== p || info.paused) return bank;
  if(info.graceLeft > 0) return `<span class="grace">${Math.ceil(info.graceLeft/1000)}秒</span>${bank}`;
  return `<span class="grace out">0秒</span>${bank.replace('class="bank', 'class="bank ticking')}`;
}
function updateClocks(){
  document.querySelectorAll('.clock').forEach(el => { el.innerHTML = clockHtml(Number(el.dataset.p)); });
  if(typeof opponentDisconnectText === 'function'){ const d = $('#oppDisc'); if(d) d.textContent = opponentDisconnectText(); }
}
