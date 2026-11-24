// エンジンの動作確認：CPU同士で対局させ、不正な操作が出ないか・状態がJSONで送れるかを調べる
// 使い方：node tests/selfplay.js [対局数]
const E = require('../js/engine.js');
const Cpu = require('../js/cpu.js');

const games = Number(process.argv[2]) || 20;
let failures = 0, finished = 0;
for(let g=0; g<games; g++){
  const { state } = E.createGame({ decks:[E.CONFIG.DECK, E.CONFIG.DECK], first: g%2, seed: 1000+g, now: 0 });
  let steps = 0;
  while(!state.over && steps < 3000){
    const a = Cpu.nextAction(state, state.cur);
    const r = E.apply(state, a, 0);   // 時刻は0で固定（持ち時間を減らさない）
    if(!r.ok){ failures++; console.log('不正な操作:', a, r.error); break; }
    JSON.parse(JSON.stringify(state));
    steps++;
  }
  if(state.over) finished++;
  console.log(`対局${g+1}: ${state.over ? `プレイヤー${state.winner+1}の勝ち` : '決着つかず'}（${state.turn}ターン）`);
}
// 相手の手札・山札・乱数の種が見えないこと
const { state } = E.createGame({ decks:[E.CONFIG.DECK, E.CONFIG.DECK], first:0, seed:5 });
const v = E.viewFor(state, 0);
const hidden = v.players[1].hand.length === 0 && v.players[0].deck.length === 0 && !('seed' in v);
console.log(`\n決着 ${finished}/${games}　不正な操作 ${failures}　情報の隠し ${hidden ? 'OK' : 'NG'}`);
process.exit(failures || !hidden ? 1 : 0);
