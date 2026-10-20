# 키 체인저

유튜브 링크를 넣으면 키(음정)와 속도를 바꿔서 들을 수 있는 PWA.
FastAPI + yt-dlp가 오디오 스트림을 중계하고, 브라우저(SoundTouch AudioWorklet)가 실시간으로 피치를 변환한다.

## 로컬 실행
    python -m venv .venv
    .venv\Scripts\pip install -r requirements.txt
    .venv\Scripts\python -m uvicorn app:app --port 8000

## 배포 (Render)
1. 이 폴더를 GitHub 저장소로 올린다.
2. Render > New > Blueprint(또는 Web Service, Docker)로 저장소 연결. `render.yaml`이 설정을 가져간다.
3. 배포 후 안드로이드 Chrome에서 접속 > 메뉴 > "앱 설치"(홈 화면에 추가).
4. 설치 후에는 유튜브 앱의 공유 > "키 체인저"로 링크를 바로 넘길 수 있다.

## 참고
- 유튜브가 데이터센터 IP를 차단하면 재생이 실패할 수 있다. 그 경우 yt-dlp 업데이트(재배포)나 다른 호스팅이 필요하다.
- 무료 플랜은 유휴 시 슬립되어 첫 접속이 30~60초 걸릴 수 있다.
- PWA 설치와 서비스 워커는 HTTPS(또는 localhost)에서만 동작한다.
