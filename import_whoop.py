#!/usr/bin/env python3
"""
import_whoop.py — Import WHOOP CSV exports into the CALIBEX Supabase database.

Usage:
    python import_whoop.py --cycles physiological_cycles.csv
    python import_whoop.py --workouts workouts.csv
    python import_whoop.py --cycles physiological_cycles.csv --workouts workouts.csv

Requires:
    pip install supabase python-dotenv

Environment (.env):
    SUPABASE_URL=https://<project>.supabase.co
    SUPABASE_ANON_KEY=<anon-key>
"""

import argparse
import csv
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# ---------------------------------------------------------------------------
# WHOOP CSV column name → schema field mapping (matched to actual export headers)
# ---------------------------------------------------------------------------

CYCLES_COL = {
    "cycle_start":                "Cycle start time",
    "cycle_end":                  "Cycle end time",
    "recovery_score":             "Recovery score %",
    "resting_heart_rate":         "Resting heart rate (bpm)",
    "hrv_rmssd_ms":               "Heart rate variability (ms)",
    "skin_temp_celsius":          "Skin temp (celsius)",
    "blood_oxygen_percent":       "Blood oxygen %",
    "respiratory_rate":           "Respiratory rate (rpm)",
    "sleep_start":                "Sleep onset",
    "sleep_end":                  "Wake onset",
    "sleep_performance_percent":  "Sleep performance %",
    "sleep_consistency_percent":  "Sleep consistency %",
    "sleep_efficiency_percent":   "Sleep efficiency %",
    # durations are already in minutes (float) in the WHOOP export
    "total_sleep_minutes":        "Asleep duration (min)",
    "rem_sleep_minutes":          "REM duration (min)",
    "light_sleep_minutes":        "Light sleep duration (min)",
    "deep_sleep_minutes":         "Deep (SWS) duration (min)",
    "awake_minutes":              "Awake duration (min)",
    "sleep_need_minutes":         "Sleep need (min)",
    "sleep_debt_minutes":         "Sleep debt (min)",
}

WORKOUTS_COL = {
    "sport_name":           "Activity name",
    "workout_start":        "Workout start time",
    "workout_end":          "Workout end time",
    "duration_minutes":     "Duration (min)",
    "strain_score":         "Activity Strain",
    "average_heart_rate":   "Average HR (bpm)",
    "max_heart_rate":       "Max HR (bpm)",
    "calories_burned":      "Energy burned (cal)",
    "zone_one_percent":     "HR Zone 1 %",
    "zone_two_percent":     "HR Zone 2 %",
    "zone_three_percent":   "HR Zone 3 %",
    "zone_four_percent":    "HR Zone 4 %",
    "zone_five_percent":    "HR Zone 5 %",
}

TS_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%m/%d/%y %H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
]

# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def clean(value):
    if value is None:
        return None
    v = str(value).strip()
    return v or None


def to_float(value):
    v = clean(value)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_int(value):
    v = clean(value)
    if v is None:
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def parse_ts_dt(value):
    """Parse a WHOOP timestamp string; return a UTC-aware datetime."""
    v = clean(value)
    if v is None:
        return None
    for fmt in TS_FORMATS:
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    print(f"  WARNING: could not parse timestamp '{v}'")
    return None


def parse_ts(value):
    """Parse a WHOOP timestamp string; return ISO 8601 string for Supabase."""
    dt = parse_ts_dt(value)
    return dt.isoformat() if dt else None


def get(row, col_map, key):
    col = col_map.get(key)
    return row.get(col) if col else None


# ---------------------------------------------------------------------------
# Import: cycles
# ---------------------------------------------------------------------------

