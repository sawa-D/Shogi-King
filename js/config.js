'use strict';
/* カードと数値の設定（ここを書き換えてバランス調整） */
const CONFIG = {
  COLS: 5,            // 盤の列数
  FIELD_ROWS: 5,      // 戦場の行数（この上下に陣が1行ずつ付く）
  HAND_START: 6,      // 初期手札
  MANA_FIRST: 1,      // 先攻の開始マナ
  MANA_SECOND: 2,     // 後攻の開始マナ
  MANA_MAX: 3,        // マナ上限
  DECK_SIZE: 30,       // デッキの枚数（ちょうどこの枚数）
  MAX_COPIES: 3,       // 同じカードの上限枚数
  UNLIMITED: ['fu'],   // 上限なしのカード
  // 標準デッキ（CPUのデッキ／Myデッキ未作成時に使用）
  DECK: { fu:8, kyo:2, kei:2, gin:3, kin:3, kaku:2, hi:2,  shingun:2, hokyu:2, tettai:2, rakurai:2 },
};

const ORTHO = [[1,0],[-1,0],[0,1],[0,-1]];
const DIAG  = [[1,1],[1,-1],[-1,1],[-1,-1]];
// 移動方向は [前方向の量, 横方向の量]（自分から見て）
const CARDS = {
  king:   { name:'王将', short:'王', kind:'piece', cost:0, value:100, step:[...ORTHO,...DIAG], desc:'全方向に1マス' },
  fu:     { name:'歩兵', short:'歩', kind:'piece', cost:1, value:1, step:[[1,0]], desc:'前に1マス' },
  kyo:    { name:'香車', short:'香', kind:'piece', cost:2, value:2, slide:[[1,0]], desc:'前にどこまでも' },
  kei:    { name:'桂馬', short:'桂', kind:'piece', cost:2, value:2, step:[[2,1],[2,-1]], desc:'前方に桂馬跳び' },
  gin:    { name:'銀将', short:'銀', kind:'piece', cost:2, value:3, step:[[1,-1],[1,0],[1,1],[-1,-1],[-1,1]], desc:'前3方向と斜め後ろ' },
  kin:    { name:'金将', short:'金', kind:'piece', cost:2, value:3, step:[[1,-1],[1,0],[1,1],[0,-1],[0,1],[-1,0]], desc:'斜め後ろ以外に1マス' },
  kaku:   { name:'角行', short:'角', kind:'piece', cost:3, value:5, slide:DIAG, desc:'斜めにどこまでも' },
  hi:     { name:'飛車', short:'飛', kind:'piece', cost:3, value:5, slide:ORTHO, desc:'縦横にどこまでも' },
  shingun:{ name:'進軍', short:'進', kind:'cmd', cost:1, desc:'このターン、駒をもう1回動かせる' },
  hokyu:  { name:'補給', short:'補', kind:'cmd', cost:1, desc:'カードを2枚引く' },
  tettai: { name:'撤退', short:'撤', kind:'cmd', cost:1, target:'own',   desc:'自分の駒1つ(王以外)を手札に戻す' },
  rakurai:{ name:'落雷', short:'雷', kind:'cmd', cost:3, target:'enemy', desc:'相手の駒1つ(王以外)を破壊' },
};
