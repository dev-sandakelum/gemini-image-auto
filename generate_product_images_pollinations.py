#!/usr/bin/env python3
"""
generate_product_images_pollinations.py

Generates 5 images per product (main, angle, detail, context, packaging)
via Pollinations.ai's keyless endpoint, saves them under
public/products/{id}-{slug}/, and rewrites each product's `images` array
in products.json as soon as that product's 5 slots are complete.

- No API key, no account: plain GET requests.
- Paced at ~1 request / 15 s (anonymous rate limit) -> ~2 h for 500 images.
- Per-slot retry with exponential backoff; one bad slot never blocks a run.
- progress.json updated after EVERY image -> interrupt & resume anytime.
- products.json.backup is created once before the first write.
- --retry-failed reprocesses only previously failed slots.
- --limit 2 --dry-run previews the prompts without touching anything.

Requires: pip install requests
"""

import argparse
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_BASE = "https://image.pollinations.ai/prompt/"
WIDTH, HEIGHT = 512, 512
DELAY = 15.0            # seconds between HTTP requests (--delay overrides)
MAX_ATTEMPTS = 3
BACKOFF_BASE = 20.0     # first retry waits 20 s, then 40 s
HTTP_TIMEOUT = 180      # free-tier generation can be slow
MIN_IMAGE_BYTES = 1000  # reject error pages / empty bodies

PRODUCTS_FILE = Path("products.json")
BACKUP_FILE = Path("products.json.backup")
PROGRESS_FILE = Path("progress.json")
OUT_DIR = Path("public/products")

SLOT_SPECS = [
    {"file": "01-main",      "view": "main",      "label": "main product shot"},
    {"file": "02-angle",     "view": "angle",     "label": "three-quarter angle view"},
    {"file": "03-detail",    "view": "detail",    "label": "close-up detail"},
    {"file": "04-context",   "view": "context",   "label": "product in use"},
    {"file": "05-packaging", "view": "packaging", "label": "retail packaging"},
]

CATEGORY_STYLES = {
    "laptop": "modern laptop computer",          "desktop": "desktop PC tower",
    "gaming pc": "gaming PC with glass panel",   "monitor": "slim-bezel computer monitor",
    "keyboard": "mechanical keyboard",           "mouse": "ergonomic computer mouse",
    "headset": "over-ear headset",               "printer": "office printer",
    "gpu": "graphics card",                      "graphics": "graphics card",
    "cpu": "desktop CPU processor",              "processor": "desktop CPU processor",
    "ssd": "solid-state drive",                  "storage": "external storage drive",
    "router": "wifi router",                     "networking": "networking device",
    "accessories": "computer accessory",         "peripherals": "computer peripheral",
}
DEFAULT_STYLE = "computer product"

QUALITY_TAIL = "high detail, sharp focus, professional commercial product photography"

VIEW_MODIFIERS = {
    "main":      "centered on a plain white studio background, e-commerce catalog style, even lighting, soft shadow",
    "angle":     "dynamic three-quarter angle view on a plain white studio background, e-commerce catalog style",
    "detail":    "extreme close-up macro shot of its most distinctive feature, shallow depth of field",
    "context":   "shown in a realistic everyday setting while being used, natural lighting, lifestyle photo",
    "packaging": "displayed next to its retail box packaging, studio lighting, clean neutral background",
}

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

DELAY_IS_GLOBAL = None  # placeholder to keep DELAY rebindable from main()


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(text):
    s = re.sub(r"[^\w\s-]", "", (text or "").lower()).strip()
    return (re.sub(r"[\s_-]+", "-", s)[:60]) or "product"


