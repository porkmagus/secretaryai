FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/services/stt-faster-whisper

COPY services/stt-faster-whisper/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY services/stt-faster-whisper/app.py ./app.py

EXPOSE 5001

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5001"]
