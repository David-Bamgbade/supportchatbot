import asyncio
from concurrent.futures import ThreadPoolExecutor

class AsyncRunner:
    def __init__(self):
        self.loop = asyncio.new_event_loop()
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.executor.submit(self._run_loop)

    def _run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run(self, coro):
        # Submits the coroutine to the background loop and waits for the result
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return future.result()

# Global instance
runner = AsyncRunner()