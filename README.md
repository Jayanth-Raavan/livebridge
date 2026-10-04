# LiveBridge-AI · ElevenLabs-first Telugu ⇄ English POC

A one-phrase speech translation prototype. The subscriber records Telugu or English, **ElevenLabs Scribe v2** transcribes it, **Sarvam Translate** converts the text, and **ElevenLabs TTS** speaks the reviewed translation in a selected available voice. The other caller installs nothing in the eventual product. This milestone uses the same local microphone to test both directions; no meeting routing or personal voice enrollment is implemented yet.

## Windows setup

Install Node.js 20 or later. Create ElevenLabs and Sarvam API keys on their own sites. Both have limited free testing allowances, subject to current account permissions and credit balance. In PowerShell, from this folder:

```powershell
$env:ELEVENLABS_API_KEY = "YOUR_ELEVENLABS_API_KEY"
$env:SARVAM_API_KEY = "YOUR_SARVAM_API_KEY"
npm start
```

Open `http://127.0.0.1:4173` in Edge or Chrome, allow microphone access, select the voice and model returned by your ElevenLabs account, and record a short phrase. Click again to stop. Review the original text, **edit the translation if necessary**, then click **Speak reviewed translation**. The audio is delivered to your browser speaker, not to a meeting app. Use headphones. `npm test` runs the mocked provider and server tests without spending credits or installing packages.

The Account capability panel calls your local backend, which in turn reads ElevenLabs subscription, models and voice IDs. It reports `can_use_instant_voice_cloning` and `can_use_professional_voice_cloning` returned for **your API key**. Voice Design, voice-library availability and cloning are different capabilities. Select a personally owned voice if it appears; this version never creates or clones a voice. Do not paste an API key into this page, commit it, or send it in chat.

## Pipeline and boundaries

`Default microphone → recorded short clip → ElevenLabs Scribe v2 → Sarvam Translate v1 → on-screen review → ElevenLabs v3 TTS → default speaker`

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
