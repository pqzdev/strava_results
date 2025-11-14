#!/usr/bin/env python3

"""
Process exported race data for ML training
Converts JSON to CSV and generates initial statistics
"""

import json
import pandas as pd
from pathlib import Path
from datetime import datetime

# Paths
DATA_DIR = Path(__file__).parent / "data"
RAW_JSON = DATA_DIR / "races_raw.json"
OUTPUT_CSV = DATA_DIR / "races_training.csv"
STATS_FILE = DATA_DIR / "data_stats.json"

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
    """Load and process race data"""
    print("📊 Loading race data...")

    races = load_wrangler_json(RAW_JSON)
    print(f"   Loaded {len(races)} races")

    # Convert to DataFrame
    df = pd.DataFrame(races)

    # Parse date
    df['date'] = pd.to_datetime(df['date'])
    df['year'] = df['date'].dt.year
    df['month'] = df['date'].dt.month
    df['day_of_week'] = df['date'].dt.dayofweek  # 0=Monday, 5=Saturday
    df['hour'] = df['date'].dt.hour

    # Calculate pace (min/km)
    df['pace_min_per_km'] = (df['final_time'] / 60) / (df['final_distance'] / 1000)

    # Create features for model
    df['distance_km'] = df['final_distance'] / 1000
    df['time_minutes'] = df['final_time'] / 60

    # Label for parkrun detection (we'll use activity name as proxy for now)
    df['is_parkrun'] = df['activity_name'].str.lower().str.contains('parkrun|park run', regex=True, na=False)

    print(f"\n📈 Data Statistics:")
    print(f"   Total races: {len(df)}")
    print(f"   Date range: {df['date'].min().date()} to {df['date'].max().date()}")
    print(f"   Unique events: {df['event_name'].nunique()}")
    print(f"   With polylines: {df['has_polyline'].sum()} ({df['has_polyline'].sum()/len(df)*100:.1f}%)")
    print(f"   Labeled as parkrun: {df['is_parkrun'].sum()}")

    # Event distribution
    print(f"\n🏃 Top 10 Events:")
    event_counts = df['event_name'].value_counts()
    for event, count in event_counts.head(10).items():
        print(f"   {event}: {count}")

    # Distance distribution
    print(f"\n📏 Distance Distribution:")
    dist_bins = [0, 5, 10, 15, 21, 42, 100]
    dist_labels = ['<5km', '5-10km', '10-15km', '15-21km', '21-42km', '>42km']
    df['distance_category'] = pd.cut(df['distance_km'], bins=dist_bins, labels=dist_labels)
    print(df['distance_category'].value_counts().sort_index())

    # Save to CSV
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"\n✅ Saved processed data to {OUTPUT_CSV}")

    # Save statistics
    stats = {
        'total_races': len(df),
        'unique_events': int(df['event_name'].nunique()),
        'with_polylines': int(df['has_polyline'].sum()),
        'polyline_coverage_pct': float(df['has_polyline'].sum() / len(df) * 100),
        'date_range': {
            'min': df['date'].min().isoformat(),
            'max': df['date'].max().isoformat()
        },
        'top_events': event_counts.head(20).to_dict(),
        'distance_distribution': df['distance_category'].value_counts().to_dict(),
        'potential_parkruns': int(df['is_parkrun'].sum())
    }

    with open(STATS_FILE, 'w') as f:
        json.dump(stats, f, indent=2, default=str)

    print(f"✅ Saved statistics to {STATS_FILE}")

    return df

if __name__ == "__main__":
    print("🚀 Processing race training data...\n")

    # Ensure pandas is installed
    try:
        import pandas as pd
    except ImportError:
        print("❌ pandas not installed. Install with: pip install pandas")
        exit(1)

    df = process_races()

    print(f"\n✨ Processing complete!")
    print(f"\nNext steps:")
    print(f"1. Review the CSV: {OUTPUT_CSV}")
    print(f"2. Check statistics: {STATS_FILE}")
    print(f"3. Start exploratory data analysis")
    print(f"4. Build feature engineering pipeline")
