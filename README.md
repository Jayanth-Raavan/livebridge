# LiveBridge-AI · ElevenLabs-first Telugu ⇄ English POC

A one-phrase speech translation prototype. Choose independently whether the client hears your original recording or translated English, and whether you hear an original English test recording or translated Telugu. Original mode plays the captured audio locally without provider calls. Translated mode uses **ElevenLabs Scribe v2**, **Sarvam Translate**, and **ElevenLabs TTS** after text review. Incoming audio can use the local microphone for testing or an explicitly selected call-audio capture. An experimental desktop bridge routes speech to a selected virtual cable; personal voice enrollment is not implemented.

## Windows setup

Install Node.js 20 or later. Create ElevenLabs and Sarvam API keys on their own sites. Both have limited free testing allowances, subject to current account permissions and credit balance. In PowerShell, from this folder:

```powershell
$env:ELEVENLABS_API_KEY = "YOUR_ELEVENLABS_API_KEY"
$env:SARVAM_API_KEY = "YOUR_SARVAM_API_KEY"
npm start
```

Open `http://127.0.0.1:4173` in Edge or Chrome, allow microphone access, preview and choose voices, then choose Original or Translated separately for each direction. Record a short phrase and click again to stop. In Translated mode, **edit the translation if necessary** before generating speech. In Original mode, play back the captured recording without API usage. The choice applies to the next recording. For a local test, audio plays in the browser. The experimental desktop bridge can send it to a selected virtual cable for a test call; it has not been verified on Windows devices. Use headphones. `npm test` runs mocked provider and server tests without spending credits or installing packages.

The Account capability panel calls your local backend, which in turn reads ElevenLabs subscription, models and voice IDs. It reports `can_use_instant_voice_cloning` and `can_use_professional_voice_cloning` returned for **your API key**. Voice Design, voice-library availability and cloning are different capabilities. Select a personally owned voice if it appears; this version never creates or clones a voice. Do not paste an API key into this page, commit it, or send it in chat.

## Pipeline and boundaries

### Experimental desktop call bridge

This is a **manual, phrase-level Windows test**, not automatic live interpreting. Use a personal test call, headphones and two virtual audio cables. You must explicitly grant microphone or screen capture permission. Do not test on a managed organization laptop unless its policies allow the audio devices and app.

1. In the page, click **Choose outgoing cable** and select the playback endpoint of cable A (for VB-CABLE, `CABLE Input`). In Teams **Settings → Devices**, choose cable A's paired recording endpoint (`CABLE Output`) as the **microphone**. Do not select your physical microphone there. Press **Test outgoing route** and confirm the Teams microphone meter responds in a test call. The tone may be audible to the other participant.
2. Click **Choose headphones** and select your physical headphones for incoming translated playback.
3. For incoming translation, set the call app **speaker** to cable B's playback endpoint. In LiveBridge click **Find call audio inputs**, select cable B's paired recording endpoint, then **Connect incoming audio**. Alternatively select screen/system audio and explicitly share the call app's audio in the browser picker. Screen capture varies by browser and may include unrelated sounds or your own output.
4. For **Original outgoing**, the browser feeds your physical mic to cable A while the mode is active. For **Translated outgoing**, record a short phrase, review the text, then click Speak. The generated audio is sent to cable A. Do not keep original pass-through on while playing a translated phrase.
5. For **Translated incoming**, record a short captured phrase, review it, and play the Telugu audio in your headphones. For **Original incoming**, choose your physical headphones directly as the call app speaker; no LiveBridge capture is needed.

The two directions are independent. This POC never interprets continuously: click Stop after each phrase, review the translation, and then click Speak. If the caller speaks over the translated audio, wait and capture a new phrase. Do not rely on this for a time-sensitive or confidential work call; the remote audio and transcript are sent to the configured providers.

