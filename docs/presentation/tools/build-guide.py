"""Render the instruction document, with embedded screenshots, without making a PPT."""
from pathlib import Path
import base64, html, json, re
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
md = MarkdownIt("commonmark", {"html": True}).enable("table")
CSS = """
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:35px}body{margin:0;background:#F8F6FF;color:#111;font-family:Pretendard,'Apple SD Gothic Neo',sans-serif;line-height:1.8;font-size:17px}a{color:#5431A6;text-underline-offset:3px}aside{position:fixed;inset:0 auto 0 0;width:270px;padding:34px 24px;background:white;border-right:1px solid #E3E3E3;overflow-y:auto}aside strong{display:block;font-size:25px;color:#5431A6}aside small{color:#5D5D5D}nav{margin-top:25px}nav a{display:block;text-decoration:none;font-size:14px;line-height:1.6;padding:7px 0}nav a:hover{color:#7F4FE6}main{max-width:1340px;margin-left:270px;padding:50px 55px 140px}h1{font-size:38px;line-height:1.35;letter-spacing:-.035em}h2{font-size:28px;margin-top:75px;padding-top:25px;border-top:2px solid #DCCCFF;line-height:1.5;color:#5431A6;letter-spacing:-.025em}h3{font-size:23px}p{margin:17px 0}blockquote{margin:22px 0;padding:14px 25px;border-left:5px solid #7F4FE6;background:#F0E8FF;font-size:23px;font-weight:600;line-height:1.7}blockquote p{margin:8px 0}table{border-collapse:collapse;width:100%;font-size:15px;margin:24px 0;background:#fff}th{background:#F0E8FF;text-align:left;color:#5431A6}th,td{border-bottom:1px solid #E3E3E3;padding:13px 14px;vertical-align:top}td code{font-size:12px;overflow-wrap:anywhere}code{background:#F0E8FF;padding:2px 5px;border-radius:4px;font-size:.87em;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:white;border:1px solid #DCCCFF;border-radius:12px;padding:20px;line-height:1.65}pre code{background:none;padding:0}img{width:100%;height:auto;border:1px solid #DCCCFF;border-radius:14px;display:block;margin:25px 0;cursor:zoom-in;background:white}hr{border:0;border-top:1px solid #E3E3E3;margin:50px 0}li{margin:7px 0}.document-note{padding:15px 22px;background:#FFF3CF;border-radius:8px;color:#634401;font-size:15px}.zoom{position:fixed;inset:0;background:rgba(17,17,17,.88);display:none;align-items:center;justify-content:center;padding:35px;z-index:10;cursor:zoom-out}.zoom.open{display:flex}.zoom img{max-width:95vw;max-height:93vh;width:auto;object-fit:contain;margin:0;cursor:zoom-out}.print{margin-top:20px;border:1px solid #DCCCFF;background:#F0E8FF;border-radius:8px;padding:8px 14px;font:inherit;font-size:14px;color:#5431A6;cursor:pointer}@media(max-width:1000px){aside{position:static;width:auto}nav{display:flex;gap:14px;flex-wrap:wrap}main{margin:0;padding:25px}h1{font-size:30px}table{font-size:13px}th,td{padding:8px}}@media print{aside,.zoom{display:none}main{margin:0;max-width:none;padding:0}h2{break-before:page}img{break-inside:avoid}a{color:inherit}body{font-size:12pt;background:white}blockquote{font-size:15pt}}
"""

def slug(value):
    return re.sub(r"[^\w\- ]", "", value).strip().lower().replace(" ", "-")

for source, target, title in [("slide-guide.md", "index.html", "10분 발표 지시서"), ("evidence-audit.md", "evidence-audit.html", "구현·실행 근거")]:
    text = (ROOT / source).read_text()
    content = md.render(text)
    toc = []
    def heading(match):
        clean = re.sub("<[^>]+>", "", match.group(1))
        key = slug(clean)
        toc.append((key,clean))
        return f'<h2 id="{key}">{match.group(1)}</h2>'
    content = re.sub(r"<h2>(.*?)</h2>", heading, content)
    def embed(match):
        rel = match.group(1)
        path = ROOT / rel
        if path.is_file() and path.suffix == ".png":
            return 'src="data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode() + '"'
        return match.group(0)
    content = re.sub(r'src="([^"]+)"', embed, content)
    content = content.replace('href="slide-guide.md', 'href="index.html').replace('href="evidence-audit.md','href="evidence-audit.html')
    links = ''.join(f'<a href="#{key}">{html.escape(label)}</a>' for key,label in toc)
    output = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>말모아 · {title}</title><style>{CSS}</style></head><body>
<aside><strong>말모아 · MALMOA</strong><small>{title}<br>2026.10.09 · 12장 · 600초</small><nav><a href="index.html">발표 구성·문구·대본</a><a href="evidence-audit.html">구현·실행 근거 부록</a>{links}</nav><button class="print" onclick="window.print()">인쇄 / PDF 저장</button></aside>
<main><div class="document-note">PPT 제작 전 지시서입니다. 이미지는 실제 서비스 캡처이며, 누르면 확대됩니다.</div>{content}</main>
<div class="zoom" role="dialog" aria-label="캡처 확대" aria-modal="true" tabindex="-1"><img alt="확대된 실제 서비스 캡처"></div>
<script>const z=document.querySelector('.zoom');document.querySelectorAll('main img').forEach(i=>i.addEventListener('click',()=>{{z.querySelector('img').src=i.src;z.classList.add('open');z.focus();}}));z.addEventListener('click',()=>z.classList.remove('open'));document.addEventListener('keydown',e=>{{if(e.key==='Escape')z.classList.remove('open');}});</script></body></html>'''
    (ROOT / target).write_text(output)
    print(target)

# Portable validation record: checks source references and screenshot files, not the app itself.
references=[]
for name in ["slide-guide.md","evidence-audit.md"]:
    source=(ROOT/name).read_text()
    for link in re.findall(r'\]\(([^)]+)\)',source):
        if '://' in link or link.startswith('#'):continue
        file=link.split('#')[0]
        references.append({"from":name,"target":link,"exists":(ROOT/file).exists()})
durations=[40,45,50,55,50,50,60,50,65,40,50,45]
report={"slides":12,"durations_seconds":durations,"total_seconds":sum(durations),"references":references,"missing":[r for r in references if not r['exists']]}
(ROOT/'evidence/document-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
if report['missing']:raise SystemExit('Missing document references')
