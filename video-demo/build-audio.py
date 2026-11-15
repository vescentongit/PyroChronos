import json, os, pathlib, subprocess, tempfile, wave
root=pathlib.Path(__file__).parent
tools=pathlib.Path(tempfile.gettempdir())/'pyro-video-tools'
ffmpeg=os.environ.get('HYPERFRAMES_FFMPEG_PATH',str(tools/'ffmpeg.exe'))
parts=json.loads((root/'narration.json').read_text())
audio_dir=tools/'voice-fit';audio_dir.mkdir(exist_ok=True)
outputs=[];measurements=[]
for i,phrase in enumerate(parts):
    source=root/'assets'/f'voice-{i:02}.wav'
    with wave.open(str(source),'rb') as w: duration=w.getnframes()/w.getframerate()
    slot=phrase['end']-phrase['start']
    tempo=max(1,duration/(slot-.15))
    output=audio_dir/f'{i:02}.wav'
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(source),'-af',
      f'atempo={tempo:.6f},apad,atrim=duration={slot}','-ar','48000','-ac','1','-c:a','pcm_s16le',str(output)],check=True)
    outputs.append(output);measurements.append({'segment':i,'sourceSeconds':duration,'slotSeconds':slot,'tempo':tempo})
assembled=audio_dir/'assembled.wav'
with wave.open(str(assembled),'wb') as dest:
    dest.setnchannels(1);dest.setsampwidth(2);dest.setframerate(48000)
    for output in outputs:
        with wave.open(str(output),'rb') as w: dest.writeframes(w.readframes(w.getnframes()))
subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(assembled),'-af','loudnorm=I=-16:TP=-1.5:LRA=7',
    '-ar','48000','-ac','1','-c:a','pcm_s16le',str(root/'assets/narration.wav')],check=True)
with wave.open(str(root/'assets/narration.wav'),'rb') as w: final=w.getnframes()/w.getframerate()
assert abs(final-30)<.001
(root/'assets/audio-timing.json').write_text(json.dumps({'voice':'Microsoft Zira Desktop','duration':final,'segments':measurements},indent=2))
def timestamp(seconds): return f'{seconds//3600:02}:{seconds%3600//60:02}:{seconds%60:02},000'
subtitles=[]
for i,p in enumerate(parts):
    text=p['text'].replace('NASA Com','NasaCom').replace('Pyro Chronos','PyroChronos')
    subtitles.append(f'{i+1}\n{timestamp(p["start"])} --> {timestamp(p["end"])}\n{text}\n')
(root/'PyroChronos-NasaCom.srt').write_text('\n'.join(subtitles),encoding='utf-8')
print(json.dumps({'narrationSeconds':final,'segments':len(parts)},indent=2))
