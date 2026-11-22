'use strict';
/* CPUの思考 */
const valAt = t => CARDS[st.board[t.r][t.c].type].value;
function pickSpot(p, spots){
  const scored = spots.map(s => {
    const fr = s.r + fwd(p);
    let sc = Math.random();
    if(!st.board[fr][s.c]) sc += 2;
    else if(st.board[fr][s.c].owner !== p) sc += 3;
    if(attacked(st.board, fr, s.c, 1-p)) sc -= 1;
    return {s, sc};
  }).sort((a,b)=>b.sc-a.sc);
  return scored[0].s;
}
function bestMove(p){
  const B = st.board; let best = null;
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const pc = B[r][c]; if(!pc || pc.owner!==p || st.locked.has(pc.id)) continue;
    const v = CARDS[pc.type].value;
    for(const m of movesFor(B,r,c)){
      let s = Math.random()*0.6;
      const cap = B[m.r][m.c];
      if(cap) s += cap.type==='king' ? 100000 : CARDS[cap.type].value*10 - (CARDS[cap.type].binds ? 3 : 0);
      const nb = B.map(row=>row.slice()); nb[m.r][m.c]=pc; nb[r][c]=null;
      const kp = findKing(nb,p);
      if(kp && attacked(nb,kp.r,kp.c,1-p)) s -= 5000;
      else if(attacked(nb,m.r,m.c,1-p)) s -= v*9;
      if(pc.type!=='king'){
        if(attacked(B,r,c,1-p)) s += v*6;          // 狙われている駒を逃がす
        s += (m.r-r)*fwd(p)*1.5;                   // 前進ボーナス
      } else s -= 2;
      if(isJin(r)) s += 2;
      const ek = findKing(nb,1-p); if(ek && attacked(nb,ek.r,ek.c,p)) s += 8;
      if(!best || s>best.score) best = {fr:r,fc:c,tr:m.r,tc:m.c,score:s};
    }
    // 砲兵の撃ち出し
    for(const L of launchesFor(B,r,c)){
      let s = Math.random()*0.6;
      const cap = B[L.r][L.c], fu = B[L.fr][L.fc];
      const nb = B.map(row=>row.slice()); nb[L.fr][L.fc] = null;
      if(cap){ s += cap.type==='king' ? 100000 : CARDS[cap.type].value*10 - 10; nb[L.r][L.c] = null; }
      else { nb[L.r][L.c] = fu; s += 2; if(attacked(nb,L.r,L.c,1-p)) s -= 9; }
      const kp = findKing(nb,p); if(kp && attacked(nb,kp.r,kp.c,1-p)) s -= 5000;
      const ek = findKing(nb,1-p); if(ek && attacked(nb,ek.r,ek.c,p)) s += 8;
      if(!best || s>best.score) best = {fr:r,fc:c,tr:L.r,tc:L.c,score:s,launch:true};
    }
  }
  return best;
}
// 突風：相手の王を狙える、または自分の王手を外せる組み合わせがあれば使う
function bestToppu(p){
  const es = cmdTargets(p,'toppu',[]), os = cmdTargets(p,'toppu',[null]);
  const inCheckNow = inCheck(p);
  let best = null, bestScore = 0;
  for(const e of es) for(const o of os){
    const B = st.board.map(row=>row.slice());
    const movedIds = new Set();
    for(const q of [e,o]){ const pc=B[q.r][q.c], l=leftOf(p,q.r,q.c); B[l.r][l.c]=pc; B[q.r][q.c]=null; movedIds.add(pc.id); }
    let s = 0;
    const ek = findKing(B,1-p), mk = findKing(B,p);
    // 動かした駒はこのターン動けないので、それ以外の駒で王を狙えるか
    const hits = (r,c) => { for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){ const q=B[i][j];
      if(q && q.owner===p && !movedIds.has(q.id) && movesFor(B,i,j).some(m=>m.r===r&&m.c===c)) return true; } return false; };
    if(ek && hits(ek.r,ek.c)) s += 100;
    if(inCheckNow && mk && !attacked(B,mk.r,mk.c,1-p)) s += 80;
    if(s > bestScore){ bestScore = s; best = [e,o]; }
  }
  return best;
}
async function runCpu(){
  const p = 1, pl = st.players[p];
  const g = st;
  const step = async () => { render(); await sleep(550); if(st !== g) throw 'abort'; };
  let i = pl.hand.findIndex(c=>c.key==='hokyu');
  if(i>=0 && pl.hand.length<=5 && pl.deck.length && canCmd(p,i)){ useCmd(p,i); await step(); }
  i = pl.hand.findIndex(c=>c.key==='rakurai');
  if(i>=0 && canCmd(p,i)){
    const ts = cmdTargets(p,'rakurai').sort((a,b)=>valAt(b)-valAt(a));
    if(ts.length && valAt(ts[0])>=3){ useCmd(p,i,[ts[0]]); await step(); }
  }
  i = pl.hand.findIndex(c=>c.key==='ryuka');
  if(i>=0 && canCmd(p,i)){ useCmd(p,i,[cmdTargets(p,'ryuka')[0]]); await step(); }
  i = pl.hand.findIndex(c=>c.key==='toppu');
  if(i>=0 && canCmd(p,i)){ const t = bestToppu(p); if(t){ useCmd(p,i,t); await step(); } }
  while(true){
    const cands = pl.hand.map((c,idx)=>({c,idx})).filter(o=>canSummon(p,o.idx));
    if(!cands.length) break;
    cands.sort((a,b)=>CARDS[b.c.key].cost-CARDS[a.c.key].cost + (Math.random()-.5)*.5);
    const spot = pickSpot(p, summonTargets(p));
    summon(p, cands[0].idx, spot.r, spot.c); await step();
  }
  i = pl.hand.findIndex(c=>c.key==='shingun');
  if(i>=0 && canCmd(p,i) && Math.random()<0.7){ useCmd(p,i); await step(); }
  while(st.movesLeft>0 && !st.over){
    const m = bestMove(p); if(!m || m.score < -40) break;
    if(m.launch) doLaunch(p,m.fr,m.fc,m.tr,m.tc); else doMove(p,m.fr,m.fc,m.tr,m.tc);
    await step();
  }
  ui.cpuBusy = false;
  if(st.over){ render(); showResult(); } else endTurn();
}
