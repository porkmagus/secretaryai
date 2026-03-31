"""
Secretary TTS Service using Orpheus TTS
A fast, local text-to-speech service with voice cloning support.
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
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("secretary-tts")

# Configuration
ROOT = Path(__file__).resolve().parents[2]
SPEECH_RUNTIME = ROOT / "runtime" / "speech"
MODEL_DIR = Path(os.getenv("TTS_MODEL_DIR", SPEECH_RUNTIME / "models" / "tts"))
TMP_DIR = SPEECH_RUNTIME / "tts"
DEVICE = os.getenv("TTS_DEVICE", "cpu").strip().lower() or "cpu"

os.environ.setdefault("HF_HOME", str(MODEL_DIR))
os.environ.setdefault("HF_HUB_CACHE", str(MODEL_DIR / "huggingface"))

# Hugging Face auth from env
hf_token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
if hf_token:
    os.environ.setdefault("HF_TOKEN", hf_token)
    logger.info("HF_TOKEN is set")
else:
    logger.warning("HF_TOKEN not set - Orpheus model download may fail")

app = FastAPI(
    title="Secretary TTS Service",
    version="0.3.0",
    description="Local Orpheus TTS service for Secretary voice replies.",
)

# Model cache
_orpheus_model = None
_tokenizer = None
_snac_model = None
_model_loading = False
_model_error = None

def get_device():
    if DEVICE == "cuda" and torch.cuda.is_available():
        return "cuda"
    return "cpu"

def load_models():
    """Load Orpheus TTS and SNAC models."""
    global _orpheus_model, _tokenizer, _snac_model, _model_loading, _model_error
    
    if _orpheus_model is not None:
        return _orpheus_model, _tokenizer, _snac_model
    
    if _model_loading:
        raise RuntimeError("Model is still loading, please retry shortly")
    
    if _model_error:
        raise _model_error
    
    _model_loading = True
    
    try:
        device = get_device()
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        
        logger.info("Loading Orpheus TTS models on %s...", device)
        
        from transformers import AutoModelForCausalLM, AutoTokenizer
        
        model_name = "canopylabs/orpheus-tts-0.1-finetune-prod"
        
        # Load tokenizer
        logger.info("Loading tokenizer...")
        _tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            cache_dir=str(MODEL_DIR / "huggingface"),
            token=hf_token,
            trust_remote_code=True,
        )
        
        # Load model
        logger.info("Loading Orpheus model (~3GB, may take a few minutes on first run)...")
        dtype = torch.float16 if device == "cuda" else torch.float32
        _orpheus_model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=dtype,
            cache_dir=str(MODEL_DIR / "huggingface"),
            token=hf_token,
            trust_remote_code=True,
        )
        _orpheus_model.to(device)
        _orpheus_model.eval()
        
        # Load SNAC for audio decoding
        logger.info("Loading SNAC audio codec...")
        from snac import SNAC
        _snac_model = SNAC.from_pretrained("hubertsiuzdak/snac_24khz")
        _snac_model.to(device)
        _snac_model.eval()
        
        logger.info("✅ Orpheus TTS ready!")
        
    except Exception as e:
        logger.error("Failed to load models: %s", e)
        _model_error = e
        raise
    finally:
        _model_loading = False
    
    return _orpheus_model, _tokenizer, _snac_model

def extract_snac_tokens(token_ids: list, tokenizer) -> tuple:
    """Extract hierarchical SNAC tokens from Orpheus output."""
    SNAC_OFFSET = 10
    codes_0, codes_1, codes_2 = [], [], []
    
    for token in token_ids:
        token_val = int(token)
        if token_val < SNAC_OFFSET:
            continue
        snac_id = token_val - SNAC_OFFSET
        if len(codes_0) <= len(codes_1) and len(codes_0) <= len(codes_2):
            codes_0.append(snac_id)
        elif len(codes_1) <= len(codes_2):
            codes_1.append(snac_id)
        else:
            codes_2.append(snac_id)
    
    min_len = min(len(codes_0), len(codes_1), len(codes_2))
    if min_len == 0:
        return None, None, None
    
    return codes_0[:min_len], codes_1[:min_len], codes_2[:min_len]

def decode_audio_snac(codes_0, codes_1, codes_2, snac_model, device):
    """Decode SNAC codes to audio waveform."""
    if codes_0 is None or len(codes_0) == 0:
        return torch.zeros(24000)
    
    codes_tensor = torch.tensor([
        codes_0, codes_1, codes_2
    ], dtype=torch.long, device=device).unsqueeze(0)
    
    with torch.no_grad():
        audio = snac_model.decode(codes_tensor)
    
    return audio.squeeze(0).squeeze(0).cpu()

def generate_speech(text: str, voice: str = "tara") -> tuple[np.ndarray, int]:
    """Generate speech from text using Orpheus."""
    model, tokenizer, snac = load_models()
    device = get_device()
    
    prompt = f"<|{voice}|>{text}"
    
    logger.info("Generating speech for: %s", text[:50] + "..." if len(text) > 50 else text)
    
    inputs = tokenizer(prompt, return_tensors="pt")
    input_ids = inputs["input_ids"].to(device)
    
    start_time = time.time()
    
    with torch.no_grad():
        output = model.generate(
            input_ids,
            max_new_tokens=2000,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id,
        )
    
    generated_ids = output[0][input_ids.shape[1]:].tolist()
    codes_0, codes_1, codes_2 = extract_snac_tokens(generated_ids, tokenizer)
    
    if codes_0 is None:
        logger.warning("No audio tokens generated, returning silence")
        audio_np = np.zeros(24000, dtype=np.float32)
    else:
        audio = decode_audio_snac(codes_0, codes_1, codes_2, snac, device)
        audio_np = audio.numpy()
    
    generation_time = time.time() - start_time
    duration_ms = int(len(audio_np) / 24)
    
    logger.info("Generated %dms audio in %.2fs", duration_ms, generation_time)
    
    audio_int16 = (audio_np * 32767).clip(-32768, 32767).astype(np.int16)
    
    return audio_int16, duration_ms

@app.get("/health/live")
def live():
    return {"ok": True, "service": "tts"}

@app.get("/health/ready")
def ready():
    """Ready check - returns ok even if model not loaded yet (lazy loading)."""
    device = get_device()
    status = {
        "ok": True,
        "service": "tts",
        "device": device,
        "engine": "orpheus",
        "defaultVoice": "tara",
        "modelLoaded": _orpheus_model is not None,
        "modelLoading": _model_loading,
        "hfTokenSet": hf_token is not None,
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
        if speakerWav:
            suffix = Path(speakerWav.filename or "speaker.wav").suffix
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=TMP_DIR) as tmp:
                speaker_path = Path(tmp.name)
                import shutil
                shutil.copyfileobj(speakerWav.file, tmp)
            logger.info("Speaker sample saved (cloning not yet implemented)")
        
        if emotion and emotion.lower() in ["laugh", "chuckle", "sigh", "gasp", "yawn", "cough", "groan"]:
            text = f"<{emotion.lower()}>{text}"
        
        selected_voice = voice or engineId or "tara"
        
        audio_data, duration_ms = generate_speech(text, selected_voice)
        
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(audio_data.tobytes())
        
        return Response(
            content=buffer.getvalue(),
            media_type="audio/wav",
            headers={
                "X-Secretary-Tts-Model": "orpheus",
                "X-Secretary-Tts-Voice": selected_voice,
                "X-Secretary-Duration-Ms": str(duration_ms),
            }
        )
        
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Synthesis failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if speaker_path:
            speaker_path.unlink(missing_ok=True)

@app.get("/voices")
def list_voices():
    return {
        "voices": [
            {"id": "tara", "name": "Tara", "gender": "female"},
            {"id": "leah", "name": "Leah", "gender": "female"},
            {"id": "jessica", "name": "Jessica", "gender": "female"},
            {"id": "dan", "name": "Dan", "gender": "male"},
            {"id": "alex", "name": "Alex", "gender": "male"},
            {"id": "emma", "name": "Emma", "gender": "female"},
            {"id": "liam", "name": "Liam", "gender": "male"},
        ]
    }

@app.get("/emotions")
def list_emotions():
    return {
        "emotions": [
            {"tag": "laugh", "desc": "Laughter"},
            {"tag": "chuckle", "desc": "Chuckle"},
            {"tag": "sigh", "desc": "Sigh"},
            {"tag": "gasp", "desc": "Gasp"},
            {"tag": "yawn", "desc": "Yawn"},
            {"tag": "cough", "desc": "Cough"},
            {"tag": "groan", "desc": "Groan"},
        ]
    }
