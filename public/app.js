const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('button[data-direction]')];
let recorder, stream, chunks, direction, startedAt;
const selectedVoices = { outgoing: '', incoming: '' };
let availableVoices = [], voiceTarget = 'outgoing', playingVoice = '';
const status = (message, kind = '') => { $('status').textContent = message; $('status').dataset.kind = kind; };
function setButtons(disabled) { buttons.forEach(button => button.disabled = disabled); }

function fillVoices(voices) {
  availableVoices = voices;
  if (!voices.length) { $('voiceList').textContent = 'No API voices available for this key.'; return; }
  const personal = voices.find(voice => voice.category === 'cloned' || voice.category === 'professional');
  selectedVoices.outgoing = personal?.id || voices[0].id;
  selectedVoices.incoming = voices[0].id;
  renderVoices();
}

function renderVoices() {
  const list = $('voiceList');
  list.replaceChildren();
  for (const voice of availableVoices) {
    const card = document.createElement('div');
    card.className = 'voice-card';
    if (selectedVoices[voiceTarget] === voice.id) card.classList.add('chosen');
    const detail = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = voice.name;
    const category = document.createElement('small'); category.textContent = voice.category || 'available';
    detail.append(title, category);
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'preview-button';
    preview.textContent = playingVoice === voice.id ? '■ Stop' : '▶ Play';
    preview.disabled = !voice.previewUrl;
    preview.setAttribute('aria-label', `${playingVoice === voice.id ? 'Stop' : 'Play'} preview of ${voice.name}`);
    preview.title = voice.previewUrl ? `Preview ${voice.name}` : 'No preview available for this voice';
    preview.addEventListener('click', () => playPreview(voice));
    const choose = document.createElement('button');
    choose.type = 'button'; choose.className = 'choose-button';
    choose.textContent = selectedVoices[voiceTarget] === voice.id ? '✓' : '+';
    choose.setAttribute('aria-label', `Use ${voice.name} for ${voiceTarget === 'outgoing' ? 'client' : 'yourself'}`);
    choose.setAttribute('aria-pressed', String(selectedVoices[voiceTarget] === voice.id));
    choose.addEventListener('click', () => { selectedVoices[voiceTarget] = voice.id; renderVoices(); });
    card.append(detail, preview, choose); list.append(card);
  }
  const name = id => availableVoices.find(voice => voice.id === id)?.name || 'None';
  $('voiceSelection').textContent = `Client hears: ${name(selectedVoices.outgoing)} · You hear: ${name(selectedVoices.incoming)}`;
}

async function playPreview(voice) {
  if (!voice.previewUrl) return;
  const audio = $('voicePreview');
  if (playingVoice === voice.id) { audio.pause(); audio.currentTime = 0; playingVoice = ''; renderVoices(); return; }
  audio.pause(); audio.src = voice.previewUrl;
  playingVoice = voice.id; renderVoices();
  try { await audio.play(); } catch { playingVoice = ''; renderVoices(); status('Voice preview could not play. Try another voice.', 'error'); }
}

$('voicePreview').addEventListener('ended', () => { playingVoice = ''; renderVoices(); });
document.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => {
  voiceTarget = button.dataset.target;
  document.querySelectorAll('[data-target]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderVoices();
}));

