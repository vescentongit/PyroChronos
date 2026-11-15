# PyroChronos · NasaCom video demo

GOAL: Explain why comparable satellite fire records matter, demonstrate the current prototype, and end on the team's future ambition.
OUTPUT: English, 1920×1080 landscape MP4, 30 fps, narrated with local English TTS as requested. Exactly 30 seconds / 900 frames.
LOOK: Existing PyroChronos identity: #0e0e0e, #0a3c91, white, #fc3c23. Self-hosted Plus Jakarta Sans 500/700. Main titles 82–126px; subtitles 36–42px. 110px side margins. Real UI remains flat and keeps its labels.
OBJECTS: Supplied transparent logo; actual Home globe; actual polygon/date controls; actual activity calendar and research exports. Globe uses the bundled real NASA FIRMS snapshot. Historical results shown in the walkthrough are illustrative prototype data and carry a persistent label.
MOTION: One focus per shot. Entry 12 frames power3.out; camera moves 18 frames power2.inOut; no perpetual drift. Actual UI actions are captured from the working app. Caption track sits at y=926, within title safe; essential slide content ends before y=875.

SHOTS:
- Frames 0–59: “We are NasaCom” over the real globe. All three full names remain visible through frame 149.
- Frames 60–149: The challenge appears: different satellites, different observations. Inspiration: understanding Indonesia's fire activity. Full team names remain readable.
- Frames 150–299: PyroChronos title and “See the fire. Read the pattern.” Show the actual globe and source label.
- Frames 300–419: Actual prototype: choose an area and date range, then trigger analysis.
- Frames 420–599: Calendar and source evidence. Persistent “Illustrative prototype data” label. NASA FIRMS · MODIS / VIIRS credited. No claim of global model validation.
- Frames 600–779: Future vision: informed field checks, research, and preparedness for communities and ecosystems. Clearly label as the team's vision.
- Frames 780–899: Logo/wordmark and concluding “From observations to informed action”. Hold final message for at least 2 seconds.

VOICE: Local installed English voice. Frame times are hard limits; narration is synthesized in timed phrases and fitted without clipping words. Full names are displayed on screen because all three cannot be spoken intelligibly within the required two-second introduction.
SOUND: Voice-led. No music catalog/sign-in is available; do not substitute unreviewable generated music. Narration remains audible and levels are measured.
BANNED: Invented dashboards; invented NASA partner datasets; unqualified claims of validated global harmonization; showing illustrative data as live; fake disaster statistics; decorative glow/particles; unreadable UI; slide decks of feature cards; a logo stuck in a corner.
QA: Inspect start, 2.6s, 7s, 11.5s, 16.5s, 22s and 28s plus all cut boundaries. Run full HyperFrames check, inspect exported frames, verify non-empty H.264/AAC MP4 and duration ≤30s with FFprobe. Audio is measured, not listened to by the agent.
