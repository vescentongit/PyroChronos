"""Private, local durable-volume adapter; no credential-bearing public URLs."""
import asyncio
import hashlib
import os
import tempfile
from pathlib import Path
from uuid import UUID

from firms import SafeFailure


class FileRawStorage:
    def __init__(self, root):
        self.root = Path(root).resolve()

    async def put(self, batch_id, payload):
        failure = False
        try:
            return await asyncio.to_thread(self._put, batch_id, payload)
        except Exception:
            failure = True
        if failure:
            raise SafeFailure("STORAGE_FAILED", True)

    def _put(self, batch_id, payload):
        if str(UUID(batch_id)) != batch_id:
            raise ValueError
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        ref = f"{batch_id}.csv"
        target = self.root / ref
        # Publish atomically without replacing an existing object, even on races.
        with tempfile.NamedTemporaryFile(dir=self.root, prefix=".batch-", delete=False) as handle:
            temporary = Path(handle.name)
            try:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            except BaseException:
                handle.close()
                temporary.unlink(missing_ok=True)
                raise
        try:
            try:
                os.link(temporary, target)
            except FileExistsError:
                pass
            if target.is_symlink():
                raise ValueError
            with target.open("rb") as stored:
                verified = stored.read(len(payload) + 1)
            if verified != payload:
                raise ValueError
            return {"payloadRef": ref, "payloadBytes": len(verified),
                    "checksumSha256": hashlib.sha256(verified).hexdigest()}
        finally:
            temporary.unlink(missing_ok=True)
