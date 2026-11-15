# PyroChronos · NasaCom demo

English landscape pitch, 1920×1080, 30 fps, 30 seconds. Team: Bagas Anugrah, Muhammad Orkhan, and Shaquille Nathan.

Deliverables:

- `PyroChronos-NasaCom-30s.mp4`: final narrated video with burned-in English captions.
- `PyroChronos-NasaCom.srt`: separate English subtitles.
- `index.html` and `compositions/`: editable HyperFrames project.
- `narration.json`: timed script; raw local voice segments and final mix are in `assets/`.

The real PyroChronos interface was captured in a fresh browser. The globe uses the bundled NASA FIRMS snapshot dated 8–14 November 2026. The historical workflow is a working prototype filmed with illustrative backend responses, clearly labeled on screen. It demonstrates the interface and does not certify live connectivity, field validation, or worldwide model validity. Credits and provenance are in `assets/capture-provenance.json`; the supplied project logo is used unchanged. Plus Jakarta Sans is bundled with its OFL license.

Narration uses the locally installed Microsoft Zira Desktop English voice, selected by the user. Short segments are fitted to the outline and normalized to a target of −16 LUFS / −1.5 dBTP. There is no background music. Audio was measured programmatically; human listening and pronunciation review are recommended before submission.

To edit and render, use Node.js 22+ and the pinned HyperFrames 0.9.52 CLI. FFmpeg and FFprobe must be installed, or configured with `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH`. Then run:

```powershell
npx hyperframes@0.9.52 check --json
npx hyperframes@0.9.52 preview --background
npx hyperframes@0.9.52 render --quality delivery --workers 1 --low-memory-mode -o PyroChronos-NasaCom-30s.mp4
```

`build-composition.py` regenerates the composition from the authored scene definitions. `build-audio.py` rebuilds the 30-second narration from the source segments using FFmpeg. `SPEC.md` records the shot plan; `REVIEW.md` records final verification and limitations.
