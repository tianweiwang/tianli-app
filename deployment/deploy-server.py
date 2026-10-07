"""Install a verified static release with backups and rollback. Run via SSH."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--archive', required=True)
p.add_argument('--release', required=True)
p.add_argument('--sha256', required=True)
p.add_argument('--attempt', default='first')
a = p.parse_args()
assert os.geteuid() == 0
assert re.fullmatch(r'20\d{6}-tianli-v3-v4-[a-f0-9]{8}', a.release)
assert re.fullmatch(r'[a-z0-9-]{1,24}', a.attempt)
sha = lambda b: hashlib.sha256(b).hexdigest()
archive = Path(a.archive)
assert archive.parent == Path('/tmp') and archive.is_file()
assert sha(archive.read_bytes()) == a.sha256, 'Archive hash mismatch'

base = Path('/srv/tianli-prototypes')
release = base / 'releases' / a.release
backup = base / 'backups' / (a.release if a.attempt == 'first' else a.release+'-'+a.attempt)
current = base / 'current'
config = Path('/etc/nginx/sites-enabled/badminton-venue-domain').resolve(strict=True)
snippet = Path('/etc/nginx/snippets/tianli-prototypes.conf')
marker = '# tianli-prototypes-managed'
include = 'include /etc/nginx/snippets/tianli-prototypes.conf;'
original = config.read_bytes()
old_snippet = snippet.read_bytes() if snippet.exists() else None
assert old_snippet is None or marker.encode() in old_snippet
assert not backup.exists(), 'Preserve existing attempt backup'
assert not release.is_symlink(), 'Release must be a real directory'
assert not current.exists() or current.is_symlink(), 'Refuse replacing a real current directory'
old_current = os.readlink(current) if current.is_symlink() else None
if include in original.decode():
    assert original.decode().count(include) == 1 and old_snippet is not None
    candidate_config = original
else:
    pattern = re.compile(r'(?m)^([ \t]*)include /etc/nginx/snippets/dorm-demo\.conf;[ \t]*$')
    matches = list(pattern.finditer(original.decode()))
    assert len(matches) == 1, 'Existing HTTPS location anchor is ambiguous'
    candidate_config = pattern.sub(lambda m: m.group(0) + '\n' + m.group(1) + include, original.decode()).encode()

def run(args, timeout=30):
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr.decode(errors='replace')[:1200])
    return r.stdout

def fetch(path):
    result = run(['curl', '-sS', '--connect-timeout', '5', '--max-time', '20', '--resolve', 'wxw.ac.cn:443:127.0.0.1', '-w', '\n%{http_code}', 'https://wxw.ac.cn'+path])
    body, status = result.rsplit(b'\n', 1)
    return {'status': int(status), 'sha256': sha(body)}

def atomic_write(path, data, mode=0o644):
    temp = path.with_name(path.name+'.tianli-'+a.release)
    temp.write_bytes(data)
    os.chmod(temp, mode)
    os.replace(temp, path)

baseline = {path: fetch(path) for path in ['/dorm-demo/index.html', '/dorm-mini-demo/index.html']}
run(['nginx', '-t'])
base.mkdir(mode=0o755, exist_ok=True)
(base / 'releases').mkdir(mode=0o755, exist_ok=True)
(base / 'backups').mkdir(mode=0o700, exist_ok=True)
reuse_release = release.exists()
if not reuse_release:
    release.mkdir(mode=0o755)
backup.mkdir(mode=0o700)
shutil.copy2(config, backup / 'nginx-domain.before.conf')
if old_snippet is not None:
    (backup / 'snippet.before.conf').write_bytes(old_snippet)
(backup / 'baseline.json').write_text(json.dumps(baseline, indent=2))
with tarfile.open(archive, 'r:gz') as tar:
    archive_files = set()
    for item in tar.getmembers():
        assert item.isfile() and not item.name.startswith('/')
        target = (release / item.name).resolve()
        assert target.is_relative_to(release.resolve()), 'Archive traversal'
        archive_files.add(item.name)
        if reuse_release:
            assert not (release/item.name).is_symlink()
            assert sha(target.read_bytes()) == sha(tar.extractfile(item).read()), 'Existing release differs: '+item.name
    if reuse_release:
        assert {str(f.relative_to(release)) for f in release.rglob('*') if f.is_file()} == archive_files
    else:
        tar.extractall(release)
for file in release.rglob('*'):
    assert not file.is_symlink()
    os.chmod(file, 0o755 if file.is_dir() else 0o644)
manifest = json.loads((release / 'manifest.json').read_text())
assert manifest['release'] == a.release
for item in manifest['files']:
    path = release / item['path']
    assert path.resolve().is_relative_to(release.resolve())
    assert sha(path.read_bytes()) == item['sha256'], item['path']

new_snippet = f'''{marker}
location = /tianli {{ return 302 /tianli/; }}
location ^~ /tianli/ {{
    alias /srv/tianli-prototypes/current/;
    index index.html;
    autoindex off;
    types {{
        text/html html;
        text/css css;
        application/javascript js;
        image/png png;
        image/jpeg jpg jpeg;
        image/svg+xml svg;
        text/plain md txt;
        application/json json;
    }}
    default_type application/octet-stream;
    charset utf-8;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options "nosniff" always;
    limit_except GET HEAD {{ deny all; }}
}}
'''.encode()
changed = False
try:
    assert config.read_bytes() == original, 'Nginx config changed during preparation'
    changed = True
    atomic_write(snippet, new_snippet)
    atomic_write(config, candidate_config, config.stat().st_mode & 0o777)
    run(['nginx', '-t'])
    next_link = base / ('current.next-'+a.release)
    os.symlink(release, next_link)
    os.replace(next_link, current)
    run(['systemctl', 'reload', 'nginx'])
    checks = {}
    for file in ['index.html', 'v3/demo.html', 'v3/index.html', 'v4/demo.html', 'v4/index.html']:
        expected = {'status': 200, 'sha256': sha((release/file).read_bytes())}
        attempts = []
        for retry in range(12):
            checks[file] = fetch('/tianli/'+file)
            attempts.append(checks[file])
            if checks[file] == expected:
                break
            time.sleep(0.5)
        assert checks[file] == expected, f'Entry check failed: {file}; responses={attempts}'
    after = {path: fetch(path) for path in baseline}
    assert after == baseline, 'Existing prototype response changed'
    result = {'success': True, 'release': a.release, 'releasePath': str(release), 'backup': str(backup), 'config': str(config), 'snippet': str(snippet), 'archiveSha256': a.sha256, 'filesVerified': len(manifest['files']), 'publicBase': 'https://wxw.ac.cn/tianli/', 'entryChecks': checks, 'existingSites': after}
    (backup / 'deployment.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
except Exception as error:
    if changed:
        assert config.read_bytes() in [original, candidate_config], 'Concurrent Nginx edit; manual recovery required'
        atomic_write(config, original, config.stat().st_mode & 0o777)
        if old_snippet is None:
            if snippet.exists() and snippet.read_bytes() == new_snippet:
                snippet.unlink()
        else:
            atomic_write(snippet, old_snippet)
        if current.is_symlink() and os.readlink(current) == str(release):
            if old_current is None:
                current.unlink()
            else:
                restore_link = base / ('current.restore-'+a.release)
                os.symlink(old_current, restore_link)
                os.replace(restore_link, current)
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
    (backup / 'failure.json').write_text(json.dumps({'error': str(error), 'rolledBack': changed}, indent=2))
    raise
