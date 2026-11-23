'use strict';
/* 画面の描画と操作 */
/* ---------- 操作 ---------- */
const viewer = () => mySeat();
const myTurn = () => !!st && !st.over && !ui.handoff && !ui.cpuBusy && !ui.pending && st.cur===mySeat() && (!isOnline() || netReady());
function clearSel(){ ui.sel=null; ui.targets=[]; ui.prompt=''; ui.action=null; ui.warn=false; }
function setPrompt(t, warn){ ui.prompt=t; ui.warn=!!warn; }

function onCard(cardId){
  if(!myTurn()) return;
  const p = st.cur, card = Engine.findCard(st, p, cardId); if(!card) return;
  const d = CARDS[card.key];
  if(ui.sel && ui.sel.type==='card' && ui.sel.cardId===cardId){ clearSel(); render(); return; }
  clearSel();
  if(d.kind==='piece'){
    const block = Engine.summonBlock(st, p, cardId);
    if(block) setPrompt(block, true);
    else { ui.sel={type:'card',cardId}; ui.targets=Engine.summonTargets(st,p); setPrompt(st.ambush ? `${d.name}（${d.desc}）を伏兵として出すマスを選んでください（陣以外）` : `${d.name}（${d.desc}）を援軍に出す陣のマスを選んでください`); }
  } else {
    const block = Engine.cmdBlock(st, p, cardId);
    if(block) setPrompt(block, true);
    else if(d.targets){
      ui.sel={type:'card',cardId,picks:[]}; ui.targets=Engine.cmdTargets(st,p,card.key,[]);
      setPrompt(`【${d.name}】${d.desc}　→ ${d.targets[0].label}`);
    } else {
      ui.sel={type:'card',cardId};
      setPrompt(`【${d.name}】${d.desc}`);
      ui.action = {label:'使う', fn:()=>{ clearSel(); dispatch({type:'command', cardId}); afterAction(); }};
    }
  }
  render();
}
function onCell(r, c){
  if(!myTurn()) return;
  const p = st.cur, sel = ui.sel;
  const t = sel && ui.targets.find(t=>t.r===r&&t.c===c);
  if(t){
    if(sel.type==='card'){
      const card = Engine.findCard(st, p, sel.cardId), d = CARDS[card.key];
      if(d.kind==='piece'){ clearSel(); dispatch({type:'summon', cardId:sel.cardId, r, c}); }
      else {
        // 対象を順番に選ぶ（突風は2つ）
        sel.picks.push({r,c});
        const next = d.targets[sel.picks.length];
        if(next){
          ui.targets = Engine.cmdTargets(st, p, card.key, sel.picks);
          setPrompt(`【${d.name}】${next.label}`);
          render(); return;
        }
        clearSel(); dispatch({type:'command', cardId:sel.cardId, picks:sel.picks});
      }
    } else {
      clearSel();
      dispatch({type: t.launch ? 'launch' : 'move', from:{r:sel.r, c:sel.c}, to:{r, c}});
    }
    afterAction(); return;
  }
  const pc = st.board[r][c];
  clearSel();
  if(pc){
    const d = CARDS[pc.type];
    if(pc.owner===p){
      const block = Engine.moveBlock(st, p, r, c);
      if(block) setPrompt(block, true);
      else {
        const ms = Engine.movesFor(st.board,r,c), ls = Engine.launchesFor(st.board,r,c);
        ui.sel={type:'piece',r,c}; ui.targets=[...ms, ...ls];
        if(ms.length && ls.length) setPrompt(`${d.name}：前に1マス、またはオレンジのマスへ歩兵を撃ち出せます`);
        else if(ls.length)        setPrompt(`${d.name}：オレンジのマスへ歩兵を撃ち出せます`);
        else if(ms.length)        setPrompt(`${d.name}（${d.desc}）`);
        else                      setPrompt(`${d.name}：動ける場所がありません`, true);
      }
    } else setPrompt(`相手の${d.name}（${d.desc}）`);
  }
  render();
}
function afterAction(){ render(); if(st && st.over){ const g = st; setTimeout(() => { if(st === g) showResult(); }, 400); } }

