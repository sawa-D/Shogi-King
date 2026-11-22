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
    const pc = B[r][c]; if(!pc || pc.owner!==p) continue;
    const v = CARDS[pc.type].value;
    for(const m of movesFor(B,r,c)){
      let s = Math.random()*0.6;
      const cap = B[m.r][m.c];
      if(cap) s += cap.type==='king' ? 100000 : CARDS[cap.type].value*10;
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
    if(ts.length && valAt(ts[0])>=3){ useCmd(p,i,ts[0]); await step(); }
  }
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
    doMove(p,m.fr,m.fc,m.tr,m.tc); await step();
  }
  ui.cpuBusy = false;
  if(st.over){ render(); showResult(); } else endTurn();
}
