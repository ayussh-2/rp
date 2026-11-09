"""
End-to-End Terramechanics Benchmark Automation
==============================================
Runs the rover DEM simulation across multiple slip ratios via Playwright,
saves the exported time series CSVs to `src/plot/csv/<preset>/`, and generates
publication-quality benchmark validation curves.

Usage via package.json / uv:
----------------------------
npm run benchmark
npm run benchmark -- --headed
npm run benchmark -- --nakashima_earth
uv run --directory src/plot benchmark
"""

import argparse
import os
import sys
import time
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# ==============================================================================
# PRESETS & CONFIGURATION
# ==============================================================================
PRESETS = {
    "rashid": {
        "id": "hurrell-2025-rashid-1",
        "name": "Hurrell (2025): Rashid-1 Lunar Baseline",
        "mass": 20.0,
        "gravity": 1.62,
        "radius": 0.10,
    },
    "nakashima_earth": {
        "id": "nakashima-2014",
        "name": "Nakashima (2014): Earth Gravity Baseline",
        "mass": 20.0,
        "gravity": 9.81,
        "radius": 0.10,
    },
    "niksirat_lunar": {
        "id": "niksirat-2020",
        "name": "Niksirat (2020): Lunar Reduced-Gravity Baseline",
        "mass": 121.2,
        "gravity": 1.62,
        "radius": 0.10,
    },
    "omura_slope": {
        "id": "omura-2023",
        "name": "Omura (2023): Slope Ascent & Loose Sand Baseline",
        "mass": 20.0,
        "gravity": 1.62,
        "radius": 0.10,
    },
    "takehana_toyoura": {
        "id": "takehana-2024",
        "name": "Takehana (2024): Toyoura Sand Baseline",
        "mass": 20.0,
        "gravity": 9.81,
        "radius": 0.10,
    },
}

TARGET_SLIP_RATIOS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]
DEFAULT_URL = os.environ.get("DEM_URL", "http://localhost:5173")
SIM_MAX_WAIT_SEC = 600  # 10 minutes per simulation run

# Directory resolution
# __file__ is in src/plot/src/plot/automation.py -> parents[2] is src/plot, parents[3] is project root
PLOT_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def parse_args():
    parser = argparse.ArgumentParser(description="Rover DEM Benchmark Automation")
    parser.add_argument("--url", default=DEFAULT_URL, help="Simulation URL (default: http://localhost:5173)")
    parser.add_argument("--preset", default=None, help=f"Preset name ({', '.join(PRESETS.keys())})")
    parser.add_argument("--headed", action="store_true", help="Run browser in headed mode (visible UI)")
    parser.add_argument("--timeout", type=int, default=SIM_MAX_WAIT_SEC, help="Max wait per simulation (seconds)")

    # Also detect --<preset_name> directly (e.g. npm run benchmark -- --rashid)
    args, unknown = parser.parse_known_args()

    # Check for direct preset flags or npm environment flags
    chosen_preset = args.preset
    if not chosen_preset:
        for arg in unknown + sys.argv[1:]:
            flag = arg.lstrip("-")
            if flag in PRESETS:
                chosen_preset = flag
                break

    if not chosen_preset:
        for key in os.environ:
            if key.startswith("npm_config_"):
                flag = key.removeprefix("npm_config_")
                if flag in PRESETS:
                    chosen_preset = flag
                    break

    # Default to rashid if unspecified
    if not chosen_preset or chosen_preset not in PRESETS:
        chosen_preset = "rashid"

    return args, chosen_preset


# ==============================================================================
# PART 1: BROWSER AUTOMATION (PLAYWRIGHT)
# ==============================================================================
def select_preset(page, preset_info: dict):
    """Selects the target preset from the React UI dropdown."""
    dropdown = page.locator('select[aria-label="Select Published Benchmark"]')
    dropdown.wait_for(state="visible", timeout=15_000)

    # 1. Try by preset ID
    try:
        dropdown.select_option(value=preset_info["id"])
        print(f"    [+] Selected preset ID: {preset_info['id']}")
        page.wait_for_timeout(500)
        return
    except Exception:
        pass

    # 2. Try by preset Name
    try:
        dropdown.select_option(label=preset_info["name"])
        print(f"    [+] Selected preset Label: {preset_info['name']}")
        page.wait_for_timeout(500)
        return
    except Exception:
        pass

    # 3. Fallback: Search option text
    options = dropdown.locator("option").all()
    for opt in options:
        val = opt.get_attribute("value") or ""
        text = opt.inner_text()
        if preset_info["id"].lower() in val.lower() or preset_info["name"].lower() in text.lower():
            dropdown.select_option(value=val)
            print(f"    [+] Selected matching preset: {text}")
            page.wait_for_timeout(500)
            return

    print("    [!] Warning: Preset option could not be selected from dropdown; continuing with current settings.")


