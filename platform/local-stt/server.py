import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel


app = FastAPI(title="SOFTskills local STT", version="1.0.0")

DEFAULT_MODEL = os.environ.get("LOCAL_STT_MODEL", "base.en")
DEVICE = os.environ.get("LOCAL_STT_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("LOCAL_STT_COMPUTE_TYPE", "int8")

_model: Optional[WhisperModel] = None
_model_loaded = False


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
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio)
            temp_path = temp_file.name

        segments, info = get_model().transcribe(
            temp_path,
            language=language or None,
            vad_filter=True,
            beam_size=1,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
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
