import { env } from '../../config/env';
import type { SpeechProvider } from '../types';

function toDataUrl(mimeType: string, buffer: ArrayBuffer): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

function normalizeMimeType(mimeType: string) {
  const normalized = String(mimeType || '').split(';')[0]?.trim().toLowerCase();
  return normalized || 'application/octet-stream';
}

function cleanBase64Audio(audioBase64: string) {
  const normalized = String(audioBase64 || '').trim();
  if (!normalized) {
    return '';
  }

  const dataUrlPrefix = /^data:[^,]+,/i;
  if (dataUrlPrefix.test(normalized)) {
    return normalized.replace(dataUrlPrefix, '');
  }

  return normalized;
}

function decodeAudioBytes(audioBase64: string) {
  return Buffer.from(cleanBase64Audio(audioBase64), 'base64');
}

async function readErrorDetails(response: Response) {
  const text = (await response.text()).trim();
  return text ? ` - ${text.slice(0, 240)}` : '';
}

export const huggingFaceSpeechProvider: SpeechProvider = {
  kind: 'huggingface',
  async speechToText(input) {
    if (!env.HF_TOKEN) {
      throw new Error('HF_TOKEN is not configured.');
    }

    const audioBytes = decodeAudioBytes(input.audioBase64);
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${env.LLM_STT_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HF_TOKEN}`,
        'Content-Type': normalizeMimeType(input.mimeType),
      },
      body: audioBytes,
    });

    if (!response.ok) {
      throw new Error(`Hugging Face STT error: ${response.status}${await readErrorDetails(response)}`);
    }

    const json = await response.json() as { text?: string };
    return { text: json.text ?? '', provider: 'huggingface', model: env.LLM_STT_MODEL };
  },
  async textToSpeech(input) {
    if (!env.HF_TOKEN) {
      throw new Error('HF_TOKEN is not configured.');
    }

    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${env.LLM_TTS_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: input.text }),
    });

    if (!response.ok) {
      throw new Error(`Hugging Face TTS error: ${response.status}${await readErrorDetails(response)}`);
    }

    const audio = await response.arrayBuffer();
    return { audioUrl: toDataUrl('audio/wav', audio), provider: 'huggingface', model: env.LLM_TTS_MODEL };
  },
};
