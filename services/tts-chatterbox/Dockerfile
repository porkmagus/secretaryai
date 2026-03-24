FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/services/tts-chatterbox

COPY services/tts-chatterbox/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY services/tts-chatterbox/app.py ./app.py

EXPOSE 5002

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5002"]
