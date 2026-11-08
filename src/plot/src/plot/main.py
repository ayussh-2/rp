import pandas as pd
import matplotlib.pyplot as plt
import glob
import os
import sys
from pathlib import Path

PRESETS = {
    "rashid": {"mass": 20.0, "gravity": 1.62, "radius": 0.10},
    "nakashima_earth": {"mass": 20.0, "gravity": 9.81, "radius": 0.10},
    "niksirat_lunar": {"mass": 121.2, "gravity": 1.62, "radius": 0.10},
    "omura_slope": {"mass": 20.0, "gravity": 1.62, "radius": 0.10},
    "takehana_toyoura": {"mass": 20.0, "gravity": 9.81, "radius": 0.10},
}

plot_dir = Path(__file__).resolve().parents[2]
command_line_flags = [argument[2:] for argument in sys.argv[1:] if argument.startswith("--")]
npm_flags = [
    key.removeprefix("npm_config_")
    for key, value in os.environ.items()
    if key.startswith("npm_config_") and value == "true"
]
folder_flags = command_line_flags + npm_flags

if len(folder_flags) > 1 or (folder_flags and not folder_flags[0]):
    raise SystemExit("Use at most one data folder flag in the form --<folder-name>.")

if folder_flags:
    ACTIVE_PRESET = folder_flags[0]
else:
    ACTIVE_PRESET = Path.cwd().name

if ACTIVE_PRESET not in PRESETS:
    available_presets = ", ".join(PRESETS)
    raise SystemExit(
        f"Could not determine a valid preset from the current folder or command-line "
        f"flag. Use --<preset-name>. Available presets: {available_presets}"
    )

WHEEL_MASS = PRESETS[ACTIVE_PRESET]["mass"]
GRAVITY = PRESETS[ACTIVE_PRESET]["gravity"]
WHEEL_RADIUS = PRESETS[ACTIVE_PRESET]["radius"]
WHEEL_LOAD = WHEEL_MASS * GRAVITY

csv_dir = plot_dir / "csv" / ACTIVE_PRESET if folder_flags else Path.cwd()
csv_files = glob.glob(str(csv_dir / "*.csv"))

if not csv_files:
    print("No CSV files found in the current directory. Please add your exported files.")
    exit()

results = []

for file in csv_files:
    df = pd.read_csv(file)
    
    if 'phase' in df.columns:
        drive_data = df[df['phase'] == 'drive']
    else:
        max_time = df['t_s'].max()
        drive_data = df[df['t_s'] > (max_time / 2)]
        
    if drive_data.empty:
        continue

    avg_slip = drive_data['slip'].mean()
    avg_drawbar = drive_data['drawbar_pull_N_per_m'].mean()
    avg_sinkage_mm = drive_data['sinkage_mm'].mean()
    
    traction_coeff = avg_drawbar / WHEEL_LOAD
    normalized_sinkage = (avg_sinkage_mm / 1000) / WHEEL_RADIUS
    
    results.append({
        'Slip Ratio': avg_slip,
        'Traction Coefficient': traction_coeff,
        'Normalized Sinkage': normalized_sinkage
    })

results_df = pd.DataFrame(results).sort_values(by='Slip Ratio')

print("=== Processed Benchmark Data ===")
print(results_df.to_string(index=False))

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

ax1.plot(results_df['Slip Ratio'], results_df['Traction Coefficient'], 
         marker='o', linestyle='-', color='#335f8a', linewidth=2, markersize=8)
ax1.set_title('Traction Coefficient vs. Slip Ratio', fontsize=14, fontweight='bold')
ax1.set_xlabel('Slip Ratio', fontsize=12)
ax1.set_ylabel('Traction Coefficient (Fx / W)', fontsize=12)
ax1.grid(True, linestyle='--', alpha=0.7)
ax1.set_xlim(0, 0.6)

ax2.plot(results_df['Slip Ratio'], results_df['Normalized Sinkage'], 
         marker='s', linestyle='-', color='#a65f00', linewidth=2, markersize=8)
ax2.set_title('Normalized Sinkage vs. Slip Ratio', fontsize=14, fontweight='bold')
ax2.set_xlabel('Slip Ratio', fontsize=12)
ax2.set_ylabel('Normalized Sinkage (z / R)', fontsize=12)
ax2.grid(True, linestyle='--', alpha=0.7)
ax2.set_xlim(0, 0.6)

plt.suptitle(
    f'2D DEM Benchmark Validation ({ACTIVE_PRESET}, Load: {WHEEL_LOAD:.1f} N/m, '
    f'R: {WHEEL_RADIUS} m)',
    fontsize=16
)
plt.tight_layout()

plt.savefig('benchmark_validation_curves.png', dpi=300)
print("\nPlot saved as 'benchmark_validation_curves.png'")
plt.show()