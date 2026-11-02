#!/usr/bin/env python3
"""
sync_whoop.py — Pull recent WHOOP data (cycles, recovery, sleep, workouts)
via the v2 API and upsert into Supabase. Uses the refresh_token from .env to
mint a fresh access token each run (and rotates the refresh_token back into
.env, since WHOOP issues a new one on every refresh).

Usage:
    python3 sync_whoop.py                # last 30 days (default)
    python3 sync_whoop.py --days 7       # last 7 days (nightly cron)
    python3 sync_whoop.py --days 365     # one-year backfill

Requires:
    pip install supabase python-dotenv
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

API_BASE = "https://api.prod.whoop.com"
TOKEN_URL = f"{API_BASE}/oauth/oauth2/token"
UA = "Calibex/1.0 (+python)"
PAGE_LIMIT = 25  # WHOOP max


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------

def refresh_access_token(client_id, client_secret, refresh_token):
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "offline",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", UA)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"Token refresh failed: {e.code} {e.reason}\n{body}", file=sys.stderr)
        raise


def load_refresh_token(sb: Client):
    """Source of truth is whoop_auth.refresh_token in Supabase. Fall back to .env
    for first-run bootstrap."""
    try:
        res = sb.table("whoop_auth").select("refresh_token").eq("id", 1).execute()
        if res.data and res.data[0].get("refresh_token"):
            return res.data[0]["refresh_token"]
    except Exception as exc:
        print(f"  (whoop_auth lookup failed: {exc})", file=sys.stderr)
    return os.getenv("WHOOP_REFRESH_TOKEN")


def save_refresh_token(sb: Client, new_token: str):
    """WHOOP rotates refresh tokens on every refresh — persist the new one."""
    sb.table("whoop_auth").upsert({
        "id": 1,
        "refresh_token": new_token,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="id").execute()


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_get(path, access_token, params=None):
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {access_token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", UA)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"  GET {path} → HTTP {e.code} {e.reason}\n  {body}", file=sys.stderr)
        raise


def fetch_all(path, access_token, start_iso, end_iso):
    records = []
    next_token = None
    while True:
        params = {"limit": PAGE_LIMIT, "start": start_iso, "end": end_iso}
        if next_token:
            params["nextToken"] = next_token
        page = api_get(path, access_token, params)
        records.extend(page.get("records", []))
        next_token = page.get("next_token")
        if not next_token:
            break
    return records


# ---------------------------------------------------------------------------
# Parsing / mapping
# ---------------------------------------------------------------------------

def ms_to_min(ms):
    if ms is None:
        return None
    try:
        return round(float(ms) / 60000.0, 2)
    except (TypeError, ValueError):
        return None


def kj_to_kcal(kj):
    if kj is None:
        return None
    try:
        return round(float(kj) / 4.184, 2)
    except (TypeError, ValueError):
        return None


def parse_iso(ts):
    if not ts:
        return None
    # handle trailing Z and +00:00 forms
    t = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(t)
    except ValueError:
        return None


IST = timezone(timedelta(hours=5, minutes=30))


def parse_offset(off):
    """WHOOP's timezone_offset, e.g. "+05:30" or "-04:00", as a tzinfo (None if absent)."""
    if not off or len(off) < 6 or off[0] not in "+-":
        return None
    try:
        h, m = int(off[1:3]), int(off[4:6])
    except ValueError:
        return None
    sign = 1 if off[0] == "+" else -1
    return timezone(sign * timedelta(hours=h, minutes=m))


def wake_date_from(sleep_end_iso, cycle_start_iso, sleep_offset=None, cycle_offset=None):
    # The local calendar date of waking, in the offset WHOOP recorded for that sleep.
    # The UTC date filed a wake before 05:30 IST under the previous day and overwrote
    # that day's real row (17 Oct 2025, 10 Jan, 31 Jan, 25 Apr 2026).
    if parse_iso(sleep_end_iso):
        dt, tz = parse_iso(sleep_end_iso), parse_offset(sleep_offset) or parse_offset(cycle_offset)
    else:
        dt, tz = parse_iso(cycle_start_iso), parse_offset(cycle_offset)
    return dt.astimezone(tz or IST).date().isoformat() if dt else None


def score(rec):
    return rec.get("score") or {}