def wait_for_simulation(page, max_wait_sec: int) -> bool:
    """Monitors #status banner until the simulation finishes."""
    status_locator = page.locator("#status")
    status_locator.wait_for(state="visible", timeout=10_000)

    start_time = time.time()
    last_phase = ""

    while time.time() - start_time < max_wait_sec:
        text = status_locator.inner_text().strip()
        first_phrase = text.replace("\n", " ").split(",")[0].strip()

        if first_phrase != last_phase:
            print(f"    -> Status: {first_phrase}")
            last_phase = first_phrase

        lower = text.lower()
        if "finished" in lower or "wheel stopped" in lower or "coast" in lower:
            print(f"    [+] Simulation reached completion ({first_phrase}).")
            time.sleep(1.0)
            return True

        time.sleep(1.0)

    print(f"    [!] Timeout reached after {max_wait_sec}s ({max_wait_sec // 60} min).")
    return False


def run_campaign(preset_key: str, url: str, headed: bool, timeout: int):
    preset_info = PRESETS[preset_key]
    csv_dir = PLOT_DIR / "csv" / preset_key
    csv_dir.mkdir(parents=True, exist_ok=True)

    print("==================================================")
    print("STEP 1: PLAYWRIGHT BROWSER SIMULATION AUTOMATION")
    print(f"Preset: {preset_key} ({preset_info['name']})")
    print(f"Target URL: {url}")
    print(f"Headless: {not headed}")
    print(f"Export CSV Directory: {csv_dir.resolve()}")
    print("==================================================")

    downloaded_files = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not headed,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 900})
        page = context.new_page()

        print(f"[*] Navigating to {url}...")
        page.goto(url, timeout=60_000)
        page.wait_for_load_state("domcontentloaded")

        # Select benchmark preset
        select_preset(page, preset_info)

        # Loop through slip ratios
        for idx, slip in enumerate(TARGET_SLIP_RATIOS, start=1):
            print(f"\n[{idx}/{len(TARGET_SLIP_RATIOS)}] Setting Slip Ratio = {slip:.2f}...")

            # 1. Fill slip input
            slip_input = page.locator("#p_slip")
            slip_input.wait_for(state="visible", timeout=10_000)
            slip_input.click()
            slip_input.fill(str(slip))
            slip_input.press("Tab")
            page.wait_for_timeout(300)

            # 2. Click Build bed and run
            build_button = page.locator("#btnBed")
            build_button.wait_for(state="visible", timeout=10_000)
            print("    [*] Starting DEM bed build & run...")
            build_button.click()

            page.wait_for_timeout(1000)

            # 3. Wait for simulation to finish
            wait_for_simulation(page, timeout)

            # 4. Export CSV
            export_btn = page.locator("#btnCsv")
            export_btn.wait_for(state="visible", timeout=10_000)

            dest_file = csv_dir / f"timeseries_slip_{slip:.2f}.csv"
            try:
                with page.expect_download(timeout=15_000) as dl_info:
                    export_btn.click()
                download = dl_info.value
                download.save_as(str(dest_file))
                print(f"    [+] Saved CSV: {dest_file.name}")
                downloaded_files.append(dest_file)
            except PlaywrightTimeoutError:
                print(f"    [!] Failed to download CSV for slip {slip:.2f}")

        browser.close()

    return downloaded_files


