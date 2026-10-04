import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ElevenLabsSpeech, SarvamTranslation } from './providers.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/azure-provider.js', ['public/azure-provider.js', 'text/javascript; charset=utf-8']],
  ['/azure.html', ['public/azure.html', 'text/html; charset=utf-8']],
  ['/azure-app.js', ['public/azure-app.js', 'text/javascript; charset=utf-8']],
]);
const regionPattern = /^[a-z0-9-]{2,30}$/;

export function createServer({ key = process.env.AZURE_SPEECH_KEY,
  region = process.env.AZURE_SPEECH_REGION, tokenFetch = fetch,
  elevenKey = process.env.ELEVENLABS_API_KEY,
  sarvamKey = process.env.SARVAM_API_KEY,
  apiFetch = fetch } = {}) {
  const eleven = new ElevenLabsSpeech(elevenKey, apiFetch);
  const translator = new SarvamTranslation(sarvamKey, apiFetch);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; connect-src 'self' https://*.speech.microsoft.com https://*.api.cognitive.microsoft.com wss://*.speech.microsoft.com wss://*.stt.speech.microsoft.com wss://*.tts.speech.microsoft.com; img-src 'self' data:; media-src 'self' blob: https:");
    if (url.pathname === '/api/health') {
      if (req.method !== 'GET') return methodNotAllowed(res);
      json(res, 200, { ready: Boolean(elevenKey && sarvamKey), elevenlabs: Boolean(elevenKey), sarvam: Boolean(sarvamKey), azureFallback: Boolean(key && region && regionPattern.test(region)), mode: 'elevenlabs-first' });
      return;
    }
    if (url.pathname === '/api/account') {
      if (req.method !== 'GET') return methodNotAllowed(res);
      if (!elevenKey) return json(res, 503, { error: 'Set ELEVENLABS_API_KEY to inspect your available voices and account capabilities.' });
      try {
        const [subscription, voices, models] = await Promise.all([eleven.subscription(), eleven.voices(), eleven.models()]);
        json(res, 200, {
          tier: subscription.tier,
          creditsUsed: subscription.character_count,
          creditsLimit: subscription.character_limit,
          canCloneInstant: subscription.can_use_instant_voice_cloning,
          canCloneProfessional: subscription.can_use_professional_voice_cloning,
          voices: voices.voices.map(({ voice_id, name, category, preview_url }) => ({ id: voice_id, name, category, previewUrl: /^https:\/\//.test(preview_url || '') ? preview_url : null })),
          models: models.filter(model => model.can_do_text_to_speech).map(({ model_id, name, languages, max_characters_request_free_user }) => ({ id: model_id, name, telugu: languages?.some(l => l.language_id === 'tel' || l.language_id === 'te'), freeMaxChars: max_characters_request_free_user })),
        });
      } catch (error) { json(res, 502, { error: error.message }); }
      return;
    }
    if (url.pathname === '/api/translate') {
      if (req.method !== 'POST') return methodNotAllowed(res);
      if (!elevenKey || !sarvamKey) return json(res, 503, { error: 'Set ELEVENLABS_API_KEY and SARVAM_API_KEY.' });
      const direction = req.headers['x-direction'];
      if (!['outgoing', 'incoming'].includes(direction)) return json(res, 400, { error: 'Invalid direction.' });
      if (!['audio/webm', 'audio/mp4', 'audio/ogg'].some(type => req.headers['content-type']?.startsWith(type))) return json(res, 415, { error: 'Unsupported audio format.' });
      try {
        const audio = await readBody(req, 5 * 1024 * 1024);
        if (!audio.length) return json(res, 400, { error: 'Record a phrase first.' });
        const started = performance.now();
        const source = await eleven.transcribe(audio, req.headers['content-type']);
        const sttMs = Math.round(performance.now() - started);
        if (!source.text?.trim()) return json(res, 422, { error: 'No speech recognized. Try another phrase.' });
        const translated = await translator.translate(source.text, direction);
        json(res, 200, { original: source.text, translated, timings: { sttMs, translationMs: Math.round(performance.now() - started) - sttMs } });
      } catch (error) { json(res, error.status || 502, { error: error.message }); }
      return;
    }
    if (url.pathname === '/api/speak') {
      if (req.method !== 'POST') return methodNotAllowed(res);
      if (!elevenKey) return json(res, 503, { error: 'Set ELEVENLABS_API_KEY.' });
      try {
        const body = JSON.parse((await readBody(req, 8192)).toString('utf8'));
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000 || !/^[A-Za-z0-9]{10,40}$/.test(body.voiceId || '')) return json(res, 400, { error: 'Select a voice and translate a short phrase first.' });
        const start = performance.now();
        const audio = await eleven.speak(body.text, body.voiceId, body.modelId || 'eleven_v3');
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'X-Tts-Ms': String(Math.round(performance.now() - start)) }).end(audio);
      } catch (error) { json(res, error.status || 502, { error: error.message }); }
      return;
    }
    if (url.pathname === '/api/token') {
      if (req.method !== 'GET') return methodNotAllowed(res);
      if (!key || !region || !regionPattern.test(region)) {
        json(res, 503, { error: 'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION before starting.' });
        return;
      }
      try {
        const upstream = await tokenFetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
          method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
          signal: AbortSignal.timeout(10000),
        });
        if (!upstream.ok) throw new Error(`Azure token endpoint returned ${upstream.status}`);
        const token = await upstream.text();
        if (!token) throw new Error('Azure returned an empty token');
        json(res, 200, { token, region });
      } catch (error) {
        json(res, 502, { error: error.message });
      }
      return;
    }
    if (req.method !== 'GET') return methodNotAllowed(res);
    const entry = files.get(url.pathname);
    if (!entry) { res.writeHead(404).end('Not found'); return; }
    try {
      const bytes = await readFile(path.join(root, entry[0]));
      res.writeHead(200, { 'Content-Type': entry[1] }).end(bytes);
    } catch {
      res.writeHead(500).end('File unavailable');
    }
  });
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) { const error = new Error('Recording or request is too large.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function methodNotAllowed(res) { res.writeHead(405).end('Method not allowed'); }

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`LiveBridge POC: http://127.0.0.1:${port}`);
  });
}
