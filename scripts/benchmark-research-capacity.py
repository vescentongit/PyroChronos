"""Synthetic archive setup and self-resource probe; never reads deployment secrets."""
import contextlib
import ctypes
import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))


def resources():
    if sys.platform != "win32":
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF)
        return {"cpuSeconds": r.ru_utime + r.ru_stime,
                "peakRssBytes": r.ru_maxrss * (1 if sys.platform == "darwin" else 1024),
                "readTransferBytes": None, "writeTransferBytes": None}
    from ctypes import wintypes as w

    class Memory(ctypes.Structure):
        _fields_ = [("cb", w.DWORD), ("PageFaultCount", w.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = w.HANDLE
    handle = w.HANDLE(kernel.GetCurrentProcess())
    memory, counters = Memory(), IO()
    memory.cb = ctypes.sizeof(memory)
    if not ctypes.WinDLL("psapi").GetProcessMemoryInfo(handle, ctypes.byref(memory), memory.cb):
        raise ctypes.WinError()
    if not kernel.GetProcessIoCounters(handle, ctypes.byref(counters)):
        raise ctypes.WinError()
    return {"cpuSeconds": time.process_time(), "peakRssBytes": memory.PeakWorkingSetSize,
            "readTransferBytes": counters.ReadTransferCount,
            "writeTransferBytes": counters.WriteTransferCount}


def main():
    if sys.argv[1] == "fixture":
        from synthetic import MODIS_HEADER, VIIRS_HEADER, modis_row, viirs_row
        from test_research_adapter import build_archive
        root = Path(sys.argv[2])
        root.mkdir(parents=True, exist_ok=True)
        with contextlib.redirect_stdout(io.StringIO()):
            for source, row, header in (("MODIS_SP", modis_row, MODIS_HEADER),
                                        ("VIIRS_SNPP_SP", viirs_row, VIIRS_HEADER)):
                rows = [row(-2.0 - (i % 40) * .025, 113 + (i % 80) * .025,
                            f"2019-{1 + i % 12:02d}-{1 + (i // 12) % 28:02d}",
                            time=f"{(i // 336) % 24:02d}{i % 60:02d}") for i in range(6000)]
                build_archive(root, source, 2019, rows, header)
        print(json.dumps({"synthetic": True, "inputRows": 12000}))
        return
    from research_p1_producer import fingerprint
    from research_worker import produce
    request = json.load(sys.stdin)
    before, start = resources(), time.perf_counter()
    request["run"]["input"]["dataset"]["fingerprint"] = fingerprint(request["root"])
    bundle = produce(request["root"], request["run"])
    after = resources()
    print(json.dumps({"bundle": bundle, "resources": {
        "wallMs": (time.perf_counter() - start) * 1000,
        "cpuSeconds": after["cpuSeconds"] - before["cpuSeconds"],
        "peakRssBytes": after["peakRssBytes"],
        **{key: None if after[key] is None else after[key] - before[key]
           for key in ("readTransferBytes", "writeTransferBytes")}}}, allow_nan=False))


if __name__ == "__main__":
    main()