# ==============================================================================
# PART 2: DATA PROCESSING & VISUALIZATION
# ==============================================================================
def process_benchmark_data(preset_key: str):
    preset_info = PRESETS[preset_key]
    wheel_mass = preset_info["mass"]
    gravity = preset_info["gravity"]
    wheel_radius = preset_info["radius"]
    wheel_load = wheel_mass * gravity

    csv_dir = PLOT_DIR / "csv" / preset_key
    csv_files = sorted(csv_dir.glob("*.csv"))

    print("\n==================================================")
    print("STEP 2: DATA PROCESSING & VALIDATION PLOTTING")
    print(f"Preset: {preset_key} (Load: {wheel_load:.2f} N/m, Radius: {wheel_radius*1000:.0f} mm)")
    print(f"Reading CSVs from: {csv_dir.resolve()}")
    print("==================================================")

    if not csv_files:
        print("[!] No CSV files found to process.")
        return

    results = []
    for file in csv_files:
        try:
            df = pd.read_csv(file)
            if df.empty:
                continue

            # Steady-state data filtering
            if "phase" in df.columns:
                drive_data = df[df["phase"] == "drive"]
            elif "t_s" in df.columns:
                max_time = df["t_s"].max()
                drive_data = df[df["t_s"] > (max_time / 2.0)]
            else:
                drive_data = df.iloc[len(df) // 2 :]

            if drive_data.empty:
                drive_data = df

            avg_slip = drive_data["slip"].mean()
            avg_drawbar = drive_data["drawbar_pull_N_per_m"].mean()
            avg_sinkage_mm = drive_data["sinkage_mm"].mean()

            # 2D-to-3D terramechanics normalizations
            traction_coeff = avg_drawbar / wheel_load
            normalized_sinkage = (avg_sinkage_mm / 1000.0) / wheel_radius

            results.append({
                "File": file.name,
                "Slip Ratio": avg_slip,
                "Avg Drawbar (N/m)": avg_drawbar,
                "Avg Sinkage (mm)": avg_sinkage_mm,
                "Traction Coefficient": traction_coeff,
                "Normalized Sinkage": normalized_sinkage,
            })
        except Exception as e:
            print(f"[!] Error processing {file.name}: {e}")

    results_df = pd.DataFrame(results).sort_values(by="Slip Ratio").reset_index(drop=True)

    print("\n=== Benchmark Summary Table ===")
    display_cols = ["Slip Ratio", "Avg Drawbar (N/m)", "Avg Sinkage (mm)", "Traction Coefficient", "Normalized Sinkage"]
    print(results_df[display_cols].to_string(index=False))

    # Generate publication validation figure
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.2), dpi=100)

    # Plot 1: Traction Coefficient vs Slip Ratio
    ax1.plot(
        results_df["Slip Ratio"],
        results_df["Traction Coefficient"],
        marker="o",
        markersize=8,
        linewidth=2.2,
        color="#335f8a",
        label="2D DEM Simulation",
    )
    ax1.set_title("Traction Coefficient vs. Slip Ratio", fontsize=13, fontweight="bold", pad=10)
    ax1.set_xlabel("Slip Ratio ($s$)", fontsize=11)
    ax1.set_ylabel("Traction Coefficient ($F_x / W$)", fontsize=11)
    ax1.set_xlim(-0.02, max(0.55, results_df["Slip Ratio"].max() + 0.05))
    ax1.grid(True, linestyle="--", alpha=0.7)
    ax1.legend(loc="lower right")

    # Plot 2: Normalized Sinkage vs Slip Ratio
    ax2.plot(
        results_df["Slip Ratio"],
        results_df["Normalized Sinkage"],
        marker="s",
        markersize=8,
        linewidth=2.2,
        color="#a65f00",
        label="2D DEM Simulation",
    )
    ax2.set_title("Normalized Sinkage vs. Slip Ratio", fontsize=13, fontweight="bold", pad=10)
    ax2.set_xlabel("Slip Ratio ($s$)", fontsize=11)
    ax2.set_ylabel("Normalized Sinkage ($z / R$)", fontsize=11)
    ax2.set_xlim(-0.02, max(0.55, results_df["Slip Ratio"].max() + 0.05))
    ax2.grid(True, linestyle="--", alpha=0.7)
    ax2.legend(loc="upper left")

    plt.suptitle(
        f"2D DEM Benchmark Validation ({preset_key})\n"
        f"Wheel Load: {wheel_load:.1f} N/m | Radius: {wheel_radius*1000:.0f} mm",
        fontsize=14,
        fontweight="bold",
    )
    plt.tight_layout()

    out_image = PROJECT_ROOT / "benchmark_validation_curves.png"
    plt.savefig(out_image, dpi=300)
    plt.close(fig)
    print(f"\n[+] Validation plot successfully saved to: {out_image.resolve()}")


def main():
    args, preset_key = parse_args()
    run_campaign(preset_key, args.url, args.headed, args.timeout)
    process_benchmark_data(preset_key)


if __name__ == "__main__":
    main()