def import_cycles(supabase: Client, filepath: str):
    with open(filepath, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    print(f"  {len(rows)} rows found in {filepath}")
    records = []
    skipped = 0

    for row in rows:
        wake_onset_dt  = parse_ts_dt(get(row, CYCLES_COL, "sleep_end"))   # "Wake onset"
        cycle_start_dt = parse_ts_dt(get(row, CYCLES_COL, "cycle_start"))

        # wake_date = the calendar date the person woke up
        if wake_onset_dt:
            wake_date = wake_onset_dt.date().isoformat()
        elif cycle_start_dt:
            wake_date = cycle_start_dt.date().isoformat()
        else:
            print(f"  SKIP: cannot determine wake_date — {dict(row)}")
            skipped += 1
            continue

        records.append({
            "wake_date":                    wake_date,
            "cycle_start":                  parse_ts(get(row, CYCLES_COL, "cycle_start")),
            "cycle_end":                    parse_ts(get(row, CYCLES_COL, "cycle_end")),
            "recovery_score":               to_float(get(row, CYCLES_COL, "recovery_score")),
            "hrv_rmssd_ms":                 to_float(get(row, CYCLES_COL, "hrv_rmssd_ms")),
            "resting_heart_rate":           to_float(get(row, CYCLES_COL, "resting_heart_rate")),
            "skin_temp_celsius":            to_float(get(row, CYCLES_COL, "skin_temp_celsius")),
            "blood_oxygen_percent":         to_float(get(row, CYCLES_COL, "blood_oxygen_percent")),
            "respiratory_rate":             to_float(get(row, CYCLES_COL, "respiratory_rate")),
            "sleep_start":                  parse_ts(get(row, CYCLES_COL, "sleep_start")),
            "sleep_end":                    parse_ts(get(row, CYCLES_COL, "sleep_end")),
            "sleep_performance_percent":    to_float(get(row, CYCLES_COL, "sleep_performance_percent")),
            "sleep_consistency_percent":    to_float(get(row, CYCLES_COL, "sleep_consistency_percent")),
            "sleep_efficiency_percent":     to_float(get(row, CYCLES_COL, "sleep_efficiency_percent")),
            # durations already in minutes as floats — no conversion needed
            "total_sleep_minutes":          to_float(get(row, CYCLES_COL, "total_sleep_minutes")),
            "rem_sleep_minutes":            to_float(get(row, CYCLES_COL, "rem_sleep_minutes")),
            "light_sleep_minutes":          to_float(get(row, CYCLES_COL, "light_sleep_minutes")),
            "deep_sleep_minutes":           to_float(get(row, CYCLES_COL, "deep_sleep_minutes")),
            "awake_minutes":                to_float(get(row, CYCLES_COL, "awake_minutes")),
            "sleep_need_minutes":           to_float(get(row, CYCLES_COL, "sleep_need_minutes")),
            "sleep_debt_minutes":           to_float(get(row, CYCLES_COL, "sleep_debt_minutes")),
        })

    # deduplicate by wake_date — last row in the CSV wins
    deduped = {r["wake_date"]: r for r in records}
    records = list(deduped.values())

    if records:
        supabase.table("cycles").upsert(records, on_conflict="wake_date").execute()

    print(f"  cycles: {len(records)} upserted, {skipped} skipped")


# ---------------------------------------------------------------------------
# Import: workouts
# ---------------------------------------------------------------------------

def import_workouts(supabase: Client, filepath: str):
    with open(filepath, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    print(f"  {len(rows)} rows found in {filepath}")
    records = []
    skipped = 0

    for row in rows:
        workout_start_dt = parse_ts_dt(get(row, WORKOUTS_COL, "workout_start"))

        if not workout_start_dt:
            print(f"  SKIP: no workout_start — {dict(row)}")
            skipped += 1
            continue

        records.append({
            "wake_date":            workout_start_dt.date().isoformat(),
            "sport_name":           clean(get(row, WORKOUTS_COL, "sport_name")),
            "workout_start":        workout_start_dt.isoformat(),
            "workout_end":          parse_ts(get(row, WORKOUTS_COL, "workout_end")),
            "duration_minutes":     to_float(get(row, WORKOUTS_COL, "duration_minutes")),
            "strain_score":         to_float(get(row, WORKOUTS_COL, "strain_score")),
            "average_heart_rate":   to_int(get(row, WORKOUTS_COL, "average_heart_rate")),
            "max_heart_rate":       to_int(get(row, WORKOUTS_COL, "max_heart_rate")),
            "calories_burned":      to_float(get(row, WORKOUTS_COL, "calories_burned")),
            "zone_one_percent":     to_float(get(row, WORKOUTS_COL, "zone_one_percent")),
            "zone_two_percent":     to_float(get(row, WORKOUTS_COL, "zone_two_percent")),
            "zone_three_percent":   to_float(get(row, WORKOUTS_COL, "zone_three_percent")),
            "zone_four_percent":    to_float(get(row, WORKOUTS_COL, "zone_four_percent")),
            "zone_five_percent":    to_float(get(row, WORKOUTS_COL, "zone_five_percent")),
        })

    # dedupe by workout_start within this batch (belt-and-suspenders)
    deduped = {r["workout_start"]: r for r in records if r.get("workout_start")}
    records = list(deduped.values())

    if records:
        supabase.table("workouts").upsert(records, on_conflict="workout_start").execute()

    print(f"  workouts: {len(records)} upserted, {skipped} skipped")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Import WHOOP CSVs into CALIBEX via Supabase")
    parser.add_argument("--cycles",   metavar="FILE", help="WHOOP physiological cycles CSV")
    parser.add_argument("--workouts", metavar="FILE", help="WHOOP workouts CSV")
    args = parser.parse_args()

    if not args.cycles and not args.workouts:
        parser.error("provide at least one of --cycles or --workouts")

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_ANON_KEY")

    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env", file=sys.stderr)
        sys.exit(1)

    print("Connecting to Supabase...")
    supabase: Client = create_client(supabase_url, supabase_key)

    try:
        if args.cycles:
            print("\nImporting cycles...")
            import_cycles(supabase, args.cycles)

        if args.workouts:
            print("\nImporting workouts...")
            import_workouts(supabase, args.workouts)

    except Exception as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        sys.exit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
