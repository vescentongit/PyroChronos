"""Format validated immutable input from the private worker's NDJSON stream."""
import json
import sys

from research_export import aggregate_rows, raw_rows, write_csv


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="")
    try:
        request = json.loads(sys.stdin.readline())
        if request["kind"] == "raw-hotspots-csv":
            header, rows = raw_rows(json.loads(line) for line in sys.stdin)
        elif request["kind"] == "harmonized-aggregates-csv":
            header, rows = aggregate_rows(request["result"], request["periodRole"])
        else:
            raise ValueError("INVALID_EXPORT_KIND")
        write_csv(sys.stdout, header, rows)
        return 0
    except (ValueError, KeyError, TypeError, OSError, UnicodeError):
        print("EXPORT_FORMAT_FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
