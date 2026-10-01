from pathlib import Path
import os
import time

ROOT = Path(__file__).resolve().parent.parent
def executable(playwright):
    expected = Path(playwright.chromium.executable_path)
    if expected.exists():
        return str(expected)
    choices = list((ROOT / 'temp' / 'browsers').glob('chromium-*/chrome-win64/chrome.exe'))
    choices += list((Path(os.environ['LOCALAPPDATA']) / 'ms-playwright').glob('chromium-*/chrome-win64/chrome.exe'))
    if not choices:
        raise RuntimeError('Install Playwright Chromium, or provide an existing Chrome for Testing runtime.')
    return str(sorted(choices)[-1])

def wait_truthy(page, expression, timeout=10000):
    """Await async expressions explicitly; wait_for_function treats Promises as truthy."""
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if page.evaluate(expression):
            return
        page.wait_for_timeout(100)
    raise TimeoutError('Async condition did not become true: ' + expression)
