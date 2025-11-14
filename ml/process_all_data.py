#!/usr/bin/env python3

"""
Process ALL exported race data (including parkruns) for ML training
Converts JSON to CSV and generates comprehensive statistics
"""

import json
import pandas as pd
from pathlib import Path
from datetime import datetime

# Paths
DATA_DIR = Path(__file__).parent / "data"
RAW_JSON = DATA_DIR / "all_races_raw.json"
OUTPUT_CSV = DATA_DIR / "all_races_training.csv"
PARKRUN_CSV = DATA_DIR / "parkrun_training.csv"
NON_PARKRUN_CSV = DATA_DIR / "non_parkrun_training.csv"
STATS_FILE = DATA_DIR / "full_data_stats.json"

def load_wrangler_json(file_path):
    """Load JSON output from wrangler d1 execute"""
    with open(file_path) as f:
        data = json.load(f)

    # Wrangler outputs array with results
    if isinstance(data, list) and len(data) > 0:
        if 'results' in data[0]:
            return data[0]['results']
    return []

def process_races():
    """Load and process ALL race data"""
    print("📊 Loading ALL race data (including parkruns)...")

    races = load_wrangler_json(RAW_JSON)
    print(f"   Loaded {len(races)} total races")

    # Convert to DataFrame
    df = pd.DataFrame(races)

    # Parse date
    df['date'] = pd.to_datetime(df['date'])
    df['year'] = df['date'].dt.year
    df['month'] = df['date'].dt.month
    df['day_of_week'] = df['date'].dt.dayofweek  # 0=Monday, 5=Saturday, 6=Sunday
    df['hour'] = df['date'].dt.hour
    df['day_name'] = df['date'].dt.day_name()

    # Calculate pace (min/km)
    df['pace_min_per_km'] = (df['final_time'] / 60) / (df['final_distance'] / 1000)

    # Create features for model
    df['distance_km'] = df['final_distance'] / 1000
    df['time_minutes'] = df['final_time'] / 60

    # Parkrun identification (already labeled in SQL, but verify)
    df['is_parkrun'] = df['is_parkrun'].astype(bool)

    print(f"\n📈 Overall Statistics:")
    print(f"   Total races: {len(df)}")
    print(f"   Date range: {df['date'].min().date()} to {df['date'].max().date()}")
    print(f"   Parkruns: {df['is_parkrun'].sum()} ({df['is_parkrun'].sum()/len(df)*100:.1f}%)")
    print(f"   Non-parkruns: {(~df['is_parkrun']).sum()} ({(~df['is_parkrun']).sum()/len(df)*100:.1f}%)")
    print(f"   With polylines: {df['has_polyline'].sum()} ({df['has_polyline'].sum()/len(df)*100:.1f}%)")

    # Parkrun analysis
    parkruns = df[df['is_parkrun']]
    non_parkruns = df[~df['is_parkrun']]

    print(f"\n🏃 Parkrun Characteristics:")
    print(f"   Count: {len(parkruns)}")
    print(f"   Avg distance: {parkruns['distance_km'].mean():.2f}km (±{parkruns['distance_km'].std():.2f}km)")
    print(f"   Distance range: {parkruns['distance_km'].min():.2f}km - {parkruns['distance_km'].max():.2f}km")
    print(f"   Most common day: {parkruns['day_name'].mode()[0] if len(parkruns) > 0 else 'N/A'}")
    print(f"   Day distribution:")
    for day, count in parkruns['day_name'].value_counts().items():
        print(f"     {day}: {count}")
    print(f"   Hour distribution:")
    for hour, count in parkruns['hour'].value_counts().sort_index().head(5).items():
        print(f"     {hour:02d}:00: {count}")
    print(f"   With polylines: {parkruns['has_polyline'].sum()} ({parkruns['has_polyline'].sum()/len(parkruns)*100:.1f}%)")

    print(f"\n🏁 Non-Parkrun (Events) Characteristics:")
    print(f"   Count: {len(non_parkruns)}")
    print(f"   Unique events: {non_parkruns['event_name'].nunique()}")
    print(f"   Top 10 events:")
    for event, count in non_parkruns['event_name'].value_counts().head(10).items():
        print(f"     {event}: {count}")
    print(f"   With polylines: {non_parkruns['has_polyline'].sum()} ({non_parkruns['has_polyline'].sum()/len(non_parkruns)*100:.1f}%)")

    # Distance distribution
    print(f"\n📏 Distance Distribution (All):")
    dist_bins = [0, 5, 10, 15, 21, 42, 100]
    dist_labels = ['<5km', '5-10km', '10-15km', '15-21km', '21-42km', '>42km']
    df['distance_category'] = pd.cut(df['distance_km'], bins=dist_bins, labels=dist_labels)
    print(df['distance_category'].value_counts().sort_index())

    # Save datasets
    df.to_csv(OUTPUT_CSV, index=False)
    parkruns.to_csv(PARKRUN_CSV, index=False)
    non_parkruns.to_csv(NON_PARKRUN_CSV, index=False)

    print(f"\n✅ Saved datasets:")
    print(f"   All races: {OUTPUT_CSV}")
    print(f"   Parkruns only: {PARKRUN_CSV}")
    print(f"   Non-parkruns only: {NON_PARKRUN_CSV}")

    # Save comprehensive statistics
    stats = {
        'total_races': len(df),
        'parkruns': {
            'count': int(len(parkruns)),
            'percentage': float(len(parkruns) / len(df) * 100),
            'avg_distance_km': float(parkruns['distance_km'].mean()),
            'std_distance_km': float(parkruns['distance_km'].std()),
            'most_common_day': parkruns['day_name'].mode()[0] if len(parkruns) > 0 else None,
            'day_distribution': parkruns['day_name'].value_counts().to_dict(),
            'polyline_coverage_pct': float(parkruns['has_polyline'].sum() / len(parkruns) * 100) if len(parkruns) > 0 else 0
        },
        'non_parkruns': {
            'count': int(len(non_parkruns)),
            'percentage': float(len(non_parkruns) / len(df) * 100),
            'unique_events': int(non_parkruns['event_name'].nunique()),
            'top_events': non_parkruns['event_name'].value_counts().head(20).to_dict(),
            'polyline_coverage_pct': float(non_parkruns['has_polyline'].sum() / len(non_parkruns) * 100)
        },
        'overall': {
            'polyline_coverage_pct': float(df['has_polyline'].sum() / len(df) * 100),
            'date_range': {
                'min': df['date'].min().isoformat(),
                'max': df['date'].max().isoformat()
            },
            'distance_distribution': df['distance_category'].value_counts().to_dict()
        }
    }

    with open(STATS_FILE, 'w') as f:
        json.dump(stats, f, indent=2, default=str)

    print(f"✅ Saved statistics to {STATS_FILE}")

    return df

if __name__ == "__main__":
    print("🚀 Processing ALL race training data...\n")

    # Ensure pandas is installed
    try:
        import pandas as pd
    except ImportError:
        print("❌ pandas not installed. Install with: pip install pandas")
        exit(1)

    df = process_races()

    print(f"\n✨ Processing complete!")
    print(f"\n📊 Dataset Summary:")
    print(f"   Total: {len(df)} races")
    print(f"   Parkruns: {df['is_parkrun'].sum()}")
    print(f"   Events: {(~df['is_parkrun']).sum()}")
    print(f"   Balanced: {'✅ Yes' if 0.3 <= df['is_parkrun'].sum()/len(df) <= 0.7 else '⚠️  Imbalanced'}")
    print(f"\nNext steps:")
    print(f"1. Train parkrun binary classifier (parkrun vs not)")
    print(f"2. Train event name predictor (on non-parkruns only)")
    print(f"3. Feature engineering with polylines")
