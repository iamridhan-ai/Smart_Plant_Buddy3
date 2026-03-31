# plant_report.py
import csv, os
from datetime import datetime
from groq import Groq
from collections import defaultdict, Counter

LOG_FILE = "/Users/pingu/Desktop/yes/plant_log.csv"
API_KEY  = "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"  # ← paste your Groq API key here

def reading_label(row):
    timestamp = row.get("timestamp", "")
    if timestamp:
        try:
            return datetime.fromisoformat(timestamp).strftime("%H:%M")
        except ValueError:
            pass

    hour = row.get("hour", "")
    minute = row.get("minute", "")
    if hour and minute:
        return f"{hour}:{minute}"
    if hour.endswith(":00"):
        return hour
    if hour:
        return f"{hour}:00"
    return "unknown time"

def load_summary(log_file=LOG_FILE):
    if not os.path.exists(log_file):
        raise FileNotFoundError(
            f"No log file found at '{log_file}'.\n"
            f"  → Run plant_logger.py first to collect sensor data.\n"
            f"  → Looking in: {os.getcwd()}"
        )

    minute_soil  = defaultdict(list)
    minute_temp  = defaultdict(list)
    status_count = Counter()
    lowest_soil_row = None
    highest_temp_row = None

    with open(log_file) as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if not rows:
        raise ValueError("plant_log.csv exists but contains no data yet. "
                         "Let the logger run for a while first.")

    for row in rows:
        label = reading_label(row)
        minute_soil[label].append(float(row["soil_pct"]))
        minute_temp[label].append(float(row["temp_c"]))
        status_count[row["status"]] += 1

        if lowest_soil_row is None or float(row["soil_pct"]) < float(lowest_soil_row["soil_pct"]):
            lowest_soil_row = row
        if highest_temp_row is None or float(row["temp_c"]) > float(highest_temp_row["temp_c"]):
            highest_temp_row = row

    avg_soil = {label: round(sum(values) / len(values), 1)
                for label, values in sorted(minute_soil.items())}
    avg_temp = {label: round(sum(values) / len(values), 1)
                for label, values in sorted(minute_temp.items())}

    return avg_soil, avg_temp, status_count, lowest_soil_row, highest_temp_row

def generate_report():
    try:
        avg_soil, avg_temp, status_count, lowest_soil_row, highest_temp_row = load_summary()
    except FileNotFoundError as e:
        print(f"\n⚠️  {e}")
        return
    except ValueError as e:
        print(f"\n⚠️  {e}")
        return

    driest_minute = reading_label(lowest_soil_row)
    hottest_minute = reading_label(highest_temp_row)
    crisis_pct = round(
        100 * status_count["CRITICAL"] / max(sum(status_count.values()), 1), 1
    )

    prompt = f"""You are a plant care expert analysing real sensor data.

Minute-by-minute average soil moisture % (100=soaked, 0=bone dry):
{avg_soil}

Minute-by-minute average temperature (°C):
{avg_temp}

Status breakdown today: {dict(status_count)}
Driest minute: {driest_minute} ({float(lowest_soil_row['soil_pct']):.1f}% soil moisture)
Hottest minute: {hottest_minute} ({float(highest_temp_row['temp_c']):.1f}°C)
Critical alerts: {crisis_pct}% of all readings

Write a personal plant care report with:
1. One-sentence verdict on today's plant health
2. The specific minute(s) needing most attention and why
3. Two concrete actions to take tomorrow
4. An encouraging closing line

Be specific, warm, and use the actual numbers. Mention times in HH:MM format. No generic advice."""

    client = Groq(api_key=API_KEY)
    result = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500
    )

    report = result.choices[0].message.content
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
          "  SMART PLANT BUDDY — CARE REPORT\n"
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    print(report)
    return report

if __name__ == "__main__":
    generate_report()
