import { env } from '../../config/env';
import { withSpeechProvider } from '../../providers/providerRegistry';

export class SpeechService {
  speechToText(input: { audioBase64: string; mimeType: string; language?: string }) {
    return withSpeechProvider(env.LLM_STT_PROVIDER, (provider) => provider.speechToText(input));
  }

  textToSpeech(input: { text: string; voice?: string; language?: string }) {
    return withSpeechProvider(env.LLM_TTS_PROVIDER, (provider) => provider.textToSpeech(input));
  }
}
