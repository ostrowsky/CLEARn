import { env } from '../../config/env';
import type { SpeechProvider } from '../types';

function toDataUrl(mimeType: string, buffer: ArrayBuffer): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

function cleanBase64Audio(value: string) {
  return value.includes(',') ? value.split(',').pop() || '' : value;
}

function decodeAudioBytes(audioBase64: string) {
  return Buffer.from(cleanBase64Audio(audioBase64), 'base64');
}

function getAudioUploadFileName(mimeType: string) {
  const normalized = String(mimeType || '').split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'speech.wav';
    case 'audio/ogg':
    case 'audio/opus':
      return 'speech.ogg';
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return 'speech.m4a';
    case 'audio/aac':
      return 'speech.aac';
    case 'audio/flac':
      return 'speech.flac';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'speech.mp3';
    default:
      return 'speech.webm';
  }
}

async function readSelfHostedSpeechError(response: Response) {
  const details = await response.text().catch(() => '');
  return details ? ` - ${details.slice(0, 300)}` : '';
}

async function fetchSelfHostedSpeech(path: string, init: RequestInit, timeoutMs: number, operation: 'STT' | 'TTS') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${env.SELF_HOSTED_SPEECH_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Self-hosted ${operation} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const selfHostedSpeechProvider: SpeechProvider = {
  kind: 'selfhosted',
  async speechToText(input) {
    const audioBytes = decodeAudioBytes(input.audioBase64);
    const formData = new FormData();
    formData.append('file', new Blob([audioBytes], { type: input.mimeType || 'audio/webm' }), getAudioUploadFileName(input.mimeType));
    formData.append('model', env.SELF_HOSTED_STT_MODEL);
    if (input.language) {
      formData.append('language', input.language);
    }

    const response = await fetchSelfHostedSpeech(
      '/audio/transcriptions',
      {
        method: 'POST',
        body: formData,
      },
      env.SELF_HOSTED_STT_TIMEOUT_MS,
      'STT',
    );

    if (!response.ok) {
      throw new Error(`Self-hosted STT error: ${response.status}${await readSelfHostedSpeechError(response)}`);
    }

    const json = await response.json();
    return { text: json.text ?? '', provider: 'selfhosted', model: env.SELF_HOSTED_STT_MODEL };
  },
  async textToSpeech(input) {
    const response = await fetchSelfHostedSpeech(
      '/audio/speech',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      env.SELF_HOSTED_TTS_TIMEOUT_MS,
      'TTS',
    );

    if (!response.ok) {
      throw new Error(`Self-hosted TTS error: ${response.status}${await readSelfHostedSpeechError(response)}`);
    }

    const audio = await response.arrayBuffer();
    return { audioUrl: toDataUrl('audio/mpeg', audio), provider: 'selfhosted', model: env.LLM_TTS_MODEL };
  },
};
