'use strict';
/* =====================================================================
   CPUの思考
   - 盤面を見て「次にする操作」を1つ返すだけ（画面には触れない）
   - 1ターンの間、nextAction() を何度も呼ぶ。駒を動かすと自動でターンが終わる
   - エンジンと同じくブラウザでもサーバー（Node.js）でも使える
   ===================================================================== */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Cpu = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function(E){
  const { CARDS, ROWS, COLS } = E;
  const val = t => CARDS[t].value;

  function pickSpot(state, p, spots, key){
    const B = state.board;
    return spots.map(s => {
      const fr = s.r + E.fwd(p);
      let sc = Math.random();
      if(state.ambush){
        // 伏兵：相手の王や駒を狙えて、狙われにくいマスを選ぶ
        const nb = E.copyBoard(B); nb[s.r][s.c] = { id:-1, owner:p, type:key };
        for(const m of E.movesFor(nb, s.r, s.c)){ const t = nb[m.r][m.c]; if(t) sc += t.type==='king' ? 20 : val(t.type)*2; }
        if(E.attacked(nb, s.r, s.c, 1-p)) sc -= val(key)*3;
        return { s, sc };
      }
      if(E.inB(fr, s.c)){
        if(!B[fr][s.c]) sc += 2;
        else if(B[fr][s.c].owner !== p) sc += 3;
        if(E.attacked(B, fr, s.c, 1-p)) sc -= 1;
      }
      return { s, sc };
    }).sort((a,b)=>b.sc-a.sc)[0].s;
  }

  // いちばん良さそうな移動（または砲兵の撃ち出し）
  function bestMove(state, p){
    const B = state.board; let best = null;
    const consider = (s, a) => { if(!best || s > best.score) best = { score:s, action:a }; };
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const pc = B[r][c]; if(!pc || pc.owner!==p || state.locked[pc.id]) continue;
      const v = val(pc.type);
      for(const m of E.movesFor(B,r,c)){
        let s = Math.random()*0.6;
        const cap = B[m.r][m.c];
        if(cap) s += cap.type==='king' ? 100000 : val(cap.type)*10 - (CARDS[cap.type].binds ? 3 : 0);
        const nb = E.copyBoard(B); nb[m.r][m.c]=pc; nb[r][c]=null;
        const kp = E.findKing(nb,p);
        if(kp && E.attacked(nb,kp.r,kp.c,1-p)) s -= 5000;
        else if(E.attacked(nb,m.r,m.c,1-p)) s -= v*9;
        if(pc.type!=='king'){
          if(E.attacked(B,r,c,1-p)) s += v*6;            // 狙われている駒を逃がす
          s += (m.r-r)*E.fwd(p)*1.5;                     // 前進ボーナス
        } else s -= 2;
        if(E.isJin(r)) s += 2;
        const ek = E.findKing(nb,1-p); if(ek && E.attacked(nb,ek.r,ek.c,p)) s += 8;
        consider(s, { type:'move', p, from:{r,c}, to:{r:m.r,c:m.c} });
      }
      for(const L of E.launchesFor(B,r,c)){
        let s = Math.random()*0.6;
        const cap = B[L.r][L.c], fu = B[L.fr][L.fc];
        const nb = E.copyBoard(B); nb[L.fr][L.fc] = null;
        if(cap){ s += cap.type==='king' ? 100000 : val(cap.type)*10 - 10; nb[L.r][L.c] = null; }
        else { nb[L.r][L.c] = fu; s += 2; if(E.attacked(nb,L.r,L.c,1-p)) s -= 9; }
        const kp = E.findKing(nb,p); if(kp && E.attacked(nb,kp.r,kp.c,1-p)) s -= 5000;
        const ek = E.findKing(nb,1-p); if(ek && E.attacked(nb,ek.r,ek.c,p)) s += 8;
        consider(s, { type:'launch', p, from:{r,c}, to:{r:L.r,c:L.c} });
      }
    }
    return best;
  }

  // 突風：相手の王を狙える、または自分の王手を外せる組み合わせがあれば使う
  function bestToppu(state, p){
    const es = E.cmdTargets(state,p,'toppu',[]), os = E.cmdTargets(state,p,'toppu',[null]);
    const inCheckNow = E.inCheck(state,p);
    let best = null, bestScore = 0;
    for(const e of es) for(const o of os){
      const B = E.copyBoard(state.board), movedIds = new Set();
      for(const q of [e,o]){ const pc=B[q.r][q.c], l=E.leftOf(p,q.r,q.c); B[l.r][l.c]=pc; B[q.r][q.c]=null; movedIds.add(pc.id); }
      let s = 0;
      const ek = E.findKing(B,1-p), mk = E.findKing(B,p);
      // 動かした駒はこのターン動けないので、それ以外の駒で王を狙えるか
      const hits = (r,c) => { for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){ const q=B[i][j];
        if(q && q.owner===p && !movedIds.has(q.id) && !state.locked[q.id] && E.movesFor(B,i,j).some(m=>m.r===r&&m.c===c)) return true; } return false; };
      if(ek && hits(ek.r,ek.c)) s += 100;
      if(inCheckNow && mk && !E.attacked(B,mk.r,mk.c,1-p)) s += 80;
      if(s > bestScore){ bestScore = s; best = [e,o]; }
    }
    return best;
  }

  // 次にする操作を1つ返す
  function nextAction(state, p){
    const pl = state.players[p];
    const card = key => pl.hand.find(c => c.key===key && E.canCmd(state,p,c.id));
    const cmd = (c, picks) => ({ type:'command', p, cardId:c.id, picks: picks || [] });
    let c;
    // 指令
    if((c = card('hokyu')) && pl.hand.length<=5 && pl.deck.length) return cmd(c);
    if((c = card('rakurai'))){
      const ts = E.cmdTargets(state,p,'rakurai').sort((a,b)=>val(state.board[b.r][b.c].type)-val(state.board[a.r][a.c].type));
      if(ts.length && val(state.board[ts[0].r][ts[0].c].type) >= 3) return cmd(c, [ts[0]]);
    }
    if((c = card('ryuka'))) return cmd(c, [E.cmdTargets(state,p,'ryuka')[0]]);
    if((c = card('toppu'))){ const t = bestToppu(state,p); if(t) return cmd(c, t); }
    // 伏兵：伏兵のコスト＋出せる駒のコストのマナがあれば使う
    if((c = card('fukuhei')) && pl.hand.some(x => CARDS[x.key].kind==='piece' && CARDS[x.key].cost + CARDS.fukuhei.cost <= pl.mana)) return cmd(c);
    // 援軍（コストの高い駒から）
    const cands = pl.hand.filter(x => E.canSummon(state,p,x.id))
      .sort((a,b)=>CARDS[b.key].cost-CARDS[a.key].cost + (Math.random()-.5)*.5);
    if(cands.length){ const s = pickSpot(state, p, E.summonTargets(state,p), cands[0].key); return { type:'summon', p, cardId:cands[0].id, r:s.r, c:s.c }; }
    if((c = card('shingun')) && !state.moved) return cmd(c);
    // 移動（駒は必ず1回動かす。動かすと自動でターン終了。動かせる駒がなければパス）
    const m = bestMove(state, p);
    if(m) return m.action;
    return { type:'endTurn', p };
  }

  return { nextAction, bestMove, bestToppu };
});
