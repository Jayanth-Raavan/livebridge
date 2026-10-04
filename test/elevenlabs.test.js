import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenLabsSpeech, SarvamTranslation } from '../providers.js';
import { createServer } from '../server.js';

test('ElevenLabs transcribes audio and speaks the chosen user voice through the server', async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/speech-to-text')) {
      assert.equal(options.headers['xi-api-key'], 'eleven-secret');
      assert.equal(options.body.get('model_id'), 'scribe_v2');
      assert.equal(options.body.get('file').name, 'phrase.webm');
      return { ok: true, json: async () => ({ text: 'React frontend ni .NET API tho integrate chesthanu' }) };
    }
    if (url.endsWith('/translate')) {
      const body = JSON.parse(options.body);
      assert.equal(body.source_language_code, 'te-IN');
      assert.equal(body.target_language_code, 'en-IN');
      assert.equal(options.headers['api-subscription-key'], 'sarvam-secret');
      return { ok: true, json: async () => ({ translated_text: 'I will integrate the React frontend with the .NET API.' }) };
    }
    if (url.includes('/v1/text-to-speech/')) {
      assert.match(url, /chosenVoice123/);
      assert.equal(JSON.parse(options.body).model_id, 'eleven_v3');
      return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const speech = new ElevenLabsSpeech('eleven-secret', fakeFetch);
  const translation = new SarvamTranslation('sarvam-secret', fakeFetch);
  const recognized = await speech.transcribe(Buffer.from([1, 2]), 'audio/webm');
  const translated = await translation.translate(recognized.text, 'outgoing');
  const audio = await speech.speak(translated, 'chosenVoice123', 'eleven_v3');
  assert.equal(translated, 'I will integrate the React frontend with the .NET API.');
  assert.deepEqual([...audio], [1, 2, 3]);
  assert.equal(calls.length, 3);
});

test('account capability endpoint returns own voice and cloning entitlement without API key', async () => {
  const fakeFetch = async url => {
    const json = url.includes('/user/subscription') ? { tier: 'free', character_count: 100, character_limit: 10000, can_use_instant_voice_cloning: false, can_use_professional_voice_cloning: false }
      : url.includes('voice_type=personal') ? { voices: [{ voice_id: 'myVoice123456', name: 'My voice', category: 'cloned' }] }
      : url.includes('/v2/voices') ? { voices: [{ voice_id: 'standardVoice12', name: 'Standard', category: 'premade', preview_url: 'https://example.elevenlabs.io/preview.mp3' }] }
      : [{ model_id: 'eleven_v3', name: 'Eleven v3', can_do_text_to_speech: true, languages: [{ language_id: 'tel' }] }];
    return { ok: true, json: async () => json };
  };
  const server = createServer({ elevenKey: 'secret', sarvamKey: 'other-secret', apiFetch: fakeFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/account`);
    const account = await response.json();
    assert.equal(response.status, 200);
    assert.equal(account.canCloneInstant, false);
    assert.equal(account.voices.length, 2);
    assert.equal(account.voices[0].previewUrl, 'https://example.elevenlabs.io/preview.mp3');
    assert.equal(account.models[0].telugu, true);
    assert.doesNotMatch(JSON.stringify(account), /other-secret|"secret"/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
