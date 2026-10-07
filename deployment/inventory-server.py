import json
import pathlib
import re
import subprocess

result = {}
config = pathlib.Path('/etc/nginx/sites-enabled/badminton-venue-domain').resolve(strict=True)
text = config.read_text()
result['config'] = str(config)
result['routes'] = [line.strip() for line in text.splitlines() if re.match(r'\s*(listen|server_name|location|alias|root|include .*snippets)\b', line)]
snippets = pathlib.Path('/etc/nginx/snippets')
result['snippetFiles'] = [p.name for p in snippets.iterdir() if p.is_file()]
result['existingTianliPaths'] = []
for path in [config, *snippets.glob('*.conf')]:
    if '/tianli/' in path.read_text():
        result['existingTianliPaths'].append(str(path))
result['prototypesDirectoryExists'] = pathlib.Path('/srv/tianli-prototypes').exists()
result['python'] = subprocess.check_output(['python3', '--version'], text=True).strip()
for name in ['dorm-demo.conf', 'dorm-mini-demo.conf']:
    p = snippets / name
    if p.exists():
        result[name] = [line.strip() for line in p.read_text().splitlines() if re.match(r'\s*(location|alias|root|index)\b', line)]
print(json.dumps(result, ensure_ascii=False, indent=2))
