"""Fixed launcher for Branchline's reviewed read-only Cabin package."""
import sys
from pathlib import Path
if len(sys.argv)!=2:raise SystemExit('Choose the configured Home package.')
sys.path.insert(0,str(Path(sys.argv[1]).absolute()))
from hearthline_cabin.shelf_server import main
main()
