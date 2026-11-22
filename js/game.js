'use strict';
/* ゲームの状態とルール */
const ROWS = CONFIG.ROWS, COLS = CONFIG.COLS;
document.documentElement.style.setProperty('--cols', COLS);
document.documentElement.style.setProperty('--rows', ROWS);
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
// カードごとの上限枚数
function cardLimit(k){
  if(CONFIG.UNLIMITED.includes(k)) return Infinity;
  return CONFIG.LIMITS[k] ?? CONFIG.MAX_COPIES;
}
// デッキのチェック（オンライン対戦ではサーバー側でも同じ確認をする）
function deckErrors(cards){
  const errs = []; let total = 0;
  for(const [k,n] of Object.entries(cards)){
    if(!CARDS[k] || CARDS[k].token){ errs.push(`使えないカード：${k}`); continue; }
    if(!Number.isInteger(n) || n<0){ errs.push(`${CARDS[k].name}の枚数が不正です`); continue; }
    if(n > cardLimit(k)) errs.push(`${CARDS[k].name}は${cardLimit(k)}枚までです`);
    total += n;
  }
  if(total !== CONFIG.DECK_SIZE) errs.push(`デッキは${CONFIG.DECK_SIZE}枚ちょうどにしてください（現在${total}枚）`);
  return errs;
}
const deckTotal = cards => Object.values(cards).reduce((a,b)=>a+b, 0);
function buildDeck(cards){ const d=[]; for(const [k,n] of Object.entries(cards || CONFIG.DECK)) for(let i=0;i<n;i++) d.push({id:uid++,key:k}); return shuffle(d); }
const pname = p => st.mode === 'cpu' ? (p===0 ? 'あなた' : 'CPU') : (p===0 ? 'プレイヤー1' : 'プレイヤー2');
function log(msg){ st.log.unshift(msg); st.log = st.log.slice(0,4); }

/* ---------- ルール ---------- */
// 倒されたり手札に戻ったりするときの元の駒（龍→飛車）
const baseType = t => CARDS[t].base || t;
// 砲兵の撃ち出し：前方3マスにいる自分の歩兵を2マス先へ。行き先が空きか相手の駒なら撃てる
function launchesFor(B, r, c){
  const pc = B[r][c]; if(!pc || !CARDS[pc.type].launcher) return [];
  const f = fwd(pc.owner), out = [];
  for(const dc of [-1,0,1]){
    const fr = r+f, fc = c+dc;
    if(!inB(fr,fc)) continue;
    const q = B[fr][fc]; if(!q || q.owner!==pc.owner || q.type!=='fu') continue;
    const tr = fr+2*f, tc = fc;
    if(!inB(tr,tc)) continue;
    const t = B[tr][tc]; if(t && t.owner===pc.owner) continue;
    out.push({fr, fc, r:tr, c:tc, launch:true});
  }
  return out;
}
function movesFor(B, r, c){
  const pc = B[r][c]; if(!pc) return [];
  const f = fwd(pc.owner), out = [];
  const ok = (tr,tc) => {
    if(!inB(tr,tc)) return 0;
    const t = B[tr][tc];
    if(!t) return 1;
    if(t.owner === pc.owner) return 0;
    if((CARDS[pc.type].cantCapture || []).includes(t.type)) return 0;   // 縛兵は歩兵を取れない
    return 2;
  };
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
    const pc=B[i][j]; if(!pc || pc.owner!==by) continue;
    if(movesFor(B,i,j).some(m=>m.r===r&&m.c===c) || launchesFor(B,i,j).some(m=>m.r===r&&m.c===c)) return true;
  }
  return false;
}
function findKing(B, p){
  for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){ const pc=B[i][j]; if(pc && pc.owner===p && pc.type==='king') return {r:i,c:j}; }
  return null;
}
function inCheck(p){ const k=findKing(st.board,p); return k && attacked(st.board,k.r,k.c,1-p); }

// 各プレイヤーが使うデッキ：CPUは標準デッキ、人はMyデッキ
function deckFor(mode, p){
  if(mode==='cpu' && p===1) return CONFIG.DECK;
  const my = loadMyDeck();
  return my && !deckErrors(my.cards).length ? my.cards : CONFIG.DECK;
}
function newGame(mode, first){
  const board = Array.from({length:ROWS}, () => Array(COLS).fill(null));
  // 王は自分の陣の真ん中（列数が偶数のときは、お互い自分から見て中央の右寄り＝点対称）
  const mid = Math.floor(COLS/2);
  board[jinRow(0)][mid]        = {id:uid++, owner:0, type:'king'};
  board[jinRow(1)][COLS-1-mid] = {id:uid++, owner:1, type:'king'};
  st = { mode, first, cur:first, board, over:false, winner:null, last:null,
         players:[0,1].map(p=>({deck:buildDeck(deckFor(mode,p)), hand:[], mana:0, maxMana:0, turns:0})),
         movesLeft:0, moved:false, locked:new Map(), bindNext:[new Map(), new Map()], log:[] };
  for(const p of [0,1]) draw(p, CONFIG.HAND_START, true);
  log('対局開始！');
  hideOverlay();
  startBgm();
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
  // 動けない駒：縛兵を取った駒は、持ち主の次のターンに動けない（値は理由）
  st.locked = st.bindNext[p]; st.bindNext[p] = new Map();
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
// 防人の守り：自身と周囲8マスにいる、防人と同じ持ち主の駒は相手の指令を受けない
function guarded(B, r, c){
  const pc = B[r][c]; if(!pc) return false;
  for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
    const rr=r+dr, cc=c+dc; if(!inB(rr,cc)) continue;
    const q = B[rr][cc]; if(q && q.owner===pc.owner && q.type==='sakimori') return true;
  }
  return false;
}
// 指令を使う人から見て「左」のマス
const leftOf = (p, r, c) => ({ r, c: c + (p===0 ? -1 : 1) });

