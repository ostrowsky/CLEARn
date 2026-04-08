import { env } from '../../config/env';
import type { SpeechProvider } from '../types';

function toDataUrl(mimeType: string, buffer: ArrayBuffer): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

export const selfHostedSpeechProvider: SpeechProvider = {
  kind: 'selfhosted',
  async speechToText(input) {
    const response = await fetch(`${env.SELF_HOSTED_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Self-hosted STT error: ${response.status}`);
    }

    const json = await response.json();
    return { text: json.text ?? '', provider: 'selfhosted', model: env.LLM_STT_MODEL };
  },
  async textToSpeech(input) {
    const response = await fetch(`${env.SELF_HOSTED_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Self-hosted TTS error: ${response.status}`);
    }

    const audio = await response.arrayBuffer();
    return { audioUrl: toDataUrl('audio/mpeg', audio), provider: 'selfhosted', model: env.LLM_TTS_MODEL };
  },
};
