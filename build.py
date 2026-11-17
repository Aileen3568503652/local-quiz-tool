"""Build the offline, single-file release without external dependencies."""
from pathlib import Path
import re
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
PARTS = {'__STYLE_CSS__': 'style.css', '__PARSER_JS__': 'parser.js', '__CORE_JS__': 'core.js', '__APP_JS__': 'app.js'}

def build():
    content = (ROOT/'src'/'shell.html').read_text(encoding='utf-8')
    for placeholder, name in PARTS.items():
        part = (ROOT/'src'/name).read_text(encoding='utf-8')
        if name.endswith('.js'):
            # A literal closing script tag is unsafe even inside a JS string.
            part = re.sub(r'</script', r'<\\/script', part, flags=re.I)
        if placeholder not in content:
            raise ValueError(f'Missing build placeholder: {placeholder}')
        content = content.replace(placeholder, part)
    assert not any(key in content for key in PARTS)
    assert not re.search(r'<script\b[^>]*\bsrc\s*=',content,re.I), 'Release must work without external scripts'
    assert not re.search(r'<link\b[^>]*\bhref\s*=',content,re.I), 'Release must work without external styles'
    target=ROOT/'刷题神器.html'
    target.write_text(content,encoding='utf-8')
    if target.stat().st_size > 5*1024*1024:
        raise ValueError('Release exceeds 5 MB target')
    print(f'{target}\n{target.stat().st_size:,} bytes')
    release = ROOT / '刷题神器_便携版.zip'
    files = [target, ROOT/'README.md']
    if (ROOT/'示例资料').is_dir():
        files.extend(sorted((ROOT/'示例资料').glob('*')))
    with ZipFile(release, 'w', ZIP_DEFLATED) as archive:
        for file in files:
            if file.is_file():
                archive.write(file, file.relative_to(ROOT).as_posix())
    print(f'{release}\n{release.stat().st_size:,} bytes')

if __name__ == '__main__':
    build()
