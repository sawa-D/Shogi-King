// 対戦サーバーの動作確認（ルーム・対局・再戦・降参・満員・切断・時間切れ）
// 使い方：server フォルダで  npx wrangler dev --var TURN_MS:2000 --var BANK_MS:8000 --var DISCONNECT_MS:4000  を起動してから
//         node tests/server-test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const Cpu = require('../js/cpu.js');
const S = 'http://127.0.0.1:8787';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const deck = E.CONFIG.DECK;

function client(code, pid, name, opts={}){
  const c = { pid, last:null, msgs:[], errors:[] };
  c.open = () => new Promise(res => {
    c.ws = new WebSocket(`ws://127.0.0.1:8787/rooms/${code}/ws`);
    c.ws.onopen = () => { c.ws.send(JSON.stringify({t:'hello', pid, name, deck: opts.deck || deck})); res(); };
    c.ws.onmessage = e => { const m = JSON.parse(e.data); c.msgs.push(m); if(m.t==='state') c.last = m; if(m.t==='error') c.errors.push(m.message); };
    c.ws.onclose = e => { c.closed = e.code; };
  });
  c.send = o => c.ws.send(JSON.stringify(o));
  return c;
}
async function newRoom(){ const r = await fetch(S+'/rooms',{method:'POST'}); return (await r.json()).code; }
const ok = (label, cond) => console.log((cond?'OK  ':'NG  ')+label);

// 1) 2人で最後まで対局（CPUの思考で手を選ぶ）
{
  const code = await newRoom();
  const a = client(code,'pa','あきら'), b = client(code,'pb','ぼたん');
  await a.open(); await sleep(200);
  ok('待機中は盤面なし', a.last && a.last.view===null && a.last.room.status==='waiting');
  await b.open(); await sleep(300);
  ok('2人そろうと開始', a.last.room.status==='playing' && b.last.view);
  ok('相手の手札は見えない', a.last.view.players[1-a.last.room.you].hand.length===0 && a.last.view.players[1-a.last.room.you].handCount>0);
  ok('乱数の種は届かない', !('seed' in a.last.view));
  const cs = [a,b]; let steps=0, errs=0;
  while(steps<2000){
    const st = a.last.view; if(st.over) break;
    const me = cs.find(c=>c.last.room.you===st.cur);
    const action = Cpu.nextAction(me.last.view, st.cur);
    delete action.p;
    const before = a.last.seq;
    me.send({t:'action', action});
    for(let i=0;i<100 && a.last.seq===before && me.errors.length===errs;i++) await sleep(5);
    if(me.errors.length>errs){ errs=me.errors.length; console.log('  error:', me.errors.at(-1)); break; }
    steps++;
  }
  ok(`対局が決着（${steps}手, エラー${errs}件, 勝者 ${a.last.view.winner}, 理由 ${a.last.view.reason}）`, a.last.view.over && b.last.view.over);
  // 相手番に操作するとエラー
  // 再戦
  a.send({t:'rematch'}); await sleep(150);
  ok('片方だけでは再戦しない', a.last.room.status==='over');
  b.send({t:'rematch'}); await sleep(300);
  ok('両方そろうと再戦開始', a.last.room.status==='playing' && a.last.events.some(e=>e.type==='start'));
  const notMe = [a,b].find(c=>c.last.room.you!==c.last.view.cur);
  const ne = notMe.errors.length; notMe.send({t:'action', action:{type:'endTurn'}}); await sleep(150);
  ok('相手の手番に操作するとエラー', notMe.errors.length>ne);
  a.send({t:'resign'}); await sleep(200);
  ok('降参で終了', b.last.view.over && b.last.view.reason==='resign' && b.last.view.winner===b.last.room.you);
  a.ws.close(); b.ws.close();
}
// 2) 3人目は入れない・存在しないコード・不正なデッキ
{
  const code = await newRoom();
  const a = client(code,'p1','A'), b = client(code,'p2','B'), c = client(code,'p3','C');
  await a.open(); await b.open(); await sleep(200); await c.open(); await sleep(300);
  ok('3人目は満員', c.errors.some(e=>e.includes('満員')) && c.closed===4003);
  const x = client('999999','px','X'); await x.open(); await sleep(300);
  ok('存在しないコード', x.errors.some(e=>e.includes('見つかりません')));
  const code2 = await newRoom(); const d = client(code2,'pd','D',{deck:{fu:30}}); await d.open(); await sleep(300);
  ok('不正なデッキは入れない', d.errors.some(e=>e.includes('デッキ')));
  a.ws.close(); b.ws.close();
}
// 3) 切断→時間内に再接続（続きから）／戻らないと負け
{
  const code = await newRoom();
  const a = client(code,'qa','A'), b = client(code,'qb','B');
  await a.open(); await b.open(); await sleep(300);
  a.ws.close(); await sleep(300);
  ok('相手に切断が伝わる', b.last.room.players[a.last.room.you].connected===false);
  const a2 = client(code,'qa','A'); await a2.open(); await sleep(300);
  ok('時間内の再接続で続きから', a2.last.room.status==='playing' && b.last.room.players[a2.last.room.you].connected===true && !a2.last.view.over);
  a2.ws.close(); await sleep(4800);
  ok('戻らなければ切断負け', b.last.view.over && b.last.view.reason==='disconnect' && b.last.view.winner===b.last.room.you);
  b.ws.close();
}
// 4) 持ち時間切れ
{
  const code = await newRoom();
  const a = client(code,'ta','A'), b = client(code,'tb','B');
  await a.open(); await b.open(); await sleep(300);
  const cur = a.last.view.cur;
  await sleep(5000);
  ok('30秒（テストでは2秒）を過ぎると持ち時間が減る', !a.last.view.over);
  await sleep(5800);
  ok('持ち時間切れで負け', a.last.view.over && a.last.view.reason==='timeout' && a.last.view.winner===1-cur);
  a.ws.close(); b.ws.close();
}
process.exit(0);
