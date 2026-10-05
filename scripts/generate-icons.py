#!/usr/bin/env python3
"""Generate every OneShare icon and splash asset from one mark definition.

Requires Inkscape (SVG -> PNG). Run from the repository root:

    python3 scripts/generate-icons.py
"""

import math
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACCENT = "#2D4BE0"
WHITE = "#FFFFFF"


def mark(cx: float, cy: float, scale: float, color: str) -> str:
    """A ring with a gap at the top right and a dot passing through it."""
    radius = 236 * scale
    stroke = 104 * scale
    dot = 62 * scale

    def point(angle: float) -> tuple[float, float]:
        rad = math.radians(angle)
        return cx + radius * math.cos(rad), cy + radius * math.sin(rad)

    x1, y1 = point(-10)
    x2, y2 = point(280)
    dx, dy = point(-45)
    return (
        f'<path d="M{x1:.2f} {y1:.2f}A{radius:.2f} {radius:.2f} 0 1 1 {x2:.2f} {y2:.2f}" '
        f'fill="none" stroke="{color}" stroke-width="{stroke:.2f}" stroke-linecap="round"/>'
        f'<circle cx="{dx:.2f}" cy="{dy:.2f}" r="{dot:.2f}" fill="{color}"/>'
    )


def svg(size: int, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}">{body}</svg>'
    )


def rounded_icon() -> str:
    # macOS grid: 824px body on a 1024px canvas. Also used for Linux and the web.
    return svg(
        1024,
        f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{ACCENT}"/>'
        + mark(512, 512, 824 / 1024, WHITE),
    )


def full_bleed_icon() -> str:
    # iOS and legacy Android masks apply their own corner shape.
    return svg(1024, f'<rect width="1024" height="1024" fill="{ACCENT}"/>' + mark(512, 512, 0.86, WHITE))


def round_icon() -> str:
    return svg(1024, f'<circle cx="512" cy="512" r="512" fill="{ACCENT}"/>' + mark(512, 512, 0.86, WHITE))


def foreground_icon() -> str:
    # Adaptive icon foreground: 108dp canvas with a 66dp safe zone.
    return svg(1024, mark(512, 512, 0.9, WHITE))


def splash(width: int, height: int) -> str:
    size = min(width, height) * 0.22
    scale = size / 1024
    x = (width - size) / 2
    y = (height - size) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}">'
        f'<rect width="{width}" height="{height}" fill="{WHITE}"/>'
        f'<g transform="translate({x:.2f} {y:.2f}) scale({scale:.5f})">'
        f'<rect width="1024" height="1024" rx="230" fill="{ACCENT}"/>'
        + mark(512, 512, 0.86, WHITE)
        + "</g></svg>"
    )


def render(source: str, target: Path, width: int, height: int | None = None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as handle:
        handle.write(source)
        path = handle.name
    command = ["inkscape", path, "-w", str(width), "-o", str(target)]
    if height:
        command += ["-h", str(height)]
    subprocess.run(command, check=True, capture_output=True)
    Path(path).unlink()
    if target.name.startswith("splash"):
        # Splash screens ship without alpha.
        subprocess.run(
            ["magick", str(target), "-background", WHITE, "-alpha", "remove", "-alpha", "off", str(target)],
            check=True,
        )


def android_vector() -> str:
    # Same geometry in the 108dp viewport, centred on 54,54.
    scale = 0.9 * 108 / 1024
    radius = 236 * scale
    stroke = 104 * scale
    dot = 62 * scale

    def point(angle: float) -> tuple[float, float]:
        rad = math.radians(angle)
        return 54 + radius * math.cos(rad), 54 + radius * math.sin(rad)

    x1, y1 = point(-10)
    x2, y2 = point(280)
    dx, dy = point(-45)
    return f"""<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:pathData="M{x1:.2f},{y1:.2f}A{radius:.2f},{radius:.2f} 0,1 1,{x2:.2f},{y2:.2f}"
        android:strokeColor="#FFFFFF"
        android:strokeWidth="{stroke:.2f}"
        android:strokeLineCap="round" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M{dx - dot:.2f},{dy:.2f}a{dot:.2f},{dot:.2f} 0,1 0,{dot * 2:.2f},0a{dot:.2f},{dot:.2f} 0,1 0,{-dot * 2:.2f},0" />
</vector>
"""


def main() -> None:
    brand = ROOT / "assets" / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    (brand / "icon.svg").write_text(rounded_icon() + "\n")
    (brand / "icon-ios.svg").write_text(full_bleed_icon() + "\n")
    (ROOT / "public" / "favicon.svg").write_text(rounded_icon() + "\n")

    render(rounded_icon(), ROOT / "public" / "icon.png", 1024)
    # Linux desktops only look up the standard hicolor sizes, so ship each one.
    for size in (16, 24, 32, 48, 64, 128, 256, 512):
        render(rounded_icon(), ROOT / "assets" / "linux-icons" / f"{size}x{size}.png", size)
    render(full_bleed_icon(), ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024)

    res = ROOT / "android/app/src/main/res"
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for density, factor in densities.items():
        folder = res / f"mipmap-{density}"
        render(full_bleed_icon(), folder / "ic_launcher.png", round(48 * factor))
        render(round_icon(), folder / "ic_launcher_round.png", round(48 * factor))
        render(foreground_icon(), folder / "ic_launcher_foreground.png", round(108 * factor))

    (res / "drawable-v24" / "ic_launcher_foreground.xml").write_text(android_vector())
    (res / "drawable" / "ic_launcher_background.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="@color/ic_launcher_background" />
</shape>
"""
    )
    (res / "values" / "ic_launcher_background.xml").write_text(
        f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{ACCENT}</color>
</resources>
"""
    )

    splashes = {
        "drawable/splash.png": (480, 320),
        "drawable-land-mdpi/splash.png": (480, 320),
        "drawable-land-hdpi/splash.png": (800, 480),
        "drawable-land-xhdpi/splash.png": (1280, 720),
        "drawable-land-xxhdpi/splash.png": (1600, 960),
        "drawable-land-xxxhdpi/splash.png": (1920, 1280),
        "drawable-port-mdpi/splash.png": (320, 480),
        "drawable-port-hdpi/splash.png": (480, 800),
        "drawable-port-xhdpi/splash.png": (720, 1280),
        "drawable-port-xxhdpi/splash.png": (960, 1600),
        "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    }
    for relative, (width, height) in splashes.items():
        render(splash(width, height), res / relative, width, height)

    ios_splash = ROOT / "ios/App/App/Assets.xcassets/Splash.imageset"
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        render(splash(2732, 2732), ios_splash / name, 2732, 2732)


if __name__ == "__main__":
    main()
