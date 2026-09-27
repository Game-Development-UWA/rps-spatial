@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>&1
  if %ERRORLEVEL%==0 (
    set "PY=python"
  ) else (
    echo Python is not on PATH. Install Python 3.11+ from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  %PY% -m venv .venv
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python main.py
