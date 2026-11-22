'use strict';
/* データの保存（今はブラウザの localStorage。オンライン対戦の段階でDBに切り替える） */
const STORAGE_KEY_DECK = 'shogiking.mydeck.v1';

// 保存形式：{ version:1, name:'Myデッキ', cards:{ fu:6, kin:2, ... }, updatedAt:'ISO日時' }
function loadMyDeck(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DECK);
    if(!raw) return null;
    const d = JSON.parse(raw);
    if(!d || typeof d.cards !== 'object') return null;
    return d;
  } catch(e){ return null; }
}

function saveMyDeck(name, cards){
  const clean = {};
  for(const [k,n] of Object.entries(cards)) if(n > 0) clean[k] = n;
  const d = { version:1, name: name || 'Myデッキ', cards: clean, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(STORAGE_KEY_DECK, JSON.stringify(d)); return true; }
  catch(e){ return false; }
}

function deleteMyDeck(){
  try { localStorage.removeItem(STORAGE_KEY_DECK); } catch(e){}
}
