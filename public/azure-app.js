import { AzureSpeechProvider } from './azure-provider.js';

const pairs = {
  outgoing: { source: 'te-IN', target: 'en', voice: 'en-US-GuyNeural', title: 'Telugu → English' },
  incoming: { source: 'en-US', target: 'te', voice: 'te-IN-MohanNeural', title: 'English → Telugu' },
};
const $ = (id) => document.getElementById(id);
const status = (message, kind = '') => { $('status').textContent = message; $('status').dataset.kind = kind; };
let busy = false;
let provider;

async function getToken() {
  const response = await fetch('/api/token', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Token request failed (${response.status})`);
  return data;
}

async function run(direction) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button[data-direction]').forEach((button) => button.disabled = true);
  const pair = pairs[direction];
  $('original').textContent = 'Listening…';
  $('translated').textContent = 'Waiting for speech…';
  $('metrics').textContent = 'Timing begins when the microphone opens and includes speaking time.';
  try {
    status(`Connecting · ${pair.title}`);
    const { token, region } = await getToken();
    provider ||= new AzureSpeechProvider(window.SpeechSDK);
    status(`Listening · Speak ${direction === 'outgoing' ? 'Telugu' : 'English'}, then pause.`);
    const result = await provider.translateMicrophone({ token, region, ...pair });
    $('original').textContent = result.original;
    $('translated').textContent = result.translated;
    const sensitive = /\d|₹|\$|friday|monday|tuesday|wednesday|thursday|saturday|sunday|week|rupee/i.test(result.original + result.translated);
    $('review').hidden = !sensitive;
    if (sensitive) {
      status('Review the translation before audio playback.');
      if (!window.confirm(`Check dates, numbers, money, and commitments before speaking:\n\n${result.translated}\n\nPlay this translation?`)) {
        status('Audio held for review · Try another phrase');
        return;
      }
    }
    status('Translation ready · Speaking…');
    const { synthesisMs } = await provider.speak({ token, region, text: result.translated, voice: pair.voice });
    $('metrics').textContent = `Recognition + translation: ${result.recognitionMs} ms (includes speaking and silence) · Synthesis/playback: ${synthesisMs} ms`;
    status('Complete · Try another phrase', 'success');
  } catch (error) {
    status(error.message || String(error), 'error');
    if ($('original').textContent === 'Listening…') $('original').textContent = 'No result';
  } finally {
    busy = false;
    document.querySelectorAll('button[data-direction]').forEach((button) => button.disabled = false);
  }
}

document.querySelectorAll('button[data-direction]').forEach((button) => {
  button.addEventListener('click', () => run(button.dataset.direction));
});
fetch('/api/health').then(r => r.json()).then(({ ready }) => {
  status(ready ? 'Ready · Choose a direction' : 'Setup needed · Add Azure Speech key and region', ready ? 'success' : 'error');
}).catch(() => status('Could not reach the local server', 'error'));
