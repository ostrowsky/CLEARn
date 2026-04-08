import { Platform } from 'react-native';

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

export type PreparedSpeechPayload = {
  audioBase64: string;
  mimeType: string;
};

export const MAX_RECORDING_MS = 10000;
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
export const RECORDER_PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];

export function normalizeMimeType(mimeType: string) {
  const normalized = String(mimeType || '').split(';')[0]?.trim().toLowerCase();
  return normalized || 'application/octet-stream';
}

export function supportsDirectSttMimeType(mimeType: string) {
  return DIRECT_STT_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (Platform.OS !== 'web') {
    return null;
  }

  const speechWindow = globalThis as typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

export function supportsBrowserRecording() {
  if (Platform.OS !== 'web') {
    return false;
  }

  const mediaDevices = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.mediaDevices;
  return Boolean(mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

export function getPreferredRecorderMimeType() {
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read audio data.'));
    reader.readAsDataURL(blob);
  });
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

export async function prepareSpeechPayloadForStt(blob: Blob, mimeType: string): Promise<PreparedSpeechPayload> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (supportsDirectSttMimeType(normalizedMimeType)) {
    return {
      audioBase64: await blobToDataUrl(blob),
      mimeType: normalizedMimeType,
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
