import test from 'node:test';
import assert from 'node:assert/strict';
import { AzureSpeechProvider } from '../public/azure-provider.js';

test('passes both language pairs to recognition and chooses their corresponding voice', async () => {
  const observations = [];
  const sdk = {
    ResultReason: { TranslatedSpeech: 1, SynthesizingAudioCompleted: 2 },
    SpeechTranslationConfig: { fromAuthorizationToken(token, region) {
      const value = { addTargetLanguage(target) { value.target = target; } };
      observations.push({ token, region, config: value });
      return value;
    } },
    SpeechConfig: { fromAuthorizationToken(token, region) { return { token, region }; } },
    AudioConfig: { fromDefaultMicrophoneInput: () => ({}), fromDefaultSpeakerOutput: () => ({}) },
    TranslationRecognizer: class {
      constructor(config) { this.config = config; }
      recognizeOnceAsync(done) { done({ reason: 1, text: 'React frontend ni .NET API tho integrate chesthanu', translations: new Map([[this.config.target, 'I will integrate the React frontend with the .NET API.']]) }); }
      close() { observations.push('recognizer closed'); }
    },
    SpeechSynthesizer: class {
      constructor(config) { observations.push(config); }
      speakTextAsync(text, done) { observations.push(text); done({ reason: 2 }); }
      close() { observations.push('synthesizer closed'); }
    },
  };
  const provider = new AzureSpeechProvider(sdk);
  const translation = await provider.translateMicrophone({ token: 'token', region: 'centralindia', source: 'te-IN', target: 'en' });
  assert.match(translation.translated, /React frontend with the \.NET API/);
  assert.equal(observations[0].config.speechRecognitionLanguage, 'te-IN');
  assert.equal(observations[0].config.target, 'en');
  await provider.speak({ token: 'token', region: 'centralindia', text: translation.translated, voice: 'en-US-GuyNeural' });
  assert.equal(observations[2].speechSynthesisVoiceName, 'en-US-GuyNeural');
  assert.equal(observations.at(-1), 'synthesizer closed');
});
