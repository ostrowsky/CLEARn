import { env } from '../../config/env';
import type { SpeechProvider } from '../types';

function toDataUrl(mimeType: string, buffer: ArrayBuffer): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}


function getAudioUploadFileName(mimeType: string) {
  switch (String(mimeType || '').split(';')[0]?.trim().toLowerCase()) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'speech.wav';
    case 'audio/ogg':
      return 'speech.ogg';
    case 'audio/mp4':
      return 'speech.m4a';
    case 'audio/aac':
      return 'speech.aac';
    case 'audio/flac':
    case 'audio/x-flac':
      return 'speech.flac';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'speech.mp3';
    default:
      return 'speech.webm';
  }
}
export const openAiSpeechProvider: SpeechProvider = {
  kind: 'openai',
  async speechToText(input) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    const formData = new FormData();
    const binary = Buffer.from(input.audioBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    formData.append('file', new Blob([binary], { type: input.mimeType }), getAudioUploadFileName(input.mimeType));
    formData.append('model', env.LLM_STT_MODEL);
    if (input.language) {
      formData.append('language', input.language);
    }

    const response = await fetch(`${env.OPENAI_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT error: ${response.status}`);
    }

    const json = await response.json();
    return { text: json.text ?? '', provider: 'openai', model: env.LLM_STT_MODEL };
  },
  async textToSpeech(input) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    const response = await fetch(`${env.OPENAI_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: env.LLM_TTS_MODEL, input: input.text, voice: input.voice ?? 'alloy' }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS error: ${response.status}`);
    }

    const audio = await response.arrayBuffer();
    return { audioUrl: toDataUrl('audio/mpeg', audio), provider: 'openai', model: env.LLM_TTS_MODEL };
  },
};

