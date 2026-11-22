'use strict';
/* カードと数値の設定（ここを書き換えてバランス調整） */
const CONFIG = {
  COLS: 7,            // 盤の列数（奇数にすると王が真ん中に置ける）
  FIELD_ROWS: 7,      // 戦場の行数（この上下に陣が1行ずつ付く）
  HAND_START: 5,      // 初期手札
  MANA_FIRST: 1,      // 先攻の開始マナ
  MANA_SECOND: 2,     // 後攻の開始マナ
  MANA_MAX: 3,        // マナ上限
  DECK_SIZE: 30,       // デッキの枚数（ちょうどこの枚数）
  MAX_COPIES: 2,       // 同じカードの上限枚数
  LIMITS: { hi:1, kaku:1 },  // カードごとの上限（MAX_COPIESより優先）
  UNLIMITED: ['fu'],   // 上限なしのカード
  // 標準デッキ（CPUのデッキ／Myデッキ未作成時に使用）
  DECK: { fu:16, kyo:2, kin:2, kaku:1, hi:1,  shingun:2, hokyu:2, tettai:2, rakurai:2 },
};

const ORTHO = [[1,0],[-1,0],[0,1],[0,-1]];
const DIAG  = [[1,1],[1,-1],[-1,1],[-1,-1]];
// 移動方向は [前方向の量, 横方向の量]（自分から見て）
const CARDS = {
  king:   { name:'王将', short:'王', kind:'piece', cost:0, value:100, step:[...ORTHO,...DIAG], desc:'全方向に1マス' },
  fu:     { name:'歩兵', short:'歩', kind:'piece', cost:1, value:1, step:[[1,0]], desc:'前に1マス' },
  kyo:    { name:'香車', short:'香', kind:'piece', cost:2, value:2, slide:[[1,0]], desc:'前にどこまでも' },
  kin:    { name:'金将', short:'金', kind:'piece', cost:2, value:3, step:[[1,-1],[1,0],[1,1],[0,-1],[0,1],[-1,0]], desc:'斜め後ろ以外に1マス' },
  kaku:   { name:'角行', short:'角', kind:'piece', cost:3, value:5, slide:DIAG, desc:'斜めにどこまでも' },
  hi:     { name:'飛車', short:'飛', kind:'piece', cost:3, value:5, slide:ORTHO, desc:'縦横にどこまでも' },
  shingun:{ name:'進軍', short:'進', kind:'cmd', cost:1, desc:'このターン、駒をもう1回動かせる' },
  hokyu:  { name:'補給', short:'補', kind:'cmd', cost:1, desc:'カードを2枚引く' },
  tettai: { name:'撤退', short:'撤', kind:'cmd', cost:1, target:'own',   desc:'自分の駒1つ(王以外)を手札に戻す' },
  rakurai:{ name:'落雷', short:'雷', kind:'cmd', cost:3, target:'enemy', desc:'相手の駒1つ(王以外)を破壊' },
};
