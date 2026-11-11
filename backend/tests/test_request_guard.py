import unittest

from app.services.request_guard import TokenBucketLimiter


class TokenBucketLimiterTests(unittest.TestCase):
    def test_allows_burst_then_returns_429_equivalent_until_refill(self):
        limiter = TokenBucketLimiter(capacity=3, refill_per_second=1)
        self.assertTrue(limiter.allow("127.0.0.1", now=10.0))
        self.assertTrue(limiter.allow("127.0.0.1", now=10.0))
        self.assertTrue(limiter.allow("127.0.0.1", now=10.0))
        self.assertFalse(limiter.allow("127.0.0.1", now=10.0))
        self.assertTrue(limiter.allow("127.0.0.1", now=11.0))

    def test_clients_have_independent_buckets(self):
        limiter = TokenBucketLimiter(capacity=1, refill_per_second=1)
        self.assertTrue(limiter.allow("client-a", now=1.0))
        self.assertFalse(limiter.allow("client-a", now=1.0))
        self.assertTrue(limiter.allow("client-b", now=1.0))

    def test_bucket_memory_is_bounded(self):
        limiter = TokenBucketLimiter(capacity=2, refill_per_second=1, max_keys=3)
        for index in range(10):
            limiter.allow(f"client-{index}", now=float(index))
        self.assertLessEqual(len(limiter._buckets), 3)

    def test_clock_rollback_does_not_mint_tokens(self):
        limiter = TokenBucketLimiter(capacity=1, refill_per_second=1)
        self.assertTrue(limiter.allow("client", now=10.0))
        self.assertFalse(limiter.allow("client", now=9.0))


if __name__ == "__main__":
    unittest.main()
