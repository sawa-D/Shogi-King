/* =====================================================================
   Shogi King オンライン対戦サーバー（Cloudflare Workers + Durable Objects）
   - ルームコード（6桁の数字）ごとに Room（Durable Object）が1つできる
   - Room がルールエンジン（js/engine.js）で審判をし、各プレイヤーには
     見せてよい情報だけ（Engine.viewFor）を WebSocket で送る
   - 持ち時間：1ターン30秒＋各自の持ち時間5分（js/config.js の TURN_SEC・BANK_SEC）
   - 切断：60秒以内に戻らなければ負け（どちらもアラームで判定）
   ===================================================================== */
import { DurableObject } from 'cloudflare:workers';
import Engine from '../../js/engine.js';

const DISCONNECT_MS = 60 * 1000;        // 切断してから負けになるまで
const ROOM_TTL_MS = 30 * 60 * 1000;     // 使われていないルームを片付けるまで

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
const randomInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;

/* ---------- 入口（ルームを作る・ルームにつなぐ） ---------- */
export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if(req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if(url.pathname === '/' || url.pathname === '/health') return json({ ok: true, name: 'shogi-king-server' });

    // ルームを作る → 6桁のルームコードを返す
    if(url.pathname === '/rooms' && req.method === 'POST'){
      for(let i = 0; i < 10; i++){
        const code = String(100000 + randomInt(900000));
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await room.fetch(`https://room/init?code=${code}`, { method: 'POST' });
        if(res.status === 200) return json({ code });
      }
      return json({ error: 'ルームを作れませんでした。もう一度お試しください' }, 503);
    }

    // ルームに WebSocket でつなぐ
    const m = url.pathname.match(/^\/rooms\/(\d{6})\/ws$/);
    if(m){
      if(req.headers.get('Upgrade') !== 'websocket') return json({ error: 'WebSocket で接続してください' }, 426);
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    return json({ error: 'not found' }, 404);
  },
};

/* ---------- ルーム ----------
   保存する内容（this.room）
   { code, status:'waiting'|'playing'|'over', createdAt, expiresAt,
     players:[{ pid, name, deck, connected, discAt }],
     game: エンジンの state（持ち時間 state.clock を含む）, rematch:[bool,bool], seq } */
