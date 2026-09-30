@echo off
cd /d "%~dp0"
python "%~dp0tools\manual\serve.py"
if errorlevel 1 (
  echo Python could not start. See the manual acceptance guide.
  pause
)
