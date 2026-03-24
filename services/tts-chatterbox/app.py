from __future__ import annotations

import io
import logging
import os
import shutil
import tempfile
from pathlib import Path

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from chatterbox.tts import ChatterboxTTS
from chatterbox.tts_turbo import ChatterboxTurboTTS
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("secretary-tts")

ROOT = Path(__file__).resolve().parents[2]
SPEECH_RUNTIME = ROOT / "runtime" / "speech"
MODEL_DIR = Path(os.getenv("TTS_MODEL_DIR", SPEECH_RUNTIME / "models" / "tts"))
TMP_DIR = SPEECH_RUNTIME / "tts"
DEFAULT_ENGINE = os.getenv("TTS_DEFAULT_ENGINE", "chatterbox")
DEFAULT_LANGUAGE = os.getenv("TTS_DEFAULT_LANGUAGE", "en")
DEVICE = os.getenv("TTS_DEVICE", "cpu").strip().lower() or "cpu"

os.environ.setdefault("HF_HOME", str(MODEL_DIR))
os.environ.setdefault("HF_HUB_CACHE", str(MODEL_DIR / "huggingface"))

app = FastAPI(
    title="Secretary TTS Service",
    version="0.2.0",
    description="CPU-first local Chatterbox TTS service for Secretary voice replies.",
)

_models: dict[str, object] = {}


def resolve_device() -> str:
    if DEVICE == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA requested for TTS but unavailable; falling back to CPU.")
        return "cpu"

    if DEVICE == "mps" and not torch.backends.mps.is_available():
        logger.warning("MPS requested for TTS but unavailable; falling back to CPU.")
        return "cpu"

    return DEVICE


RUNTIME_DEVICE = resolve_device()


def normalize_engine(engine_id: str | None) -> str:
    candidate = (engine_id or DEFAULT_ENGINE).strip().lower()

    if candidate in {"chatterbox", "chatterbox-turbo", "chatterbox-multilingual"}:
        return candidate

    raise HTTPException(
        status_code=400,
        detail=(
            "Unsupported TTS engine. Use chatterbox, chatterbox-turbo, "
            "or chatterbox-multilingual."
        ),
    )


def get_model(engine_id: str):
    model = _models.get(engine_id)

    if model is not None:
        return model

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("Loading TTS engine %s on %s", engine_id, RUNTIME_DEVICE)

    if engine_id == "chatterbox":
        model = ChatterboxTTS.from_pretrained(RUNTIME_DEVICE)
    elif engine_id == "chatterbox-turbo":
        model = ChatterboxTurboTTS.from_pretrained(RUNTIME_DEVICE)
    else:
        model = ChatterboxMultilingualTTS.from_pretrained(torch.device(RUNTIME_DEVICE))

    _models[engine_id] = model
    return model


def render_audio(
    engine_id: str,
    text: str,
    language: str | None,
    speaker_path: Path | None,
):
    model = get_model(engine_id)
    kwargs: dict[str, object] = {}

    if speaker_path is not None:
        kwargs["audio_prompt_path"] = str(speaker_path)

    if engine_id == "chatterbox-multilingual":
        kwargs["language_id"] = (language or DEFAULT_LANGUAGE).strip().lower()
    elif language:
        kwargs["language"] = language.strip().lower()

    if engine_id == "chatterbox-turbo":
        kwargs.pop("language", None)

    try:
        waveform = model.generate(text, **kwargs)
    except TypeError:
        kwargs.pop("language", None)
        waveform = model.generate(text, **kwargs)

    sample_rate = int(getattr(model, "sr", 24000))
    return waveform.detach().cpu(), sample_rate


@app.get("/health/live")
def live() -> dict[str, object]:
    return {
        "ok": True,
        "service": "tts",
    }


@app.get("/health/ready")
def ready() -> dict[str, object]:
    try:
        get_model(DEFAULT_ENGINE)
    except Exception as error:  # pragma: no cover - readiness failure path
        raise HTTPException(status_code=503, detail=str(error)) from error

    return {
        "ok": True,
        "service": "tts",
        "device": RUNTIME_DEVICE,
        "defaultEngine": DEFAULT_ENGINE,
        "defaultLanguage": DEFAULT_LANGUAGE,
    }


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    language: str | None = Form(default=None),
    engineId: str | None = Form(default=None),
    speakerWav: UploadFile | None = File(default=None),
) -> Response:
    normalized_text = text.strip()

    if not normalized_text:
        raise HTTPException(status_code=400, detail="Text is required.")

    engine_id = normalize_engine(engineId)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    speaker_path: Path | None = None

    try:
        if speakerWav is not None:
            suffix = Path(speakerWav.filename or "speaker.wav").suffix or ".wav"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=TMP_DIR) as tmp:
                speaker_path = Path(tmp.name)
                shutil.copyfileobj(speakerWav.file, tmp)

        waveform, sample_rate = render_audio(
            engine_id=engine_id,
            text=normalized_text,
            language=language,
            speaker_path=speaker_path,
        )
        duration_ms = int((waveform.shape[-1] / sample_rate) * 1000) if waveform.numel() else 0

        buffer = io.BytesIO()
        ta.save(buffer, waveform, sample_rate, format="wav")

        headers = {
            "X-Secretary-Tts-Model": engine_id,
            "X-Secretary-Duration-Ms": str(duration_ms),
        }

        return Response(content=buffer.getvalue(), media_type="audio/wav", headers=headers)
    except HTTPException:
        raise
    except Exception as error:  # pragma: no cover - service runtime failure path
        logger.exception("Synthesis failed")
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        if speaker_path is not None:
            speaker_path.unlink(missing_ok=True)
