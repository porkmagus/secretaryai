# Secretary TTS Service

This service provides local text-to-speech using **Orpheus TTS** - a fast, open-source conversational AI voice synthesis model.

## Features

- **Fast**: ~100ms latency with streaming
- **Voice Cloning**: Zero-shot cloning from 3-second samples
- **Emotion Control**: Tags like `<laugh>`, `<sigh>`, `<gasp>`
- **Conversational**: Built for AI agent interactions
- **Free**: Apache 2.0 license, self-hosted

## Defaults

- host: `127.0.0.1`
- port: `5002`
- device: `cpu`
- default voice: `tara`
- sample rate: `24kHz`

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

- `GET /health/live` - Liveness check
- `GET /health/ready` - Readiness check (loads model)
- `GET /voices` - List available preset voices
- `GET /emotions` - List available emotion tags
- `POST /synthesize` - Generate speech

### POST /synthesize

Expects multipart form data with:

- `text` (required) - Text to speak
- `voice` (optional) - Voice ID (default: `tara`)
- `emotion` (optional) - Emotion tag (`laugh`, `sigh`, `gasp`, etc.)
- `speakerWav` (optional) - Audio file for voice cloning

Returns `audio/wav` with headers:
- `X-Secretary-Tts-Model`: `orpheus`
- `X-Secretary-Tts-Voice`: selected voice
- `X-Secretary-Duration-Ms`: audio duration

## Voices

Built-in voices: `tara`, `leah`, `jessica`, `dan`, `alex`, `emma`, `liam`

## Emotion Tags

Orpheus supports inline emotion tags for expressive speech:
- `<laugh>` - Laughter
- `<chuckle>` - Chuckle
- `<sigh>` - Sigh
- `<gasp>` - Gasp
- `<yawn>` - Yawn
- `<cough>` - Cough
- `<groan>` - Groan
- `<sniffle>` - Sniffle

Example: `"<laugh>That's hilarious!"`

## Environment Variables

- `TTS_DEVICE` - `cpu` or `cuda` (default: `cpu`)
- `TTS_MODEL_DIR` - Model cache directory
- `HF_TOKEN` - Hugging Face token (optional, for model download)
