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
  if (!HTMLMediaElement.prototype.setSinkId) {
    bridgeStatus('This browser cannot route audio to another output. Open this page in current Edge or Chrome on Windows.');
    return;
  }
  try {
    const select = $(kind === 'outgoing' ? 'outgoingOutput' : 'headphoneOutput');
    let id = select.value, label = select.selectedOptions[0]?.textContent;
    if (!id && navigator.mediaDevices.selectAudioOutput) {
      const device = await navigator.mediaDevices.selectAudioOutput();
      id = device.deviceId; label = device.label;
    }
    if (!id || id === 'default') return bridgeStatus('Choose a named audio output, then press Use. The system default is unsafe for call routing.');
    if (id === outputs[kind === 'outgoing' ? 'incoming' : 'outgoing']) return bridgeStatus('Choose different devices for the outgoing cable and private headphones.');
    const probe = document.createElement('audio');
    await probe.setSinkId(id);
    outputs[kind] = id;
    if (kind === 'outgoing') $('testOutbound').disabled = false;
    bridgeStatus(`${kind === 'outgoing' ? 'Outgoing cable' : 'Your headphones'}: ${label}. ${outputs.outgoing && outputs.incoming ? 'Both outputs selected.' : 'Choose the other output too.'}`);
    if (kind === 'outgoing' && $('outgoingMode').value === 'original') await startPassthrough();
  } catch (error) { bridgeStatus(`Audio output selection failed: ${error.message}`); }
}

async function findOutputs() {
  if (!navigator.mediaDevices?.enumerateDevices || !HTMLMediaElement.prototype.setSinkId) return bridgeStatus('Open this page in current Edge or Chrome on Windows to route audio.');
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputsFound = devices.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications');
    for (const id of ['outgoingOutput', 'headphoneOutput']) {
      const select = $(id), previous = select.value;
      select.replaceChildren(new Option(id === 'outgoingOutput' ? 'Select outgoing cable' : 'Select headphones', ''));
      for (const device of outputsFound) select.add(new Option(device.label || 'Unnamed output', device.deviceId));
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
    bridgeStatus(outputsFound.length ? 'Select a named cable and headphones, then press their Use buttons.' : 'No named audio outputs found. Check Windows devices and microphone permission.');
    return outputsFound;
  } catch (error) { bridgeStatus(`Could not list outputs: ${error.message}`); }
  finally { mic?.getTracks().forEach(track => track.stop()); }
}

async function setupTeams() {
  $('setupTeams').disabled = true;
  $('teamsSteps').textContent = 'Finding the virtual cable and headphones…';
  try {
    const devices = await findOutputs();
    if (!devices?.length) throw new Error('No audio outputs were listed. Allow microphone access and try again.');
    const cable = devices.find(device => /cable input/i.test(device.label));
    const headphones = devices.find(device => device.deviceId !== cable?.deviceId && /oneplus|headphone|headset|earbud/i.test(device.label));
    if (!cable) throw new Error('CABLE Input is missing. Restart the browser after installing the virtual cable.');
    if (!headphones) throw new Error('I could not identify your headphones. Select them in Advanced audio controls.');
    $('outgoingOutput').value = cable.deviceId;
    $('headphoneOutput').value = headphones.deviceId;
    $('outgoingMode').value = 'translated';
    $('incomingMode').value = 'original';
    stopPassthrough();
    await chooseOutput('outgoing');
    await chooseOutput('incoming');
    if (outputs.outgoing !== cable.deviceId || outputs.incoming !== headphones.deviceId) throw new Error('The browser could not route audio to both devices. Read the status below.');
    $('teamsSteps').textContent = 'Ready in LiveBridge. In Teams select Microphone: CABLE Output and Speaker: your headphones. Record Telugu below, review English, then click Speak. Only the other participant hears the test beep.';
    bridgeStatus(`Outgoing: ${cable.label} · Private listening: ${headphones.label}. Incoming English remains on Teams headphones.`);
  } catch (error) { $('teamsSteps').textContent = error.message; }
  finally { $('setupTeams').disabled = false; }
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
  if (autoState.incoming) stopAutomatic('incoming');
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
$('findOutputs').addEventListener('click', findOutputs);
$('setupTeams').addEventListener('click', setupTeams);
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

const autoState = { outgoing: null, incoming: null };
let playingAutomatic = false;
const autoStatus = message => { $('autoStatus').textContent = message; };

async function toggleAutomatic(kind) {
  if (autoState[kind]) return stopAutomatic(kind);
  const outgoing = kind === 'outgoing';
  if (outgoing && !outputs.outgoing) return autoStatus('Set up the outgoing cable first.');
  if (!outgoing && !outputs.incoming) return autoStatus('Run Set up my Teams test to choose your headphones first.');
  if (!outgoing && !callStream?.getAudioTracks().length) {
    autoStatus('In the browser picker, share a screen with system audio enabled to capture Teams.');
    await captureCall();
    if (!callStream?.getAudioTracks().length) return autoStatus('No incoming audio was shared. Try again and enable Share system audio in the browser picker.');
  }
  if (!outgoing && $('incomingMode').value !== 'translated') $('incomingMode').value = 'translated';
  if (outgoing && $('outgoingMode').value !== 'translated') { $('outgoingMode').value = 'translated'; stopPassthrough(); }
  let source, context;
  try {
    source = outgoing
      ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      : new MediaStream(callStream.getAudioTracks().map(track => track.clone()));
    context = new AudioContext();
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    context.createMediaStreamSource(source).connect(analyser);
    const state = { source, context, analyser, data: new Float32Array(analyser.fftSize), recorder: null, chunks: [], busy: false, speechAt: 0, quietAt: 0, resumeAt: 0, discard: false, frame: 0 };
    autoState[kind] = state;
    $(outgoing ? 'autoOutgoing' : 'autoIncoming').textContent = outgoing ? 'Stop my automatic translation' : 'Stop client automatic translation';
    autoStatus(`${outgoing ? 'Your microphone' : 'Captured client audio'} is listening for speech. Pause briefly to send a phrase.`);
    monitorAutomatic(kind, state);
  } catch (error) {
    source?.getTracks().forEach(track => track.stop()); await context?.close();
    autoStatus(`Could not start automatic translation: ${error.message}`);
  }
}

function monitorAutomatic(kind, state) {
  if (autoState[kind] !== state) return;
  state.analyser.getFloatTimeDomainData(state.data);
  const rms = Math.sqrt(state.data.reduce((sum, value) => sum + value * value, 0) / state.data.length);
  const now = performance.now(), audible = rms > 0.022;
  if (!state.busy && !playingAutomatic && now > state.resumeAt) {
    if (audible && !state.recorder) {
      const format = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      state.chunks = []; state.speechAt = now; state.quietAt = 0;
      state.recorder = new MediaRecorder(state.source, format ? { mimeType: format } : undefined);
      state.recorder.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); };
      state.recorder.onstop = () => {
        const blob = new Blob(state.chunks, { type: state.recorder.mimeType });
        state.recorder = null;
        if (state.discard) { state.discard = false; state.busy = false; return; }
        if (autoState[kind] === state && blob.size && performance.now() - state.speechAt > 350) processAutomatic(kind, state, blob);
        else state.busy = false;
      };
      state.recorder.start();
    }
    if (state.recorder) {
      if (audible) state.quietAt = 0;
      else if (!state.quietAt) state.quietAt = now;
      if ((state.quietAt && now - state.quietAt > 850) || now - state.speechAt > 12000) {
        state.busy = true; state.recorder.stop();
      }
    }
  }
  state.frame = requestAnimationFrame(() => monitorAutomatic(kind, state));
}