def build_cycle_row(cycle, recovery, sleep):
    """Merge one cycle + its recovery + its main (non-nap) sleep into a cycles row."""
    cycle_start_iso = cycle.get("start")
    cycle_end_iso = cycle.get("end")
    sleep_start_iso = sleep.get("start") if sleep else None
    sleep_end_iso = sleep.get("end") if sleep else None

    wake_date = wake_date_from(sleep_end_iso, cycle_start_iso,
                               (sleep or {}).get("timezone_offset"), (cycle or {}).get("timezone_offset"))
    if not wake_date:
        return None

    cycle_score = score(cycle) if cycle else {}
    rec_score = score(recovery) if recovery else {}
    sleep_score = score(sleep) if sleep else {}
    stage = sleep_score.get("stage_summary") or {}
    sleep_needed = sleep_score.get("sleep_needed") or {}

    # sleep_need_minutes = baseline + debt + recent_strain
    need_total_ms = sum(
        v for v in [
            sleep_needed.get("baseline_milli"),
            sleep_needed.get("need_from_sleep_debt_milli"),
            sleep_needed.get("need_from_recent_strain_milli"),
        ] if v is not None
    ) or None

    # total_sleep = light + deep + rem (conservative — excludes awake)
    total_sleep_ms = None
    parts = [
        stage.get("total_light_sleep_time_milli"),
        stage.get("total_slow_wave_sleep_time_milli"),
        stage.get("total_rem_sleep_time_milli"),
    ]
    if any(p is not None for p in parts):
        total_sleep_ms = sum(p for p in parts if p is not None)

    return {
        "wake_date":                   wake_date,
        "cycle_start":                 cycle_start_iso,
        "cycle_end":                   cycle_end_iso,
        "recovery_score":              rec_score.get("recovery_score"),
        "hrv_rmssd_ms":                rec_score.get("hrv_rmssd_milli"),
        "resting_heart_rate":          rec_score.get("resting_heart_rate"),
        "skin_temp_celsius":           rec_score.get("skin_temp_celsius"),
        "blood_oxygen_percent":        rec_score.get("spo2_percentage"),
        "respiratory_rate":            sleep_score.get("respiratory_rate"),
        "sleep_start":                 sleep_start_iso,
        "sleep_end":                   sleep_end_iso,
        "sleep_performance_percent":   sleep_score.get("sleep_performance_percentage"),
        "sleep_consistency_percent":   sleep_score.get("sleep_consistency_percentage"),
        "sleep_efficiency_percent":    sleep_score.get("sleep_efficiency_percentage"),
        "total_sleep_minutes":         ms_to_min(total_sleep_ms),
        "rem_sleep_minutes":           ms_to_min(stage.get("total_rem_sleep_time_milli")),
        "light_sleep_minutes":         ms_to_min(stage.get("total_light_sleep_time_milli")),
        "deep_sleep_minutes":          ms_to_min(stage.get("total_slow_wave_sleep_time_milli")),
        "awake_minutes":               ms_to_min(stage.get("total_awake_time_milli")),
        "sleep_need_minutes":          ms_to_min(need_total_ms),
        "sleep_debt_minutes":          ms_to_min(sleep_needed.get("need_from_sleep_debt_milli")),
        "day_strain":                  cycle_score.get("strain"),
        "day_average_heart_rate":      cycle_score.get("average_heart_rate"),
        "day_max_heart_rate":          cycle_score.get("max_heart_rate"),
        "day_calories":                kj_to_kcal(cycle_score.get("kilojoule")),
        "time_in_bed_minutes":         ms_to_min(stage.get("total_in_bed_time_milli")),
        "sleep_disturbance_count":     stage.get("disturbance_count"),
        "step_count":                  cycle.get("step_count") if cycle else None,
        "recovery_calibrating":        rec_score.get("user_calibrating"),
    }


