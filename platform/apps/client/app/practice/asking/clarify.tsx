import { createElement, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ContentBlock, ContentMaterial } from '@softskills/domain';
import { Screen } from '../../../src/components/Screen';
import { useContent } from '../../../src/hooks/useContent';
import { apiClient, resolveApiUrl } from '../../../src/lib/api';
import {
  fillRuntimeTemplate,
  findFirstBlockByRenderer,
  getNestedString,
  getPracticeScreenConfig,
  getSectionByRoute,
  getUiConfig,
} from '../../../src/lib/contentMeta';
import { tokens } from '../../../src/theme/tokens';

type ClarifyExample = {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  statement: string;
  placeholder: string;
  expectedQuestion: string;
  acceptedAnswers: string[];
};

type FeedbackState = {
  accepted: boolean;
  text: string;
  showExpected: boolean;
};

type BrowserSpeechRecognitionConstructor = new () => {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  onresult?: (event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void;
  onerror?: (event: { error?: string; message?: string }) => void;
  onend?: () => void;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type DecodedAudioBuffer = {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
};

type BrowserAudioContext = {
  decodeAudioData: (
    audioData: ArrayBuffer,
    successCallback?: (buffer: DecodedAudioBuffer) => void,
    errorCallback?: (error: unknown) => void,
  ) => Promise<DecodedAudioBuffer> | void;
  close?: () => Promise<void>;
};

type BrowserAudioContextConstructor = new () => BrowserAudioContext;

type PreparedSpeechPayload = {
  audioBase64: string;
  mimeType: string;
  converted: boolean;
  originalMimeType: string;
};

const MAX_RECORDING_MS = 10000;
const DIRECT_STT_MIME_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/x-flac',
]);
const RECORDER_PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeMimeType(mimeType: string) {
  const normalized = String(mimeType || '').split(';')[0]?.trim().toLowerCase();
  return normalized || 'application/octet-stream';
}

function supportsDirectSttMimeType(mimeType: string) {
  return DIRECT_STT_MIME_TYPES.has(normalizeMimeType(mimeType));
}

function buildClarifyExamples(block: ContentBlock | undefined): ClarifyExample[] {
  return (block?.materials ?? [])
    .filter((material): material is ContentMaterial => material.type === 'audio')
    .map((material) => {
      const meta = asRecord(material.meta);
      return {
        id: material.id,
        title: material.title || asString(meta.statement, material.id),
        description: material.body,
        audioUrl: material.url ? resolveApiUrl(material.url) : '',
        statement: asString(meta.statement),
        placeholder: asString(meta.placeholder),
        expectedQuestion: asString(meta.clarification),
        acceptedAnswers: asStringArray(meta.acceptedAnswers),
      };
    })
    .filter((example) => example.expectedQuestion.trim().length > 0);
}

function BrowserAudioPlayer({ url }: { url: string }) {
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.audioShell}>
      {createElement('audio', { controls: true, preload: 'metadata', src: url, style: webAudioStyle })}
    </View>
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(''));
    reader.readAsDataURL(blob);
  });
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (Platform.OS !== 'web') {
    return null;
  }

  const speechWindow = globalThis as typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function supportsBrowserRecording() {
  if (Platform.OS !== 'web') {
    return false;
  }

  const mediaDevices = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.mediaDevices;
  return Boolean(mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

function getPreferredRecorderMimeType() {
  if (Platform.OS !== 'web' || typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  for (const mimeType of RECORDER_PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return '';
}

function getAudioContextConstructor(): BrowserAudioContextConstructor | null {
  if (Platform.OS !== 'web') {
    return null;
  }

  const audioWindow = globalThis as typeof globalThis & {
    AudioContext?: BrowserAudioContextConstructor;
    webkitAudioContext?: BrowserAudioContextConstructor;
  };

  return audioWindow.AudioContext || audioWindow.webkitAudioContext || null;
}

function writeAsciiString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

async function decodeAudioBuffer(audioContext: BrowserAudioContext, audioData: ArrayBuffer) {
  return await new Promise<DecodedAudioBuffer>((resolve, reject) => {
    let settled = false;
    const finishResolve = (buffer: DecodedAudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(buffer);
      }
    };
    const finishReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || 'Unable to decode audio data.')));
      }
    };

    try {
      const result = audioContext.decodeAudioData(audioData.slice(0), finishResolve, finishReject);
      if (result && typeof (result as Promise<DecodedAudioBuffer>).then === 'function') {
        (result as Promise<DecodedAudioBuffer>).then(finishResolve).catch(finishReject);
      }
    } catch (error) {
      finishReject(error);
    }
  });
}

