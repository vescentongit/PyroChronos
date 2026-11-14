"""Print the date range FIRMS serves per source (no key is printed or written).

Usage:
  python pipeline/firms_availability.py
  python pipeline/firms_availability.py --filter VIIRS_SNPP
"""

import argparse
import csv
import io
import sys

from firms_ingest import FirmsIngestError, http_get, read_key

URL = "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{key}/ALL"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--filter", default="")
    args = parser.parse_args(argv)
    key = read_key()
    if not key:
        print("error: FIRMS_MAP_KEY is not configured", file=sys.stderr)
        return 1
    try:
        status, body = http_get(URL.format(key=key))
    except (OSError, FirmsIngestError) as error:
        print(f"error: request failed ({type(error).__name__})", file=sys.stderr)
        return 1
    if status != 200:
        print(f"error: HTTP {status}", file=sys.stderr)
        return 1
    rows = list(csv.reader(io.StringIO(body.decode("utf-8", "replace"))))
    if not rows or "data_id" not in rows[0]:
        print("error: unexpected response", file=sys.stderr)
        return 1
    for row in rows[1:]:
        if args.filter in row[0]:
            print(",".join(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
