"""python3 -m unittest tests/test_wake_date.py"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SUPABASE_URL", "x")
from sync_whoop import wake_date_from


class WakeDate(unittest.TestCase):
    def test_early_ist_wake_keeps_its_own_day(self):
        # 2025-01-02 03:15 IST = 2025-01-01 21:45 UTC: the UTC date filed it a day early.
        self.assertEqual(wake_date_from("2025-01-01T21:45:00.000Z", None, "+05:30"), "2025-01-02")

    def test_normal_wake(self):
        self.assertEqual(wake_date_from("2026-10-17T04:43:00.000Z", None, "+05:30"), "2026-10-17")

    def test_travel_offset_used(self):
        # 2025-12-01 01:30 at +04:00 = 2025-11-30 21:30 UTC.
        self.assertEqual(wake_date_from("2025-11-30T21:30:00.000Z", None, "+04:00"), "2025-12-01")

    def test_missing_offset_falls_back_to_cycle_then_ist(self):
        self.assertEqual(wake_date_from("2025-10-17T22:26:00Z", None, None, "+05:30"), "2025-10-18")
        self.assertEqual(wake_date_from("2025-10-17T22:26:00Z", None), "2025-10-18")

    def test_no_sleep_uses_cycle_start(self):
        self.assertEqual(wake_date_from(None, "2026-10-16T17:00:00Z", None, "+05:30"), "2026-10-16")
        self.assertIsNone(wake_date_from(None, None))


if __name__ == "__main__":
    unittest.main()
