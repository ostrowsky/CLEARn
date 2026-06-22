import asyncio
import gc
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel


app = FastAPI(title="CLEARn local STT", version="1.0.0")

DEFAULT_MODEL = os.environ.get("LOCAL_STT_MODEL", "base.en")
DEVICE = os.environ.get("LOCAL_STT_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("LOCAL_STT_COMPUTE_TYPE", "int8")
MAX_AUDIO_BYTES = int(os.environ.get("LOCAL_STT_MAX_AUDIO_BYTES", "8000000"))
TRANSCRIBE_CONCURRENCY = max(1, int(os.environ.get("LOCAL_STT_TRANSCRIBE_CONCURRENCY", "1")))
BEAM_SIZE = max(1, int(os.environ.get("LOCAL_STT_BEAM_SIZE", "5")))

_model: Optional[WhisperModel] = None
_model_loaded = False
_transcribe_lock = asyncio.Semaphore(TRANSCRIBE_CONCURRENCY)


def get_model() -> WhisperModel:
    global _model, _model_loaded
    if _model is None:
        _model = WhisperModel(DEFAULT_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
        _model_loaded = True
    return _model


@app.on_event("startup")
def warm_model_on_startup():
    if os.environ.get("LOCAL_STT_WARMUP_ON_STARTUP", "1") == "1":
        get_model()


@app.get("/health")
@app.get("/v1/health")
def health():
    return {
        "ok": True,
        "provider": "selfhosted",
        "model": DEFAULT_MODEL,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "modelLoaded": _model_loaded,
        "maxAudioBytes": MAX_AUDIO_BYTES,
        "transcribeConcurrency": TRANSCRIBE_CONCURRENCY,
        "beamSize": BEAM_SIZE,
    }


@app.post("/v1/warmup")
def warmup():
    get_model()
    return health()


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: Optional[str] = Form(None),
):
    suffix = Path(file.filename or "speech.webm").suffix or ".webm"
    temp_path = ""
    try:
        audio = await file.read()
        if len(audio) > MAX_AUDIO_BYTES:
            return JSONResponse(
                status_code=413,
                content={"error": f"Audio upload is too large. Max size is {MAX_AUDIO_BYTES} bytes."},
            )

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio)
            temp_path = temp_file.name

        async with _transcribe_lock:
            segments, info = get_model().transcribe(
                temp_path,
                language=language or None,
                vad_filter=True,
                beam_size=BEAM_SIZE,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()

        gc.collect()
        return {
            "text": text,
            "model": DEFAULT_MODEL,
            "requestedModel": model or DEFAULT_MODEL,
            "language": getattr(info, "language", language or ""),
            "provider": "selfhosted",
        }
    except Exception as error:
        return JSONResponse(status_code=500, content={"error": str(error)})
    finally:
        if temp_path:
            try:
                os.remove(temp_path)
            except OSError:
                pass


@app.post("/v1/audio/speech")
async def speech_not_configured():
    return JSONResponse(status_code=501, content={"error": "Local TTS is not configured in this STT server."})
