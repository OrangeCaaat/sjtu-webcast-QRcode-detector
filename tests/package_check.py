from pathlib import Path
import zipfile, json, re

ROOT = Path(__file__).resolve().parent.parent
archive = ROOT / '课堂哨-Edge-Chrome-0.1.1.zip'
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None, 'ZIP CRC failure'
    names=set(package.namelist())
    assert all(not name.startswith(('/', '\\')) and '..' not in name.split('/') for name in names)
    assert not any(name.startswith(('tests/','temp/')) for name in names)
    assert '使用指南.md' in names
    guide = package.read('使用指南.md').decode('utf8')
    assert '## 安装' in guide and '## 开始监控' in guide
    assert not any(text in guide for text in ('readme-dev.md','实机验收操作指南.md','## 可选：手动测试工具'))
    assert not any(name.startswith(('tools/','src/','scripts/')) or name.endswith('.py') for name in names)
    manifest=json.loads(package.read('manifest.json'))
    assert manifest['manifest_version']==3
    assert 'host_permissions' not in manifest and 'tabs' not in manifest['permissions']
    assert manifest['background']['service_worker'] in names
    assert {'wasm/zxing_reader.wasm','popup.html','settings.html','offscreen.html','content.js','licenses/ZXing-Cpp-LICENSE.txt'} <= names
    for name in names:
        if name.endswith('.html'):
            for target in re.findall(r'(?:src|href)="([^"#]+)"',package.read(name).decode('utf8')):
                if not target.startswith(('http:','https:','data:')):
                    assert target.removeprefix('./') in names,(name,target)
    print(f'Package: PASS ({len(names)} files, CRC, MV3, local assets, licenses, minimal permissions)')
