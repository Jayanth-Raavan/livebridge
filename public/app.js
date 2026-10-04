const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('button[data-direction]')];
let recorder, stream, chunks, direction, startedAt, recordedMode;
let originalAudioUrl = '';
let callStream, passthroughStream;
const outputs = { outgoing: '', incoming: '' };
const selectedVoices = { outgoing: '', incoming: '' };
let availableVoices = [], voiceTarget = 'outgoing', playingVoice = '';
const status = (message, kind = '') => { $('status').textContent = message; $('status').dataset.kind = kind; };
function setButtons(disabled) { buttons.forEach(button => button.disabled = disabled); }
const bridgeStatus = message => { $('bridgeStatus').textContent = message; };

async function chooseOutput(kind) {
  if (!navigator.mediaDevices.selectAudioOutput || !HTMLMediaElement.prototype.setSinkId) {
    bridgeStatus('This browser cannot choose a separate audio output. Try current Edge or Chrome on Windows.');
    return;
  }
  try {
    const device = await navigator.mediaDevices.selectAudioOutput();
    outputs[kind] = device.deviceId;
    if (kind === 'outgoing') $('testOutbound').disabled = false;
    bridgeStatus(`${kind === 'outgoing' ? 'Outgoing cable' : 'Your headphones'}: ${device.label}. ${outputs.outgoing && outputs.incoming ? 'Both outputs selected.' : 'Choose the other output too.'}`);
    if (kind === 'outgoing' && $('outgoingMode').value === 'original') await startPassthrough();
  } catch (error) { bridgeStatus(`Audio output selection failed: ${error.message}`); }
}

async function testOutbound() {
  if (!outputs.outgoing) return bridgeStatus('Choose the outgoing cable first.');
  const wasPassthrough = !!passthroughStream;
  if (wasPassthrough) stopPassthrough();
  const sampleRate = 16000, samples = sampleRate / 3;
  const bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
  const label = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); label(8, 'WAVE');
  label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 500, (samples - i) / 500);
    view.setInt16(44 + i * 2, Math.round(6000 * envelope * Math.sin(2 * Math.PI * 660 * i / sampleRate)), true);
  }
  const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
  try {
    await audio.setSinkId(outputs.outgoing);
    await audio.play();
    bridgeStatus('Test tone sent to the outgoing cable. Check the Teams microphone meter or ask your test partner if they heard it.');
    await new Promise(resolve => { audio.onended = resolve; audio.onerror = resolve; });
  } catch (error) { bridgeStatus(`Outgoing route test failed: ${error.message}`); }
  finally { URL.revokeObjectURL(audio.src); if (wasPassthrough && $('outgoingMode').value === 'original') await startPassthrough(); }
}

async function startPassthrough() {
  stopPassthrough();
  if (!outputs.outgoing) return bridgeStatus('Choose the virtual cable output before using original voice in a call.');
  try {
    passthroughStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const audio = $('micPassthrough');
    audio.srcObject = passthroughStream;
    await audio.setSinkId(outputs.outgoing);
    await audio.play();
    bridgeStatus('Original microphone is feeding the selected virtual cable. Mute your physical mic in the call app by selecting only the cable as its microphone.');
  } catch (error) { stopPassthrough(); bridgeStatus(`Microphone pass-through failed: ${error.message}`); }
}

function stopPassthrough() {
  $('micPassthrough').pause(); $('micPassthrough').srcObject = null;
  passthroughStream?.getTracks().forEach(track => track.stop()); passthroughStream = null;
}

async function captureCall() {
  try {
    const source = $('incomingSource').value;
    if (source === 'screen' && !navigator.mediaDevices.getDisplayMedia) return bridgeStatus('Screen audio capture is unavailable in this browser.');
    callStream = source === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' })
      : await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: source }, echoCancellation: false }, video: false });
    if (!callStream.getAudioTracks().length) {
      callStream.getTracks().forEach(track => track.stop()); callStream = null;
      return bridgeStatus('No call audio was shared. Try again and explicitly enable Share system audio or Share tab audio.');
    }
    callStream.getVideoTracks()[0]?.addEventListener('ended', stopCapture, { once: true });
    $('captureCall').disabled = true; $('stopCapture').disabled = false;
    bridgeStatus(`Incoming audio connected through ${source === 'screen' ? 'screen/system capture' : 'selected cable'}. Use headphones, then record an incoming phrase.`);
  } catch (error) { bridgeStatus(`Call audio capture was not started: ${error.message}`); }
}

async function listInputs() {
  try {
    const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    permission.getTracks().forEach(track => track.stop());
    const select = $('incomingSource'); select.replaceChildren(new Option('Screen or system audio', 'screen'));
    for (const device of devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')) {
      select.add(new Option(device.label || 'Audio input', device.deviceId));
    }
    bridgeStatus('Select the recording side of your incoming virtual cable, then connect incoming audio.');
  } catch (error) { bridgeStatus(`Could not list inputs: ${error.message}`); }
}

