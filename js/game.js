'use strict';
/* ゲームの状態とルール */
const ROWS = CONFIG.FIELD_ROWS + 2, COLS = CONFIG.COLS;
const $ = s => document.querySelector(s);
let st = null;
let ui = { sel:null, targets:[], prompt:'', warn:false, action:null, handoff:false, cpuBusy:false };
let uid = 1;

const fwd = p => p === 0 ? -1 : 1;           // 0=下側(手前) 1=上側
const jinRow = p => p === 0 ? ROWS - 1 : 0;
const isJin = r => r === 0 || r === ROWS - 1;
const inB = (r,c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
let sleep = ms => new Promise(res => setTimeout(res, ms));

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function buildDeck(){ const d=[]; for(const [k,n] of Object.entries(CONFIG.DECK)) for(let i=0;i<n;i++) d.push({id:uid++,key:k}); return shuffle(d); }
const pname = p => st.mode === 'cpu' ? (p===0 ? 'あなた' : 'CPU') : (p===0 ? 'プレイヤー1' : 'プレイヤー2');
function log(msg){ st.log.unshift(msg); st.log = st.log.slice(0,4); }

/* ---------- ルール ---------- */
function movesFor(B, r, c){
  const pc = B[r][c]; if(!pc) return [];
  const f = fwd(pc.owner), out = [];
  const ok = (tr,tc) => {
    if(!inB(tr,tc) || isJin(tr)) return 0;      // 陣には入れない
    const t = B[tr][tc];
    if(!t) return 1;
    return t.owner !== pc.owner ? 2 : 0;
  };
  if(isJin(r)){                                  // 出陣：1マス前のみ
    const tr = r + f; if(ok(tr,c)) out.push({r:tr,c});
    return out;
  }
  const d = CARDS[pc.type];
  for(const [dy,dx] of (d.step||[])){ const tr=r+dy*f, tc=c+dx*f; if(ok(tr,tc)) out.push({r:tr,c:tc}); }
  for(const [dy,dx] of (d.slide||[])){
    let tr=r, tc=c;
    while(true){ tr+=dy*f; tc+=dx*f; const k=ok(tr,tc); if(!k) break; out.push({r:tr,c:tc}); if(k===2) break; }
  }
  return out;
}
function attacked(B, r, c, by){
  for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){
    const pc=B[i][j]; if(pc && pc.owner===by && movesFor(B,i,j).some(m=>m.r===r&&m.c===c)) return true;
  }
  return false;
}
function findKing(B, p){
  for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){ const pc=B[i][j]; if(pc && pc.owner===p && pc.type==='king') return {r:i,c:j}; }
  return null;
}
function inCheck(p){ const k=findKing(st.board,p); return k && attacked(st.board,k.r,k.c,1-p); }

function newGame(mode, first){
  const board = Array.from({length:ROWS}, () => Array(COLS).fill(null));
  const mid = Math.floor(COLS/2);
  board[ROWS-2][mid] = {id:uid++, owner:0, type:'king'};   // 自陣側の真ん中
  board[1][mid]      = {id:uid++, owner:1, type:'king'};
  st = { mode, first, cur:first, board, over:false, winner:null, last:null,
         players:[0,1].map(()=>({deck:buildDeck(), hand:[], mana:0, maxMana:0, turns:0})),
         movesLeft:0, moved:false, log:[] };
  for(const p of [0,1]) draw(p, CONFIG.HAND_START, true);
  log('対局開始！');
  hideOverlay();
  startTurn();
}
function draw(p, n, silent){
  const pl = st.players[p]; let cnt = 0;
  for(let i=0;i<n;i++){
    if(!pl.deck.length){ if(!silent) log(`${pname(p)}の山札が切れているため引けません`); break; }
    pl.hand.push(pl.deck.pop()); cnt++;
  }
  return cnt;
}
function startTurn(){
  const p = st.cur, pl = st.players[p];
  pl.turns++;
  const base = p === st.first ? CONFIG.MANA_FIRST : CONFIG.MANA_SECOND;
  pl.maxMana = Math.min(CONFIG.MANA_MAX, base + pl.turns - 1);
  pl.mana = pl.maxMana;
  st.movesLeft = 1; st.moved = false;
  clearSel();
  draw(p, 1);
  log(`${pname(p)}のターン（マナ${pl.mana}）`);
  if(st.mode === 'cpu' && p === 1){ ui.cpuBusy = true; render(); const g = st; setTimeout(() => { if(st === g) runCpu().catch(e => { if(e !== 'abort') throw e; }); }, 650); }
  else if(st.mode === '2p'){ render(); showHandoff(); }
  else render();
}
function endTurn(){ if(st.over) return; st.cur = 1 - st.cur; startTurn(); }

