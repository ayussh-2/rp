"""
End-to-End Terramechanics Benchmark Automation
==============================================
Automates Rover 2D DEM simulations via Playwright (async API),
saves exported time-series CSVs to `src/plot/csv/<preset>/`, and generates
publication-quality validation figures.

Supported Modes:
----------------
1. --mode rashid (Default)
   - Runs slip sweep [0.0, 0.1, 0.2, 0.3, 0.4, 0.5] for Rashid-1 lunar baseline
   - Generates Traction Coefficient and Normalized Sinkage validation curves
   - Output: benchmark_validation_curves.png

2. --mode nakashima
   - Gravity scaling comparison locked at slip ratio = 0.20
   - Preset 1: Nakashima (2014): Earth Gravity Baseline (g = 9.81 m/s^2, 20 kg)
   - Preset 2: Niksirat (2020): Lunar Constant Load (g = 1.62 m/s^2, 121.2 kg)
   - Evaluates steady-state Sinkage Ratio and Resistance (Drawbar Pull) Ratio vs Gravity Ratio
   - Output: nakashima_gravity_validation.png

Usage Examples:
---------------
python automation.py --mode rashid
python automation.py --mode nakashima
python automation.py --mode nakashima --headed
python automation.py --mode nakashima --process-only
npm run benchmark -- --mode nakashima
"""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

import matplotlib.pyplot as plt
import pandas as pd
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, async_playwright

