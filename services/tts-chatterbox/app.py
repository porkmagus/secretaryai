"""
Secretary TTS Service using Kokoro TTS
Fast, lightweight, open-source text-to-speech service.
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("secretary-tts")

# Configuration
ROOT = Path(__file__).resolve().parents[2]
SPEECH_RUNTIME = ROOT / "runtime" / "speech"
MODEL_DIR = Path(os.getenv("TTS_MODEL_DIR", SPEECH_RUNTIME / "models" / "tts"))
TMP_DIR = SPEECH_RUNTIME / "tts"

MODEL_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Secretary TTS Service",
    version="0.3.0",
    description="Local Kokoro TTS service for Secretary voice replies.",
)

# Model cache
_kokoro = None
_voices = None
_model_loading = False
_model_error = None

def load_model():
    """Load Kokoro TTS model (auto-downloads if needed)."""
    global _kokoro, _voices, _model_loading, _model_error
    
    if _kokoro is not None:
        return _kokoro, _voices
    
    if _model_loading:
        raise RuntimeError("Model is still loading, please retry shortly")
    
    if _model_error:
        raise _model_error
    
    _model_loading = True
    
    try:
        logger.info("Loading Kokoro TTS model...")
        from kokoro_onnx import Kokoro
        
        # Model and voices paths
        model_path = MODEL_DIR / "kokoro-v1.0.onnx"
        voices_path = MODEL_DIR / "voices-v1.0.bin"
        
        # Auto-download if needed
        if not model_path.exists():
            logger.info("Downloading Kokoro model (~80MB)...")
            import urllib.request
            urllib.request.urlretrieve(
                "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
                str(model_path)
            )
            logger.info("Model downloaded!")
        
        if not voices_path.exists():
            logger.info("Downloading Kokoro voices (~28MB)...")
            import urllib.request
            urllib.request.urlretrieve(
                "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
                str(voices_path)
            )
            logger.info("Voices downloaded!")
        
        _kokoro = Kokoro(str(model_path), str(voices_path))
        _voices = _kokoro.get_voices()
        
        logger.info(f"✅ Kokoro TTS ready! Voices: {', '.join(_voices)}")
        
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        _model_error = e
        raise
    finally:
        _model_loading = False
    
    return _kokoro, _voices

def generate_speech(text: str, voice: str = "af") -> tuple[bytes, int, int]:
    """Generate speech from text using Kokoro."""
    kokoro, available_voices = load_model()
    
    # Validate voice
    if voice not in available_voices:
        logger.warning(f"Voice '{voice}' not found, using default 'af_sarah'")
        voice = "af_sarah"
    
    logger.info(f"Generating: {text[:50]}..." if len(text) > 50 else f"Generating: {text}")
    
    start_time = time.time()
    
    # Generate audio
    samples, sample_rate = kokoro.create(text, voice=voice)
    
    # Convert to int16
    audio_int16 = (np.array(samples) * 32767).astype(np.int16)
    
    generation_time = time.time() - start_time
    duration_ms = int(len(samples) / sample_rate * 1000)
    
    logger.info(f"Generated {duration_ms}ms audio in {generation_time:.2f}s")
    
    # Create WAV file
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio_int16.tobytes())
    
    return buffer.getvalue(), duration_ms, sample_rate

@app.get("/health/live")
def live():
    return {"ok": True, "service": "tts"}

@app.get("/health/ready")
def ready():
    """Ready check - returns ok even if model not loaded yet (lazy loading)."""
    status = {
        "ok": True,
        "service": "tts",
        "engine": "kokoro",
        "modelLoaded": _kokoro is not None,
        "modelLoading": _model_loading,
    }
    
    if _model_error:
        status["modelError"] = str(_model_error)
        status["ok"] = False
        raise HTTPException(status_code=503, detail=status)
    
    return status

@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    engineId: str | None = Form(default=None),
    voice: str | None = Form(default=None),
    emotion: str | None = Form(default=None),
    speakerWav: UploadFile | None = File(default=None),
) -> Response:
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    speaker_path = None
    
    try:
        # Note: Kokoro doesn't support voice cloning
        if speakerWav:
            logger.info("Speaker sample provided but Kokoro doesn't support voice cloning")
        
        # Use voice or engineId or default
        selected_voice = voice or engineId or "af_sarah"
        
        # Generate speech
        audio_data, duration_ms, sample_rate = generate_speech(text, selected_voice)
        
        return Response(
            content=audio_data,
            media_type="audio/wav",
            headers={
                "X-Secretary-Tts-Model": "kokoro",
                "X-Secretary-Tts-Voice": selected_voice,
                "X-Secretary-Duration-Ms": str(duration_ms),
            }
        )
        
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Synthesis failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/voices")
def list_voices():
    """List available Kokoro voices."""
    try:
        _, voices = load_model()
        return {
            "voices": [
                {"id": v, "name": v.replace("_", " ").title(), "gender": "female" if v.startswith("f") or v in ["af", "bf"] else "male"}
                for v in voices
            ]
        }
    except Exception:
        return {
            "voices": [
                {"id": "af", "name": "American Female", "gender": "female"},
                {"id": "am", "name": "American Male", "gender": "male"},
                {"id": "bf", "name": "British Female", "gender": "female"},
                {"id": "bm", "name": "British Male", "gender": "male"},
            ]
        }

@app.get("/emotions")
def list_emotions():
    """Kokoro doesn't support emotion tags."""
    return {"emotions": []}
