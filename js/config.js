'use strict';
/* カードと数値の設定（ここを書き換えてバランス調整）
   ブラウザでもサーバー（Node.js）でも読み込めるようにしてある */
var CONFIG = {
  COLS: 5,            // 盤の列数（奇数にすると王が真ん中に置ける）
  ROWS: 5,            // 盤の行数（いちばん手前の行が自分の陣＝援軍を置ける行）
  HAND_START: 4,      // 初期手札
  MANA_FIRST: 1,      // 先攻の開始マナ
  MANA_SECOND: 2,     // 後攻の開始マナ
  MANA_MAX: 3,        // マナ上限
  DECK_SIZE: 20,       // デッキの枚数（ちょうどこの枚数）
  MAX_COPIES: 2,       // 同じカードの上限枚数
  LIMITS: { hi:1, kaku:1 },  // カードごとの上限（MAX_COPIESより優先）
  UNLIMITED: ['fu'],   // 上限なしのカード
  // 標準デッキ（CPUのデッキ／Myデッキ未作成時に使用）
  DECK: { fu:5, bakuhei:1, kyo:1, kin:2, sakimori:2, houhei:2, kaku:1, hi:1,  hokyu:1, tettai:1, rakurai:1, toppu:1, ryuka:1 },
};

var ORTHO = [[1,0],[-1,0],[0,1],[0,-1]];
var DIAG  = [[1,1],[1,-1],[-1,1],[-1,-1]];
// 移動方向は [前方向の量, 横方向の量]（自分から見て）
// token:true はデッキに入れられない駒（王・龍）。base は倒されたときや手札に戻るときの元の駒
var CARDS = {
  king:   { name:'王将', short:'王', kind:'piece', token:true, cost:0, value:100, step:[...ORTHO,...DIAG], desc:'全方向に1マス' },
  fu:     { name:'歩兵', short:'歩', kind:'piece', cost:1, value:1, step:[[1,0]], desc:'前に1マス' },
  bakuhei:{ name:'縛兵', short:'縛', kind:'piece', cost:1, value:1, step:[[1,0]], cantCapture:['fu'], binds:true,
            desc:'前に1マス。この駒を取った駒は次のターン動けない。相手の歩兵は取れない' },
  kyo:    { name:'香車', short:'香', kind:'piece', cost:2, value:2, slide:[[1,0]], desc:'前にどこまでも' },
  kin:    { name:'金将', short:'金', kind:'piece', cost:2, value:3, step:[[1,-1],[1,0],[1,1],[0,-1],[0,1],[-1,0]], desc:'斜め後ろ以外に1マス' },
  sakimori:{ name:'防人', short:'防', kind:'piece', cost:2, value:3, step:ORTHO, desc:'縦横に1マス。自身と周囲8マスの味方は相手の指令を受けない' },
  houhei: { name:'砲兵', short:'砲', kind:'piece', cost:2, value:2, step:[[1,0]], launcher:true,
            desc:'前に1マス。移動の代わりに、前方3マスの歩兵を2マス先へ撃ち出せる（相手の駒を取ったら歩兵は消える）' },
  kaku:   { name:'角行', short:'角', kind:'piece', cost:3, value:5, slide:DIAG, desc:'斜めにどこまでも' },
  hi:     { name:'飛車', short:'飛', kind:'piece', cost:3, value:5, slide:ORTHO, desc:'縦横にどこまでも' },
  ryu:    { name:'龍',   short:'龍', kind:'piece', token:true, base:'hi', cost:3, value:7, slide:ORTHO, step:[...ORTHO,...DIAG], desc:'縦横にどこまでも＋周囲8マス' },
  shingun:{ name:'進軍', short:'進', kind:'cmd', cost:3, desc:'このターン、駒をもう1回動かせる' },
  hokyu:  { name:'補給', short:'補', kind:'cmd', cost:1, desc:'カードを2枚引く' },
  tettai: { name:'撤退', short:'撤', kind:'cmd', cost:1, targets:[{side:'own', label:'手札に戻す自分の駒を選んでください'}], desc:'自分の駒1つ(王以外)を手札に戻す' },
  rakurai:{ name:'落雷', short:'雷', kind:'cmd', cost:3, targets:[{side:'enemy', label:'破壊する相手の駒を選んでください'}], desc:'相手の駒1つ(王以外)を破壊' },
  ryuka:  { name:'龍化', short:'龍', kind:'cmd', cost:1,
            targets:[{side:'own', type:'hi', label:'龍に変える飛車を選んでください'}],
            desc:'盤上の自分の飛車を龍に変える（縦横どこまでも＋周囲8マス）' },
  toppu:  { name:'突風', short:'風', kind:'cmd', cost:1,
            targets:[{side:'enemy', king:true, shift:true, label:'左へ動かす相手の駒を選んでください'},
                     {side:'own',   king:true, shift:true, label:'左へ動かす自分の駒を選んでください'}],
            desc:'相手の駒と自分の駒を1つずつ選び、それぞれ1マス左へ。動かした駒はこのターン移動できない' },
};

if(typeof module === 'object' && module.exports) module.exports = { CONFIG, CARDS };
