"""Prepare only public prototype assets; preserve both source directories."""
import hashlib
import json
import re
import shutil
import tarfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = '20261002-tianli-v3-v4-' + uuid.uuid4().hex[:8]
OUT = ROOT / 'deployment' / 'releases' / RELEASE
SITE = OUT / 'site'
SITE.mkdir(parents=True, exist_ok=False)
records = []

for version, count, images in [('v3', 170, 182), ('v4', 80, 96)]:
    source = ROOT / 'design' / ('prototype-' + version)
    target = SITE / version
    target.mkdir()
    report = json.loads((source / 'verification' / 'verification.json').read_text(encoding='utf-8-sig'))
    assert report['summary']['screens'] == count
    assert report['summary']['issues'] == 0
    for path in source.iterdir():
        if path.is_file() and path.suffix in {'.html', '.css', '.js'}:
            assert not path.is_symlink()
            shutil.copy2(path, target / path.name)
    for folder in ['vendor', 'exports']:
        assert (source / folder).is_dir() and not (source / folder).is_symlink()
        shutil.copytree(source / folder, target / folder)
    assert not [p for p in (target / 'exports').iterdir() if p.is_dir()]
    assert len(list((target / 'exports').glob('*.png'))) == images
    # Deployment-facing explanations omit local paths and internal evidence files.
    label = '完整流程版' if version == 'v3' else '预约版'
    public_readme = f'''# 天俪 {version} · {label}

[流程演示](demo.html) · [全部设计稿](index.html) · [版本入口](../index.html)

本版本包含{count}个页面状态。演示中的支付、身份核验、定位、消息、文件和资金结果为模拟，不产生真实交易；请使用虚构资料。

演示记录保存在当前浏览器标签页，刷新可继续。切换用户、技师和店长可查看同一笔记录；重置演示可重新开始。画廊中的页面使用独立示例，内容可上下滚动。

本地已有渲染与交互验证通过；正式后端、真实微信接口、真机和审核仍需单独验证。
'''
    (target / 'README.md').write_text(public_readme, encoding='utf-8')
    (target / 'coverage.md').write_text(public_readme + '\n导出图包括单页和流程总览；文件名保持扁平，每张总览引用图片均已检查解码。\n', encoding='utf-8')
    for html in target.glob('*.html'):
        text = html.read_text(encoding='utf-8-sig')
        for ref in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', text):
            if ref.startswith(('http:', 'https:', 'data:', '#')) or '${' in ref:
                continue
            file = ref.split('?', 1)[0].split('#', 1)[0]
            assert (html.parent / file).is_file(), (html.name, ref)
    records.append({'version': version, 'screens': count, 'png': images, 'localValidation': report['summary']})

landing = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>天俪 · 原型评审</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f6f7;color:#25282d;font:15px/1.7 "Microsoft YaHei",sans-serif}main{max-width:760px;margin:60px auto;padding:0 20px}h1{font-size:26px;margin:0 0 8px}h2{font-size:19px;margin:0 0 8px}p{color:#737a83;margin:8px 0}section{background:white;border:1px solid #e6e8eb;border-radius:12px;padding:24px;margin:20px 0}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}a{min-height:48px;padding:10px 18px;display:flex;align-items:center;justify-content:center;border:1px solid #dcdee2;border-radius:8px;text-decoration:none;color:#25282d;background:#fff}a.primary{background:#c94f35;border-color:#c94f35;color:white}.note{font-size:13px}</style></head><body><main><h1>天俪 · 原型评审</h1><p>选择版本，查看三类端页面和预约流程。</p><section><h2>v3 · 完整流程版</h2><p>170个页面状态，包含原服务流程、异常处理与资金状态。</p><div class="actions"><a class="primary" href="v3/demo.html">体验流程</a><a href="v3/index.html">查看设计稿</a></div></section><section><h2>v4 · 预约版</h2><p>80个页面状态，选择门店、项目、技师和时间，保留定位与就近匹配交互。</p><div class="actions"><a class="primary" href="v4/demo.html">体验流程</a><a href="v4/index.html">查看设计稿</a></div></section><p class="note">数据与外部接口均为演示，请使用虚构资料。原型记录在当前浏览器标签页保存。</p></main></body></html>'''
(SITE / 'index.html').write_text(landing, encoding='utf-8')
manifest = []
for path in sorted(SITE.rglob('*')):
    if not path.is_file():
        continue
    data = path.read_bytes()
    manifest.append({'path': path.relative_to(SITE).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(SITE / 'manifest.json').write_text(json.dumps({'release': RELEASE, 'versions': records, 'files': manifest}, ensure_ascii=False, indent=2), encoding='utf-8')
archive = OUT / (RELEASE + '.tar.gz')
with tarfile.open(archive, 'w:gz') as bundle:
    for path in sorted(SITE.rglob('*')):
        if path.is_file():
            bundle.add(path, arcname=path.relative_to(SITE).as_posix(), recursive=False)
result = {'release': RELEASE, 'site': str(SITE), 'archive': str(archive), 'archiveBytes': archive.stat().st_size, 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'files': len(manifest) + 1, 'versions': records}
(OUT / 'prepared.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
(ROOT / 'deployment' / 'prepared-release.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