function encodeAudioBufferToWav(audioBuffer: DecodedAudioBuffer) {
  const bytesPerSample = 2;
  const blockAlign = audioBuffer.numberOfChannels * bytesPerSample;
  const byteRate = audioBuffer.sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) => audioBuffer.getChannelData(channel));

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audioBuffer.numberOfChannels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
      const rawSample = channelData[channelIndex]?.[sampleIndex] ?? 0;
      const normalizedSample = Math.max(-1, Math.min(1, rawSample));
      const pcmSample = normalizedSample < 0 ? normalizedSample * 0x8000 : normalizedSample * 0x7fff;
      view.setInt16(offset, pcmSample, true);
      offset += bytesPerSample;
    }
  }

  return output;
}

async function prepareSpeechPayloadForStt(blob: Blob, mimeType: string): Promise<PreparedSpeechPayload> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (supportsDirectSttMimeType(normalizedMimeType)) {
    return {
      audioBase64: await blobToDataUrl(blob),
      mimeType: normalizedMimeType,
      converted: false,
      originalMimeType: normalizedMimeType,
    };
  }

  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error(`Unsupported recording format: ${normalizedMimeType}. This browser cannot convert audio for speech recognition.`);
  }

  const audioContext = new AudioContextConstructor();
  try {
    const sourceAudio = await blob.arrayBuffer();
    const decodedAudio = await decodeAudioBuffer(audioContext, sourceAudio);
    const wavBuffer = encodeAudioBufferToWav(decodedAudio);
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    return {
      audioBase64: await blobToDataUrl(wavBlob),
      mimeType: 'audio/wav',
      converted: true,
      originalMimeType: normalizedMimeType,
    };
  } finally {
    if (audioContext.close) {
      try {
        await audioContext.close();
      } catch {
      }
    }
  }
}

