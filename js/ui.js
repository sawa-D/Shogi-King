'use strict';
/* 画面の描画と操作 */
/* ---------- 操作 ---------- */
const viewer = () => st.mode==='2p' ? st.cur : 0;
const myTurn = () => st && !st.over && !ui.handoff && !ui.cpuBusy && (st.mode==='2p' || st.cur===0);
function clearSel(){ ui.sel=null; ui.targets=[]; ui.prompt=''; ui.action=null; ui.warn=false; }
function setPrompt(t, warn){ ui.prompt=t; ui.warn=!!warn; }

function onCard(idx){
  if(!myTurn()) return;
  const p = st.cur, card = st.players[p].hand[idx], d = CARDS[card.key];
  if(ui.sel && ui.sel.type==='card' && ui.sel.idx===idx){ clearSel(); render(); return; }
  clearSel();
  if(d.kind==='piece'){
    if(st.moved) setPrompt('駒を動かした後は援軍を出せません', true);
    else if(d.cost > st.players[p].mana) setPrompt('マナが足りません', true);
    else if(!summonTargets(p).length) setPrompt('陣に空きがありません', true);
    else { ui.sel={type:'card',idx}; ui.targets=summonTargets(p); setPrompt(`${d.name}（${d.desc}）を援軍に出す陣のマスを選んでください`); }
  } else {
    if(d.cost > st.players[p].mana) setPrompt('マナが足りません', true);
    else if(d.targets){
      if(!canCmd(p, idx)) setPrompt(`【${d.name}】対象にできる駒がありません`, true);
      else { ui.sel={type:'card',idx,picks:[]}; ui.targets=cmdTargets(p, card.key, []); setPrompt(`【${d.name}】${d.desc}　→ ${d.targets[0].label}`); }
    } else {
      ui.sel={type:'card',idx};
      setPrompt(`【${d.name}】${d.desc}`);
      ui.action = {label:'使う', fn:()=>{ useCmd(p,idx); clearSel(); afterAction(); }};
    }
  }
  render();
}
function onCell(r, c){
  if(!myTurn()) return;
  const p = st.cur;
  if(ui.sel && ui.targets.some(t=>t.r===r&&t.c===c)){
    if(ui.sel.type==='card'){
      const d = CARDS[st.players[p].hand[ui.sel.idx].key];
      if(d.kind==='piece') summon(p, ui.sel.idx, r, c);
      else {
        // 対象を順番に選ぶ（突風は2つ）
        ui.sel.picks.push({r,c});
        const key = st.players[p].hand[ui.sel.idx].key, next = d.targets[ui.sel.picks.length];
        if(next){
          ui.targets = cmdTargets(p, key, ui.sel.picks);
          setPrompt(`【${d.name}】${next.label}`);
          render(); return;
        }
        useCmd(p, ui.sel.idx, ui.sel.picks);
      }
    } else doMove(p, ui.sel.r, ui.sel.c, r, c);
    clearSel(); afterAction(); return;
  }
  const pc = st.board[r][c];
  clearSel();
  if(pc){
    const d = CARDS[pc.type];
    if(pc.owner===p){
      if(st.movesLeft<=0) setPrompt(`${d.name}：このターンはもう駒を動かせません`, true);
      else if(st.locked.has(pc.id)) setPrompt(`${d.name}：突風で動いたため、このターンは移動できません`, true);
      else {
        const ms = movesFor(st.board,r,c);
        ui.sel={type:'piece',r,c}; ui.targets=ms;
        setPrompt(`${d.name}（${d.desc}）`);
        if(!ms.length) setPrompt(`${d.name}：動ける場所がありません`, true);
      }
    } else setPrompt(`相手の${d.name}（${d.desc}）`);
  }
  render();
}
function afterAction(){ render(); if(st.over){ const g = st; setTimeout(() => { if(st === g) showResult(); }, 400); } }

