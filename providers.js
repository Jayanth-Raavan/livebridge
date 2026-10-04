export class ElevenLabsSpeech {
  constructor(key, request = fetch) { this.key = key; this.request = request; }

  async call(path, options = {}) {
    const response = await this.request(`https://api.elevenlabs.io${path}`, {
      ...options,
      headers: { 'xi-api-key': this.key, ...options.headers },
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}. Check key, credits, model and account permissions.`);
    return response;
  }

  async subscription() { return (await this.call('/v1/user/subscription')).json(); }
  async voices() {
    const [available, personal] = await Promise.all([
      this.call('/v2/voices?page_size=100').then(r => r.json()),
      this.call('/v2/voices?voice_type=personal&page_size=100').then(r => r.json()),
    ]);
    const byId = new Map([...available.voices, ...personal.voices].map(voice => [voice.voice_id, voice]));
    return { voices: [...byId.values()] };
  }
  async models() { return (await this.call('/v1/models')).json(); }

  async transcribe(bytes, mime) {
    const form = new FormData();
    const extension = mime.startsWith('audio/mp4') ? 'm4a' : mime.startsWith('audio/ogg') ? 'ogg' : 'webm';
    form.append('file', new Blob([bytes], { type: mime }), `phrase.${extension}`);
    form.append('model_id', 'scribe_v2');
    form.append('tag_audio_events', 'false');
    // Automatic detection gives mixed Telugu + English terms a fairer trial.
    return (await this.call('/v1/speech-to-text', { method: 'POST', body: form })).json();
  }

  async speak(text, voiceId, modelId) {
    const response = await this.call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: modelId }),
    });
    return Buffer.from(await response.arrayBuffer());
  }
}

export class SarvamTranslation {
  constructor(key, request = fetch) { this.key = key; this.request = request; }
  async translate(input, direction) {
    const response = await this.request('https://api.sarvam.ai/translate', {
      method: 'POST',
      headers: { 'api-subscription-key': this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input,
        source_language_code: direction === 'outgoing' ? 'te-IN' : 'en-IN',
        target_language_code: direction === 'outgoing' ? 'en-IN' : 'te-IN',
        model: 'sarvam-translate:v1',
        mode: 'formal',
        numerals_format: 'international',
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Sarvam translation returned ${response.status}. Check key, credits and language pair.`);
    const result = await response.json();
    if (!result.translated_text?.trim()) throw new Error('Translation returned no text.');
    return result.translated_text;
  }
}
