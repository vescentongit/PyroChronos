"""Frozen Nathan producer configuration and P1 publication provenance."""
import calendar
import hashlib
import json
import os
import subprocess
from pathlib import Path

import harmonize_config
from area_counts import DEFAULT_SOURCES, QUALITY_POLICY, SATELLITE_CONFIG_VERSION
from detection_store import FORMAT_VERSION, source_coverage
from research_adapter import BASELINE_POLICY, load_default_harmonization

PIPELINE = Path(__file__).resolve().parent


def digest(content):
    return "sha256:" + hashlib.sha256(content).hexdigest()


def document(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fingerprint(root):
    if hasattr(root, "fingerprint"):
        return root.fingerprint()
    root = Path(root)
    if not root.is_dir():
        raise ValueError("MISSING_DATASET")
    checksum = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and (p.suffix == ".pcd" or p.name == "manifest.jsonl")):
        checksum.update(path.relative_to(root).as_posix().encode() + b"\0")
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                checksum.update(block)
    return "sha256:" + checksum.hexdigest()


def producer_version():
    files = ["research_worker.py", "research_p1_producer.py", "research_adapter.py", "reference_baseline.py", "area_counts.py", "area_query.py", "detection_store.py", "harmonize_config.py", "firms_catalog.py"]
    return "research-p1-" + hashlib.sha256(b"".join((PIPELINE / name).read_bytes() for name in files)).hexdigest()[:32]


def describe_producer(root, models_dir=None, build_commit=None, mode="research"):
    model, baseline = load_default_harmonization(models_dir=models_dir)
    model_text = document(model) if model is not None else None
    baseline_text = document(baseline) if baseline is not None else None
    policy = document({"quality": QUALITY_POLICY, "harmonization": harmonize_config.describe(), "satelliteConfigVersion": SATELLITE_CONFIG_VERSION})
    commit = build_commit or os.environ.get("RESEARCH_BUILD_COMMIT")
    if commit is None:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=PIPELINE.parent, capture_output=True, text=True, check=True).stdout.strip()
    if mode not in {"research", "replay", "demo"}:
        raise ValueError("INVALID_MODE")
    return {
        "schemaVersion": "research-producer-config-1", "fingerprint": fingerprint(root),
        "sources": list(DEFAULT_SOURCES), "archives": {source: [{"year": year, "checksum": entry["sha256"]} for year, entry in source_coverage(root, source).items()] for source in DEFAULT_SOURCES},
        "producerVersion": producer_version(), "buildCommit": commit, "mode": mode,
        "modelVersion": "1", "model": model_text, "baseline": baseline_text,
        "modelChecksum": digest(model_text.encode()) if model_text is not None else None,
        "baselineChecksum": digest(baseline_text.encode()) if baseline_text is not None else None,
        "policyChecksum": digest(policy.encode()), "policyDocument": policy,
        "qualityPolicyVersion": QUALITY_POLICY["version"], "satelliteConfigVersion": SATELLITE_CONFIG_VERSION,
        "aggregationVersion": FORMAT_VERSION,
        "baselinePolicyVersion": baseline["policyVersion"] if baseline else BASELINE_POLICY,
        "minimumValidYears": baseline["minimumValidYears"] if baseline else 10,
    }


def frozen_harmonization(config, window_years):
    for field in ("model", "baseline"):
        text, checksum = config[field], config[field + "Checksum"]
        if (text is None) != (checksum is None) or (text is not None and digest(text.encode()) != checksum):
            raise ValueError("CONFIGURATION_CHANGED")
    if digest(config["policyDocument"].encode()) != config["policyChecksum"] or config["producerVersion"] != producer_version():
        raise ValueError("CONFIGURATION_CHANGED")
    model = json.loads(config["model"]) if config["model"] is not None else None
    baseline = json.loads(config["baseline"]) if config["baseline"] is not None else None
    if model is not None and model["configHash"] != harmonize_config.CONFIG_HASH:
        raise ValueError("CONFIGURATION_CHANGED")
    if baseline is not None:
        baseline = {**baseline, "windowYears": window_years, "minimumValidYears": min(baseline["minimumValidYears"], window_years)}
    return model, baseline


def split_period(span):
    start, end = span["start"], span["end"]
    year, month = map(int, end.split("-"))
    return {"start": start + "-01", "end": f"{end}-{calendar.monthrange(year, month)[1]:02d}"}


def publication_manifest(built, data, job_id, workspace_id):
    result, native, config = built["result"], built["manifest"], data["producer"]
    harmonization = native.get("harmonization")
    return {
        "schemaVersion": "research-manifest-1", "id": native["id"], "jobId": job_id, "workspaceId": workspace_id,
        **data["versions"], "areaId": data["area"]["id"], "areaRevision": data["area"]["revision"], "geometryHash": data["area"]["geometryHash"],
        "qualityPolicyVersion": result["qualityPolicyVersion"], "baselinePolicyVersion": result["baseline"]["policyVersion"],
        "producerVersion": config["producerVersion"], "buildCommit": config["buildCommit"],
        "pairingPolicyVersion": harmonization["configHash"] if harmonization else "raw-no-pairing-1",
        "missingnessPolicyVersion": "archive-observation-coverage-1",
        "trainPeriod": split_period(harmonization["split"]["train"]) if harmonization else None,
        "testPeriod": split_period(harmonization["split"]["test"]) if harmonization else None,
        "sourceSnapshots": [{"sourceId": source["id"], "processingLevel": source["processingLevel"], "productVersion": source["version"], "checksum": source["checksum"], "batchIds": [], "archiveRevision": source["checksum"], "ingestedAt": None} for source in result["sources"]],
        "producerMetadata": {"nativeManifestChecksum": "sha256:" + native["contentSha256"], "archiveFingerprint": config["fingerprint"], "modelChecksum": config["modelChecksum"], "baselineChecksum": config["baselineChecksum"], "policyChecksum": config["policyChecksum"], "archives": config["archives"], "harmonization": harmonization},
    }
