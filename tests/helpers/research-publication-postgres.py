"""Create/drop only random publication test schemas on the dedicated localhost DB."""
import json
import os
import re
import sys
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict


def main():
    try:
        settings = conninfo_to_dict(os.environ["RESEARCH_TEST_DATABASE_URL"])
        schema, operation = os.environ["PUBLICATION_TEST_SCHEMA"], sys.argv[1]
        if (settings.get("host") not in {"localhost", "127.0.0.1", "::1"}
                or settings.get("dbname") != "research_worker_test"
                or not re.fullmatch(r"publication_test_[a-f0-9]{32}", schema)
                or operation not in {"init", "drop"}):
            raise ValueError
        with psycopg.connect(os.environ["RESEARCH_TEST_DATABASE_URL"], autocommit=True, connect_timeout=5) as db:
            if operation == "drop":
                db.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            else:
                db.execute(f'CREATE SCHEMA "{schema}"')
                db.execute(f'SET search_path TO "{schema}", public')
                root = Path(__file__).resolve().parents[2] / "prisma/migrations"
                for migration in sorted(root.glob("*/migration.sql")):
                    db.execute(migration.read_text(encoding="utf-8"), prepare=False)
        print(json.dumps({"status": "ok"}))
        return 0
    except (KeyError, ValueError, IndexError, OSError, psycopg.Error):
        print(json.dumps({"status": "TEST_DATABASE_SETUP_FAILED"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