def load_json(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            corrupt = path.with_suffix(".json.corrupt")
            try:
                shutil.copy2(path, corrupt)
                log(f"WARNING: {path} unreadable ({exc}); copy saved to {corrupt}")
            except OSError:
                log(f"WARNING: {path} unreadable ({exc})")
    return default


def save_json(path, data):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


_last_request = 0.0


def pace():
    """Maintain the global request interval across all HTTP calls."""
    global _last_request
    wait = DELAY - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


# ---------------------------------------------------------------------------
# Prompt building  (swap in your existing build_prompts() here if you have one
# from the Gemini script -- the required shape is identical: {view: prompt})
# ---------------------------------------------------------------------------

def resolve_style(category):
    c = (category or "").strip().lower()
    if c in CATEGORY_STYLES:
        return CATEGORY_STYLES[c]
    for key, style in CATEGORY_STYLES.items():
        if key in c:  # "gaming laptops" -> laptop style
            return style
    return DEFAULT_STYLE


def build_prompts(product):
    name = (product.get("name") or "generic product").strip()
    style = resolve_style(product.get("category"))
    subject = f"{name} ({style})"
    return {
        spec["view"]: f"Professional product photo of {subject}, "
                      f"{VIEW_MODIFIERS[spec['view']]}, {QUALITY_TAIL}"
        for spec in SLOT_SPECS
    }


# ---------------------------------------------------------------------------
# Image fetching
# ---------------------------------------------------------------------------

def fetch_image(prompt, dest):
    url = f"{API_BASE}{quote(prompt, safe='')}?width={WIDTH}&height={HEIGHT}&nologo=true"
    last_err = "unknown error"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        pace()
        try:
            r = requests.get(
                url,
                timeout=HTTP_TIMEOUT,
                headers={"User-Agent": "vertex-demo/1.0", "Accept": "image/*"},
            )
            ctype = r.headers.get("content-type", "")
            if (r.status_code == 200 and ctype.startswith("image/")
                    and len(r.content) >= MIN_IMAGE_BYTES):
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(r.content)
                return True, "ok"
            last_err = f"HTTP {r.status_code}, type={ctype or 'none'}, {len(r.content)}B"
        except requests.RequestException as exc:
            last_err = f"{type(exc).__name__}: {exc}"
        if attempt < MAX_ATTEMPTS:
            backoff = BACKOFF_BASE * (2 ** (attempt - 1))
            log(f"      attempt {attempt}/{MAX_ATTEMPTS} failed ({last_err}); "
                f"retrying in {backoff:.0f}s")
    return False, last_err


# ---------------------------------------------------------------------------
# products.json update
# ---------------------------------------------------------------------------

def build_images_array(product_dir, product_name):
    # Adjust key names ("src"/"alt") if your frontend expects different ones.
    base = "/" + product_dir.as_posix()
    return [
        {
            "src": f"{base}/{spec['file']}.jpg",
            "alt": f"{product_name} - {spec['label']}",
            "primary": spec["view"] == "main",
        }
        for spec in SLOT_SPECS
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delay", type=float, default=15.0,
                    help="seconds between requests (default 15)")
    ap.add_argument("--retry-failed", action="store_true",
                    help="also reprocess slots previously marked failed")
    ap.add_argument("--limit", type=int, default=None,
                    help="process only the first N products (smoke test)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print prompts/URLs and exit; no files are touched")
    ap.add_argument("--products-file", default="products.json")
    ap.add_argument("--out-dir", default="public/products")
    return ap.parse_args()


def main():
    global DELAY, PRODUCTS_FILE, BACKUP_FILE, PROGRESS_FILE, OUT_DIR
    args = parse_args()
    DELAY = args.delay
    PRODUCTS_FILE = Path(args.products_file)
    BACKUP_FILE = PRODUCTS_FILE.with_suffix(".json.backup")
    PROGRESS_FILE = Path("progress.json")
    OUT_DIR = Path(args.out_dir)

    if not PRODUCTS_FILE.exists():
        print(f"ERROR: {PRODUCTS_FILE} not found — run from the project root.",
              file=sys.stderr)
        return 1
    products = load_json(PRODUCTS_FILE, default=None)
    if not isinstance(products, list) or not products:
        print("ERROR: products.json must be a non-empty JSON array.", file=sys.stderr)
        return 1

    selected = products[: args.limit]  # slice with None = full list

    # ---- dry run: preview only -------------------------------------------
    if args.dry_run:
        for product in selected:
            print(f"\n=== {product.get('name')} ===")
            for spec in SLOT_SPECS:
                prompt = build_prompts(product)[spec["view"]]
                url = f"{API_BASE}{quote(prompt, safe='')}?width={WIDTH}&height={HEIGHT}&nologo=true"
                print(f"  [{spec['file']}]\n    prompt: {prompt}\n    url:    {url}")
        return 0

    # ---- real run: backup + progress --------------------------------------
    if not BACKUP_FILE.exists():
        shutil.copy2(PRODUCTS_FILE, BACKUP_FILE)
        log(f"Created one-time backup: {BACKUP_FILE}")

    progress = load_json(PROGRESS_FILE, default={"products": {}})
    progress.setdefault("products", {})

    done_entries = sum(1 for slots in progress["products"].values()
                       for e in slots.values() if e.get("status") == "done")
    total_slots = len(selected) * 5
    log(f"{len(selected)} products, {total_slots} slots total, "
        f"{done_entries} already done -> ~{max(total_slots - done_entries, 0) * DELAY / 60:.0f} min of pacing minimum")

    stats = {"generated": 0, "skipped": 0, "failed": 0,
             "still_failed": 0, "completed_products": 0}
    started = time.time()

    try:
        for idx, product in enumerate(selected, 1):
            pid = str(product.get("id", idx))
            name = product.get("name") or f"product-{pid}"
            slug = product.get("slug") or slugify(name)
            pdir = OUT_DIR / f"{pid}-{slug}"
            log(f"[{idx}/{len(selected)}] {name} -> {pdir}")

            prompts = build_prompts(product)
            p_slots = progress["products"].setdefault(pid, {})
            results = {}

            for spec in SLOT_SPECS:
                key = spec["file"]
                dest = pdir / f"{key}.jpg"
                entry = p_slots.get(key) or {}

                if entry.get("status") == "done" and dest.exists():
                    results[key] = True
                    stats["skipped"] += 1
                    continue
                if entry.get("status") == "failed" and not args.retry_failed:
                    results[key] = False
                    stats["still_failed"] += 1
                    continue

                log(f"    {key}: generating ({spec['view']})...")
                ok, info = fetch_image(prompts[spec["view"]], dest)
                p_slots[key] = {"status": "done" if ok else "failed",
                                **({"path": dest.as_posix()} if ok
                                   else {"error": info}),
                                "ts": utcnow()}
                save_json(PROGRESS_FILE, progress)
                results[key] = ok
                stats["generated" if ok else "failed"] += 1

            if all((pdir / f"{s['file']}.jpg").exists() for s in SLOT_SPECS):
                product["images"] = build_images_array(pdir, name)
                save_json(PRODUCTS_FILE, products)
                stats["completed_products"] += 1
                log(f"    -> all 5 images present; products.json updated")
            else:
                missing = [s["file"] for s in SLOT_SPECS
                           if not (pdir / f"{s['file']}.jpg").exists()]
                log(f"    -> incomplete, missing: {', '.join(missing)} "
                    f"(products.json untouched for this product)")

    except KeyboardInterrupt:
        save_json(PROGRESS_FILE, progress)
        log("Interrupted — progress saved. Re-run the same command to resume.")
        return 130

    mins = (time.time() - started) / 60
    log(f"Done in {mins:.1f} min — generated {stats['generated']}, "
        f"skipped {stats['skipped']}, newly failed {stats['failed']}, "
        f"still failed {stats['still_failed']}, "
        f"products completed: {stats['completed_products']}/{len(selected)}")
    if stats["failed"] or stats["still_failed"]:
        log("Re-run with --retry-failed to retry the failed slots.")
    return 0


if __name__ == "__main__":
    sys.exit(main())