export default function ClarifyPracticeScreen() {
  const { sectionId, blockId } = useLocalSearchParams<{ sectionId?: string; blockId?: string }>();
  const { content, error } = useContent();
  const ui = getUiConfig(content);
  const practiceConfig = getPracticeScreenConfig(content, 'clarify');
  const sectionRoute = getNestedString(practiceConfig, ['sectionRoute']) || fillRuntimeTemplate(getNestedString(practiceConfig, ['sectionRouteTemplate']), {});
  const blockRenderer = getNestedString(practiceConfig, ['blockRenderer']);
  const section = sectionId
    ? (content?.sections.find((item) => item.id === sectionId) || null)
    : (getSectionByRoute(content, sectionRoute) || null);
  const practiceBlock = blockId
    ? (section?.blocks.find((block) => block.id === blockId) || findFirstBlockByRenderer(content, section || undefined, blockRenderer))
    : findFirstBlockByRenderer(content, section || undefined, blockRenderer);
  const examples = buildClarifyExamples(practiceBlock);
  const [activeExampleId, setActiveExampleId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedbackById, setFeedbackById] = useState<Record<string, FeedbackState>>({});
  const [speechStatusById, setSpeechStatusById] = useState<Record<string, string>>({});
  const [recordingExampleId, setRecordingExampleId] = useState('');
  const [transcribingExampleId, setTranscribingExampleId] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<InstanceType<BrowserSpeechRecognitionConstructor> | null>(null);
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

  const noExamplesText = getNestedString(ui, ['feedback', 'clarifyNoExamples']);
  const missingAudioText = getNestedString(ui, ['feedback', 'clarifyAudioMissing']);
  const recordingUnavailableText = getNestedString(ui, ['feedback', 'speechRecordingUnavailable']);
  const transcribingText = getNestedString(ui, ['feedback', 'speechTranscribing']);
  const emptyTranscriptText = getNestedString(ui, ['feedback', 'speechTranscriptEmpty']);
  const answerRequiredText = getNestedString(ui, ['feedback', 'clarifyAnswerRequired']);
  const yourQuestionLabel = getNestedString(ui, ['labels', 'yourClarifyingQuestion']);
  const expectedAnswerLabel = getNestedString(ui, ['labels', 'expectedAnswer']);
  const startRecordingLabel = getNestedString(ui, ['buttons', 'startRecording']);
  const stopRecordingLabel = getNestedString(ui, ['buttons', 'stopRecording']);
  const checkAnswerLabel = getNestedString(ui, ['buttons', 'checkAnswer']);
  const showExpectedLabel = getNestedString(ui, ['buttons', 'showExpectedAnswer']);
  const openMediaLabel = getNestedString(ui, ['buttons', 'openMedia']);
  const answerPlaceholder = getNestedString(ui, ['placeholders', 'clarifyAnswer']);

  const activeExample = examples.find((example) => example.id === activeExampleId) || examples[0] || null;
  const activeDraft = activeExample ? drafts[activeExample.id] || '' : '';
  const activeAnswerPlaceholder = activeExample?.placeholder || answerPlaceholder;
  const activeFeedback = activeExample ? feedbackById[activeExample.id] : undefined;
  const activeSpeechStatus = activeExample ? speechStatusById[activeExample.id] || '' : '';

  function logAction(event: string, details: Record<string, unknown> = {}) {
    void apiClient.logDebug('clarify', event, {
      sectionId: section?.id || '',
      blockId: practiceBlock?.id || '',
      activeExampleId: activeExample?.id || '',
      platform: Platform.OS,
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
      onTimeout();
    }, MAX_RECORDING_MS);
  }

  useEffect(() => {
    logAction('screen:mount', { examples: examples.length });

    return () => {
      clearRecordingTimer();
      const recognition = recognitionRef.current;
      if (recognition?.abort) {
        recognition.abort();
      }
      recognitionRef.current = null;

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      recorderRef.current = null;

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
      }
      streamRef.current = null;
      logAction('screen:unmount');
    };
  }, []);

  useEffect(() => {
    if (!examples.length) {
      setActiveExampleId('');
      return;
    }

    if (!examples.some((example) => example.id === activeExampleId)) {
      setActiveExampleId(examples[0]?.id || '');
    }
  }, [activeExampleId, examples]);

  useEffect(() => {
    if (activeExampleId) {
      logAction('example:selected', { exampleId: activeExampleId });
    }
  }, [activeExampleId]);

  function setSpeechStatus(exampleId: string, text: string) {
    setSpeechStatusById((current) => ({ ...current, [exampleId]: text }));
    if (text) {
      logAction('speech:status', { exampleId, text });
    }
  }

  function updateDraft(exampleId: string, value: string) {
    setDrafts((current) => ({ ...current, [exampleId]: value }));
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

  async function handleStartRecording() {
    if (!activeExample) {
      return;
    }

    const example = activeExample;
    logAction('recording:start-requested', {
      exampleId: example.id,
      mediaRecorderSupported,
      speechRecognitionSupported,
      preferredRecorderMimeType,
      mediaRecorderSttCompatible,
      shouldPreferSpeechRecognition,
      maxRecordingMs: MAX_RECORDING_MS,
    });

    if (!recordingSupported) {
      setSpeechStatus(example.id, recordingUnavailableText);
      return;
    }

    if (shouldPreferSpeechRecognition) {
      logAction('recording:prefer-speech-recognition', {
        exampleId: example.id,
        preferredRecorderMimeType,
      });
    }

    if (mediaRecorderSupported && !shouldPreferSpeechRecognition) {
      try {
        const mediaDevices = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          throw new Error(recordingUnavailableText);
        }

        const mediaStream = await mediaDevices.getUserMedia({ audio: true });
        const recorder = preferredRecorderMimeType
          ? new MediaRecorder(mediaStream, { mimeType: preferredRecorderMimeType })
          : new MediaRecorder(mediaStream);
        const exampleId = example.id;
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
          setRecordingExampleId('');
          setTranscribingExampleId(exampleId);
          logAction('recording:stopped', { exampleId, mode: 'media-recorder', chunkCount: chunksRef.current.length });

          try {
            const mimeType = normalizeMimeType(recorder.mimeType || preferredRecorderMimeType || 'audio/webm');
            const blob = new Blob(chunksRef.current, { type: mimeType });
            if (!blob.size) {
              setSpeechStatus(exampleId, emptyTranscriptText);
              logAction('transcription:empty-blob', { exampleId, mode: 'media-recorder' });
              return;
            }

            const speechPayload = await prepareSpeechPayloadForStt(blob, mimeType);
            logAction('transcription:start', {
              exampleId,
              mode: 'media-recorder',
              mimeType: speechPayload.mimeType,
              originalMimeType: speechPayload.originalMimeType,
              converted: speechPayload.converted,
              blobSize: blob.size,
            });
            if (speechPayload.converted) {
              logAction('transcription:audio-converted', {
                exampleId,
                fromMimeType: speechPayload.originalMimeType,
                toMimeType: speechPayload.mimeType,
              });
            }
            const result = await apiClient.speechToText(speechPayload.audioBase64, speechPayload.mimeType);
            const transcript = String(result.text || '').trim();
            if (!transcript) {
              setSpeechStatus(exampleId, emptyTranscriptText);
              logAction('transcription:empty-result', { exampleId, mode: 'media-recorder', provider: result.provider, model: result.model });
              return;
            }

            updateDraft(exampleId, transcript);
            setSpeechStatus(exampleId, '');
            logAction('transcription:success', {
              exampleId,
              mode: 'media-recorder',
              provider: result.provider,
              model: result.model,
              transcriptLength: transcript.length,
            });
          } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : String(nextError);
            setSpeechStatus(exampleId, message || recordingUnavailableText);
            logAction('transcription:error', { exampleId, mode: 'media-recorder', message });
          } finally {
            chunksRef.current = [];
            recorderRef.current = null;
            stopActiveStream();
            setTranscribingExampleId('');
          }
        };
        recorder.onerror = (event) => {
          const reason = typeof event === 'object' && event && 'error' in event ? String((event as { error?: unknown }).error || '') : '';
          setSpeechStatus(exampleId, reason || recordingUnavailableText);
          logAction('recording:error', { exampleId, mode: 'media-recorder', reason: reason || recordingUnavailableText });
          clearRecordingTimer();
          setRecordingExampleId('');
          setTranscribingExampleId('');
          recorderRef.current = null;
          chunksRef.current = [];
          stopActiveStream();
        };
        recorder.start();
        setSpeechStatus(exampleId, '');
        setRecordingExampleId(exampleId);
        logAction('recording:started', { exampleId, mode: 'media-recorder', mimeType: preferredRecorderMimeType || recorder.mimeType || '' });
        scheduleRecordingStop(() => {
          logAction('recording:auto-stop', { exampleId, mode: 'media-recorder', maxRecordingMs: MAX_RECORDING_MS });
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        });
        return;
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : String(nextError);
        logAction('recording:fallback', { exampleId: example.id, from: 'media-recorder', to: 'speech-recognition', reason: message || recordingUnavailableText });
        stopActiveStream();
        clearRecordingTimer();
        if (!speechRecognitionConstructor) {
          setSpeechStatus(example.id, message || recordingUnavailableText);
          return;
        }
      }
    }

    if (speechRecognitionConstructor) {
      try {
        const Recognition = speechRecognitionConstructor;
        const recognition = new Recognition();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;
        setSpeechStatus(example.id, '');
        setRecordingExampleId(example.id);
        setTranscribingExampleId('');
        logAction('recording:started', { exampleId: example.id, mode: 'speech-recognition' });

        recognition.onresult = (event) => {
          const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
          if (!transcript) {
            setSpeechStatus(example.id, emptyTranscriptText);
            logAction('transcription:empty-result', { exampleId: example.id, mode: 'speech-recognition' });
            return;
          }

          updateDraft(example.id, transcript);
          setSpeechStatus(example.id, '');
          logAction('transcription:success', { exampleId: example.id, mode: 'speech-recognition', transcriptLength: transcript.length });
        };
        recognition.onerror = (event) => {
          const reason = String(event?.error || event?.message || '').trim();
          const message = reason ? `Speech recognition error: ${reason}` : recordingUnavailableText;
          setSpeechStatus(example.id, message);
          logAction('recording:error', { exampleId: example.id, mode: 'speech-recognition', reason: message });
        };
        recognition.onend = () => {
          clearRecordingTimer();
          setRecordingExampleId('');
          setTranscribingExampleId('');
          recognitionRef.current = null;
          logAction('recording:ended', { exampleId: example.id, mode: 'speech-recognition' });
        };
        recognition.start();
        scheduleRecordingStop(() => {
          logAction('recording:auto-stop', { exampleId: example.id, mode: 'speech-recognition', maxRecordingMs: MAX_RECORDING_MS });
          recognition.stop();
        });
        return;
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : String(nextError);
        setSpeechStatus(example.id, message || recordingUnavailableText);
        setRecordingExampleId('');
        setTranscribingExampleId('');
        clearRecordingTimer();
        logAction('recording:error', { exampleId: example.id, mode: 'speech-recognition', reason: message || recordingUnavailableText });
      }
    }
  }

  function handleStopRecording() {
    clearRecordingTimer();
    const recognition = recognitionRef.current;
    if (recognition) {
      if (recordingExampleId) {
        setTranscribingExampleId(recordingExampleId);
        logAction('recording:manual-stop', { exampleId: recordingExampleId, mode: 'speech-recognition' });
      }
      recognition.stop();
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    if (recorder.state !== 'inactive') {
      logAction('recording:manual-stop', { exampleId: recordingExampleId, mode: 'media-recorder' });
      recorder.stop();
    }
  }

  async function handleCheckAnswer() {
    if (!activeExample) {
      return;
    }

    const userQuestion = activeDraft.trim();
    logAction('answer:check-requested', { exampleId: activeExample.id, hasText: Boolean(userQuestion), textLength: userQuestion.length });
    if (!userQuestion) {
      setFeedbackById((current) => ({
        ...current,
        [activeExample.id]: {
          accepted: false,
          text: answerRequiredText,
          showExpected: false,
        },
      }));
      return;
    }

    try {
      const result = await apiClient.checkClarify({
        userQuestion,
        expectedQuestion: activeExample.expectedQuestion,
        acceptedAnswers: activeExample.acceptedAnswers,
      });
      setFeedbackById((current) => ({
        ...current,
        [activeExample.id]: {
          accepted: result.accepted,
          text: result.feedback,
          showExpected: Boolean(result.accepted),
        },
      }));
      logAction('answer:check-result', { exampleId: activeExample.id, accepted: result.accepted, feedbackLength: result.feedback.length });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setFeedbackById((current) => ({
        ...current,
        [activeExample.id]: {
          accepted: false,
          text: message,
          showExpected: false,
        },
      }));
      logAction('answer:check-error', { exampleId: activeExample.id, message });
    }
  }

  function handleShowExpectedAnswer() {
    if (!activeExample) {
      return;
    }

    logAction('answer:show-expected', { exampleId: activeExample.id });
    setFeedbackById((current) => ({
      ...current,
      [activeExample.id]: {
        accepted: current[activeExample.id]?.accepted || false,
        text: current[activeExample.id]?.text || '',
        showExpected: true,
      },
    }));
  }

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(ui, ['brandTagline'])}
      footerNote={getNestedString(ui, ['footerNote'])}
      eyebrow={section?.eyebrow}
      title={practiceBlock?.title ?? ''}
      subtitle={practiceBlock?.description ?? ''}
      backHref={section ? `/section/${section.id}` : '/sections'}
      backLabel={section?.title ?? getNestedString(ui, ['navigation', 'backToHome'])}
    >
      {!examples.length ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackText}>{noExamplesText}</Text>
        </View>
      ) : (
        <>
          <View style={styles.selectorRow}>
            {examples.map((example) => {
              const selected = example.id === activeExample?.id;
              return (
                <Pressable key={example.id} style={[styles.selectorChip, selected ? styles.selectorChipActive : null]} onPress={() => setActiveExampleId(example.id)}>
                  <Text style={[styles.selectorText, selected ? styles.selectorTextActive : null]}>{example.title}</Text>
                </Pressable>
              );
            })}
          </View>

          {activeExample ? (
            <View style={styles.card}>
              <Text style={styles.exampleTitle}>{activeExample.title}</Text>
              {activeExample.description ? <Text style={styles.description}>{activeExample.description}</Text> : null}

              {activeExample.audioUrl ? (
                <>
                  <BrowserAudioPlayer url={activeExample.audioUrl} />
                  {Platform.OS !== 'web' ? (
                    <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(activeExample.audioUrl)}>
                      <Text style={styles.secondaryText}>{openMediaLabel}</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackText}>{missingAudioText}</Text>
                </View>
              )}

              <View style={styles.inlineActions}>
                <Pressable
                  style={[styles.button, recordingExampleId === activeExample.id || transcribingExampleId === activeExample.id ? styles.buttonDisabled : null]}
                  onPress={() => void handleStartRecording()}
                  disabled={recordingExampleId === activeExample.id || transcribingExampleId === activeExample.id}
                >
                  <Text style={styles.buttonText}>{startRecordingLabel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, recordingExampleId !== activeExample.id ? styles.buttonDisabled : null]}
                  onPress={handleStopRecording}
                  disabled={recordingExampleId !== activeExample.id}
                >
                  <Text style={styles.secondaryText}>{stopRecordingLabel}</Text>
                </Pressable>
              </View>

              {transcribingExampleId === activeExample.id ? (
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeText}>{transcribingText}</Text>
                </View>
              ) : null}
              {activeSpeechStatus ? (
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeText}>{activeSpeechStatus}</Text>
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>{yourQuestionLabel}</Text>
              <TextInput
                value={activeDraft}
                onChangeText={(value) => updateDraft(activeExample.id, value)}
                placeholder={activeAnswerPlaceholder}
                style={[styles.input, styles.inputLarge]}
                multiline
              />

              <View style={styles.inlineActions}>
                <Pressable style={styles.button} onPress={() => void handleCheckAnswer()}>
                  <Text style={styles.buttonText}>{checkAnswerLabel}</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={handleShowExpectedAnswer}>
                  <Text style={styles.secondaryText}>{showExpectedLabel}</Text>
                </Pressable>
              </View>

              {activeFeedback ? (
                <View style={[styles.feedbackCard, activeFeedback.accepted ? styles.feedbackCardSuccess : null]}>
                  <Text style={[styles.feedbackText, activeFeedback.accepted ? styles.feedbackTextSuccess : null]}>{activeFeedback.text}</Text>
                </View>
              ) : null}

              {activeFeedback?.showExpected ? (
                <View style={styles.expectedCard}>
                  <Text style={styles.expectedLabel}>{expectedAnswerLabel}</Text>
                  <Text style={styles.expectedText}>{activeExample.expectedQuestion}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {error ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackText}>{error}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const webAudioStyle = {
  width: '100%',
};

const styles = StyleSheet.create({
  selectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  selectorChip: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  selectorChipActive: {
    borderColor: tokens.colors.accent,
    backgroundColor: '#ffe5ca',
  },
  selectorText: {
    color: tokens.colors.ink,
    fontWeight: '700',
  },
  selectorTextActive: {
    color: tokens.colors.accentDeep,
  },
  card: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  exampleTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  description: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  fieldLabel: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
  input: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    color: tokens.colors.ink,
    minHeight: 52,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  inputLarge: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  button: {
    backgroundColor: tokens.colors.accent,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  secondaryText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  audioShell: {
    width: '100%',
  },
  noticeCard: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: '#fff6ea',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  noticeText: {
    color: tokens.colors.accentDeep,
    lineHeight: 22,
  },
  feedbackCard: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: '#fff1ed',
    borderWidth: 1,
    borderColor: '#f2c5b5',
  },
  feedbackCardSuccess: {
    backgroundColor: 'rgba(232,255,240,0.86)',
    borderColor: 'rgba(32,101,58,0.2)',
  },
  feedbackText: {
    color: tokens.colors.danger,
    lineHeight: 22,
  },
  feedbackTextSuccess: {
    color: tokens.colors.success,
  },
  expectedCard: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.xs,
  },
  expectedLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  expectedText: {
    color: tokens.colors.ink,
    lineHeight: 22,
    fontWeight: '700',
  },
});















