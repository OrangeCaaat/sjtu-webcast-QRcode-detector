from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'temp' / 'python-deps'))
import qrcode
ROOT = Path(__file__).resolve().parent.parent
target = ROOT / 'tests' / 'private'
target.mkdir(parents=True, exist_ok=True)
for name, value in {'a':'https://example.org/course-a?token=first', 'b':'https://example.org/course-a?token=refreshed', 'c':'https://example.org/course-b?token=first'}.items():
    qrcode.make(value).save(target / f'{name}.png')
print('Synthetic fixtures created in tests/private/')