def build_workout_row(w):
    start_iso = w.get("start")
    end_iso = w.get("end")
    start_dt = parse_iso(start_iso)
    end_dt = parse_iso(end_iso)

    if not start_dt:
        return None

    duration_min = None
    if start_dt and end_dt:
        duration_min = round((end_dt - start_dt).total_seconds() / 60.0, 2)

    sc = score(w)
    zones = sc.get("zone_durations") or {}
    total_zone_ms = sum(v for v in zones.values() if isinstance(v, (int, float))) or None

    def zone_pct(key):
        v = zones.get(key)
        if v is None or not total_zone_ms:
            return None
        return round(100.0 * v / total_zone_ms, 2)

    return {
        "wake_date":            start_dt.date().isoformat(),
        "sport_name":           w.get("sport_name"),
        "workout_start":        start_iso,
        "workout_end":          end_iso,
        "duration_minutes":     duration_min,
        "strain_score":         sc.get("strain"),
        "average_heart_rate":   sc.get("average_heart_rate"),
        "max_heart_rate":       sc.get("max_heart_rate"),
        "calories_burned":      kj_to_kcal(sc.get("kilojoule")),
        "distance_meters":      sc.get("distance_meter"),
        "zone_one_percent":     zone_pct("zone_one_milli"),
        "zone_two_percent":     zone_pct("zone_two_milli"),
        "zone_three_percent":   zone_pct("zone_three_milli"),
        "zone_four_percent":    zone_pct("zone_four_milli"),
        "zone_five_percent":    zone_pct("zone_five_milli"),
    }


