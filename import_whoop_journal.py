#!/usr/bin/env python3
"""
import_whoop_journal.py — import WHOOP's journal_entries.csv into public.journal (migration 020).

Usage:
    python3 -I import_whoop_journal.py /path/to/journal_entries.csv [--dry-run]

The journal CSV writes Cycle start/end in the cycle's LOCAL time (see its "Cycle timezone"
column, e.g. UTC+05:30), while cycles.cycle_start is a UTC instant. So the offset is
subtracted before matching each journal cycle to its row in `cycles` (to the second), and the
row takes THAT cycle's wake_date. A journal cycle with no matching cycles row has no
wake_date and is skipped (listed in the output). Idempotent: upserts on (cycle_start, question).
"""
import csv
import os
import re
import site
import sys
from datetime import datetime, timedelta, timezone

sys.path.append(site.getusersitepackages())  # -I drops user site-packages; supabase lives there
from dotenv import load_dotenv  # noqa: E402
from supabase import create_client  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def local_to_utc(value, tz):
    """'2026-04-18 05:26:52' + 'UTC+05:30' -> aware UTC datetime."""
    if not value:
        return None
    naive = datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    m = re.fullmatch(r"UTC([+-])(\d{2}):(\d{2})", tz.strip())
    if not m:
        raise ValueError(f"unexpected timezone {tz!r}")
    off = timedelta(hours=int(m[2]), minutes=int(m[3])) * (1 if m[1] == "+" else -1)
    return naive - off


def parse_db_ts(v):
    v = v.replace("Z", "+00:00")
    v = re.sub(r"\.(\d+)", lambda m: "." + m[1].ljust(6, "0")[:6], v)
    return datetime.fromisoformat(v).replace(microsecond=0)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

    by_start, offset = {}, 0
    while True:
        page = sb.table("cycles").select("wake_date,cycle_start").range(offset, offset + 999).execute().data
        for c in page:
            if c["cycle_start"]:
                by_start[parse_db_ts(c["cycle_start"])] = c["wake_date"]
        offset += 1000
        if len(page) < 1000:
            break

    records, skipped = {}, set()
    with open(args[0], newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            start = local_to_utc(row["Cycle start time"], row["Cycle timezone"])
            wake = by_start.get(start)
            if wake is None:
                skipped.add(row["Cycle start time"])
                continue
            end = local_to_utc(row["Cycle end time"], row["Cycle timezone"])
            ans = row["Answered yes"].strip().lower()
            records[(start, row["Question text"])] = {  # the export repeats some rows exactly
                "wake_date": wake,
                "cycle_start": start.isoformat(),
                "cycle_end": end.isoformat() if end else None,
                "cycle_tz": row["Cycle timezone"],
                "question": row["Question text"],
                "answered_yes": {"true": True, "false": False}.get(ans),
                "notes": row["Notes"].strip() or None,
            }
    rows = list(records.values())
    print(f"{len(rows)} rows to upsert; {len(skipped)} journal cycles have no cycles row: {sorted(skipped)}")
    if dry:
        return
    for i in range(0, len(rows), 500):
        sb.table("journal").upsert(rows[i:i + 500], on_conflict="cycle_start,question").execute()
    print("done")


if __name__ == "__main__":
    main()
