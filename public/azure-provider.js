// Provider boundary. Replace this class to compare STT, translation, or TTS vendors.
export class AzureSpeechProvider {
  constructor(sdk) {
    if (!sdk?.SpeechTranslationConfig || !sdk?.SpeechConfig) throw new Error('Azure Speech SDK did not load. Check internet access.');
    this.sdk = sdk;
  }

  async translateMicrophone({ token, region, source, target }) {
    const sdk = this.sdk;
    const config = sdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    config.speechRecognitionLanguage = source;
    config.addTargetLanguage(target);
    const mic = sdk.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new sdk.TranslationRecognizer(config, mic);
    const started = performance.now();
    try {
      const result = await new Promise((resolve, reject) => {
        recognizer.recognizeOnceAsync(resolve, reject);
      });
      if (result.reason !== sdk.ResultReason.TranslatedSpeech) {
        const detail = sdk.CancellationDetails.fromResult(result);
        throw new Error(detail?.errorDetails || 'No speech recognized. Speak clearly and retry.');
      }
      const translated = result.translations.get(target);
      if (!translated?.trim()) throw new Error('Azure did not return translated text.');
      return { original: result.text, translated, recognitionMs: Math.round(performance.now() - started) };
    } finally {
      recognizer.close();
    }
  }

  async speak({ token, region, text, voice }) {
    const sdk = this.sdk;
    const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
    config.speechSynthesisVoiceName = voice;
    const speaker = sdk.AudioConfig.fromDefaultSpeakerOutput();
    const synthesizer = new sdk.SpeechSynthesizer(config, speaker);
    const started = performance.now();
    try {
      const result = await new Promise((resolve, reject) => synthesizer.speakTextAsync(text, resolve, reject));
      if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
        const detail = sdk.SpeechSynthesisCancellationDetails.fromResult(result);
        throw new Error(detail?.errorDetails || 'Speech synthesis failed.');
      }
      return { synthesisMs: Math.round(performance.now() - started) };
    } finally {
      synthesizer.close();
    }
  }
}