/* ---------- 描画 ---------- */
function manaStr(pl){ return '◆'.repeat(pl.mana) + `<span class="off">${'◇'.repeat(Math.max(0,pl.maxMana-pl.mana))}</span>`; }
// 手札・山札の枚数（オンラインでは相手の中身は届かず、枚数だけが届く）
const handCount = pl => pl.handCount ?? pl.hand.length;
const deckCount = pl => pl.deckCount ?? pl.deck.length;
function barHtml(p){
  const pl = st.players[p];
  return `<span class="name">${st.cur===p&&!st.over?'▶ ':''}${escapeHtml(pname(p))}<span class="clock" data-p="${p}">${onlineClockText(p)}</span></span>
    <span class="mana">${manaStr(pl)}</span>
    <span>手札 ${handCount(pl)}　山札 ${deckCount(pl)}</span>`;
}
function render(){
  if(!st) return;
  const v = viewer(), flip = v===1;
  const boardEl = $('#board'); boardEl.innerHTML = '';
  for(let vr=0; vr<ROWS; vr++) for(let vc=0; vc<COLS; vc++){
    const r = flip ? ROWS-1-vr : vr, c = flip ? COLS-1-vc : vc;
    const cell = document.createElement('div'); cell.className = 'cell';
    if(Engine.isJin(r)) cell.classList.add(r===Engine.jinRow(v) ? 'jin-mine' : 'jin-enemy');
    const pc = st.board[r][c];
    const tg = ui.targets.find(t=>t.r===r&&t.c===c);
    if(tg) cell.classList.add(tg.launch ? 'target-launch' : (pc ? 'target-cap' : 'target'));
    if(ui.sel && ui.sel.type==='piece' && ui.targets.some(t=>t.launch && t.fr===r && t.fc===c)) cell.classList.add('launch-src');
    if(ui.sel && ui.sel.type==='piece' && ui.sel.r===r && ui.sel.c===c) cell.classList.add('selected');
    if(ui.sel && ui.sel.picks && ui.sel.picks.some(q=>q.r===r&&q.c===c)) cell.classList.add('selected');
    if(st.last && ((st.last.fr===r&&st.last.fc===c)||(st.last.tr===r&&st.last.tc===c))) cell.classList.add('last');
    if(pc){
      const el = document.createElement('div');
      el.className = 'piece' + (pc.owner!==v ? ' enemy' : ' mine') + (pc.type==='king' ? ' king' : '') + (pc.type==='ryu' ? ' promoted' : '')
                   + (Engine.isBound(st, pc.id) ? ' locked' : '');
      if(Engine.guarded(st.board, r, c)) cell.classList.add('guarded');
      el.textContent = pc.type==='king' && pc.owner===1 ? '玉' : CARDS[pc.type].short;
      cell.appendChild(el);
    }
    cell.onclick = () => onCell(r,c);
    boardEl.appendChild(cell);
  }
  $('#topbar').innerHTML = barHtml(1-v); $('#topbar').classList.toggle('active', st.cur===1-v && !st.over);
  $('#botbar').innerHTML = barHtml(v);   $('#botbar').classList.toggle('active', st.cur===v && !st.over);

  // 手札
  const handEl = $('#hand'); handEl.innerHTML = '';
  const pl = st.players[v];
  pl.hand.forEach(card => {
    const d = CARDS[card.key];
    const usable = myTurn() && st.cur===v && (d.kind==='piece' ? Engine.canSummon(st,v,card.id) : Engine.canCmd(st,v,card.id));
    const el = document.createElement('div');
    el.className = 'card ' + (d.kind==='piece' ? 'piece-card' : 'cmd-card') + (usable ? '' : ' dis')
                 + (ui.sel && ui.sel.type==='card' && ui.sel.cardId===card.id ? ' sel' : '');
    el.innerHTML = `<div class="cost">${d.cost}</div><div class="kanji">${d.short}</div>
      <div class="cname">${d.name}</div><div class="tag">${d.kind==='piece'?'駒':'指令'}</div><div class="cdesc">${d.desc}</div>`;
    el.onclick = () => onCard(card.id);
    handEl.appendChild(el);
  });
  if(!pl.hand.length) handEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px">手札がありません</div>';

  // プロンプト
  const pr = $('#prompt'); pr.innerHTML = '';
  let text = ui.prompt, warn = ui.warn;
  if(!text){
    if(st.over) text = `${pname(st.winner)}の勝ち！`;
    else if(ui.cpuBusy) text = 'CPUが考え中…';
    else if(isOnline() && !netReady()){ text = '接続が切れました。再接続しています…'; warn = true; }
    else if(ui.pending) text = '送信中…';
    else if(isOnline() && st.cur!==match.you) text = `${pname(st.cur)}の番です`;
    else if(myTurn()){
      if(Engine.inCheck(st, st.cur)){ text = '王手されています！'; warn = true; }
      else if(st.movesLeft<=0) text = 'ターン終了を押してください（指令はまだ使えます）';
      else if(st.ambush) text = '伏兵：次に援軍に出す駒は、陣以外の空きマスに出せます';
      else if(st.moved) text = 'もう1回駒を動かせます';
      else text = 'カードで援軍・指令を出すか、駒を動かしましょう';
    }
  }
  const span = document.createElement('span'); span.textContent = text; pr.appendChild(span);
  pr.classList.toggle('warn', !!warn);
  const disc = opponentDisconnectText();
  if(disc){ const d = document.createElement('div'); d.id = 'oppDisc'; d.textContent = disc; pr.appendChild(d); }
  if(ui.action){
    const b = document.createElement('button'); b.className='primary'; b.textContent = ui.action.label; b.onclick = ui.action.fn; pr.appendChild(b);
    const b2 = document.createElement('button'); b2.textContent = 'やめる'; b2.onclick = ()=>{ clearSel(); render(); }; pr.appendChild(b2);
  }
  $('#btnEnd').disabled = !myTurn();
  $('#log').innerHTML = match.log.map((l,i)=>`<div style="opacity:${1-i*.2}">${l}</div>`).join('');
}