// 指令の対象候補。targets を持つ指令は、picks（選び済みの対象）の数で何番目の対象を選ぶかが決まる
function cmdTargets(p, key, picks=[]){
  const want = (CARDS[key].targets || [])[picks.length], out = [];
  if(!want) return out;
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const pc = st.board[r][c]; if(!pc) continue;
    const enemy = pc.owner !== p;
    if(want.side==='own' && enemy) continue;
    if(want.side==='enemy' && !enemy) continue;
    if(!want.king && pc.type==='king') continue;
    if(want.type && pc.type!==want.type) continue;
    if(enemy && guarded(st.board,r,c)) continue;
    if(want.shift){ const l = leftOf(p,r,c); if(!inB(l.r,l.c) || st.board[l.r][l.c]) continue; }
    out.push({r,c});
  }
  return out;
}
function canCmd(p, idx){
  const c = st.players[p].hand[idx]; if(!c) return false;
  const d = CARDS[c.key];
  if(d.kind!=='cmd' || d.cost > st.players[p].mana) return false;
  return (d.targets || []).every((_, i) => cmdTargets(p, c.key, Array(i).fill(null)).length > 0);
}
function useCmd(p, idx, picks=[]){
  if(!canCmd(p,idx)) return false;
  const pl = st.players[p], card = pl.hand[idx], d = CARDS[card.key];
  const steps = d.targets || [];
  if(picks.length !== steps.length) return false;
  for(let i=0;i<steps.length;i++){
    const t = picks[i];
    if(!t || !cmdTargets(p, card.key, picks.slice(0,i)).some(x=>x.r===t.r&&x.c===t.c)) return false;
  }
  const t = picks[0];
  pl.hand.splice(idx,1); pl.mana -= d.cost;
  switch(card.key){
    case 'shingun': st.movesLeft++; log(`${pname(p)}：【進軍】駒をもう1回動かせる`); break;
    case 'hokyu': { const n = draw(p,2); log(`${pname(p)}：【補給】カードを${n}枚引いた`); break; }
    case 'tettai': { const pc = st.board[t.r][t.c]; st.board[t.r][t.c] = null; pl.hand.push({id:pc.id,key:baseType(pc.type)});
                     log(`${pname(p)}：【撤退】${CARDS[pc.type].name}を手札に戻した`); break; }
    case 'rakurai': { const pc = st.board[t.r][t.c]; st.board[t.r][t.c] = null;
                      log(`${pname(p)}：【落雷】${CARDS[pc.type].name}を破壊した`); break; }
    case 'toppu': {
      const names = [];
      for(const q of picks){
        const pc = st.board[q.r][q.c], l = leftOf(p, q.r, q.c);
        st.board[l.r][l.c] = pc; st.board[q.r][q.c] = null;
        st.locked.set(pc.id, '突風'); names.push(CARDS[pc.type].name);
      }
      log(`${pname(p)}：【突風】${names.join('と')}を左へ動かした`); break; }
    case 'ryuka': { st.board[t.r][t.c].type = 'ryu'; log(`${pname(p)}：【龍化】飛車が龍になった！`); break; }
  }
  return true;
}
function doMove(p, fr, fc, tr, tc){
  const pc = st.board[fr][fc];
  if(!pc || pc.owner!==p || st.movesLeft<=0 || st.locked.has(pc.id)) return false;
  if(!movesFor(st.board,fr,fc).some(m=>m.r===tr&&m.c===tc)) return false;
  const cap = st.board[tr][tc];
  st.board[tr][tc] = pc; st.board[fr][fc] = null;
  st.movesLeft--; st.moved = true; st.last = {fr,fc,tr,tc};
  playSe('move');
  if(cap){
    if(cap.type==='king'){ st.over = true; st.winner = p; stopBgm(); log(`${pname(p)}が王を討ち取った！`); }
    else { st.players[p].hand.push({id:cap.id,key:baseType(cap.type)});
           log(`${pname(p)}：${CARDS[pc.type].name}が${CARDS[cap.type].name}を倒した（手札へ）`);
           if(CARDS[cap.type].binds){ st.bindNext[p].set(pc.id, '縛兵'); log(`${CARDS[pc.type].name}は縛られた！次のターン動けない`); } }
  } else log(`${pname(p)}：${CARDS[pc.type].name}が移動した`);
  return true;
}
// 砲兵の撃ち出し（駒の移動1回分を使う）
function doLaunch(p, hr, hc, tr, tc){
  const h = st.board[hr][hc];
  if(!h || h.owner!==p || st.movesLeft<=0 || st.locked.has(h.id)) return false;
  const L = launchesFor(st.board, hr, hc).find(m=>m.r===tr&&m.c===tc); if(!L) return false;
  const fu = st.board[L.fr][L.fc], cap = st.board[tr][tc];
  st.board[L.fr][L.fc] = null;
  st.movesLeft--; st.moved = true; st.last = {fr:L.fr,fc:L.fc,tr,tc};
  playSe('move');
  if(cap){
    // 相手の駒を取る。撃ち出した歩兵はその後消える
    if(cap.type==='king'){ st.board[tr][tc] = null; st.over = true; st.winner = p; stopBgm(); log(`${pname(p)}：砲撃で王を討ち取った！`); }
    else { st.board[tr][tc] = null; st.players[p].hand.push({id:cap.id,key:baseType(cap.type)});
           log(`${pname(p)}：砲撃！歩兵が${CARDS[cap.type].name}を倒して散った（手札へ）`); }
  } else { st.board[tr][tc] = fu; log(`${pname(p)}：砲兵が歩兵を撃ち出した`); }
  return true;
}
