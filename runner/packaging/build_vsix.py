"""Backwards-compatible Runner VSIX build; delegates to the shared root builder."""
from pathlib import Path
import subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
raise SystemExit(subprocess.call([sys.executable,str(ROOT/"scripts/build_vsix.py"),"--only","runner"]))
