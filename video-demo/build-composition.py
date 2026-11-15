import json,pathlib
root=pathlib.Path(__file__).parent
(root/'compositions').mkdir(exist_ok=True)
font="""@font-face{font-family:Jakarta;src:url('assets/fonts/plus-jakarta-500.ttf');font-weight:500}@font-face{font-family:Jakarta;src:url('assets/fonts/plus-jakarta-700.ttf');font-weight:700}*{box-sizing:border-box}#root{position:absolute;inset:0;background:#0e0e0e;color:#fff;font-family:Jakarta,sans-serif;overflow:hidden}h1,h2,p{margin:0;font-weight:500}h1,h2{font-weight:700;letter-spacing:-.035em}img{object-fit:contain}.accent{color:#ff715c}.small{font-size:32px;line-height:1.5;color:#d8e4f7}"""
def scene(name,style,body,tweens):
    doc=f'''<template><style>{font}{style}</style><div id="root" data-composition-id="{name}" data-width="1920" data-height="1080">{body}</div><script>
const tl=gsap.timeline({{paused:true}});
{tweens}
window.__timelines=window.__timelines||{{}};window.__timelines["{name}"]=tl;
</script></template>'''
    (root/'compositions'/f'{name}.html').write_text(doc,encoding='utf-8')
scene('introduction', '''
#intro-globe{position:absolute;left:1000px;top:72px;width:820px;height:690px}
#intro-team{position:absolute;left:192px;top:180px;width:740px;font-size:100px;line-height:1.08}
#intro-challenge{position:absolute;left:192px;top:176px;width:760px;font-size:76px;line-height:1.15}
#intro-names{position:absolute;left:192px;top:536px;font-size:39px;line-height:1.7;color:#e0e7f1}
#intro-source{position:absolute;left:1080px;top:773px;font-size:28px;color:#d8e4f7}
''','''
<img id="intro-globe" src="assets/globe.png" alt="Actual PyroChronos globe showing a fixed NASA FIRMS snapshot">
<h1 id="intro-team">We are<br><span class="accent">NasaCom</span></h1>
<h2 id="intro-challenge">Different sensors.<br>One fire history.</h2>
<p id="intro-names">Bagas Anugrah<br>Muhammad Orkhan<br>Shaquille Nathan</p>
<p id="intro-source">NASA FIRMS snapshot · 8–14 Nov 2026</p>
''','''
tl.fromTo("#intro-globe",{x:55,opacity:.65},{x:0,opacity:1,duration:.65,ease:"power3.out"},0);
tl.fromTo("#intro-team",{opacity:1},{opacity:0,duration:.18},1.82);
tl.fromTo("#intro-challenge",{opacity:0,x:-25},{opacity:1,x:0,duration:.35,ease:"power3.out"},2);
''')
scene('project','''
#project-globe{position:absolute;left:1000px;top:72px;width:820px;height:690px}
#project-name{position:absolute;left:192px;top:230px;font-size:112px;line-height:1.15}
#project-tagline{position:absolute;left:192px;top:425px;font-size:62px;line-height:1.35}
#project-source{position:absolute;left:192px;top:690px;font-size:31px;color:#d8e4f7;line-height:1.55}
''','''
<img id="project-globe" src="assets/globe.png" alt="Real project globe, not a fabricated dashboard">
<h1 id="project-name" data-hold>PyroChronos</h1>
<p id="project-tagline">See the fire.<br><span class="accent">Read the pattern.</span></p>
<p id="project-source">Harmonizing MODIS + VIIRS hotspots<br>NASA FIRMS · free, open observations</p>
''','''
tl.fromTo("#project-name",{opacity:.4,x:-32},{opacity:1,x:0,duration:.45,ease:"power4.out"},0);
tl.fromTo("#project-tagline",{opacity:0},{opacity:1,duration:.4},.7);
tl.fromTo("#project-source",{opacity:0},{opacity:1,duration:.4},2.4);
''')
scene('choose','''
#choose-root{position:absolute;inset:0;background:#0a3c91}
#choose-title{position:absolute;left:192px;top:196px;width:440px;font-size:72px;line-height:1.2}
#choose-note{position:absolute;left:192px;top:565px;width:410px;font-size:32px;line-height:1.5;color:#dbe7fc}
#choose-screen{position:absolute;left:670px;top:135px;width:1060px;height:610px;overflow:hidden;border-radius:12px;background:#0e0e0e}
#choose-controls{position:absolute;left:0;top:0;width:1484px;height:auto}
#choose-workflow{position:absolute;left:-285px;top:-200px;right:auto;bottom:auto;width:1500px;height:1042px;object-fit:contain;z-index:2}
#choose-label{position:absolute;left:670px;top:780px;font-size:29px;color:#e4edff}
''','''
<div id="choose-root"></div>
<h1 id="choose-title">Choose<br>an area.<br>Set a period.</h1>
<p id="choose-note">Same polygon.<br>Clear source records.</p>
<div id="choose-screen"><img id="choose-controls" data-layout-allow-overflow src="assets/area-controls.png" alt="Actual area and date controls from the working prototype"><video id="choose-workflow" class="clip" data-start="2" data-duration="2" data-media-start="3.8" data-track-index="2" data-layout-allow-overflow src="assets/workflow.webm" muted playsinline></video></div>
<p id="choose-label">Working prototype · illustrative analysis</p>
''','''
tl.fromTo("#choose-screen",{x:90,opacity:.5},{x:0,opacity:1,duration:.5,ease:"power3.out"},0);
tl.fromTo("#choose-controls",{x:-400,y:-95},{x:-400,y:-95,duration:.1},0);
tl.to("#choose-controls",{x:0,y:-385,duration:.65,ease:"power2.inOut"},1.8);
''')
scene('evidence','''
#evidence-title{position:absolute;left:192px;top:205px;width:430px;font-size:74px;line-height:1.2}
#evidence-second{position:absolute;left:192px;top:205px;width:430px;font-size:74px;line-height:1.2}
#evidence-note{position:absolute;left:192px;top:588px;width:420px;font-size:30px;line-height:1.55;color:#d8e4f7}
#evidence-panel{position:absolute;left:670px;top:135px;width:1060px;height:610px;overflow:hidden;border-radius:12px;background:#0e0e0e}
#evidence-result{position:absolute;left:0;top:0;width:1640px;height:auto}
#evidence-label{position:absolute;left:670px;top:780px;font-size:29px;color:#ffb2a6}
''','''
<h1 id="evidence-title">Read the<br>pattern.</h1>
<h2 id="evidence-second">Keep the<br>evidence.</h2>
<p id="evidence-note">Calendar · source comparison<br>CSV / JSON / PNG exports<br>Model limits stay visible.</p>
<div id="evidence-panel"><img id="evidence-result" data-layout-allow-overflow src="assets/analysis-result.png" alt="Actual calendar and export controls with illustrative prototype responses"></div>
<p id="evidence-label">Illustrative prototype data · not live conditions</p>
''','''
tl.fromTo("#evidence-result",{x:0,y:-20},{x:0,y:-20,duration:.1},0);
tl.fromTo("#evidence-title",{opacity:1},{opacity:0,duration:.2},2.8);
tl.fromTo("#evidence-second",{opacity:0},{opacity:1,duration:.3},3);
tl.to("#evidence-result",{y:-690,duration:.7,ease:"power2.inOut"},3.1);
''')
scene('future','''
#future-ground{position:absolute;inset:0;background:#0a3c91}
#future-title{position:absolute;left:192px;top:155px;width:850px;font-size:85px;line-height:1.16}
#future-title span{font-weight:500;font-size:55px;color:#dbe7fc;display:block;margin-bottom:25px}
#future-night{position:absolute;left:1080px;top:0;width:840px;height:1080px;background:#0e0e0e}
#future-globe{position:absolute;left:1090px;top:126px;width:690px;height:580px}
#future-phrase1,#future-phrase2,#future-phrase3{position:absolute;left:192px;top:650px;font-size:44px;color:#fff}
''','''
<div id="future-ground"></div>
<div id="future-night"></div>
<h1 id="future-title"><span>Our vision</span>Better-informed<br>action.</h1>
<img id="future-globe" src="assets/globe.png" alt="Satellite observations connect to an ambition for better preparedness">
<p id="future-phrase1">More targeted field checks</p>
<p id="future-phrase2">Stronger fire preparedness</p>
<p id="future-phrase3">Communities and ecosystems protected</p>
''','''
tl.fromTo("#future-globe",{x:70,opacity:.6},{x:0,opacity:1,duration:.7,ease:"power3.out"},0);
tl.fromTo("#future-phrase1",{opacity:1},{opacity:0,duration:.16},1.7);
tl.fromTo("#future-phrase2",{opacity:0},{opacity:1,duration:.22},1.9);
tl.to("#future-phrase2",{opacity:0,duration:.16},3.65);
tl.fromTo("#future-phrase3",{opacity:0},{opacity:1,duration:.22},3.85);
''')
scene('endcard','''
#end-logo{position:absolute;left:335px;top:252px;width:230px;height:230px}
#end-name{position:absolute;left:635px;top:287px;font-size:108px;line-height:1.2}
#end-tagline{position:absolute;left:635px;top:476px;font-size:57px;line-height:1.3}
#end-team{position:absolute;left:635px;top:670px;font-size:37px;color:#d8e4f7}
''','''
<img id="end-logo" src="assets/logo.png" alt="Supplied PyroChronos logo">
<h1 id="end-name" data-hold>PyroChronos</h1>
<p id="end-tagline">From observations<br><span class="accent">to informed action.</span></p>
<p id="end-team">NasaCom</p>
''','''
tl.fromTo("#end-logo",{scale:.8,x:-40},{scale:1,x:0,duration:.5,ease:"power3.out"},0);
tl.fromTo("#end-name",{opacity:.4,x:25},{opacity:1,x:0,duration:.5,ease:"power4.out"},0);
tl.fromTo("#end-tagline",{opacity:0},{opacity:1,duration:.4},.6);
''')
phrases=json.loads((root/'narration.json').read_text())
captions=''.join(f'<p id="cap-{i}" class="clip caption" data-start="{p["start"]}" data-duration="{p["end"]-p["start"]}" data-track-index="8">{p["text"].replace("NASA Com","NasaCom").replace("Pyro Chronos","PyroChronos")}</p>' for i,p in enumerate(phrases))
scene('captions','''
#root{background:transparent;pointer-events:none}
.caption{position:absolute;left:192px;top:850px;right:auto;bottom:auto;width:1536px;height:120px;text-align:center;font-size:35px;line-height:1.35;font-weight:500;color:#fff;padding:10px 28px;background:#10131bcc;border-radius:8px;display:flex;align-items:center;justify-content:center}
''',captions,'tl.to({}, {duration:30});')
hosts=''.join(f'<div id="{name}" class="clip" data-composition-id="{name}" data-composition-src="compositions/{name}.html" data-start="{start}" data-duration="{duration}" data-width="1920" data-height="1080" data-track-index="{i}" data-track-kind="graphics"></div>' for i,(name,start,duration) in enumerate([('introduction',0,5),('project',5,5),('choose',10,4),('evidence',14,6),('future',20,6),('endcard',26,4)]))
doc=f'''<!doctype html><html lang="en" data-resolution="landscape"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080"><script src="assets/gsap.min.js"></script><style>html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0e0e0e}}#root{{position:absolute;inset:0}}.clip{{position:absolute;inset:0}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="30" data-width="1920" data-height="1080" data-fps="30">{hosts}<div id="captions" class="clip" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="30" data-width="1920" data-height="1080" data-track-index="8" data-track-kind="captions"></div><audio id="voiceover" class="clip" src="assets/narration.wav" data-start="0" data-duration="30" data-track-index="9" data-volume="1"></audio></div><script>window.__timelines=window.__timelines||{{}};const tl=gsap.timeline({{paused:true}});tl.to({{}},{{duration:30}});window.__timelines.main=tl;</script></body></html>'''
(root/'index.html').write_text(doc,encoding='utf-8')
print('Wrote six editable scenes, captions, and root composition.')