/* ---------- 画面 ---------- */
// 画面中央に少しの間だけ出るお知らせ
let toastTimer = null;
function showToast(msg, isError){
  let el = $('#toast');
  if(!el){ el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.innerHTML = `<span class="ic">${isError ? '!' : '✓'}</span><span>${msg}</span>`;
  el.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = isError ? 'err' : ''; }, 1600);
}
function showOverlay(html){ const o=$('#overlay'); o.innerHTML = `<div class="box">${html}</div>`; o.classList.remove('hidden'); }
function hideOverlay(){ $('#overlay').classList.add('hidden'); }
function showTitle(){
  showOverlay(`<h1>Shogi King</h1><p>将棋 × カードバトル</p>
    <div class="btns">
      <button class="primary" id="m1">CPUと対戦（先攻）</button>
      <button class="primary" id="m2">CPUと対戦（後攻）</button>
      <button id="m3">2人で対戦（1台を交代で操作）</button>
      <button class="primary" id="m7">オンライン対戦</button>
      <button id="m6">Myデッキ</button>
      <button id="m4">ルール</button>
    </div>
    <p id="deckNote"></p>`);
  const my = loadMyDeck();
  $('#deckNote').textContent = my && !Engine.deckErrors(my.cards).length ? `使用デッキ：${my.name}` : '使用デッキ：標準デッキ';
  $('#m6').onclick = () => openDeckBuilder();
  $('#m1').onclick = () => newGame('cpu',0);
  $('#m2').onclick = () => newGame('cpu',1);
  $('#m3').onclick = () => newGame('2p',0);
  $('#m4').onclick = () => showRules();
  $('#m7').onclick = () => showOnlineMenu();
}
function showMenu(){
  if(!st){ showTitle(); return; }
  showOverlay(`<h2>メニュー</h2>
    <div class="btns">
      ${!st.over ? '<button class="primary" id="mn1">対局に戻る</button>' : ''}
      <button id="mn2">ルール</button>
      <button id="mn4">BGM・効果音：${sound.on ? 'ON' : 'OFF'}</button>
      ${isOnline() && !st.over ? '<button id="mn5">降参する</button>' : ''}
      <button id="mn3">タイトルに戻る</button>
    </div>`);
  if($('#mn1')) $('#mn1').onclick = hideOverlay;
  $('#mn2').onclick = () => showRules(true);
  $('#mn4').onclick = () => { setSoundOn(!sound.on); showMenu(); };
  $('#mn3').onclick = () => st.over ? toTitle() : confirmTitle();
  if($('#mn5')) $('#mn5').onclick = () => {
    showOverlay(`<h2>降参しますか？</h2><p>この対局は負けになります</p>
      <div class="btns"><button class="primary" id="ry">降参する</button><button id="rn">キャンセル</button></div>`);
    $('#ry').onclick = () => { if(netReady()) net.ws.send(JSON.stringify({ t:'resign' })); hideOverlay(); };
    $('#rn').onclick = showMenu;
  };
}
function confirmTitle(){
  showOverlay(`<h2>タイトルに戻りますか？</h2><p>${isOnline() ? 'オンライン対戦の途中で戻ると、降参（負け）になります' : '今の対局は終了します'}</p>
    <div class="btns"><button class="primary" id="cy">タイトルに戻る</button><button id="cn">キャンセル</button></div>`);
  $('#cy').onclick = toTitle;
  $('#cn').onclick = showMenu;
}
function toTitle(){
  stopBgm();
  if(isOnline() || net.code) leaveOnline();
  st = null; match = null; ui.cpuBusy = false; ui.handoff = false; clearSel();
  $('#board').innerHTML = ''; $('#hand').innerHTML = ''; $('#topbar').innerHTML = ''; $('#botbar').innerHTML = '';
  $('#prompt').innerHTML = ''; $('#log').innerHTML = '';
  showTitle();
}
function showHandoff(){
  ui.handoff = true;
  showOverlay(`<h2>${pname(st.cur)}の番です</h2><p>相手に画面が見えないように交代してください</p>
    <div class="btns"><button class="primary" id="hb">開始</button></div>`);
  $('#hb').onclick = () => { ui.handoff=false; hideOverlay(); render(); };
}
// 決着の理由（オンライン用）
function resultReason(youWin){
  const t = {
    king:       youWin ? '相手の王を討ち取りました' : '王を取られました',
    resign:     youWin ? '相手が降参しました'       : '降参しました',
    timeout:    youWin ? '相手の持ち時間が切れました' : '持ち時間が切れました',
    disconnect: youWin ? '相手の接続が切れたままでした' : '接続が切れたままでした',
  };
  return t[st.reason] || '';
}
function showResult(){
  if(isOnline()){
    const youWin = st.winner === match.you, rm = (net.room && net.room.rematch) || [false,false];
    const opp = net.room && net.room.players[1 - match.you];
    const oppGone = !opp || !opp.connected;
    const status = oppGone ? '相手は退出しました' : rm[match.you] ? '相手の返事を待っています…' : rm[1-match.you] ? `${escapeHtml(pname(1-match.you))}さんが再戦を希望しています` : '';
    showOverlay(`<h1>${youWin ? '勝利！' : '敗北…'}</h1><p>${resultReason(youWin)}</p>
      <p id="rmWait" class="hint">${status}</p>
      <div class="btns"><button class="primary" id="rm" ${rm[match.you] || oppGone ? 'disabled' : ''}>もう一度対戦する</button>
        <button id="rb">タイトルに戻る</button><button id="rb2">盤面を見る</button></div>`);
    $('#rm').onclick = () => { if(netReady()) net.ws.send(JSON.stringify({ t:'rematch' })); };
    $('#rb').onclick = toTitle; $('#rb2').onclick = hideOverlay;
    return;
  }
  const win = match.mode==='cpu' ? (st.winner===0 ? '勝利！' : '敗北…') : `${pname(st.winner)}の勝ち！`;
  showOverlay(`<h1>${win}</h1><p>${pname(st.winner)}が相手の王を討ち取りました</p>
    <div class="btns"><button class="primary" id="rb">タイトルに戻る</button><button id="rb2">盤面を見る</button></div>`);
  $('#rb').onclick = toTitle; $('#rb2').onclick = hideOverlay;
}
function showRules(fromMenu){
  const pieces = Object.entries(CARDS).filter(([k,d])=>d.kind==='piece'&&!d.token).map(([k,d])=>`<li>${d.name}（${d.cost}マナ）${d.desc}</li>`).join('');
  const cmds = Object.entries(CARDS).filter(([k,d])=>d.kind==='cmd').map(([k,d])=>`<li>${d.name}（${d.cost}マナ）${d.desc}</li>`).join('');
  showOverlay(`<h2>ルール</h2><div class="rules">
    <h3>盤面</h3><ul><li>${COLS}×${ROWS}。いちばん手前の行が自分の<b>陣</b></li><li>お互いの王は自分の陣の真ん中からスタート</li><li>陣にもほかのマスと同じように入れる</li></ul>
    <h3>手番</h3><ul><li>①カードを1枚引く</li><li>②マナの範囲で、手札の駒を自分の陣の空いているマスに置く＝<b>援軍</b>（何枚でも）</li>
      <li>③駒を1つ動かす（援軍で出した駒もすぐ動かせる）</li><li>指令カードはマナが足りる限り何枚でも使える</li>
      <li>駒を動かした後は援軍を出せない</li><li>相手の駒が自分の陣にいると、そのマスには援軍を出せない</li></ul>
    <h3>マナ</h3><ul><li>先攻1・後攻2から始まり、毎ターン+1（最大3）</li></ul>
    <h3>駒を倒す</h3><ul><li>動いた先の相手の駒を倒せる。倒した駒は自分の手札に加わる</li><li>成りはなし</li></ul>
    <h3>勝利条件</h3><ul><li>相手の王を取ったら勝ち</li><li>山札が切れても負けにならず、引けないだけ</li></ul>
    <h3>デッキ</h3><ul><li>${CONFIG.DECK_SIZE}枚ちょうど</li><li>同じカードは${CONFIG.MAX_COPIES}枚まで（${Object.keys(CONFIG.LIMITS).map(k=>CARDS[k].name).join('・')}は1枚、歩兵は上限なし）</li><li>タイトルの「Myデッキ」で編集できる</li></ul>
    <h3>駒カード</h3><ul>${pieces}</ul>
    <h3>指令カード</h3><ul>${cmds}</ul>
  </div><div class="btns"><button class="primary" id="rc">閉じる</button></div>`);
  $('#rc').onclick = () => { if(fromMenu) showMenu(); else if(!st || st.over) showTitle(); else if(ui.handoff) showHandoff(); else hideOverlay(); };
}

$('#btnEnd').onclick = () => { if(myTurn()) endTurn(); };
$('#btnMenu').onclick = () => showMenu();
showTitle();
