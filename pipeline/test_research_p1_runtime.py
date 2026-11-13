import asyncio
import sys
import unittest
from unittest.mock import patch

import research_p1_runtime as runtime
from research_jobs import WorkerFailure
from research_p1_runtime import private_process


class P1RuntimeTests(unittest.TestCase):
    def test_subprocess_bridge_works_on_the_psycopg_selector_loop(self):
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            result = runner.run(private_process([sys.executable, "-c", "import json,sys; print(json.dumps(json.load(sys.stdin)))"], {"synthetic": True}))
        self.assertEqual(result, {"synthetic": True})

    def test_cancellation_kills_the_producer_without_blocking_the_heartbeat_loop(self):
        children = []
        popen = runtime.subprocess.Popen

        def track(*args, **kwargs):
            child = popen(*args, **kwargs)
            children.append(child)
            return child

        async def exercise():
            work = asyncio.create_task(private_process([sys.executable, "-c", "import time; time.sleep(30)"], {}))
            for _ in range(3):
                await asyncio.sleep(0.02)
            self.assertIsNone(children[0].poll())
            work.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(work, 2)
            self.assertIsNotNone(children[0].poll())

        with patch.object(runtime.subprocess, "Popen", side_effect=track), asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(exercise())

    def test_oversized_output_fails_with_a_bounded_code(self):
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            with self.assertRaises(WorkerFailure) as error:
                runner.run(private_process([sys.executable, "-c", "print('private-sentinel' * 1000)"], {}, limit=64))
        self.assertEqual(str(error.exception), "PROCESSOR_FAILED")
