'use strict';
/* BGMと効果音 */
const SOUND = {
  BGM_GAME: 'bgm/bgm1.mp3',              // 対局中のBGM
  SE_MOVE:  '効果音/将棋・駒を指す03.mp3',  // 駒を動かした音
  BGM_VOLUME: 0.35,
  SE_VOLUME: 0.9,
};
const SOUND_KEY = 'shogiking.sound.v1';

const sound = {
  on: (() => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch(e){ return true; } })(),
  bgm: null,      // 対局BGM（<audio>）
  ctx: null,      // 効果音用（Web Audio：スマホでも遅れずに鳴る）
  buffers: {},
  fallback: {},   // Web Audio が使えないとき（PCでファイルを直接開いたとき）の <audio>
};

// 最初のタップのときに呼ぶ（スマホは、タップしたときしか音を鳴らし始められないため）
function soundUnlock(){
  if(!sound.ctx && location.protocol !== 'file:' && (window.AudioContext || window.webkitAudioContext)){
    try {
      sound.ctx = new (window.AudioContext || window.webkitAudioContext)();
      loadSe('move', SOUND.SE_MOVE);
    } catch(e){ sound.ctx = null; }
  }
  if(sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume().catch(()=>{});
}
async function loadSe(name, path){
  try {
    const res = await fetch(encodeURI(path));
    const buf = await res.arrayBuffer();
    sound.buffers[name] = await new Promise((ok, ng) => sound.ctx.decodeAudioData(buf, ok, ng));
  } catch(e){ /* 読み込めなければ <audio> で鳴らす */ }
}
function playSe(name){
  if(!sound.on) return;
  const path = { move: SOUND.SE_MOVE }[name];
  if(sound.ctx && sound.buffers[name]){
    const src = sound.ctx.createBufferSource(), gain = sound.ctx.createGain();
    gain.gain.value = SOUND.SE_VOLUME;
    src.buffer = sound.buffers[name];
    src.connect(gain).connect(sound.ctx.destination);
    src.start();
    return;
  }
  // 予備：<audio> を複製して鳴らす（連続で鳴っても途切れないように）
  if(!sound.fallback[name]){ const a = new Audio(encodeURI(path)); a.preload = 'auto'; sound.fallback[name] = a; }
  const a = sound.fallback[name].cloneNode();
  a.volume = SOUND.SE_VOLUME;
  a.play().catch(()=>{});
}

function startBgm(){
  if(!sound.bgm){
    sound.bgm = new Audio(encodeURI(SOUND.BGM_GAME));
    sound.bgm.loop = true;
    sound.bgm.volume = SOUND.BGM_VOLUME;
  }
  if(!sound.on) return;
  sound.bgm.currentTime = 0;
  sound.bgm.play().catch(()=>{});
}
function stopBgm(){ if(sound.bgm){ sound.bgm.pause(); } }
const bgmPlaying = () => sound.bgm && !sound.bgm.paused;

function setSoundOn(on){
  sound.on = on;
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch(e){}
  if(!on) stopBgm();
  else if(st && !st.over && sound.bgm){ sound.bgm.play().catch(()=>{}); }
  else if(st && !st.over) startBgm();
}

// アプリを裏に回したらBGMを止め、戻ったら再開
document.addEventListener('visibilitychange', () => {
  if(!sound.bgm) return;
  if(document.hidden) sound.bgm.pause();
  else if(sound.on && st && !st.over) sound.bgm.play().catch(()=>{});
});
document.addEventListener('pointerdown', soundUnlock, { capture:true });
