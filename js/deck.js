'use strict';
/* Myデッキ（デッキビルド画面） */
let db = null;   // 編集中のデッキ { name, cards, dirty, msg }

function openDeckBuilder(){
  const my = loadMyDeck();
  const base = my ? my.cards : CONFIG.DECK;
  db = { name: my ? my.name : 'Myデッキ', cards: {}, dirty: false, msg: !my ? 'まだ保存されていません（標準デッキから作成）' : (deckErrors(my.cards).length ? 'ルールが変わったため、このデッキは今のままでは使えません。組み直して保存してください' : '') };
  for(const k of Object.keys(CARDS)) if(k !== 'king') db.cards[k] = base[k] || 0;
  hideOverlay();
  $('#app').classList.add('hidden');
  $('#deckView').classList.remove('hidden');
  renderDeck();
}
function closeDeckBuilder(){
  db = null;
  $('#deckView').classList.add('hidden');
  $('#app').classList.remove('hidden');
  showTitle();
}

function changeCount(k, delta){
  const n = db.cards[k] + delta;
  if(n < 0 || n > cardLimit(k)) return;
  if(delta > 0 && deckTotal(db.cards) >= CONFIG.DECK_SIZE) return;
  db.cards[k] = n; db.dirty = true; db.msg = '';
  renderDeck();
}

function cardRow(k){
  const d = CARDS[k], n = db.cards[k], total = deckTotal(db.cards);
  const lim = cardLimit(k);
  const canAdd = n < lim && total < CONFIG.DECK_SIZE;
  return `<div class="dk-row ${n ? 'in' : ''} ${d.kind==='piece' ? 'piece-card' : 'cmd-card'}">
    <div class="dk-kanji">${d.short}<span class="cost">${d.cost}</span></div>
    <div class="dk-info"><b>${d.name}</b><small>${d.desc}</small><small class="lim">${lim===Infinity ? '上限なし' : `${lim}枚まで`}</small></div>
    <div class="dk-ctrl">
      <button data-k="${k}" data-d="-1" ${n ? '' : 'disabled'} aria-label="${d.name}を減らす">−</button>
      <span class="dk-n">${n}</span>
      <button data-k="${k}" data-d="1" ${canAdd ? '' : 'disabled'} aria-label="${d.name}を増やす">＋</button>
    </div>
  </div>`;
}

function renderDeck(){
  const total = deckTotal(db.cards), errs = deckErrors(db.cards);
  const keys = Object.keys(CARDS).filter(k => k !== 'king');
  const pieces = keys.filter(k => CARDS[k].kind === 'piece'), cmds = keys.filter(k => CARDS[k].kind === 'cmd');
  const sum = ks => ks.reduce((a,k) => a + db.cards[k], 0);
  const costs = [1,2,3].map(c => keys.filter(k => CARDS[k].cost === c).reduce((a,k) => a + db.cards[k], 0));
  const maxC = Math.max(1, ...costs);

  $('#deckView').innerHTML = `
  <div class="dk">
    <div class="dk-head">
      <button id="dkBack">← 戻る</button>
      <input id="dkName" maxlength="16" value="${db.name.replace(/"/g,'&quot;')}" aria-label="デッキ名">
      <span class="dk-count ${total===CONFIG.DECK_SIZE ? 'ok' : 'ng'}">${total}<small>/${CONFIG.DECK_SIZE}</small></span>
    </div>
    <div class="dk-stats">
      <div class="dk-split"><span>駒 <b>${sum(pieces)}</b></span><span>指令 <b>${sum(cmds)}</b></span></div>
      <div class="dk-curve">${costs.map((n,i) => `
        <div class="dk-bar"><span class="lbl">${i+1}マナ</span><span class="track"><span class="fill" style="width:${n/maxC*100}%"></span></span><span class="num">${n}</span></div>`).join('')}
      </div>
    </div>
    <div class="dk-msg ${errs.length ? 'ng' : 'ok'}">${db.msg || (errs.length ? errs.join('<br>') : 'このデッキで対戦できます')}</div>
    <h3 class="dk-h">駒カード</h3>
    ${pieces.map(cardRow).join('')}
    <h3 class="dk-h">指令カード</h3>
    ${cmds.map(cardRow).join('')}
    <div class="dk-foot">
      <button id="dkReset">標準に戻す</button>
      <button id="dkClear">全部外す</button>
      <button id="dkSave" class="primary" ${errs.length ? 'disabled' : ''}>保存</button>
    </div>
  </div>`;

  $('#deckView').querySelectorAll('.dk-ctrl button').forEach(b => b.onclick = () => changeCount(b.dataset.k, +b.dataset.d));
  $('#dkName').oninput = e => { db.name = e.target.value; db.dirty = true; };
  $('#dkBack').onclick = () => db.dirty ? confirmLeaveDeck() : closeDeckBuilder();
  $('#dkReset').onclick = () => { for(const k of keys) db.cards[k] = CONFIG.DECK[k] || 0; db.dirty = true; db.msg = '標準デッキの内容にしました（未保存）'; renderDeck(); };
  $('#dkClear').onclick = () => { for(const k of keys) db.cards[k] = 0; db.dirty = true; db.msg = ''; renderDeck(); };
  $('#dkSave').onclick = () => {
    if(deckErrors(db.cards).length) return;
    const ok = saveMyDeck(db.name.trim() || 'Myデッキ', db.cards);
    db.dirty = !ok; db.msg = ok ? '保存しました' : '保存できませんでした（ブラウザの設定を確認してください）';
    renderDeck();
    showToast(ok ? `「${db.name.trim() || 'Myデッキ'}」を保存しました` : '保存できませんでした', !ok);
  };
}

function confirmLeaveDeck(){
  showOverlay(`<h2>保存せずに戻りますか？</h2><p>変更した内容は失われます</p>
    <div class="btns"><button class="primary" id="dlSave">保存して戻る</button><button id="dlLeave">保存せずに戻る</button><button id="dlCancel">キャンセル</button></div>`);
  const valid = !deckErrors(db.cards).length;
  if(!valid){ $('#dlSave').disabled = true; $('#dlSave').textContent = `保存して戻る（${CONFIG.DECK_SIZE}枚ちょうどで保存できます）`; }
  $('#dlSave').onclick = () => {
    const name = db.name.trim() || 'Myデッキ';
    if(saveMyDeck(name, db.cards)){ closeDeckBuilder(); showToast(`「${name}」を保存しました`); }
    else showToast('保存できませんでした', true);
  };
  $('#dlLeave').onclick = closeDeckBuilder;
  $('#dlCancel').onclick = hideOverlay;
}
