"""Parameterized PostgreSQL writes against the schema owned by Prisma.

Use a psycopg async connection with dict_row and autocommit=True. Claims must
commit before HTTP I/O so competing jobs observe the PENDING attempt.
"""
import json

from firms import SafeFailure

CREATE_FIELDS = (
    "id", "sourceId", "sourceManifestVersion", "processingLevel", "productVersion",
    "regionId", "boundaryVersion", "regionConfigChecksum", "requestBbox",
    "requestedStart", "requestedEnd", "fetchStartedAt", "status",
)
UPDATE_FIELDS = frozenset((
    "status", "fetchedAt", "completedAt", "checksumSha256", "payloadRef", "payloadBytes",
    "httpStatus", "errorCode", "retryable", "validatorVersion", "rowCount", "validationSummary",
))


class PostgresRawBatches:
    def __init__(self, connection):
        self.connection = connection

    async def claim(self, record):
        result = None
        try:
            columns = ", ".join(f'"{field}"' for field in CREATE_FIELDS)
            placeholders = ", ".join("%s::jsonb" if field == "requestBbox" else "%s" for field in CREATE_FIELDS)
            params = [json.dumps(record[field]) if field == "requestBbox" else record[field] for field in CREATE_FIELDS]
            cursor = await self.connection.execute(
                f'INSERT INTO "RawBatch" ({columns}) VALUES ({placeholders}) '
                'ON CONFLICT ("id") DO NOTHING RETURNING *', params)
            row = await cursor.fetchone()
            if row is not None:
                result = True, row
            else:
                cursor = await self.connection.execute('SELECT * FROM "RawBatch" WHERE "id" = %s', [record["id"]])
                row = await cursor.fetchone()
                if row is not None:
                    result = False, row
        except Exception:
            pass
        if result is None:
            raise SafeFailure("DATABASE_FAILED", True)
        return result

    async def update(self, batch_id, fields):
        updated = False
        try:
            if not fields or not set(fields) <= UPDATE_FIELDS or "status" not in fields:
                raise ValueError
            assignments = ", ".join(f'"{field}" = %s' + ("::jsonb" if field == "validationSummary" else "") for field in fields)
            params = [json.dumps(value) if field == "validationSummary" and value is not None else value
                      for field, value in fields.items()]
            cursor = await self.connection.execute(
                f'UPDATE "RawBatch" SET {assignments} WHERE "id" = %s RETURNING "id"', [*params, batch_id])
            updated = await cursor.fetchone() is not None
        except Exception:
            pass
        if not updated:
            raise SafeFailure("DATABASE_FAILED", True)
