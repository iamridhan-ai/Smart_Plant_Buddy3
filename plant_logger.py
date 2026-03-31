"""
Smart Plant Buddy — Python Serial Logger
Reads JSON from Arduino, logs to CSV with timestamps
Run: python plant_logger.py
"""

import csv
import json
import os
from datetime import datetime

import serial

PORT = "/dev/tty.usbserial-110"
BAUD = 9600
LOG_FILE = "/Users/pingu/Desktop/yes/plant_log.csv"

STATUS_MAP = {
    0: "HAPPY",
    1: "DRY",
    2: "THIRSTY",
    3: "WET",
    4: "DRENCHED",
    5: "HOT",
    6: "COLD",
    7: "CRITICAL_HOT",
    8: "CRITICAL_COLD",
}

PROBLEM_MAP = {
    0: "NONE",
    1: "TOO_HOT",
    2: "TOO_COLD",
    3: "TOO_HUMID",
    4: "TOO_DRY",
}

CSV_HEADERS = [
    "timestamp",
    "hour",
    "minute",
    "second",
    "soil_pct",
    "temp_c",
    "humidity",
    "status",
    "problem",
    "score",
]


def migrate_csv(log_file):
    with open(log_file, newline="") as src:
        rows = list(csv.DictReader(src))

    with open(log_file, "w", newline="") as dst:
        writer = csv.writer(dst)
        writer.writerow(CSV_HEADERS)

        for row in rows:
            timestamp = row.get("timestamp", "")
            hour = row.get("hour", "")
            minute = row.get("minute", "")
            second = row.get("second", "")

            if timestamp:
                try:
                    dt = datetime.fromisoformat(timestamp)
                    hour = hour or dt.strftime("%H")
                    minute = minute or dt.strftime("%M")
                    second = second or dt.strftime("%S")
                except ValueError:
                    pass

            if hour.endswith(":00"):
                hour = hour[:2]

            writer.writerow([
                timestamp,
                hour,
                minute,
                second,
                row.get("soil_pct", 0),
                row.get("temp_c", 0),
                row.get("humidity", 0),
                row.get("status", "UNKNOWN"),
                row.get("problem", "NONE"),
                row.get("score", 0),
            ])


def init_csv():
    exists = os.path.exists(LOG_FILE)

    if exists:
        with open(LOG_FILE, newline="") as existing_file:
            reader = csv.reader(existing_file)
            header = next(reader, [])
        if header != CSV_HEADERS:
            migrate_csv(LOG_FILE)

    f = open(LOG_FILE, "a", newline="")
    w = csv.writer(f)

    if not exists:
        w.writerow(CSV_HEADERS)

    return f, w


def decode_label(value, label_map):
    if isinstance(value, str):
        return value.strip().upper()
    return label_map.get(value, "UNKNOWN")


def as_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clamp_score(value):
    score = as_int(value, 0)
    return max(0, min(100, score))


def run():
    f, writer = init_csv()
    ser = serial.Serial(PORT, BAUD, timeout=2)
    print(f"Logging from {PORT} -> {LOG_FILE}")

    try:
        while True:
            raw = ser.readline()
            if not raw:
                continue

            try:
                line = raw.decode("utf-8", errors="ignore").strip()
            except Exception:
                continue

            if not line.startswith("{"):
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                print(f"[SKIP] Bad JSON: {line}")
                continue

            if "error" in data:
                print(f"Sensor error: {data['error']}")
                continue

            now = datetime.now()
            soil = as_int(data.get("soil", 0))
            temp = as_float(data.get("temp", 0.0))
            humid = as_float(data.get("humid", 0.0))
            status = decode_label(data.get("status", 0), STATUS_MAP)
            problem = decode_label(data.get("problem", 0), PROBLEM_MAP)
            score = clamp_score(data.get("score", 0))

            writer.writerow([
                now.isoformat(),
                now.strftime("%H"),
                now.strftime("%M"),
                now.strftime("%S"),
                soil,
                temp,
                humid,
                status,
                problem,
                score,
            ])
            f.flush()

            print(
                f"[{now.strftime('%H:%M:%S')}] "
                f"Soil: {soil}% | "
                f"Temp: {temp:.1f}C | "
                f"Humid: {humid:.0f}% | "
                f"Status: {status} | "
                f"Problem: {problem} | "
                f"Score: {score}"
            )

    except KeyboardInterrupt:
        print("\nLogger stopped.")
    finally:
        f.close()
        ser.close()


if __name__ == "__main__":
    run()
