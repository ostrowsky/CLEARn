import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { apiClient } from '../lib/api';
import {
  MAX_RECORDING_MS,
  getPreferredRecorderMimeType,
  getSpeechRecognitionConstructor,
  normalizeMimeType,
  prepareSpeechPayloadForStt,
  supportsBrowserRecording,
  supportsDirectSttMimeType,
} from '../lib/webSpeech';

type UseSpeechDraftOptions = {
  scope: string;
  unsupportedMessage: string;
  emptyTranscriptMessage: string;
  onTranscript: (text: string) => void;
  getLogDetails?: () => Record<string, unknown>;
};

export function useSpeechDraft(options: UseSpeechDraftOptions) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speechRecognitionConstructor = getSpeechRecognitionConstructor();
  const speechRecognitionSupported = Boolean(speechRecognitionConstructor);
  const mediaRecorderSupported = supportsBrowserRecording();
  const preferredRecorderMimeType = getPreferredRecorderMimeType();
  const mediaRecorderSttCompatible = !preferredRecorderMimeType || supportsDirectSttMimeType(preferredRecorderMimeType);
  const shouldPreferSpeechRecognition = speechRecognitionSupported && mediaRecorderSupported && !mediaRecorderSttCompatible;
  const recordingSupported = mediaRecorderSupported || speechRecognitionSupported;

  function log(event: string, details: Record<string, unknown> = {}) {
    void apiClient.logDebug(options.scope, event, {
      platform: Platform.OS,
      ...(options.getLogDetails ? options.getLogDetails() : {}),
      ...details,
    });
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function scheduleRecordingStop(onTimeout: () => void) {
    clearRecordingTimer();
    recordingTimerRef.current = setTimeout(() => {
      recordingTimerRef.current = null;
      log('recording:auto-stop');
      onTimeout();
    }, MAX_RECORDING_MS);
  }

  function stopActiveStream() {
    if (!streamRef.current) {
      return;
    }

    for (const track of streamRef.current.getTracks()) {
      track.stop();
    }
    streamRef.current = null;
  }

  useEffect(() => () => {
    clearRecordingTimer();
    const recognition = recognitionRef.current as any;
    if (recognition?.abort) {
      recognition.abort();
    }
    recognitionRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;
    stopActiveStream();
  }, []);

  async function startRecording() {
    if (!recordingSupported) {
      setSpeechStatus(options.unsupportedMessage);
      log('recording:unsupported');
      return;
    }

    setSpeechStatus('');

    if (mediaRecorderSupported && !shouldPreferSpeechRecognition) {
      try {
        const mediaDevices = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          throw new Error(options.unsupportedMessage);
        }

        const mediaStream = await mediaDevices.getUserMedia({ audio: true });
        const recorder = preferredRecorderMimeType ? new MediaRecorder(mediaStream, { mimeType: preferredRecorderMimeType }) : new MediaRecorder(mediaStream);
        chunksRef.current = [];
        streamRef.current = mediaStream;
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };
        recorder.onstop = async () => {
          clearRecordingTimer();
          setRecording(false);
          setTranscribing(true);
          try {
            const sourceMimeType = normalizeMimeType(recorder.mimeType || preferredRecorderMimeType || 'audio/webm');
            const blob = new Blob(chunksRef.current, { type: sourceMimeType });
            if (!blob.size) {
              setSpeechStatus(options.emptyTranscriptMessage);
              log('transcription:empty', { source: 'media-recorder' });
              return;
            }

            const payload = await prepareSpeechPayloadForStt(blob, sourceMimeType);
            if (payload.mimeType !== sourceMimeType) {
              log('transcription:audio-converted', { from: sourceMimeType, to: payload.mimeType });
            }
            const result = await apiClient.speechToText(payload.audioBase64, payload.mimeType);
            const transcript = String(result.text || '').trim();
            if (!transcript) {
              setSpeechStatus(options.emptyTranscriptMessage);
              log('transcription:empty', { source: 'api' });
              return;
            }

            options.onTranscript(transcript);
            setSpeechStatus('');
            log('transcription:success', { source: 'api', textLength: transcript.length, mimeType: payload.mimeType });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSpeechStatus(message);
            log('transcription:error', { message, source: 'media-recorder' });
          } finally {
            chunksRef.current = [];
            recorderRef.current = null;
            stopActiveStream();
            setTranscribing(false);
          }
        };
        recorder.onerror = () => {
          setSpeechStatus(options.unsupportedMessage);
          setRecording(false);
          setTranscribing(false);
          clearRecordingTimer();
          recorderRef.current = null;
          chunksRef.current = [];
          stopActiveStream();
          log('recording:error', { source: 'media-recorder' });
        };
        recorder.start();
        setRecording(true);
        log('recording:started', { source: 'media-recorder', mimeType: preferredRecorderMimeType || recorder.mimeType || '' });
        scheduleRecordingStop(() => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('recording:fallback-to-speech-recognition', { message });
        if (!speechRecognitionConstructor) {
          setSpeechStatus(message);
          return;
        }
      }
    }

    if (speechRecognitionConstructor) {
      try {
        if (shouldPreferSpeechRecognition) {
          log('recording:prefer-speech-recognition', { mimeType: preferredRecorderMimeType || '' });
        }

        const Recognition = speechRecognitionConstructor as any;
        const recognition = new Recognition();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;
        setRecording(true);
        recognition.onresult = (event: any) => {
          const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
          if (!transcript) {
            setSpeechStatus(options.emptyTranscriptMessage);
            log('transcription:empty', { source: 'speech-recognition' });
            return;
          }

          options.onTranscript(transcript);
          setSpeechStatus('');
          log('transcription:success', { source: 'speech-recognition', textLength: transcript.length });
        };
        recognition.onerror = (event: any) => {
          const reason = String(event?.error || event?.message || '').trim();
          const message = reason ? `Speech recognition error: ${reason}` : options.unsupportedMessage;
          setSpeechStatus(message);
          log('transcription:error', { message, source: 'speech-recognition' });
        };
        recognition.onend = () => {
          clearRecordingTimer();
          setRecording(false);
          setTranscribing(false);
          recognitionRef.current = null;
          log('recording:ended', { source: 'speech-recognition' });
        };
        recognition.start();
        log('recording:started', { source: 'speech-recognition' });
        scheduleRecordingStop(() => recognition.stop());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSpeechStatus(message);
        setRecording(false);
        setTranscribing(false);
        clearRecordingTimer();
        log('recording:error', { message, source: 'speech-recognition' });
      }
    }
  }

  function stopRecording() {
    clearRecordingTimer();
    const recognition = recognitionRef.current as any;
    if (recognition) {
      setTranscribing(true);
      log('recording:manual-stop', { source: 'speech-recognition' });
      recognition.stop();
      return;
    }

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      log('recording:manual-stop', { source: 'media-recorder' });
      recorder.stop();
    }
  }

  return {
    recording,
    transcribing,
    speechStatus,
    recordingSupported,
    startRecording,
    stopRecording,
    clearSpeechStatus: () => setSpeechStatus(''),
  };
}
