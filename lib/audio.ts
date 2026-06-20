// Lightweight WebAudio manager. Singleton, lazily created on first user gesture (browsers block
// AudioContext until then). Loads the small CC0/authored .ogg clips in public/audio and exposes
// footstep / page-turn one-shots plus a looping ambience bed. No per-frame allocation in the hot
// path beyond a BufferSource (which is single-use by spec).

const STEP_FILES = ["/audio/step1.ogg", "/audio/step2.ogg", "/audio/step3.ogg", "/audio/step4.ogg"];
const PAGE_FILE = "/audio/pageturn.ogg";
const AMB_FILE = "/audio/ambience.ogg";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambGain: GainNode | null = null;
let ambSource: AudioBufferSourceNode | null = null;
let started = false;

const buffers: Record<string, AudioBuffer> = {};
const steps: AudioBuffer[] = [];

async function load(url: string): Promise<AudioBuffer | null> {
  if (!ctx) return null;
  if (buffers[url]) return buffers[url];
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    buffers[url] = buf;
    return buf;
  } catch {
    return null; // missing clip shouldn't break the app
  }
}

// Call from a real user gesture (click/keydown). Idempotent. Boots the context, loads clips,
// and starts the looping ambience at a low bed level.
export async function initAudio() {
  if (started) {
    // a suspended context (tab refocus) just needs resuming
    if (ctx && ctx.state === "suspended") void ctx.resume();
    return;
  }
  started = true;
  type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext };
  const AC = window.AudioContext || (window as WithWebkit).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // ambience bus
  ambGain = ctx.createGain();
  ambGain.gain.value = 0;
  ambGain.connect(master);

  const loaded = await Promise.all([...STEP_FILES.map(load), load(PAGE_FILE), load(AMB_FILE)]);
  for (let i = 0; i < STEP_FILES.length; i++) if (loaded[i]) steps.push(loaded[i] as AudioBuffer);

  const amb = buffers[AMB_FILE];
  if (amb && ctx && ambGain) {
    ambSource = ctx.createBufferSource();
    ambSource.buffer = amb;
    ambSource.loop = true;
    ambSource.connect(ambGain);
    ambSource.start();
    // fade the bed in over ~2s
    ambGain.gain.setValueAtTime(0, ctx.currentTime);
    ambGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
  }
}

function playBuffer(buf: AudioBuffer | undefined, gain: number, rate = 1) {
  if (!ctx || !master || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(master);
  src.start();
}

// One footstep — random variant + slight pitch jitter so a walk cycle never sounds robotic.
// `intensity` (0..1) scales volume (sprint louder, crouch softer).
export function playFootstep(intensity = 1) {
  if (!steps.length) return;
  const buf = steps[(Math.random() * steps.length) | 0];
  // Higher base rate lifts the pitch off the bassy "locomotive" thud; jitter keeps it organic.
  const rate = 1.15 + Math.random() * 0.2;
  playBuffer(buf, 0.22 * intensity, rate);
}

export function playPageTurn() {
  playBuffer(buffers[PAGE_FILE], 0.6, 0.95 + Math.random() * 0.1);
}

// Duck the ambience while a book is open (reading) and restore on close.
export function setAmbienceDucked(ducked: boolean) {
  if (!ctx || !ambGain) return;
  const target = ducked ? 0.2 : 0.5;
  ambGain.gain.cancelScheduledValues(ctx.currentTime);
  ambGain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.6);
}
