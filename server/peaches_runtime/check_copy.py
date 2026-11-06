"""Check a portable copy outside Branchline, offline, without keys or UI."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from package import LIMIT, inspect_files, unpack
if __name__=='__main__':
    try:
        file=Path(sys.argv[1])
        if file.stat().st_size>LIMIT: raise ValueError('Copy exceeds 1 MiB.')
        report=inspect_files(unpack(file.read_bytes()))
        report.pop('bundle')
        print(json.dumps(report,ensure_ascii=True,indent=2))
    except Exception as error:
        print(json.dumps({'status':'Could not check','error':str(error)}));sys.exit(1)
