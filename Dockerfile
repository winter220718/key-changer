FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
# yt-dlp는 유튜브 변경에 맞춰 자주 업데이트되므로 빌드마다 최신 버전을 받는다
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY static ./static
ENV PORT=8000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
