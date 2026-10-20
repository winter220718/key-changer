import logging
import re
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).parent
STATIC = BASE / "static"
CACHE_TTL = 30 * 60  # 스트림 URL은 수 시간 유효하지만 여유있게 30분만 캐시
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}

log = logging.getLogger("uvicorn.error")
app = FastAPI()
_cache: dict[str, tuple[float, dict]] = {}


def parse_video_id(url: str) -> str:
    url = url.strip()
    if ID_RE.match(url):
        return url
    u = urlparse(url if "//" in url else "https://" + url)
    if u.hostname not in YT_HOSTS:
        raise HTTPException(400, "유튜브 링크가 아닙니다.")
    if u.hostname == "youtu.be":
        vid = u.path.lstrip("/").split("/")[0]
    elif u.path == "/watch":
        vid = parse_qs(u.query).get("v", [""])[0]
    else:
        parts = [p for p in u.path.split("/") if p]
        vid = parts[1] if len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v") else ""
    if not ID_RE.match(vid):
        raise HTTPException(400, "영상 ID를 찾을 수 없습니다.")
    return vid


def resolve(vid: str) -> dict:
    hit = _cache.get(vid)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    opts = {
        "format": "bestaudio[ext=m4a]/bestaudio",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(422, f"영상을 불러올 수 없습니다: {str(e)[:200]}")
    if info.get("is_live"):
        raise HTTPException(422, "라이브 영상은 지원하지 않습니다.")
    data = {
        "id": vid,
        "title": info.get("title", ""),
        "channel": info.get("uploader", ""),
        "duration": info.get("duration") or 0,
        "thumbnail": info.get("thumbnail", ""),
        "stream_url": info["url"],
        "mime": "audio/mp4" if info.get("ext") == "m4a" else f"audio/{info.get('ext', 'webm')}",
        "headers": info.get("http_headers", {}),
    }
    _cache[vid] = (time.time(), data)
    return data


@app.get("/api/info")
def info(url: str):
    d = resolve(parse_video_id(url))
    return {k: d[k] for k in ("id", "title", "channel", "duration", "thumbnail")}


@app.get("/api/audio/{vid}")
async def audio(vid: str, request: Request):
    if not ID_RE.match(vid):
        raise HTTPException(400, "잘못된 ID")
    client = httpx.AsyncClient(timeout=httpx.Timeout(15, read=60), follow_redirects=True)
    upstream = None
    for attempt in range(2):
        d = resolve(vid)
        headers = dict(d["headers"])
        headers["Range"] = request.headers.get("range", "bytes=0-")
        try:
            upstream = await client.send(client.build_request("GET", d["stream_url"], headers=headers), stream=True)
        except httpx.HTTPError as e:
            log.warning("audio %s attempt %d: %s", vid, attempt, type(e).__name__)
            upstream = None
        else:
            if upstream.status_code < 400:
                break
            log.warning("audio %s attempt %d: upstream %s", vid, attempt, upstream.status_code)
            await upstream.aclose()
            upstream = None
        _cache.pop(vid, None)  # 만료/차단된 URL일 수 있으니 새로 추출해서 재시도
    if upstream is None:
        await client.aclose()
        raise HTTPException(502, "오디오 스트림을 가져오지 못했습니다.")

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    out = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    for h in ("content-length", "content-range"):
        if h in upstream.headers:
            out[h] = upstream.headers[h]
    return StreamingResponse(body(), status_code=upstream.status_code, media_type=d["mime"], headers=out)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/sw.js")
def service_worker():
    # 서비스 워커는 루트 스코프가 필요해서 /static이 아닌 루트에서 제공
    return FileResponse(STATIC / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
