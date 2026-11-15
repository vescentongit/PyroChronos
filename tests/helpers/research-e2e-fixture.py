"""Explicit synthetic archives/model for P1 end-to-end tests only."""
import contextlib
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from harmonize_config import CONFIG_HASH
from research_p1_producer import describe_producer
from test_harmonization import MODEL, POLICY
from test_research_adapter import fixture

root = Path(sys.argv[1])
with contextlib.redirect_stdout(io.StringIO()):
    fixture(root)
models = root / "models"
models.mkdir(exist_ok=True)
if "--raw" not in sys.argv:
    (models / f"model-{CONFIG_HASH[:12]}.json").write_text(json.dumps(MODEL), encoding="utf-8")
    (models / f"baseline-{CONFIG_HASH[:12]}.json").write_text(json.dumps(POLICY), encoding="utf-8")
print(json.dumps(describe_producer(root / "store", models_dir=models, mode="demo")))
