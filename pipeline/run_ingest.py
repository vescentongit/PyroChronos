"""Manual/private job entrypoint; never invoked by the public GET route."""
import argparse
import asyncio
import json
import os
import sys
from datetime import date

from firms import SafeFailure
from ingest import IngestService
from raw_batches import PostgresRawBatches
from raw_storage import FileRawStorage


class SafeArguments(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default error includes untrusted argument values.
        raise SafeFailure("INVALID_REQUEST")


async def run(args):
    # Imported here so protocol/unit tests need no native database driver.
    import psycopg
    from psycopg.rows import dict_row

    dsn, root = os.environ.get("DATABASE_URL"), os.environ.get("FIRMS_RAW_DIR")
    if not dsn or not root:
        return {"status": "FAILED", "errorCode": "CONFIG_MISSING", "retryable": False}
    try:
        async with await psycopg.AsyncConnection.connect(dsn, autocommit=True, row_factory=dict_row, connect_timeout=10) as connection:
            service = IngestService(PostgresRawBatches(connection), FileRawStorage(root),
                                    log=lambda record: print(json.dumps(record), file=sys.stderr))
            return await service.ingest(args.region, args.source, args.start, args.days, args.request_id)
    except Exception:
        return {"status": "FAILED", "errorCode": "DATABASE_FAILED", "retryable": True}


def main():
    parser = SafeArguments(description="Private FIRMS raw batch job (no credentials in arguments)")
    parser.add_argument("--region", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--request-id")
    result = None
    try:
        args = parser.parse_args()
        # psycopg needs a selector loop on Windows, not the default Proactor.
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            result = runner.run(run(args))
    except (SafeFailure, ValueError):
        result = {"status": "FAILED", "errorCode": "INVALID_REQUEST", "retryable": False}
    except Exception:
        result = {"status": "FAILED", "errorCode": "CONFIG_MISSING", "retryable": False}
    print(json.dumps(result))
    return 0 if result["status"] in ("VALID", "EMPTY") else 1


if __name__ == "__main__":
    raise SystemExit(main())