export class Room extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.room = undefined;
    // テスト用に時間を短くできる（wrangler dev --var TURN_MS:3000 --var BANK_MS:4000 など）。本番は config.js の値
    this.turnMs = Number(env.TURN_MS) || Engine.CONFIG.TURN_SEC * 1000;
    this.bankMs = Number(env.BANK_MS) || Engine.CONFIG.BANK_SEC * 1000;
    this.disconnectMs = Number(env.DISCONNECT_MS) || DISCONNECT_MS;
  }
  async load(){
    if(this.room === undefined) this.room = (await this.ctx.storage.get('room')) || null;
    return this.room;
  }
  async save(){ await this.ctx.storage.put('room', this.room); }

  async fetch(req){
    const url = new URL(req.url);
    await this.load();

    if(url.pathname === '/init'){
      if(this.room) return new Response('exists', { status: 409 });
      this.room = { code: url.searchParams.get('code'), status: 'waiting', createdAt: Date.now(), expiresAt: null,
                    players: [], game: null, rematch: [false, false], seq: 0 };
      await this.save(); await this.schedule();
      return new Response('ok');
    }

    // WebSocket の受け付け（休止しても接続が切れない Hibernation API を使う）
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if(!this.room){
      server.send(JSON.stringify({ t: 'error', code: 'notfound', message: 'ルームが見つかりません。コードを確かめてください' }));
      server.close(4004, 'not found');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ----- メッセージ ----- */
  async webSocketMessage(ws, raw){
    await this.load();
    if(!this.room) return;
    let m; try { m = JSON.parse(raw); } catch(e){ return; }
    if(m.t === 'hello') return this.onHello(ws, m);
    const a = ws.deserializeAttachment() || {};
    if(a.seat === undefined || a.replaced) return this.sendError(ws, '接続をやり直してください');
    switch(m.t){
      case 'ping':    ws.send(JSON.stringify({ t: 'pong', now: Date.now() })); return;
      case 'action':  return this.onAction(ws, a.seat, m.action);
      case 'resign':  return this.onResign(a.seat);
      case 'rematch': return this.onRematch(a.seat);
      case 'leave':   return this.onLeave(ws, a.seat);
    }
  }

  // 名前・端末ID・デッキを受け取って席に着かせる（再接続も同じ）
  async onHello(ws, m){
    const r = this.room;
    const pid = String(m.pid || '').slice(0, 64);
    const name = String(m.name || '').trim().slice(0, 12) || '名無し';
    if(!pid) return this.sendError(ws, '端末IDがありません');
    let seat = r.players.findIndex(p => p.pid === pid);
    if(seat < 0){
      if(r.players.length >= 2 || r.status !== 'waiting'){
        this.sendError(ws, 'このルームは満員です', 'full'); ws.close(4003, 'full'); return;
      }
      const errs = Engine.deckErrors(m.deck);
      if(errs.length){ this.sendError(ws, `デッキが正しくありません：${errs[0]}`, 'deck'); ws.close(4005, 'deck'); return; }
      r.players.push({ pid, name, deck: m.deck, connected: true, discAt: null });
      seat = r.players.length - 1;
    } else {
      Object.assign(r.players[seat], { name, connected: true, discAt: null });
    }
    // 同じ席の古い接続は閉じる（再接続したとき）
    for(const other of this.ctx.getWebSockets()){
      if(other === ws) continue;
      const oa = other.deserializeAttachment() || {};
      if(oa.seat === seat){ other.serializeAttachment({ ...oa, replaced: true }); try { other.close(4000, 'replaced'); } catch(e){} }
    }
    ws.serializeAttachment({ seat });
    let events = [];
    if(r.status === 'waiting' && r.players.length === 2) events = this.startGame();
    await this.save(); await this.schedule();
    this.broadcast(events);
  }

  startGame(){
    const r = this.room;
    const { state, events } = Engine.createGame({
      decks: [r.players[0].deck, r.players[1].deck], first: randomInt(2), seed: randomInt(2 ** 32),
      now: Date.now(), turnMs: this.turnMs, bankMs: this.bankMs,
    });
    Object.assign(r, { game: state, status: 'playing', rematch: [false, false], expiresAt: null });
    return events;
  }
  endGame(){
    Object.assign(this.room, { status: 'over', expiresAt: Date.now() + ROOM_TTL_MS });
  }

  async onAction(ws, seat, action){
    const r = this.room;
    if(r.status !== 'playing') return this.sendError(ws, '対局中ではありません');
    if(!action || typeof action !== 'object' || action.type === 'resign') return this.sendError(ws, '不正な操作です');
    const now = Date.now();
    // アラームより先に操作が届いても、時間切れなら負けを確定させる
    if(Engine.isTimeUp(r.game, now)){
      const ev = Engine.forfeit(r.game, r.game.cur, 'timeout').events;
      this.endGame(); await this.save(); await this.schedule(); this.broadcast(ev); return;
    }
    const res = Engine.apply(r.game, { ...action, p: seat }, now);
    if(!res.ok) return this.sendError(ws, res.error);
    if(r.game.over) this.endGame();
    await this.save(); await this.schedule();
    this.broadcast(res.events);
  }
  async onResign(seat){
    const r = this.room;
    if(r.status !== 'playing') return;
    const res = Engine.apply(r.game, { type: 'resign', p: seat });
    this.endGame();
    await this.save(); await this.schedule();
    this.broadcast(res.events);
  }
  async onRematch(seat){
    const r = this.room;
    if(r.status !== 'over') return;
    r.rematch[seat] = true;
    let events = [];
    if(r.rematch[0] && r.rematch[1] && r.players.every(p => p.connected)) events = this.startGame();
    await this.save(); await this.schedule();
    this.broadcast(events);
  }
  // 自分から抜ける：対局中なら降参、待機中なら席を空ける
  async onLeave(ws, seat){
    const r = this.room;
    ws.serializeAttachment({ seat, replaced: true });
    if(r.status === 'playing') return this.onResign(seat);
    if(r.status === 'waiting'){ r.players.splice(seat, 1); await this.save(); }
    else { r.players[seat].connected = false; r.rematch[seat] = false; await this.save(); this.broadcast([]); }
    try { ws.close(1000, 'leave'); } catch(e){}
  }

  /* ----- 切断 ----- */
  async webSocketClose(ws){ await this.onSocketGone(ws); }
  async webSocketError(ws){ await this.onSocketGone(ws); }
  async onSocketGone(ws){
    await this.load();
    if(!this.room) return;
    const a = ws.deserializeAttachment() || {};
    if(a.seat === undefined || a.replaced) return;
    const live = this.ctx.getWebSockets().some(o => {
      if(o === ws) return false;
      const oa = o.deserializeAttachment() || {};
      return oa.seat === a.seat && !oa.replaced;
    });
    if(live) return;
    const pl = this.room.players[a.seat]; if(!pl) return;
    pl.connected = false; pl.discAt = Date.now();
    await this.save(); await this.schedule();
    this.broadcast([]);
  }

  /* ----- 時間の判定（アラーム） ----- */
  async schedule(){
    const r = this.room;
    if(!r){ await this.ctx.storage.deleteAlarm(); return; }
    const times = [];
    if(r.status === 'playing'){
      times.push(Engine.timeUpAt(r.game));
      for(const p of r.players) if(!p.connected && p.discAt) times.push(p.discAt + this.disconnectMs);
    } else if(r.status === 'waiting') times.push(r.createdAt + ROOM_TTL_MS);
    else if(r.status === 'over') times.push(r.expiresAt);
    const next = Math.min(...times.filter(Number.isFinite));
    if(Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm(){
    await this.load();
    const r = this.room; if(!r) return;
    const now = Date.now();
    if(r.status === 'playing'){
      let events = [];
      r.players.forEach((p, seat) => {
        if(!r.game.over && !p.connected && p.discAt && now >= p.discAt + this.disconnectMs) events = Engine.forfeit(r.game, seat, 'disconnect').events;
      });
      if(Engine.isTimeUp(r.game, now)) events = Engine.forfeit(r.game, r.game.cur, 'timeout').events;
      if(r.game.over){ this.endGame(); await this.save(); this.broadcast(events); }
      await this.schedule();
      return;
    }
    const expired = (r.status === 'waiting' && now >= r.createdAt + ROOM_TTL_MS) || (r.status === 'over' && now >= r.expiresAt);
    if(expired){
      for(const ws of this.ctx.getWebSockets()){
        try { ws.send(JSON.stringify({ t: 'closed', message: 'ルームの有効期限が切れました' })); ws.close(4001, 'expired'); } catch(e){}
      }
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.schedule();
  }

  /* ----- 送信 ----- */
  sendError(ws, message, code){ try { ws.send(JSON.stringify({ t: 'error', message, code })); } catch(e){} }
  summary(seat){
    const r = this.room;
    return {
      code: r.code, status: r.status, you: seat, rematch: r.rematch,
      disconnectLimitMs: this.disconnectMs,
      players: r.players.map(p => ({ name: p.name, connected: p.connected, discAt: p.discAt })),
    };
  }
  broadcast(events){
    const r = this.room;
    r.seq = (r.seq || 0) + 1;
    for(const ws of this.ctx.getWebSockets()){
      const a = ws.deserializeAttachment() || {};
      if(a.seat === undefined || a.replaced) continue;
      const msg = { t: 'state', seq: r.seq, now: Date.now(), room: this.summary(a.seat),
                    view: r.game ? Engine.viewFor(r.game, a.seat) : null, events };
      try { ws.send(JSON.stringify(msg)); } catch(e){}
    }
  }
}
