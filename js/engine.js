'use strict';
/* =====================================================================
   ルールエンジン
   - 画面・音には一切触れない。ブラウザでもサーバー（Node.js）でも同じものを使う
   - 対局の状態（state）は、そのまま JSON にして通信で送れる形
   - 操作は { type:'move', p:0, from:{r,c}, to:{r,c} } のようなデータで表し、apply() で反映する
   - apply() は何が起きたかを events（イベントの一覧）で返す。ログや効果音は画面側がこれを見て出す
   - シャッフルはシード付きの乱数で行う（オンラインではサーバーだけがシードを持つ）
   ===================================================================== */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.Engine = factory({ CONFIG: root.CONFIG, CARDS: root.CARDS });
})(typeof self !== 'undefined' ? self : this, function({ CONFIG, CARDS }){

  const ROWS = CONFIG.ROWS, COLS = CONFIG.COLS;
  const fwd = p => p === 0 ? -1 : 1;              // 0=手前（下側） 1=奥（上側）
  const jinRow = p => p === 0 ? ROWS - 1 : 0;
  const isJin = r => r === 0 || r === ROWS - 1;
  const inB = (r,c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const baseType = t => CARDS[t].base || t;       // 倒されたり手札に戻ったりするときの元の駒（龍→飛車）
  const same = (a,b) => a && b && a.r === b.r && a.c === b.c;

  /* ---------- 乱数・デッキ ---------- */
  function random(state){                         // シード付き乱数（mulberry32）
    let t = (state.seed = (state.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(state, a){
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(random(state)*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  function cardLimit(k){
    if(CONFIG.UNLIMITED.includes(k)) return Infinity;
    return CONFIG.LIMITS[k] ?? CONFIG.MAX_COPIES;
  }
  const deckTotal = cards => Object.values(cards).reduce((a,b)=>a+b, 0);
  // デッキのチェック（オンラインではサーバーでも必ず確認する）
  function deckErrors(cards){
    const errs = []; let total = 0;
    if(!cards || typeof cards !== 'object') return ['デッキの形式が正しくありません'];
    for(const [k,n] of Object.entries(cards)){
      if(!CARDS[k] || CARDS[k].token){ errs.push(`使えないカード：${k}`); continue; }
      if(!Number.isInteger(n) || n<0){ errs.push(`${CARDS[k].name}の枚数が不正です`); continue; }
      if(n > cardLimit(k)) errs.push(`${CARDS[k].name}は${cardLimit(k)}枚までです`);
      total += n;
    }
    if(total !== CONFIG.DECK_SIZE) errs.push(`デッキは${CONFIG.DECK_SIZE}枚ちょうどにしてください（現在${total}枚）`);
    return errs;
  }
  function buildDeck(state, cards){
    const d = [];
    for(const [k,n] of Object.entries(cards)) for(let i=0;i<n;i++) d.push({ id: state.nextId++, key: k });
    return shuffle(state, d);
  }

  /* ---------- 盤面の判定（B は盤面の2次元配列） ---------- */
  function movesFor(B, r, c){
    const pc = B[r][c]; if(!pc) return [];
    const d = CARDS[pc.type], f = fwd(pc.owner), out = [];
    const ok = (tr,tc) => {                       // 0=行けない 1=空きマス 2=相手の駒を取る
      if(!inB(tr,tc)) return 0;
      const t = B[tr][tc];
      if(!t) return 1;
      if(t.owner === pc.owner) return 0;
      if((d.cantCapture || []).includes(t.type)) return 0;   // 縛兵は歩兵を取れない
      return 2;
    };
    for(const [dy,dx] of (d.step||[])){ const tr=r+dy*f, tc=c+dx*f; if(ok(tr,tc)) out.push({r:tr,c:tc}); }
    const range = d.range || Infinity;            // まっすぐ進める最大マス数
    for(const [dy,dx] of (d.slide||[])){
      let tr=r, tc=c;
      for(let n=1; n<=range; n++){ tr+=dy*f; tc+=dx*f; const k=ok(tr,tc); if(!k) break; out.push({r:tr,c:tc}); if(k===2) break; }
    }
    // 重複（龍の縦横1マスなど）を取り除く
    return out.filter((m,i) => out.findIndex(x=>same(x,m)) === i);
  }
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
      out.push({ fr, fc, r:tr, c:tc, launch:true });
    }
    return out;
  }
  function attacked(B, r, c, by){
    for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){
      const pc = B[i][j]; if(!pc || pc.owner!==by) continue;
      if(movesFor(B,i,j).some(m=>m.r===r&&m.c===c) || launchesFor(B,i,j).some(m=>m.r===r&&m.c===c)) return true;
    }
    return false;
  }
  function findKing(B, p){
    for(let i=0;i<ROWS;i++) for(let j=0;j<COLS;j++){ const pc=B[i][j]; if(pc && pc.owner===p && pc.type==='king') return {r:i,c:j}; }
    return null;
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
  const copyBoard = B => B.map(row => row.slice());

  /* ---------- 状態についての質問 ---------- */
  const inCheck = (state, p) => { const k = findKing(state.board,p); return !!k && attacked(state.board,k.r,k.c,1-p); };
  const lockReason = (state, id) => state.locked[id] || null;      // 動けない理由（'突風'・'縛兵'）
  const isBound = (state, id) => !!(state.locked[id] || state.bindNext[0][id] || state.bindNext[1][id]);
  const findCard = (state, p, cardId) => state.players[p].hand.find(c => c.id === cardId) || null;

  // 援軍を出せるマス：ふだんは自分の陣の空きマス。伏兵を使ったあとの次の1回は、陣以外の空きマス
  function summonTargets(state, p){
    const out = [];
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      if(state.board[r][c]) continue;
      if(state.ambush ? !isJin(r) : r === jinRow(p)) out.push({r,c});
    }
    return out;
  }
  // 援軍を出せない理由（出せるなら null）
  function summonBlock(state, p, cardId){
    const card = findCard(state, p, cardId); if(!card) return '手札にないカードです';
    const d = CARDS[card.key];
    if(d.kind !== 'piece') return '駒カードではありません';
    if(state.moved) return '駒を動かした後は援軍を出せません';
    if(d.cost > state.players[p].mana) return 'マナが足りません';
    if(!summonTargets(state,p).length) return state.ambush ? '陣以外に空きマスがありません' : '陣に空きがありません';
    return null;
  }
  const canSummon = (state, p, cardId) => !summonBlock(state, p, cardId);

  // 指令の対象候補。targets を持つ指令は、picks（選び済みの対象）の数で何番目の対象を選ぶかが決まる
  function cmdTargets(state, p, key, picks=[]){
    const want = (CARDS[key].targets || [])[picks.length], out = [];
    if(!want) return out;
    const B = state.board;
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const pc = B[r][c]; if(!pc) continue;
      const enemy = pc.owner !== p;
      if(want.side==='own' && enemy) continue;
      if(want.side==='enemy' && !enemy) continue;
      if(!want.king && pc.type==='king') continue;
      if(want.type && pc.type!==want.type) continue;
      if(enemy && guarded(B,r,c)) continue;
      if(want.shift){ const l = leftOf(p,r,c); if(!inB(l.r,l.c) || B[l.r][l.c]) continue; }
      if(picks.some(q => same(q,{r,c}))) continue;
      out.push({r,c});
    }
    return out;
  }
  // 指令を使えない理由（使えるなら null）
  function cmdBlock(state, p, cardId){
    const card = findCard(state, p, cardId); if(!card) return '手札にないカードです';
    const d = CARDS[card.key];
    if(d.kind !== 'cmd') return '指令カードではありません';
    if(d.cost > state.players[p].mana) return 'マナが足りません';
    if(card.key === 'fukuhei'){
      if(state.moved) return '駒を動かした後は援軍を出せません';
      if(state.ambush) return 'すでに伏兵の効果が出ています';
    }
    const ok = (d.targets || []).every((_, i) => cmdTargets(state, p, card.key, Array(i).fill(null)).length > 0);
    if(!ok) return `【${d.name}】対象にできる駒がありません`;
    return null;
  }
  const canCmd = (state, p, cardId) => !cmdBlock(state, p, cardId);

  // 駒を動かせない理由（動かせるなら null）
  function moveBlock(state, p, r, c){
    const pc = inB(r,c) && state.board[r][c];
    if(!pc || pc.owner !== p) return '自分の駒ではありません';
    if(state.movesLeft <= 0) return `${CARDS[pc.type].name}：このターンはもう駒を動かせません`;
    if(state.locked[pc.id]) return `${CARDS[pc.type].name}：${state.locked[pc.id]}の効果で、このターンは移動できません`;
    return null;
  }

  /* ---------- 対局の進行 ---------- */
  function draw(state, p, n, events){
    const pl = state.players[p]; let cnt = 0;
    for(let i=0;i<n;i++){ if(!pl.deck.length) break; pl.hand.push(pl.deck.pop()); cnt++; }
    events.push({ type:'draw', p, n:cnt });
    if(cnt < n) events.push({ type:'deckEmpty', p });
    return cnt;
  }
  function startTurn(state, events){
    const p = state.cur, pl = state.players[p];
    pl.turns++;
    const base = p === state.first ? CONFIG.MANA_FIRST : CONFIG.MANA_SECOND;
    pl.maxMana = Math.min(CONFIG.MANA_MAX, base + pl.turns - 1);
    pl.mana = pl.maxMana;
    state.turn++;
    state.movesLeft = 1; state.moved = false;
    // 縛兵を取った駒は、持ち主の次のターンに動けない
    state.locked = state.bindNext[p]; state.bindNext[p] = {};
    state.ambush = false;
    events.push({ type:'turnStart', p, mana: pl.mana, turn: state.turn });
    draw(state, p, 1, events);
  }
  function finish(state, winner, reason, events){
    state.over = true; state.winner = winner; state.reason = reason;
    events.push({ type:'gameOver', winner, reason });
  }

  // 新しい対局。decks: [先手側(p0)のデッキ, p1のデッキ]  first: 先攻のプレイヤー  seed: 乱数の種
  function createGame({ decks, first = 0, seed = 1 }){
    const board = Array.from({length:ROWS}, () => Array(COLS).fill(null));
    const state = {
      version: 1, rows: ROWS, cols: COLS,
      seed: (seed >>> 0) || 1, nextId: 1,
      first, cur: first, turn: 0,
      over: false, winner: null, reason: null,
      board, last: null,
      players: [0,1].map(() => ({ deck: [], hand: [], mana: 0, maxMana: 0, turns: 0 })),
      movesLeft: 0, moved: false,
      locked: {},                 // このターン動けない駒 { 駒id: 理由 }
      ambush: false,              // 伏兵の効果中（次の援軍を陣以外に出す）
      bindNext: [{}, {}],         // 次のターンに動けなくなる駒（プレイヤーごと）
    };
    // 王は自分の陣の真ん中（列数が偶数のときは、お互い自分から見て中央の右寄り＝点対称）
    const mid = Math.floor(COLS/2);
    board[jinRow(0)][mid]        = { id: state.nextId++, owner:0, type:'king' };
    board[jinRow(1)][COLS-1-mid] = { id: state.nextId++, owner:1, type:'king' };
    for(const p of [0,1]) state.players[p].deck = buildDeck(state, decks[p]);
    const events = [{ type:'start', first }];
    for(const p of [0,1]) draw(state, p, CONFIG.HAND_START, []);
    startTurn(state, events);
    return { state, events };
  }

  // 操作を反映する。成功なら { ok:true, events }、失敗なら { ok:false, error }（state は変わらない）
  function apply(state, action){
    const fail = error => ({ ok:false, error, events:[] });
    if(!action || typeof action !== 'object') return fail('不正な操作です');
    if(state.over) return fail('対局は終了しています');
    const p = action.p;
    if(p !== 0 && p !== 1) return fail('プレイヤーが不正です');
    const events = [];

    if(action.type === 'resign'){ finish(state, 1-p, 'resign', events); return { ok:true, events }; }
    if(p !== state.cur) return fail('相手の手番です');

    switch(action.type){
      case 'summon': {
        const { cardId, r, c } = action;
        const block = summonBlock(state, p, cardId); if(block) return fail(block);
        if(!summonTargets(state,p).some(t=>t.r===r&&t.c===c)) return fail('そのマスには援軍を出せません');
        const ambush = !!state.ambush;
        const pl = state.players[p], card = pl.hand.splice(pl.hand.findIndex(x=>x.id===cardId), 1)[0];
        pl.mana -= CARDS[card.key].cost;
        state.board[r][c] = { id: card.id, owner: p, type: card.key };
        state.ambush = false;
        events.push({ type:'summon', p, card: card.key, r, c, ambush });
        break;
      }
      case 'command': {
        const { cardId } = action, picks = action.picks || [];
        const block = cmdBlock(state, p, cardId); if(block) return fail(block);
        const pl = state.players[p], card = findCard(state, p, cardId), d = CARDS[card.key];
        const steps = d.targets || [];
        if(picks.length !== steps.length) return fail('対象の数が正しくありません');
        for(let i=0;i<steps.length;i++){
          if(!picks[i] || !cmdTargets(state, p, card.key, picks.slice(0,i)).some(x=>same(x,picks[i]))) return fail('その駒は対象にできません');
        }
        pl.hand.splice(pl.hand.indexOf(card), 1); pl.mana -= d.cost;
        const t = picks[0], ev = { type:'command', p, card: card.key };
        switch(card.key){
          case 'shingun': state.movesLeft++; break;
          case 'fukuhei': state.ambush = true; break;
          case 'hokyu':   ev.drawn = draw(state, p, 2, events); break;
          case 'tettai': { const pc = state.board[t.r][t.c]; state.board[t.r][t.c] = null;
                           pl.hand.push({ id: pc.id, key: baseType(pc.type) }); ev.piece = pc.type; break; }
          case 'rakurai':{ const pc = state.board[t.r][t.c]; state.board[t.r][t.c] = null; ev.piece = pc.type; break; }
          case 'ryuka':    state.board[t.r][t.c].type = 'ryu'; break;
          case 'toppu': {
            ev.pieces = []; ev.moves = [];
            for(const q of picks){
              const pc = state.board[q.r][q.c], l = leftOf(p, q.r, q.c);
              state.board[l.r][l.c] = pc; state.board[q.r][q.c] = null;
              state.locked[pc.id] = '突風'; ev.pieces.push(pc.type); ev.moves.push({ from:q, to:l });
            }
            break;
          }
        }
        events.unshift(ev);
        break;
      }
      case 'move': {
        const { from, to } = action;
        if(!from || !to) return fail('不正な操作です');
        const block = moveBlock(state, p, from.r, from.c); if(block) return fail(block);
        if(!movesFor(state.board, from.r, from.c).some(m=>same(m,to))) return fail('そこには動かせません');
        const pc = state.board[from.r][from.c], cap = state.board[to.r][to.c];
        state.board[to.r][to.c] = pc; state.board[from.r][from.c] = null;
        state.movesLeft--; state.moved = true;
        state.last = { fr:from.r, fc:from.c, tr:to.r, tc:to.c };
        events.push({ type:'move', p, piece: pc.type, from, to, captured: cap ? cap.type : null });
        if(cap){
          if(cap.type === 'king') finish(state, p, 'king', events);
          else {
            state.players[p].hand.push({ id: cap.id, key: baseType(cap.type) });
            if(CARDS[cap.type].binds){ state.bindNext[p][pc.id] = '縛兵'; events.push({ type:'bound', p, piece: pc.type }); }
          }
        }
        break;
      }
      case 'launch': {
        const { from, to } = action;              // from: 砲兵の位置  to: 撃ち出し先
        if(!from || !to) return fail('不正な操作です');
        const block = moveBlock(state, p, from.r, from.c); if(block) return fail(block);
        const L = launchesFor(state.board, from.r, from.c).find(m=>same(m,to));
        if(!L) return fail('そこへは撃ち出せません');
        const fu = state.board[L.fr][L.fc], cap = state.board[to.r][to.c];
        state.board[L.fr][L.fc] = null;
        state.movesLeft--; state.moved = true;
        state.last = { fr:L.fr, fc:L.fc, tr:to.r, tc:to.c };
        // 相手の駒を取ったら、撃ち出した歩兵は消える
        state.board[to.r][to.c] = cap ? null : fu;
        events.push({ type:'launch', p, from:{ r:L.fr, c:L.fc }, to, captured: cap ? cap.type : null });
        if(cap){
          if(cap.type === 'king') finish(state, p, 'king', events);
          else state.players[p].hand.push({ id: cap.id, key: baseType(cap.type) });
        }
        break;
      }
      case 'endTurn': {
        state.cur = 1 - state.cur;
        startTurn(state, events);
        break;
      }
      default: return fail('不明な操作です');
    }
    return { ok:true, events };
  }

  // 時間切れ・切断などで負けにする（サーバー用）
  function forfeit(state, loser, reason){
    const events = [];
    if(!state.over) finish(state, 1-loser, reason, events);
    return { ok:true, events };
  }

  // プレイヤー p に見せてよい情報だけにしたコピー（相手の手札と、両者の山札の中身・乱数の種を隠す）
  function viewFor(state, p){
    const v = JSON.parse(JSON.stringify(state));
    delete v.seed; delete v.nextId;
    v.players.forEach((pl, i) => {
      pl.deckCount = pl.deck.length; pl.deck = [];
      if(i !== p){ pl.handCount = pl.hand.length; pl.hand = []; }
      else pl.handCount = pl.hand.length;
    });
    v.viewer = p;
    return v;
  }

  return {
    CONFIG, CARDS, ROWS, COLS,
    fwd, jinRow, isJin, inB, baseType, leftOf, copyBoard,
    cardLimit, deckTotal, deckErrors,
    movesFor, launchesFor, attacked, findKing, guarded,
    inCheck, lockReason, isBound, findCard,
    summonTargets, summonBlock, canSummon, cmdTargets, cmdBlock, canCmd, moveBlock,
    createGame, apply, forfeit, viewFor,
  };
});
