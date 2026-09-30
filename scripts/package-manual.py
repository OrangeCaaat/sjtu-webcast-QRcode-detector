"""Package the optional manual acceptance helper without touching old files."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
files = [ROOT / '启动手动验收页.cmd', ROOT / '实机验收操作指南.md',
         ROOT / '安装与使用.md', ROOT / '验收记录.md']
files += sorted((ROOT / 'tools' / 'manual').glob('*'))
archive = ROOT / '课间哨-手动验收工具.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for source in files:
        if source.is_file():
            package.write(source, source.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
print(f'Manual helper: {archive.name}')