The browser cannot automatically change Teams/Zoom device settings. Browser output selection needs `selectAudioOutput` and `setSinkId` support. If it fails, stop the test rather than sending a phrase to the wrong device. This prototype does not integrate with mobile, PSTN, WhatsApp personal calls, or automatic speech turns. A live two-person test must verify routing, echoes and latency before any use in a real meeting.

`Microphone or captured call audio → short clip → ElevenLabs Scribe v2 → Sarvam Translate v1 → on-screen review → ElevenLabs v3 TTS → selected output`

The ElevenLabs key and Sarvam key stay in the Node server process. The browser sends a recorded phrase to `POST /api/translate`, receives recognized and translated text, and only calls `POST /api/speak` after a separate user action. The server has provider classes in `providers.js`; the UI does not contain vendor secrets. The existing Azure version remains available at `/azure.html` as an optional comparison. It requires `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` and loads Microsoft's SDK from jsDelivr. The main ElevenLabs path does not need Azure.

This backend binds only to localhost and has no accounts, authentication, usage quota or production hardening. If an API returns an entitlement/credit error, check that key's permissions and model access in ElevenLabs. The TTS model dropdown starts with `eleven_v3`, which lists Telugu. Other Telugu models are added from the account model list; quality and availability depend on the account and chosen voice. A user-owned clone can be selected by voice ID when it is available to the key, but cloned voice quality has not been tested.

## Speech trials

| Direction | Say | Verify |
| --- | --- | --- |
| Telugu → English | “Nenu current website analyse chesanu. Mobile responsiveness konchem improve cheyyali.” | Meaning and mobile context. |
| Telugu → English | “React frontend ni .NET API tho integrate chesthanu.” | React, .NET and API remain intact. |
| Telugu → English | “Deployment Friday varaku complete cheyyagalanu.” | Deadline and promise do not change. |
| Telugu → English | “Project cost fifteen thousand rupees.” | ₹15,000, not ₹50,000. |
| English → Telugu | “Can you finish the redesign within two weeks?” | Question and two-week duration remain correct. |

Record results, transcript, translated text, voice, perceived pronunciation and the stage timings shown. Timings here are **recording duration, complete STT request, complete translation request and complete TTS request**. They are not first-audio latency or a genuine call benchmark. Test romanized/code-mixed Telugu in real speech and compare against Azure fallback only after using the same recordings and environment.

## Next build milestones

1. Run the phrases above on the Windows laptop with account keys. Compare quality, cost and delays; correct text translation choice or add a fidelity checker only if measurements warrant it.
2. Replace file uploads with ElevenLabs **Scribe v2 Realtime WebSocket**, using server-issued single-use tokens. Stream phrase-level translations and ElevenLabs TTS, measure first audio byte, handle interruption and preserve glossary terms.
3. Build a React/Electron UI and a .NET Windows audio worker. For an initial meeting test use a licensed established virtual cable. Route generated English to its playback endpoint and choose the paired capture endpoint as Google Meet's microphone. Capture meeting audio with per-application WASAPI loopback and send incoming Telugu only to the subscriber's headset. Test with a second device/account.
4. Add consent-based own-voice enrollment when the ElevenLabs account grants cloning. Store voice IDs per subscriber on a secure backend, support removal and account isolation, and verify multilingual identity and pronunciation. Do not use third-party voices without authorization.
5. Test Teams, Zoom and WhatsApp Desktop independently, then add accounts, metering, concurrency controls, privacy settings and billing. The remote participant continues to use their normal application.

## Verified and unverified

The local server, read-only account capability mapping and mocked ElevenLabs/Sarvam phrase flow passed automated tests. The local server was started and its health endpoint checked. No ElevenLabs or Sarvam keys, microphone or Windows virtual device were available in the build container, so **no actual Telugu audio, cloned voice, meeting call, sound quality or latency was verified**. The signed-in ElevenLabs subscription page showed **Free, 0 / 10,000 credits used** on 4 October 2026. Its Instant Voice Cloning screen exposed upload and record controls, but we did not submit a sample; API cloning entitlement and usable voice IDs need the local API key check. See [research.md](research.md) for sources and cost assumptions.