async function init() {
  try {
    const setup = await (await fetch('/api/health')).json();
    status(setup.ready ? 'Ready · Select voices and record' : `Setup needed · ${!setup.elevenlabs ? 'ElevenLabs key ' : ''}${!setup.sarvam ? 'Sarvam key' : ''}`, setup.ready ? 'success' : 'error');
    if (!setup.elevenlabs) return;
    const response = await fetch('/api/account');
    const account = await response.json();
    if (!response.ok) throw new Error(account.error);
    fillVoices(account.voices);
    $('account').textContent = `Plan: ${account.tier || 'unknown'} · Credits used: ${account.creditsUsed ?? '?'} / ${account.creditsLimit ?? '?'} · Instant clone: ${account.canCloneInstant === true ? 'enabled' : account.canCloneInstant === false ? 'not enabled' : 'unknown'} · Professional clone: ${account.canCloneProfessional === true ? 'enabled' : account.canCloneProfessional === false ? 'not enabled' : 'unknown'} · API voices: ${account.voices.length}.`;
    for (const model of account.models.filter(model => model.telugu && model.id !== 'eleven_v3')) $('model').add(new Option(`${model.name || model.id} · Telugu`, model.id));
  } catch (error) { $('account').textContent = `Could not inspect account: ${error.message}`; }
}

async function toggleRecording(nextDirection, button) {
  if (recorder?.state === 'recording') { if (nextDirection === direction) recorder.stop(); return; }
  $('play').disabled = true;
  $('translated').value = '';
  $('original').textContent = 'Listening…';
  $('translated').placeholder = 'Waiting for transcription…';
  $('audio').hidden = true;
  $('review').hidden = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const format = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, format ? { mimeType: format } : undefined);
    chunks = [];
    direction = nextDirection;
    startedAt = performance.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => processRecording(new Blob(chunks, { type: recorder.mimeType }), Math.round(performance.now() - startedAt));
    recorder.start();
    setButtons(true);
    button.disabled = false;
    button.textContent = 'Stop and translate ■';
    status(`Recording ${direction === 'outgoing' ? 'Telugu' : 'English'} · Click again when finished`);
    const current = recorder;
    setTimeout(() => { if (current.state === 'recording') current.stop(); }, 15000);
  } catch (error) { stream?.getTracks().forEach(track => track.stop()); status(`Microphone unavailable: ${error.message}`, 'error'); }
}

async function processRecording(blob, recordingMs) {
  stream?.getTracks().forEach(track => track.stop());
  setButtons(true);
  buttons[0].innerHTML = 'Start Telugu recording <span>●</span>';
  buttons[1].innerHTML = 'Start English recording <span>●</span>';
  try {
    status('ElevenLabs transcription → Sarvam translation…');
    const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Direction': direction }, body: blob });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Translation failed (${response.status})`);
    $('original').textContent = data.original;
    $('translated').value = data.translated;
    $('review').hidden = false;
    $('play').disabled = false;
    $('play').dataset.direction = direction;
    $('metrics').textContent = `Recording: ${recordingMs} ms · STT request: ${data.timings.sttMs} ms · Translation request: ${data.timings.translationMs} ms · TTS pending`;
    status('Review the text, then choose Speak reviewed translation', 'success');
  } catch (error) { status(error.message, 'error'); $('original').textContent = 'No result'; }
  finally { setButtons(false); }
}

async function play() {
  const translatedText = $('translated').value.trim();
  if (!translatedText) return status('Enter or correct the translated text first.', 'error');
  const voiceId = selectedVoices[$('play').dataset.direction === 'outgoing' ? 'outgoing' : 'incoming'];
  if (!voiceId) return status('Select an available ElevenLabs voice.', 'error');
  $('play').disabled = true;
  status('ElevenLabs is generating speech…');
  try {
    const response = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: translatedText, voiceId, modelId: $('model').value }) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Speech failed'); }
    const mp3 = await response.blob();
    const audio = $('audio');
    if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    audio.dataset.url = URL.createObjectURL(mp3);
    audio.src = audio.dataset.url;
    audio.hidden = false;
    $('metrics').textContent += ` · ElevenLabs TTS: ${response.headers.get('X-Tts-Ms')} ms (full response)`;
    await audio.play();
    status('Playing translated speech', 'success');
  } catch (error) { status(error.message, 'error'); }
  finally { $('play').disabled = false; }
}

buttons.forEach(button => button.addEventListener('click', () => toggleRecording(button.dataset.direction, button)));
$('play').addEventListener('click', play);
init();