async function processAutomatic(kind, state, blob) {
  const outgoing = kind === 'outgoing';
  try {
    autoStatus(`${outgoing ? 'Your Telugu' : 'Client English'} phrase ended. Transcribing and translating…`);
    const response = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Direction': kind }, body: blob });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Translation failed');
    $('original').textContent = data.original;
    $('translated').value = data.translated;
    if (!data.translated?.trim()) throw new Error('No translated speech was returned.');
    const voiceId = selectedVoices[kind];
    if (!voiceId) throw new Error('Select a voice for this direction.');
    autoStatus(`Heard: ${data.original} · Speaking: ${data.translated}`);
    const speech = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: data.translated, voiceId, modelId: $('model').value }) });
    if (!speech.ok) { const error = await speech.json(); throw new Error(error.error || 'Voice generation failed'); }
    if (autoState[kind] !== state) return;
    const url = URL.createObjectURL(await speech.blob());
    const audio = new Audio(url);
    try {
      await audio.setSinkId(outgoing ? outputs.outgoing : outputs.incoming);
      playingAutomatic = true;
      for (const active of Object.values(autoState)) {
        if (active?.recorder?.state === 'recording') { active.discard = true; active.recorder.stop(); }
      }
      await audio.play();
      await new Promise(resolve => { audio.onended = resolve; audio.onerror = resolve; });
    } finally { playingAutomatic = false; for (const active of Object.values(autoState)) if (active) active.resumeAt = performance.now() + 600; URL.revokeObjectURL(url); }
  } catch (error) { autoStatus(`Automatic ${kind} failed: ${error.message}`); }
  finally { state.busy = false; state.quietAt = performance.now(); }
}

async function stopAutomatic(kind) {
  const state = autoState[kind]; if (!state) return;
  autoState[kind] = null;
  cancelAnimationFrame(state.frame);
  if (state.recorder?.state === 'recording') state.recorder.stop();
  state.source.getTracks().forEach(track => track.stop());
  await state.context.close();
  $(kind === 'outgoing' ? 'autoOutgoing' : 'autoIncoming').textContent = kind === 'outgoing' ? 'Start my Telugu → client English' : 'Start client English → my Telugu';
  autoStatus(`${kind === 'outgoing' ? 'Your' : 'Client'} automatic translation stopped.`);
}

$('autoOutgoing').addEventListener('click', () => toggleAutomatic('outgoing'));
$('autoIncoming').addEventListener('click', () => toggleAutomatic('incoming'));
window.addEventListener('pagehide', () => { stopAutomatic('outgoing'); stopAutomatic('incoming'); });