# ==============================================================================
# PRESETS & CONFIGURATION
# ==============================================================================
PRESETS = {
    "rashid": {
        "id": "hurrell-2025-rashid-1",
        "name": "Hurrell (2025): Rashid-1 Lunar Baseline (FJS-1 Simulant)",
        "mass": 31.6358,
        "gravity": 1.62,
        "radius": 0.10,
        "load": 51.25,
        "width_3d": 0.08,
    },
    "nakashima_earth": {
        "id": "nakashima-2014",
        "name": "Nakashima (2014): Earth Gravity Baseline",
        "mass": 20.0,
        "gravity": 9.81,
        "radius": 0.10,
        "load": 196.2,
        "width_3d": 0.10,
    },
    "niksirat_lunar": {
        "id": "niksirat-2020",
        "name": "Niksirat (2020): Lunar Constant Load",
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

RASHID_SLIP_SWEEP = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]
NAKASHIMA_LOCKED_SLIP = 0.20
DEFAULT_URL = os.environ.get("DEM_URL", "http://localhost:5173")
SIM_MAX_WAIT_SEC = 600  # 10 minutes per simulation run

# Resolve project directories dynamically
_FILE_PATH = Path(__file__).resolve()

# Root where package.json lives
PROJECT_ROOT = _FILE_PATH.parents[3]
for p in _FILE_PATH.parents:
    if (p / "package.json").exists() and (p / "src").is_dir():
        PROJECT_ROOT = p
        break

# Plot project root where pyproject.toml lives
PLOT_DIR = _FILE_PATH.parents[2]
for p in _FILE_PATH.parents:
    if p.name == "plot" and (p / "pyproject.toml").exists():
        PLOT_DIR = p
        break


def parse_args():
    parser = argparse.ArgumentParser(
        description="Rover DEM Benchmark & Terramechanics Validation Automation"
    )
    parser.add_argument(
        "--mode",
        choices=["rashid", "nakashima"],
        default="rashid",
        help="Experimental mode: 'rashid' (slip sweep benchmark) or 'nakashima' (gravity comparison). Default: rashid",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"Simulation URL (default: {DEFAULT_URL})",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run browser in headed mode (visible UI)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=SIM_MAX_WAIT_SEC,
        help="Max wait per simulation run in seconds (default: 600)",
    )
    parser.add_argument(
        "--process-only",
        "--skip-sim",
        action="store_true",
        help="Skip browser automation and directly process existing CSV files",
    )
    parser.add_argument(
        "--preset",
        default=None,
        help="Custom single-preset name (optional override)",
    )

    args, unknown = parser.parse_known_args()

    # Detect shorthand flags like --nakashima or --rashid
    for arg in unknown + sys.argv[1:]:
        flag = arg.lstrip("-").lower()
        if flag in ["nakashima", "rashid"]:
            args.mode = flag
            break

    # Detect npm environment config flags (e.g. npm run benchmark -- --nakashima)
    for key, value in os.environ.items():
        if key.startswith("npm_config_"):
            flag = key.removeprefix("npm_config_").lower()
            if flag in ["nakashima", "rashid"]:
                args.mode = flag
                break
            if flag == "mode" and value.lower() in ["nakashima", "rashid"]:
                args.mode = value.lower()
                break

    return args


# ==============================================================================
# BROWSER AUTOMATION (ASYNC PLAYWRIGHT)
# ==============================================================================
async def select_preset(page: Page, preset_info: dict):
    """Selects the target preset from the React UI dropdown."""
    dropdown = page.locator('select[aria-label="Select Published Benchmark"]')
    await dropdown.wait_for(state="visible", timeout=15_000)

    # 1. Try by preset ID
    try:
        await dropdown.select_option(value=preset_info["id"])
        print(f"    [+] Selected preset ID: {preset_info['id']}")
        await page.wait_for_timeout(500)
        return
    except Exception:
        pass

    # 2. Try by preset Name / Label
    try:
        await dropdown.select_option(label=preset_info["name"])
        print(f"    [+] Selected preset Label: {preset_info['name']}")
        await page.wait_for_timeout(500)
        return
    except Exception:
        pass

    # 3. Fallback: Search matching text in option elements
    options = await dropdown.locator("option").all()
    for opt in options:
        val = (await opt.get_attribute("value")) or ""
        text = await opt.inner_text()
        if preset_info["id"].lower() in val.lower() or preset_info["name"].lower() in text.lower():
            await dropdown.select_option(value=val)
            print(f"    [+] Selected matching preset: {text}")
            await page.wait_for_timeout(500)
            return

    print(f"    [!] Warning: Preset '{preset_info['name']}' not found in dropdown; continuing with current UI settings.")


async def wait_for_simulation(page: Page, max_wait_sec: int) -> bool:
    """Monitors the #status banner until the DEM simulation run reaches completion."""
    status_locator = page.locator("#status")
    await status_locator.wait_for(state="visible", timeout=10_000)

    start_time = time.time()
    last_phase = ""

    while time.time() - start_time < max_wait_sec:
        text = (await status_locator.inner_text()).strip()
        first_phrase = text.replace("\n", " ").split(",")[0].strip()

        if first_phrase != last_phase:
            print(f"    -> Status: {first_phrase}")
            last_phase = first_phrase

        lower = text.lower()
        if "finished" in lower or "wheel stopped" in lower or "coast" in lower:
            print(f"    [+] Simulation reached completion ({first_phrase}).")
            await asyncio.sleep(1.0)
            return True

        await asyncio.sleep(1.0)

    print(f"    [!] Timeout reached after {max_wait_sec}s ({max_wait_sec // 60} min).")
    return False


async def run_single_simulation(page: Page, slip: float, dest_file: Path, timeout: int) -> bool:
    """Sets the slip ratio, triggers the DEM bed build, waits for completion, and exports the CSV."""
    print(f"    [*] Setting Slip Ratio = {slip:.2f}...")
    slip_input = page.locator("#p_slip")
    await slip_input.wait_for(state="visible", timeout=10_000)
    await slip_input.click()
    await slip_input.fill(str(slip))
    await slip_input.press("Tab")
    await page.wait_for_timeout(300)

    # Click Build bed and run
    build_button = page.locator("#btnBed")
    await build_button.wait_for(state="visible", timeout=10_000)
    print("    [*] Starting DEM bed build & run...")
    await build_button.click()
    await page.wait_for_timeout(1000)

    # Wait for simulation to finish
    completed = await wait_for_simulation(page, timeout)
    if not completed:
        print("    [!] Warning: Simulation timed out or did not finish cleanly.")

    # Export CSV
    export_btn = page.locator("#btnCsv")
    await export_btn.wait_for(state="visible", timeout=10_000)

    dest_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with page.expect_download(timeout=15_000) as dl_info:
            await export_btn.click()
        download = await dl_info.value
        await download.save_as(str(dest_file))
        print(f"    [+] Saved CSV: {dest_file.name}")
        return True
    except PlaywrightTimeoutError:
        print(f"    [!] Failed to download CSV for slip {slip:.2f}")
        return False


async def run_rashid_campaign(url: str, headed: bool, timeout: int):
    """Preserves existing Rashid-1 baseline slip sweep behavior."""
    preset_info = PRESETS["rashid"]
    csv_dir = PLOT_DIR / "csv" / "rashid"
    csv_dir.mkdir(parents=True, exist_ok=True)

    print("==================================================")
    print("MODE: RASHID-1 SLIP SWEEP AUTOMATION")
    print(f"Preset: {preset_info['name']}")
    print(f"Slip Sweep: {RASHID_SLIP_SWEEP}")
    print(f"Target URL: {url}")
    print(f"Headless: {not headed}")
    print(f"Export CSV Directory: {csv_dir.resolve()}")
    print("==================================================")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not headed,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = await browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        print(f"[*] Navigating to {url}...")
        await page.goto(url, timeout=60_000)
        await page.wait_for_load_state("domcontentloaded")

        # Select Rashid-1 preset
        await select_preset(page, preset_info)

        # Loop through slip ratios
        for idx, slip in enumerate(RASHID_SLIP_SWEEP, start=1):
            print(f"\n[{idx}/{len(RASHID_SLIP_SWEEP)}] Setting Slip Ratio = {slip:.2f}...")
            dest_file = csv_dir / f"timeseries_slip_{slip:.2f}.csv"
            await run_single_simulation(page, slip, dest_file, timeout)

        await browser.close()


async def run_nakashima_campaign(url: str, headed: bool, timeout: int) -> Tuple[Path, Path]:
    """Runs Nakashima Earth Baseline and Niksirat Lunar Constant Load at slip=0.20."""
    earth_preset = PRESETS["nakashima_earth"]
    lunar_preset = PRESETS["niksirat_lunar"]

    earth_dir = PLOT_DIR / "csv" / "nakashima_earth"
    lunar_dir = PLOT_DIR / "csv" / "niksirat_lunar"
    earth_dir.mkdir(parents=True, exist_ok=True)
    lunar_dir.mkdir(parents=True, exist_ok=True)

    earth_csv = earth_dir / f"timeseries_slip_{NAKASHIMA_LOCKED_SLIP:.2f}.csv"
    lunar_csv = lunar_dir / f"timeseries_slip_{NAKASHIMA_LOCKED_SLIP:.2f}.csv"

    print("==================================================")
    print("MODE: NAKASHIMA GRAVITY SWEEP AUTOMATION")
    print(f"Locked Slip Ratio: {NAKASHIMA_LOCKED_SLIP:.2f}")
    print(f"1. Earth Baseline: {earth_preset['name']}")
    print(f"2. Lunar Scaled:   {lunar_preset['name']}")
    print(f"Target URL: {url}")
    print(f"Headless: {not headed}")
    print("==================================================")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not headed,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = await browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        print(f"[*] Navigating to {url}...")
        await page.goto(url, timeout=60_000)
        await page.wait_for_load_state("domcontentloaded")

        # 1. Earth Gravity Baseline
        print(f"\n[1/2] Executing Preset: {earth_preset['name']}")
        await select_preset(page, earth_preset)
        await run_single_simulation(page, NAKASHIMA_LOCKED_SLIP, earth_csv, timeout)

        # 2. Lunar Constant Load Baseline
        print(f"\n[2/2] Executing Preset: {lunar_preset['name']}")
        await select_preset(page, lunar_preset)
        await run_single_simulation(page, NAKASHIMA_LOCKED_SLIP, lunar_csv, timeout)

        await browser.close()

    return earth_csv, lunar_csv


# ==============================================================================
# DATA PROCESSING & VALIDATION PLOTTING
# ==============================================================================
def clean_and_load_csv(csv_path: Path) -> pd.DataFrame:
    """Loads a CSV, strips whitespace from column names, and coerces columns to numeric."""
    df = pd.read_csv(csv_path)
    df.columns = [str(c).strip() for c in df.columns]
    for col in df.columns:
        if col != "phase":
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def extract_steady_state(df: pd.DataFrame) -> pd.DataFrame:
    """Extracts steady-state data from the second half of the time-series."""
    if df.empty:
        return df

    if "phase" in df.columns and "drive" in df["phase"].values:
        drive_data = df[df["phase"] == "drive"]
    elif "t_s" in df.columns:
        max_time = df["t_s"].max()
        drive_data = df[df["t_s"] > (max_time / 2.0)]
    else:
        drive_data = df.iloc[len(df) // 2 :]

    if drive_data.empty:
        drive_data = df.iloc[len(df) // 2 :] if len(df) > 1 else df

    return drive_data


def process_rashid_data():
    """Processes Rashid-1 sweep CSVs and generates a 3-panel validation figure."""
    preset_key = "rashid"
    preset_info = PRESETS[preset_key]
    wheel_mass = preset_info["mass"]
    gravity = preset_info["gravity"]
    wheel_radius = preset_info["radius"]
    wheel_load = preset_info.get("load", wheel_mass * gravity)
    width_3d = preset_info.get("width_3d", 0.08)
    wheel_load_3d = wheel_load * width_3d
    omega = 0.2

    csv_dir = PLOT_DIR / "csv" / preset_key
    csv_files = sorted(csv_dir.glob("*.csv"))

    print("\n==================================================")
    print("STEP 2: RASHID-1 DATA PROCESSING & PLOTTING")
    print(f"Preset: {preset_key} (3D Load: {wheel_load_3d:.2f} N, 2D Load: {wheel_load:.2f} N/m, Radius: {wheel_radius*1000:.0f} mm)")
    print(f"Reading CSVs from: {csv_dir.resolve()}")
    print("==================================================")

    if not csv_files:
        print(f"[!] No CSV files found in {csv_dir.resolve()} to process.")
        return

    results = []
    for file in csv_files:
        try:
            df = clean_and_load_csv(file)
            if df.empty:
                continue

            drive_data = extract_steady_state(df)

            avg_slip = drive_data["slip"].mean() if "slip" in drive_data.columns else float("nan")
            if pd.isna(avg_slip):
                # Fallback to slip encoded in filename (e.g. timeseries_slip_0.00.csv)
                import re
                m = re.search(r"slip_([0-9.]+)", file.name)
                avg_slip = float(m.group(1)) if m else 0.0

            # 1. Ingest 3D forces (fallback to 2D force * width_3d if 3D columns not present)
            if "drawbar_pull_3D_N" in drive_data.columns:
                avg_drawbar_3d = drive_data["drawbar_pull_3D_N"].mean()
            else:
                avg_drawbar_3d = drive_data["drawbar_pull_N_per_m"].mean() * width_3d

            if "drive_torque_3D_Nm" in drive_data.columns:
                avg_torque_3d = drive_data["drive_torque_3D_Nm"].mean()
            elif "drive_torque_Nm_per_m" in drive_data.columns:
                avg_torque_3d = drive_data["drive_torque_Nm_per_m"].mean() * width_3d
            else:
                avg_torque_3d = 0.0

            avg_sinkage_mm = drive_data["sinkage_mm"].mean()

            # 2. Terramechanics Physics Calculations
            traction_coeff = avg_drawbar_3d / wheel_load_3d
            v_x = omega * wheel_radius * (1.0 - avg_slip)
            abs_torque = abs(avg_torque_3d)
            if abs_torque * omega > 1e-9:
                tractive_eff = (avg_drawbar_3d * v_x) / (abs_torque * omega)
            else:
                tractive_eff = 0.0

            normalized_sinkage = (avg_sinkage_mm / 1000.0) / wheel_radius

            results.append({
                "File": file.name,
                "Slip Ratio": avg_slip,
                "Drawbar 3D (N)": avg_drawbar_3d,
                "Torque 3D (Nm)": avg_torque_3d,
                "Traction Coefficient": traction_coeff,
                "Tractive Efficiency": tractive_eff,
                "Normalized Sinkage": normalized_sinkage,
            })
        except Exception as e:
            print(f"[!] Error processing {file.name}: {e}")

    if not results:
        print("[!] No valid simulation rows processed.")
        return

    results_df = pd.DataFrame(results).sort_values(by="Slip Ratio").reset_index(drop=True)

    print("\n=== Benchmark Summary Table ===")
    display_cols = [
        "Slip Ratio",
        "Drawbar 3D (N)",
        "Torque 3D (Nm)",
        "Traction Coefficient",
        "Tractive Efficiency",
        "Normalized Sinkage",
    ]
    print(results_df[display_cols].to_string(index=False))

    # 3. Generate 3-Panel Publication Validation Figure (1x3 Subplots)
    fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(18, 5.2), dpi=100)

    # Panel 1: Traction Coefficient vs Slip Ratio
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

    # Panel 2: Tractive Efficiency vs Slip Ratio
    ax2.plot(
        results_df["Slip Ratio"],
        results_df["Tractive Efficiency"],
        marker="^",
        markersize=8,
        linewidth=2.2,
        color="#2e7d32",
        label="2D DEM Simulation",
    )
    ax2.set_title("Tractive Efficiency vs. Slip Ratio", fontsize=13, fontweight="bold", pad=10)
    ax2.set_xlabel("Slip Ratio ($s$)", fontsize=11)
    ax2.set_ylabel("Tractive Efficiency ($\eta$)", fontsize=11)
    ax2.set_xlim(-0.02, max(0.55, results_df["Slip Ratio"].max() + 0.05))
    ax2.grid(True, linestyle="--", alpha=0.7)
    ax2.legend(loc="lower right")

    # Panel 3: Normalized Sinkage vs Slip Ratio
    ax3.plot(
        results_df["Slip Ratio"],
        results_df["Normalized Sinkage"],
        marker="s",
        markersize=8,
        linewidth=2.2,
        color="#a65f00",
        label="2D DEM Simulation",
    )
    ax3.set_title("Normalized Sinkage vs. Slip Ratio", fontsize=13, fontweight="bold", pad=10)
    ax3.set_xlabel("Slip Ratio ($s$)", fontsize=11)
    ax3.set_ylabel("Normalized Sinkage ($z / R$)", fontsize=11)
    ax3.set_xlim(-0.02, max(0.55, results_df["Slip Ratio"].max() + 0.05))
    ax3.grid(True, linestyle="--", alpha=0.7)
    ax3.legend(loc="upper left")

    plt.suptitle(
        f"2D DEM Benchmark Validation ({preset_key})\n"
        f"Wheel Load (3D): {wheel_load_3d:.2f} N | Radius: {wheel_radius*1000:.0f} mm",
        fontsize=14,
        fontweight="bold",
    )
    plt.tight_layout()

    out_image_root = PROJECT_ROOT / "benchmark_validation_curves.png"
    out_image_plot = PLOT_DIR / "benchmark_validation_curves.png"

    plt.savefig(out_image_root, dpi=300)
    if out_image_plot != out_image_root:
        plt.savefig(out_image_plot, dpi=300)

    plt.close(fig)
    print(f"\n[+] Validation plot successfully saved to: {out_image_root.resolve()}")


def process_nakashima_data(earth_csv_path: Optional[Path] = None, lunar_csv_path: Optional[Path] = None):
    """Processes Nakashima Earth vs Niksirat Lunar steady-state data and plots gravity ratios."""
    if earth_csv_path is None:
        earth_csv_path = PLOT_DIR / "csv" / "nakashima_earth" / f"timeseries_slip_{NAKASHIMA_LOCKED_SLIP:.2f}.csv"
    if lunar_csv_path is None:
        lunar_csv_path = PLOT_DIR / "csv" / "niksirat_lunar" / f"timeseries_slip_{NAKASHIMA_LOCKED_SLIP:.2f}.csv"

    print("\n==================================================")
    print("STEP 2: NAKASHIMA GRAVITY VALIDATION DATA PROCESSING")
    print(f"Earth CSV: {earth_csv_path.resolve()}")
    print(f"Lunar CSV: {lunar_csv_path.resolve()}")
    print("==================================================")

    if not earth_csv_path.exists():
        print(f"[!] Error: Earth CSV not found at {earth_csv_path.resolve()}")
        return
    if not lunar_csv_path.exists():
        print(f"[!] Error: Lunar CSV not found at {lunar_csv_path.resolve()}")
        return

    earth_df = clean_and_load_csv(earth_csv_path)
    lunar_df = clean_and_load_csv(lunar_csv_path)

    earth_steady = extract_steady_state(earth_df)
    lunar_steady = extract_steady_state(lunar_df)

    # Average sinkage_mm and drawbar_pull_N_per_m
    earth_sinkage = earth_steady["sinkage_mm"].mean()
    earth_drawbar = earth_steady["drawbar_pull_N_per_m"].mean()

    lunar_sinkage = lunar_steady["sinkage_mm"].mean()
    lunar_drawbar = lunar_steady["drawbar_pull_N_per_m"].mean()

    # Ratios as specified:
    # Gravity Ratio = 1.62 / 9.81
    # Sinkage Ratio = Lunar Sinkage / Earth Sinkage
    # Resistance Ratio = Lunar Drawbar Pull / Earth Drawbar Pull
    gravity_ratio = 1.62 / 9.81
    sinkage_ratio = lunar_sinkage / earth_sinkage if earth_sinkage != 0 else float("nan")
    resistance_ratio = lunar_drawbar / earth_drawbar if earth_drawbar != 0 else float("nan")

    print("\n=== Nakashima Gravity Validation Summary ===")
    print(f"Earth Simulation (g = 9.81 m/s^2, slip = {NAKASHIMA_LOCKED_SLIP:.2f}):")
    print(f"  - Steady-State Sinkage:       {earth_sinkage:.3f} mm")
    print(f"  - Steady-State Drawbar Pull:  {earth_drawbar:.3f} N/m")
    print(f"Lunar Simulation (g = 1.62 m/s^2, scaled mass = 121.2 kg, slip = {NAKASHIMA_LOCKED_SLIP:.2f}):")
    print(f"  - Steady-State Sinkage:       {lunar_sinkage:.3f} mm")
    print(f"  - Steady-State Drawbar Pull:  {lunar_drawbar:.3f} N/m")
    print("\nScaling Ratios:")
    print(f"  - Gravity Ratio (1.62 / 9.81):    {gravity_ratio:.4f}")
    print(f"  - Sinkage Ratio (Lunar / Earth):   {sinkage_ratio:.4f}")
    print(f"  - Resistance Ratio (Lunar / Earth):{resistance_ratio:.4f}")

    # Matplotlib 1x2 Subplot
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.2), dpi=300)

    # Left Plot (Resistance Ratio vs Gravity Ratio)
    # Diagonal ideal line from (0,0) to (1.2, 1.2)
    ax1.plot([0.0, 1.2], [0.0, 1.2], "k--", linewidth=1.8, label="Ideal Scaling ($y = x$)")
    ax1.scatter(
        [gravity_ratio],
        [resistance_ratio],
        color="red",
        s=120,
        zorder=5,
        label=f"Simulation ({gravity_ratio:.2f}, {resistance_ratio:.2f})",
    )
    ax1.set_xlim(0.0, 1.2)
    ax1.set_ylim(0.0, 1.2)
    ax1.set_title("Resistance Ratio vs. Gravity Ratio", fontsize=13, fontweight="bold", pad=10)
    ax1.set_xlabel("Gravity Ratio ($g_{moon} / g_{earth}$)", fontsize=11)
    ax1.set_ylabel("Resistance Ratio ($DP_{moon} / DP_{earth}$)", fontsize=11)
    ax1.grid(True, linestyle="--", alpha=0.7)
    ax1.legend(loc="upper left")

    # Right Plot (Sinkage Ratio vs Gravity Ratio)
    # Flat horizontal ideal line at Y=1.0
    ax2.plot([0.0, 1.2], [1.0, 1.0], "k--", linewidth=1.8, label="Ideal Invariance ($y = 1.0$)")
    ax2.scatter(
        [gravity_ratio],
        [sinkage_ratio],
        color="red",
        s=120,
        zorder=5,
        label=f"Simulation ({gravity_ratio:.2f}, {sinkage_ratio:.2f})",
    )
    ax2.set_xlim(0.0, 1.2)
    ax2.set_ylim(0.0, 2.0)
    ax2.set_title("Sinkage Ratio vs. Gravity Ratio", fontsize=13, fontweight="bold", pad=10)
    ax2.set_xlabel("Gravity Ratio ($g_{moon} / g_{earth}$)", fontsize=11)
    ax2.set_ylabel("Sinkage Ratio ($z_{moon} / z_{earth}$)", fontsize=11)
    ax2.grid(True, linestyle="--", alpha=0.7)
    ax2.legend(loc="upper left")

    plt.suptitle(
        f"Nakashima (2014) / Niksirat (2020) Gravity Scaling Validation (Slip = {NAKASHIMA_LOCKED_SLIP:.2f})\n"
        f"Gravity Ratio: {gravity_ratio:.3f} | Resistance Ratio: {resistance_ratio:.3f} | Sinkage Ratio: {sinkage_ratio:.3f}",
        fontsize=14,
        fontweight="bold",
    )
    plt.tight_layout()

    out_image_root = PROJECT_ROOT / "nakashima_gravity_validation.png"
    out_image_plot = PLOT_DIR / "nakashima_gravity_validation.png"

    plt.savefig(out_image_root, dpi=300)
    if out_image_plot != out_image_root:
        plt.savefig(out_image_plot, dpi=300)

    plt.close(fig)
    print(f"\n[+] Validation plot successfully saved to: {out_image_root.resolve()}")


# ==============================================================================
# MAIN ASYNC ORCHESTRATOR
# ==============================================================================
async def async_main():
    args = parse_args()

    if args.mode == "rashid":
        if not args.process_only:
            await run_rashid_campaign(args.url, args.headed, args.timeout)
        process_rashid_data()

    elif args.mode == "nakashima":
        earth_csv = None
        lunar_csv = None
        if not args.process_only:
            earth_csv, lunar_csv = await run_nakashima_campaign(args.url, args.headed, args.timeout)
        process_nakashima_data(earth_csv, lunar_csv)


def main():
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