function stopCapture() {
  if (direction === 'incoming' && recorder?.state === 'recording') recorder.stop();
  callStream?.getTracks().forEach(track => track.stop()); callStream = null;
  $('captureCall').disabled = false; $('stopCapture').disabled = true;
  bridgeStatus('Call audio capture stopped.');
}

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
  if (nextDirection === 'outgoing' && $('outgoingMode').value !== 'original' && passthroughStream) stopPassthrough();
  $('audio').pause();
  $('play').disabled = true;
  $('translated').value = '';
  $('original').textContent = 'Listening…';
  $('translated').placeholder = 'Waiting for transcription…';
  $('audio').hidden = true;
  $('review').hidden = true;
  try {
    const incomingCallTrack = nextDirection === 'incoming' ? callStream?.getAudioTracks()[0] : null;
    stream = incomingCallTrack ? new MediaStream([incomingCallTrack]) : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const format = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, format ? { mimeType: format } : undefined);
    chunks = [];
    direction = nextDirection;
    recordedMode = $(direction === 'outgoing' ? 'outgoingMode' : 'incomingMode').value;
    startedAt = performance.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => processRecording(new Blob(chunks, { type: recorder.mimeType }), Math.round(performance.now() - startedAt));
    recorder.start();
    setButtons(true);
    button.disabled = false;
    button.textContent = recordedMode === 'original' ? 'Stop and keep original ■' : 'Stop and translate ■';
    status(`Recording ${direction === 'outgoing' ? 'your Telugu microphone' : incomingCallTrack ? 'captured call audio' : 'English microphone test'} · Click again when finished`);
    const current = recorder;
    setTimeout(() => { if (current.state === 'recording') current.stop(); }, 15000);
  } catch (error) { stream?.getTracks().forEach(track => track.stop()); status(`Microphone unavailable: ${error.message}`, 'error'); }
}

async function processRecording(blob, recordingMs) {
  if (direction === 'outgoing' || !callStream) stream?.getTracks().forEach(track => track.stop());
  setButtons(true);
  buttons[0].innerHTML = 'Start Telugu recording <span>●</span>';
  buttons[1].innerHTML = 'Start English recording <span>●</span>';
  if (originalAudioUrl) URL.revokeObjectURL(originalAudioUrl);
  originalAudioUrl = URL.createObjectURL(blob);
  $('play').dataset.direction = direction;
  $('play').dataset.mode = recordedMode;
  if (recordedMode === 'original') {
    $('original').textContent = 'Original recording ready. Transcription is skipped in this mode.';
    $('translated').value = '';
    $('translated').placeholder = 'Select Translated before recording the next phrase to translate it.';
    $('metrics').textContent = `Recording: ${recordingMs} ms · Original audio, no provider requests`;
    $('play').textContent = 'Play original recording ↗';
    $('play').disabled = false;
    status('Original recording ready for local playback', 'success');
    setButtons(false);
    return;
  }
  try {
    status('ElevenLabs transcription → Sarvam translation…');
    const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Direction': direction }, body: blob });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Translation failed (${response.status})`);
    $('original').textContent = data.original;
    $('translated').value = data.translated;
    $('review').hidden = false;
    $('play').disabled = false;
    $('play').textContent = 'Speak reviewed translation ↗';
    $('metrics').textContent = `Recording: ${recordingMs} ms · STT request: ${data.timings.sttMs} ms · Translation request: ${data.timings.translationMs} ms · TTS pending`;
    status('Review the text, then choose Speak reviewed translation', 'success');
  } catch (error) { status(error.message, 'error'); $('original').textContent = 'No result'; }
  finally { setButtons(false); }
}

async function play() {
  const isOutgoing = $('play').dataset.direction === 'outgoing';
  if (isOutgoing && callStream && !outputs.outgoing) return status('Choose the outgoing cable before sending audio to a call.', 'error');
  if (!isOutgoing && callStream && !outputs.incoming) return status('Choose headphones before playing a private translation.', 'error');
  if ($('play').dataset.mode === 'original') {
    if (!originalAudioUrl) return status('Record an original phrase first.', 'error');
    const audio = $('audio');
    audio.pause(); audio.src = originalAudioUrl; audio.hidden = false;
    const sink = $('play').dataset.direction === 'outgoing' && passthroughStream ? outputs.incoming : $('play').dataset.direction === 'outgoing' ? outputs.outgoing : outputs.incoming;
    try { if (sink) await audio.setSinkId(sink); await audio.play(); status('Playing original recording locally', 'success'); }
    catch (error) { status(`Could not play recording: ${error.message}`, 'error'); }
    return;
  }
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
    const sink = $('play').dataset.direction === 'outgoing' ? outputs.outgoing : outputs.incoming;
    if (sink) await audio.setSinkId(sink);
    $('metrics').textContent += ` · ElevenLabs TTS: ${response.headers.get('X-Tts-Ms')} ms (full response)`;
    await audio.play();
    status('Playing translated speech', 'success');
  } catch (error) { status(error.message, 'error'); }
  finally { $('play').disabled = false; }
}

buttons.forEach(button => button.addEventListener('click', () => toggleRecording(button.dataset.direction, button)));
$('chooseOutbound').addEventListener('click', () => chooseOutput('outgoing'));
$('testOutbound').addEventListener('click', testOutbound);
$('chooseHeadphones').addEventListener('click', () => chooseOutput('incoming'));
$('listInputs').addEventListener('click', listInputs);
$('captureCall').addEventListener('click', captureCall);
$('stopCapture').addEventListener('click', stopCapture);
$('outgoingMode').addEventListener('change', () => {
  if ($('outgoingMode').value === 'original' && outputs.outgoing) startPassthrough();
  else stopPassthrough();
  status('Outgoing choice applies to the next recording.');
});
$('incomingMode').addEventListener('change', () => status('Incoming choice applies to the next recording.'));
window.addEventListener('pagehide', () => { stopPassthrough(); stopCapture(); });
$('play').addEventListener('click', play);
init();