function canSummon(p, idx){
  const c = st.players[p].hand[idx]; if(!c) return false;
  const d = CARDS[c.key];
  return d.kind==='piece' && !st.moved && d.cost <= st.players[p].mana && summonTargets(p).length > 0;
}
function summonTargets(p){ const r=jinRow(p), out=[]; for(let c=0;c<COLS;c++) if(!st.board[r][c]) out.push({r,c}); return out; }
function summon(p, idx, r, c){
  if(!canSummon(p,idx) || r!==jinRow(p) || st.board[r][c]) return false;
  const card = st.players[p].hand.splice(idx,1)[0];
  st.players[p].mana -= CARDS[card.key].cost;
  st.board[r][c] = {id:card.id, owner:p, type:card.key};
  log(`${pname(p)}：${CARDS[card.key].name}を援軍に出した`);
  return true;
}
function cmdTargets(p, key){
  const d = CARDS[key], out = []; if(!d.target) return out;
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const pc = st.board[r][c]; if(!pc || pc.type==='king') continue;
    if(d.target==='own' && pc.owner===p) out.push({r,c});
    if(d.target==='enemy' && pc.owner!==p) out.push({r,c});
  }
  return out;
}
function canCmd(p, idx){
  const c = st.players[p].hand[idx]; if(!c) return false;
  const d = CARDS[c.key];
  if(d.kind!=='cmd' || d.cost > st.players[p].mana) return false;
  if(d.target && !cmdTargets(p,c.key).length) return false;
  return true;
}
function useCmd(p, idx, t){
  if(!canCmd(p,idx)) return false;
  const pl = st.players[p], card = pl.hand[idx], d = CARDS[card.key];
  if(d.target && (!t || !cmdTargets(p,card.key).some(x=>x.r===t.r&&x.c===t.c))) return false;
  pl.hand.splice(idx,1); pl.mana -= d.cost;
  switch(card.key){
    case 'shingun': st.movesLeft++; log(`${pname(p)}：【進軍】駒をもう1回動かせる`); break;
    case 'hokyu': { const n = draw(p,2); log(`${pname(p)}：【補給】カードを${n}枚引いた`); break; }
    case 'tettai': { const pc = st.board[t.r][t.c]; st.board[t.r][t.c] = null; pl.hand.push({id:pc.id,key:pc.type});
                     log(`${pname(p)}：【撤退】${CARDS[pc.type].name}を手札に戻した`); break; }
    case 'rakurai': { const pc = st.board[t.r][t.c]; st.board[t.r][t.c] = null;
                      log(`${pname(p)}：【落雷】${CARDS[pc.type].name}を破壊した`); break; }
  }
  return true;
}
function doMove(p, fr, fc, tr, tc){
  const pc = st.board[fr][fc];
  if(!pc || pc.owner!==p || st.movesLeft<=0) return false;
  if(!movesFor(st.board,fr,fc).some(m=>m.r===tr&&m.c===tc)) return false;
  const cap = st.board[tr][tc];
  const verb = isJin(fr) ? '出陣した' : '移動した';
  st.board[tr][tc] = pc; st.board[fr][fc] = null;
  st.movesLeft--; st.moved = true; st.last = {fr,fc,tr,tc};
  if(cap){
    if(cap.type==='king'){ st.over = true; st.winner = p; log(`${pname(p)}が王を討ち取った！`); }
    else { st.players[p].hand.push({id:cap.id,key:cap.type});
           log(`${pname(p)}：${CARDS[pc.type].name}が${CARDS[cap.type].name}を倒した（手札へ）`); }
  } else log(`${pname(p)}：${CARDS[pc.type].name}が${verb}`);
  return true;
}