def build_nap_row(s, wake_date_by_cycle):
    """One WHOOP nap -> a naps row, filed under the wake_date of the cycle it fell in.
    Skipped when that cycle isn't in this batch: a date guessed from the nap's start would
    overwrite the right one for an after-midnight nap (same rule as cycles). A later sync
    with the cycle in its window writes it."""
    start_dt, end_dt = parse_iso(s.get("start")), parse_iso(s.get("end"))
    wake_date = wake_date_by_cycle.get(s.get("cycle_id"))
    if not s.get("id") or not start_dt or not wake_date:
        return None
    stage = (score(s).get("stage_summary") or {}) if s.get("score_state") == "SCORED" else {}
    parts = [stage.get(k) for k in ("total_light_sleep_time_milli", "total_slow_wave_sleep_time_milli",
                                    "total_rem_sleep_time_milli")]
    return {
        "whoop_sleep_id":   str(s["id"]),
        "wake_date":        wake_date,
        "nap_start":        s.get("start"),
        "nap_end":          s.get("end"),
        "duration_minutes": round((end_dt - start_dt).total_seconds() / 60.0, 2) if end_dt and end_dt > start_dt else None,
        "sleep_minutes":    ms_to_min(sum(p for p in parts if p is not None)) if any(p is not None for p in parts) else None,
        "light_minutes":    ms_to_min(stage.get("total_light_sleep_time_milli")),
        "deep_minutes":     ms_to_min(stage.get("total_slow_wave_sleep_time_milli")),
        "rem_minutes":      ms_to_min(stage.get("total_rem_sleep_time_milli")),
        "awake_minutes":    ms_to_min(stage.get("total_awake_time_milli")),
        "score_state":      s.get("score_state"),
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Sync WHOOP v2 data into CALIBEX Supabase.")
    p.add_argument("--days", type=int, default=30, help="lookback window (default 30)")
    args = p.parse_args()

    client_id = os.getenv("WHOOP_CLIENT_ID")
    client_secret = os.getenv("WHOOP_CLIENT_SECRET")
    sb_url = os.getenv("SUPABASE_URL")
    sb_key = os.getenv("SUPABASE_ANON_KEY")

    missing = [k for k, v in [
        ("WHOOP_CLIENT_ID", client_id),
        ("WHOOP_CLIENT_SECRET", client_secret),
        ("SUPABASE_URL", sb_url),
        ("SUPABASE_ANON_KEY", sb_key),
    ] if not v]
    if missing:
        print(f"Error: missing env vars: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    print("Connecting to Supabase...")
    sb: Client = create_client(sb_url, sb_key)

    refresh_token = load_refresh_token(sb)
    if not refresh_token:
        print("Error: no refresh token in whoop_auth table or WHOOP_REFRESH_TOKEN env.",
              file=sys.stderr)
        print("Run authorize_whoop.py once to seed it.", file=sys.stderr)
        sys.exit(1)

    print("Refreshing WHOOP access token...")
    tokens = refresh_access_token(client_id, client_secret, refresh_token)
    access_token = tokens["access_token"]
    new_refresh = tokens.get("refresh_token")
    if new_refresh and new_refresh != refresh_token:
        save_refresh_token(sb, new_refresh)
        print("  rotated refresh_token (saved to whoop_auth)")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days)
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_iso = end.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    print(f"Window: {start_iso} → {end_iso} ({args.days} days)")

    print("Fetching cycles...")
    cycles = fetch_all("/developer/v2/cycle", access_token, start_iso, end_iso)
    print(f"  {len(cycles)} cycles")

    print("Fetching recoveries...")
    recoveries = fetch_all("/developer/v2/recovery", access_token, start_iso, end_iso)
    print(f"  {len(recoveries)} recoveries")

    print("Fetching sleeps...")
    sleeps = fetch_all("/developer/v2/activity/sleep", access_token, start_iso, end_iso)
    non_nap_sleeps = [s for s in sleeps if not s.get("nap")]
    print(f"  {len(sleeps)} sleeps ({len(non_nap_sleeps)} non-nap)")

    print("Fetching workouts...")
    workouts = fetch_all("/developer/v2/activity/workout", access_token, start_iso, end_iso)
    print(f"  {len(workouts)} workouts")

    # Index by cycle_id for joins
    recovery_by_cycle = {r.get("cycle_id"): r for r in recoveries if r.get("cycle_id")}
    sleep_by_cycle = {}
    for s in non_nap_sleeps:
        cid = s.get("cycle_id")
        if not cid:
            continue
        # Prefer the sleep with the latest end time per cycle
        existing = sleep_by_cycle.get(cid)
        if not existing or (parse_iso(s.get("end")) or datetime.min.replace(tzinfo=timezone.utc)) > (
                parse_iso(existing.get("end")) or datetime.min.replace(tzinfo=timezone.utc)):
            sleep_by_cycle[cid] = s

    cycle_rows = []
    no_sleep = 0
    for c in cycles:
        cid = c.get("id")
        # Every cycle starts with a sleep. Without it the wake_date is only a guess from
        # the cycle start, and upserting on a guessed date overwrote the real day's row
        # (Sep 12 - Oct 5 2026 were all shifted a day, recovery and sleep blank). Skip it;
        # a later sync writes the row once WHOOP returns the sleep.
        if not sleep_by_cycle.get(cid):
            no_sleep += 1
            continue
        row = build_cycle_row(c, recovery_by_cycle.get(cid), sleep_by_cycle.get(cid))
        if row:
            cycle_rows.append(row)

    # dedupe by wake_date (latest cycle wins)
    dedup_cycles = {}
    for row in cycle_rows:
        wd = row["wake_date"]
        if wd not in dedup_cycles or (row.get("cycle_end") or "") > (dedup_cycles[wd].get("cycle_end") or ""):
            dedup_cycles[wd] = row
    cycle_rows = list(dedup_cycles.values())
    if no_sleep:
        print(f"  skipped {no_sleep} cycle(s) with no sleep yet")

    workout_rows = [r for r in (build_workout_row(w) for w in workouts) if r]
    # dedupe by workout_start within this batch
    workout_rows = list({r["workout_start"]: r for r in workout_rows if r.get("workout_start")}.values())

    if cycle_rows:
        sb.table("cycles").upsert(cycle_rows, on_conflict="wake_date").execute()
        print(f"  cycles: {len(cycle_rows)} upserted")
    else:
        print("  cycles: none to upsert")

    if workout_rows:
        sb.table("workouts").upsert(workout_rows, on_conflict="workout_start").execute()
        print(f"  workouts: {len(workout_rows)} upserted")
    else:
        print("  workouts: none to upsert")

    # Naps last, so a bad nap record can never block cycles or workouts.
    # Filed under the wake_date of the cycle they fell in (from that cycle's main sleep).
    try:
        wake_date_by_cycle = {}
        for c in cycles:
            row = build_cycle_row(c, None, sleep_by_cycle.get(c.get("id"))) if sleep_by_cycle.get(c.get("id")) else None
            if row:
                wake_date_by_cycle[c.get("id")] = row["wake_date"]
        nap_rows = [r for r in (build_nap_row(s, wake_date_by_cycle) for s in sleeps if s.get("nap")) if r]
        nap_rows = list({r["whoop_sleep_id"]: r for r in nap_rows}.values())
        if nap_rows:
            sb.table("naps").upsert(nap_rows, on_conflict="whoop_sleep_id").execute()
            print(f"  naps: {len(nap_rows)} upserted")
        else:
            print("  naps: none to upsert")
    except Exception as e:
        print(f"Error: naps not synced ({e}); cycles and workouts were saved.", file=sys.stderr)
        sys.exit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