/* ---------- 描画 ---------- */
function manaStr(pl){ return '◆'.repeat(pl.mana) + `<span class="off">${'◇'.repeat(Math.max(0,pl.maxMana-pl.mana))}</span>`; }
function barHtml(p){
  const pl = st.players[p];
  return `<span class="name">${st.cur===p&&!st.over?'▶ ':''}${pname(p)}</span>
    <span class="mana">${manaStr(pl)}</span>
    <span>手札 ${pl.hand.length}　山札 ${pl.deck.length}</span>`;
}
function render(){
  if(!st) return;
  const v = viewer(), flip = v===1;
  const tset = new Set(ui.targets.map(t=>t.r+','+t.c));
  const boardEl = $('#board'); boardEl.innerHTML = '';
  for(let vr=0; vr<ROWS; vr++) for(let vc=0; vc<COLS; vc++){
    const r = flip ? ROWS-1-vr : vr, c = flip ? COLS-1-vc : vc;
    const cell = document.createElement('div'); cell.className = 'cell';
    if(isJin(r)) cell.classList.add(r===jinRow(v) ? 'jin-mine' : 'jin-enemy');
    const pc = st.board[r][c];
    if(tset.has(r+','+c)) cell.classList.add(pc && ui.sel.type!=='card' ? 'target-cap' : (pc ? 'target-cap' : 'target'));
    if(ui.sel && ui.sel.type==='piece' && ui.sel.r===r && ui.sel.c===c) cell.classList.add('selected');
    if(ui.sel && ui.sel.picks && ui.sel.picks.some(q=>q.r===r&&q.c===c)) cell.classList.add('selected');
    if(st.last && ((st.last.fr===r&&st.last.fc===c)||(st.last.tr===r&&st.last.tc===c))) cell.classList.add('last');
    if(pc){
      const el = document.createElement('div');
      el.className = 'piece' + (pc.owner!==v ? ' enemy' : ' mine') + (pc.type==='king' ? ' king' : '')
                   + (st.locked.has(pc.id) ? ' locked' : '');
      if(guarded(st.board, r, c)) cell.classList.add('guarded');
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
  pl.hand.forEach((card, idx) => {
    const d = CARDS[card.key];
    const usable = myTurn() && st.cur===v && (d.kind==='piece' ? canSummon(v,idx) : canCmd(v,idx));
    const el = document.createElement('div');
    el.className = 'card ' + (d.kind==='piece' ? 'piece-card' : 'cmd-card') + (usable ? '' : ' dis')
                 + (ui.sel && ui.sel.type==='card' && ui.sel.idx===idx ? ' sel' : '');
    el.innerHTML = `<div class="cost">${d.cost}</div><div class="kanji">${d.short}</div>
      <div class="cname">${d.name}</div><div class="tag">${d.kind==='piece'?'駒':'指令'}</div><div class="cdesc">${d.desc}</div>`;
    el.onclick = () => onCard(idx);
    handEl.appendChild(el);
  });
  if(!pl.hand.length) handEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px">手札がありません</div>';

  // プロンプト
  const pr = $('#prompt'); pr.innerHTML = '';
  let text = ui.prompt, warn = ui.warn;
  if(!text){
    if(st.over) text = `${pname(st.winner)}の勝ち！`;
    else if(ui.cpuBusy) text = 'CPUが考え中…';
    else if(myTurn()){
      if(inCheck(st.cur)){ text = '王手されています！'; warn = true; }
      else if(st.movesLeft<=0) text = 'ターン終了を押してください（指令はまだ使えます）';
      else if(st.moved) text = 'もう1回駒を動かせます';
      else text = 'カードで援軍・指令を出すか、駒を動かしましょう';
    }
  }
  const span = document.createElement('span'); span.textContent = text; pr.appendChild(span);
  pr.classList.toggle('warn', !!warn);
  if(ui.action){
    const b = document.createElement('button'); b.className='primary'; b.textContent = ui.action.label; b.onclick = ui.action.fn; pr.appendChild(b);
    const b2 = document.createElement('button'); b2.textContent = 'やめる'; b2.onclick = ()=>{ clearSel(); render(); }; pr.appendChild(b2);
  }
  $('#btnEnd').disabled = !myTurn();
  $('#log').innerHTML = st.log.map((l,i)=>`<div style="opacity:${1-i*.2}">${l}</div>`).join('');
}

/* ---------- 画面 ---------- */
function showOverlay(html){ const o=$('#overlay'); o.innerHTML = `<div class="box">${html}</div>`; o.classList.remove('hidden'); }
function hideOverlay(){ $('#overlay').classList.add('hidden'); }
function showTitle(){
  showOverlay(`<h1>Shogi King</h1><p>将棋 × カードバトル</p>
    <div class="btns">
      <button class="primary" id="m1">CPUと対戦（先攻）</button>
      <button class="primary" id="m2">CPUと対戦（後攻）</button>
      <button id="m3">2人で対戦（1台を交代で操作）</button>
      <button id="m6">Myデッキ</button>
      <button id="m4">ルール</button>
    </div>
    <p id="deckNote"></p>`);
  const my = loadMyDeck();
  $('#deckNote').textContent = my && !deckErrors(my.cards).length ? `使用デッキ：${my.name}` : '使用デッキ：標準デッキ';
  $('#m6').onclick = () => openDeckBuilder();
  $('#m1').onclick = () => newGame('cpu',0);
  $('#m2').onclick = () => newGame('cpu',1);
  $('#m3').onclick = () => newGame('2p',0);
  $('#m4').onclick = () => showRules();
}
function showMenu(){
  if(!st){ showTitle(); return; }
  showOverlay(`<h2>メニュー</h2>
    <div class="btns">
      ${!st.over ? '<button class="primary" id="mn1">対局に戻る</button>' : ''}
      <button id="mn2">ルール</button>
      <button id="mn3">タイトルに戻る</button>
    </div>`);
  if($('#mn1')) $('#mn1').onclick = hideOverlay;
  $('#mn2').onclick = () => showRules(true);
  $('#mn3').onclick = () => st.over ? toTitle() : confirmTitle();
}
function confirmTitle(){
  showOverlay(`<h2>タイトルに戻りますか？</h2><p>今の対局は終了します</p>
    <div class="btns"><button class="primary" id="cy">タイトルに戻る</button><button id="cn">キャンセル</button></div>`);
  $('#cy').onclick = toTitle;
  $('#cn').onclick = showMenu;
}
function toTitle(){
  st = null; ui.cpuBusy = false; ui.handoff = false; clearSel();
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
function showResult(){
  const win = st.mode==='cpu' ? (st.winner===0 ? '勝利！' : '敗北…') : `${pname(st.winner)}の勝ち！`;
  showOverlay(`<h1>${win}</h1><p>${pname(st.winner)}が相手の王を討ち取りました</p>
    <div class="btns"><button class="primary" id="rb">タイトルに戻る</button><button id="rb2">盤面を見る</button></div>`);
  $('#rb').onclick = toTitle; $('#rb2').onclick = hideOverlay;
}
function showRules(fromMenu){
  const pieces = Object.entries(CARDS).filter(([k,d])=>d.kind==='piece'&&k!=='king').map(([k,d])=>`<li>${d.name}（${d.cost}マナ）${d.desc}</li>`).join('');
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
