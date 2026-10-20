const $ = (id) => document.getElementById(id);
const audio = new Audio();
audio.preload = "auto";
audio.preservesPitch = true;

let graphReady = false;
let pitchNode = null;
let seeking = false;

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : m;
  return (h ? h + ":" : "") + mm + ":" + String(sec).padStart(2, "0");
}

function setMsg(text, err = false) {
  $("msg").textContent = text;
  $("msg").className = err ? "err" : "";
}

// Web Audio 그래프는 사용자 제스처 이후 한 번만 만든다 (모바일 autoplay 정책)
async function ensureGraph() {
  if (graphReady) return;
  await Tone.start();
  const ctx = Tone.getContext().rawContext;
  const src = ctx.createMediaElementSource(audio);
  pitchNode = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 }).toDestination();
  Tone.connect(src, pitchNode);
  graphReady = true;
  applyKey();
}

function applyKey() {
  const k = Number($("key").value);
  $("keyVal").textContent = (k > 0 ? "+" : "") + k;
  if (!pitchNode) return;
  pitchNode.pitch = k;
  pitchNode.wet.value = k === 0 ? 0 : 1; // 0이면 원음 그대로
}

function applySpeed() {
  const v = Number($("speed").value);
  audio.playbackRate = v;
  $("speedVal").textContent = v.toFixed(2) + "x";
}

function setKey(v) {
  $("key").value = Math.min(12, Math.max(-12, v));
  applyKey();
}

async function load(url) {
  setMsg("불러오는 중…");
  $("load").disabled = true;
  try {
    const r = await fetch("/api/info?url=" + encodeURIComponent(url));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "불러오기 실패");
    const d = await r.json();
    audio.pause();
    audio.src = "/api/audio/" + d.id;
    audio.load();
    $("thumb").src = d.thumbnail;
    $("title").textContent = d.title;
    $("channel").textContent = d.channel;
    $("seek").max = d.duration || 0;
    $("seek").value = 0;
    $("dur").textContent = fmt(d.duration);
    $("cur").textContent = fmt(0);
    $("player").hidden = false;
    $("play").textContent = "▶";
    applySpeed();
    setMsg("");
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: d.title, artist: d.channel, artwork: [{ src: d.thumbnail }],
      });
    }
  } catch (e) {
    setMsg(e.message, true);
  } finally {
    $("load").disabled = false;
  }
}

async function togglePlay() {
  await ensureGraph();
  if (audio.paused) {
    try { await audio.play(); } catch (e) { setMsg("재생할 수 없습니다: " + e.message, true); }
  } else {
    audio.pause();
  }
}

function seekBy(d) {
  audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + d));
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); load($("url").value); });
$("play").addEventListener("click", togglePlay);
$("back").addEventListener("click", () => seekBy(-10));
$("fwd").addEventListener("click", () => seekBy(10));
$("key").addEventListener("input", applyKey);
$("keyDown").addEventListener("click", () => setKey(Number($("key").value) - 1));
$("keyUp").addEventListener("click", () => setKey(Number($("key").value) + 1));
$("keyReset").addEventListener("click", () => setKey(0));
$("speed").addEventListener("input", applySpeed);

$("seek").addEventListener("input", () => { seeking = true; $("cur").textContent = fmt($("seek").value); });
$("seek").addEventListener("change", () => { audio.currentTime = Number($("seek").value); seeking = false; });

audio.addEventListener("timeupdate", () => {
  if (seeking) return;
  $("seek").value = audio.currentTime;
  $("cur").textContent = fmt(audio.currentTime);
});
audio.addEventListener("play", () => { $("play").textContent = "⏸"; });
audio.addEventListener("pause", () => { $("play").textContent = "▶"; });
audio.addEventListener("ended", () => { $("play").textContent = "▶"; });
audio.addEventListener("waiting", () => setMsg("버퍼링 중…"));
audio.addEventListener("playing", () => setMsg(""));
audio.addEventListener("error", () => setMsg("오디오를 재생하지 못했습니다. 다시 불러와 주세요.", true));

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", togglePlay);
  navigator.mediaSession.setActionHandler("pause", togglePlay);
  navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-10));
  navigator.mediaSession.setActionHandler("seekforward", () => seekBy(10));
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// 공유 시트에서 링크를 넘겨받은 경우 (?url=…)
const shared = new URLSearchParams(location.search).get("url") || new URLSearchParams(location.search).get("text");
if (shared) { $("url").value = shared; load(shared); }
