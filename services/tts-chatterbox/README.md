# Secretary TTS Service

This service provides the local Phase 4 text-to-speech path for Secretary using Resemble AI's Chatterbox models.

## Defaults

- host: `127.0.0.1`
- port: `5002`
- device: `cpu`
- default engine: `chatterbox`
- default language: `en`

## Setup

From the repo root:

```powershell
npm run tts:setup
```

Then start it:

```powershell
npm run dev:tts
```

## Endpoints

- `GET /health/live`
- `GET /health/ready`
- `POST /synthesize`

`POST /synthesize` expects multipart form data with:

- `text`
- optional `language`
- optional `engineId`
- optional `speakerWav`

It returns an `audio/wav` file and includes the selected engine plus duration in response headers.
