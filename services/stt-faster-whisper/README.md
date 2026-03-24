# Secretary STT Service

This service provides the local Phase 4 speech-to-text path for Secretary using `faster-whisper`.

## Defaults

- host: `127.0.0.1`
- port: `5001`
- model size: `base`
- device: `cpu`
- compute type: `int8`

## Setup

From the repo root:

```powershell
npm run stt:setup
```

Then start it:

```powershell
npm run dev:stt
```

## Endpoints

- `GET /health/live`
- `GET /health/ready`
- `POST /transcribe`

`POST /transcribe` expects a multipart upload with a `file` field and returns JSON containing `text` and `durationMs`.

## Environment

- `STT_PORT`
- `STT_MODEL_SIZE`
- `STT_DEVICE`
- `STT_COMPUTE_TYPE`
- `STT_BEAM_SIZE`
- `STT_MODEL_DIR`
