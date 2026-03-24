from __future__ import annotations

import logging
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("secretary-stt")

ROOT = Path(__file__).resolve().parents[2]
SPEECH_RUNTIME = ROOT / "runtime" / "speech"
MODEL_DIR = Path(os.getenv("STT_MODEL_DIR", SPEECH_RUNTIME / "models"))
TMP_DIR = SPEECH_RUNTIME / "inbound"
MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "base")
DEVICE = os.getenv("STT_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
BEAM_SIZE = int(os.getenv("STT_BEAM_SIZE", "1"))

app = FastAPI(
    title="Secretary STT Service",
    version="0.1.0",
    description="CPU-first local faster-whisper service for Secretary voice intake.",
)
_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model

    if _model is None:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        logger.info(
            "Loading faster-whisper model",
            extra={
                "model_size": MODEL_SIZE,
                "device": DEVICE,
                "compute_type": COMPUTE_TYPE,
                "download_root": str(MODEL_DIR),
            },
        )
        _model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            download_root=str(MODEL_DIR),
        )

    return _model


@app.get("/health/live")
def live() -> dict[str, object]:
    return {
        "ok": True,
        "service": "stt",
    }


@app.get("/health/ready")
def ready() -> dict[str, object]:
    try:
      get_model()
    except Exception as error:  # pragma: no cover - readiness failure path
      raise HTTPException(status_code=503, detail=str(error)) from error

    return {
        "ok": True,
        "service": "stt",
        "modelSize": MODEL_SIZE,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> dict[str, object]:
    suffix = Path(file.filename or "audio.bin").suffix or ".bin"
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    with NamedTemporaryFile(delete=False, suffix=suffix, dir=TMP_DIR) as tmp:
        tmp_path = Path(tmp.name)
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)

    try:
        model = get_model()
        segments_iter, info = model.transcribe(
            str(tmp_path),
            beam_size=BEAM_SIZE,
            language=language or None,
            vad_filter=True,
        )
        segments = list(segments_iter)
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        duration_ms = int(segments[-1].end * 1000) if segments else None

        return {
            "text": text,
            "durationMs": duration_ms,
            "language": info.language,
            "languageProbability": info.language_probability,
            "segments": [
                {
                    "startMs": int(segment.start * 1000),
                    "endMs": int(segment.end * 1000),
                    "text": segment.text.strip(),
                }
                for segment in segments
            ],
        }
    except HTTPException:
        raise
    except Exception as error:  # pragma: no cover - service runtime failure path
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Unable to remove temporary audio file %s", tmp_path)
