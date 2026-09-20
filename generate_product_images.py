#!/usr/bin/env python3
"""
generate_product_images.py

Reads products.json (100 fictional PC-parts products) and generates 5
e-commerce style product images per product using the Gemini API
(gemini-2.5-flash-image, aka "Nano Banana"):

    01-front.jpg      - clean studio front/hero shot (primary)
    02-alternate.jpg  - alternate 3/4 angle
    03-detail.jpg     - close-up on a distinguishing feature
    04-context.jpg    - product in a realistic in-use setting
    05-packaging.jpg  - retail box / packaging shot

Images are written to:
    output/{id}-{slug}/01-front.jpg ... 05-packaging.jpg

A progress log (progress.json) is kept so the script can be re-run safely -
already-generated images are skipped.

IMPORTANT: This script edits /mnt/user-data/uploads/products.json's `images`
array IN PLACE for each product as soon as all 5 of its images are generated
(a backup of the original is written once, on first run, to
products.json.bak). A separate image-mapping.json is also written as a
plain record of id -> paths.

USAGE:
    export GEMINI_API_KEY="your-key-here"
    python3 generate_product_images.py                # generate all
    python3 generate_product_images.py --limit 5       # test on first 5 products
    python3 generate_product_images.py --ids 0,1,2     # only specific product ids
    python3 generate_product_images.py --retry-failed  # only retry failed images from last run
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

from google import genai
from google.genai import errors as genai_errors

# ── Config ──────────────────────────────────────────────────────────────

MODEL = "gemini-2.5-flash-image"
_SCRIPT_DIR = Path(__file__).parent
PRODUCTS_JSON = _SCRIPT_DIR / "products.json"
PRODUCTS_JSON_BACKUP = _SCRIPT_DIR / "products.json.bak"
OUTPUT_DIR = _SCRIPT_DIR / "output"
PROGRESS_FILE = _SCRIPT_DIR / "progress.json"
MAPPING_FILE = _SCRIPT_DIR / "image-mapping.json"

# Public path prefix used in the mapping file (matches /public/products/... in the app)
PUBLIC_PATH_PREFIX = "/products"

# Delay between API calls to stay comfortably under free-tier rate limits.
# Free tier for gemini-2.5-flash-image is very restricted; 30s is a safe default.
REQUEST_DELAY_SECONDS = 30.0

# Retry behavior for transient errors (429 rate limit, 500/503 server errors)
MAX_RETRIES = 5
RETRY_BACKOFF_BASE = 30  # seconds; doubles each retry

IMAGE_SLOTS = ["front", "alternate", "detail", "context", "packaging"]

ALT_TEXT_SUFFIX = {
    "front": "front view",
    "alternate": "alternate angle",
    "detail": "close-up detail",
    "context": "in use",
    "packaging": "retail packaging",
}


# ── Prompt building ─────────────────────────────────────────────────────

def top_specs(specs: dict, n: int = 4) -> str:
    """Turn a specs dict into a short comma separated string of key facts."""
    items = list(specs.items())[:n]
    return ", ".join(f"{k}: {v}" for k, v in items)


def build_prompts(product: dict) -> dict:
    """Return {slot_name: prompt_text} for the 3 image slots for a product."""
    name = product["name"]
    category = product.get("categorySlug", "")
    specs_str = top_specs(product.get("specs", {}))

    # product["name"] already includes the brand (e.g. "Nova RTX 9090 16GB
    # Graphics Card"), so use it directly rather than prepending brand again.
    full_name = name.strip()

    # Category-aware base description so different product types render sensibly
    category_hints = {
        "gpus": "a graphics card with visible cooling fans, heatsink fins, and a PCIe connector edge",
        "cpus": "a processor chip, showing the top of the integrated heat spreader with pins or contact pads",
        "motherboards": "a PC motherboard with chipset heatsinks, RAM slots, and expansion slots visible",
        "ram": "a memory module (RAM stick) with a heat spreader, shown standing upright",
        "psus": "a power supply unit, a matte metal box with a cooling fan grille and modular cable ports on one side",
        "storage": "a solid state drive or M.2 NVMe drive, a small rectangular module",
        "cooling": "a PC cooling product such as an AIO liquid cooler radiator and pump, or a large air cooler with heatsink fins",
        "cases": "a PC case (computer tower) with a tempered glass side panel",
        "peripherals": "a computer peripheral such as a keyboard, mouse, headset, or monitor",
    }
    hint = category_hints.get(category, "a computer hardware component")

    # A short phrase per category describing a good close-up focal point and
    # a plausible in-use / context setting, so slots 3 and 4 aren't generic.
    detail_hints = {
        "gpus": "an extreme close-up on the cooling fans and heatsink fins, showing texture and build quality",
        "cpus": "an extreme close-up on the metal integrated heat spreader surface and corner notches",
        "motherboards": "an extreme close-up on the CPU socket area and chipset heatsink",
        "ram": "an extreme close-up on the heat spreader texture and top edge of the module",
        "psus": "an extreme close-up on the modular cable ports and fan grille",
        "storage": "an extreme close-up on the connector edge and label area of the drive",
        "cooling": "an extreme close-up on the fan blades or pump top and tubing",
        "cases": "an extreme close-up on the tempered glass panel edge and front I/O ports",
        "peripherals": "an extreme close-up on key texture, switches, or the scroll wheel/buttons depending on the device",
    }
    context_hints = {
        "gpus": "installed inside an open PC case with RGB lighting visible, other components softly out of focus",
        "cpus": "resting on a motherboard socket, about to be installed, with a light bokeh PC-building scene in the background",
        "motherboards": "laid inside an open PC case mid-build, cables and other components softly out of focus",
        "ram": "installed in a motherboard's RAM slots inside an open PC case",
        "psus": "installed at the bottom of an open PC case with cables routed neatly",
        "storage": "installed on a motherboard M.2 slot or mounted in a case drive bay",
        "cooling": "installed on top of a CPU inside an open PC case, other components softly out of focus",
        "cases": "sitting on a desk in a modern gaming/office setup, powered on with subtle interior lighting glow",
        "peripherals": "in use on a clean modern desk setup, alongside a keyboard/mouse/monitor as appropriate",
    }
    detail_hint = detail_hints.get(category, "an extreme close-up on a distinctive part of the product")
    context_hint = context_hints.get(category, "in a realistic use setting on a desk or inside a PC")

    base_subject = (
        f"a {full_name}, {hint}. Key specs for visual accuracy: {specs_str}. "
        f"The product is a fictional/generic brand design — do not reproduce any real "
        f"manufacturer logos (no NVIDIA, AMD, Intel, Corsair, ASUS, etc. branding); "
        f"use a plain, neutral, invented brand look instead."
    )

    prompts = {
        "front": (
            f"A high-resolution, studio-lit e-commerce product photograph of {base_subject} "
            f"Centered composition, plain white/light-grey seamless background, soft three-point "
            f"softbox lighting, no harsh shadows, straight-on front angle. Ultra-realistic, sharp "
            f"focus, professional product photography style. Square image, no text or watermarks."
        ),
        "alternate": (
            f"A high-resolution, studio-lit e-commerce product photograph of {base_subject} "
            f"Centered composition, plain white/light-grey seamless background, soft studio lighting, "
            f"shown from a 3/4 rotated angle to reveal a different side and depth of the product. "
            f"Ultra-realistic, sharp focus, professional product photography style. Square image, "
            f"no text or watermarks."
        ),
        "detail": (
            f"A high-resolution, studio-lit macro product photograph of {base_subject} "
            f"The shot is {detail_hint}. Plain white/light-grey seamless background, soft studio "
            f"lighting, shallow depth of field to emphasize texture and material quality. "
            f"Ultra-realistic, sharp focus. Square image, no text or watermarks."
        ),
        "context": (
            f"A high-resolution, realistic photograph of {base_subject} "
            f"shown {context_hint}. Natural but clean lighting, shallow depth of field with the "
            f"product in sharp focus and the surroundings softly blurred. Ultra-realistic, "
            f"professional product-in-context photography style. Square image, no text or watermarks."
        ),
        "packaging": (
            f"A high-resolution, studio-lit product photograph of the retail packaging box for "
            f"{base_subject} The box design is clean and modern, showing a generic product "
            f"illustration or window, with the product name '{full_name}' printed on the front in a "
            f"clean sans-serif font. Plain white/light-grey seamless background, soft studio lighting, "
            f"slight 3/4 angle to show box depth. Ultra-realistic, sharp focus. Square image, "
            f"no watermarks."
        ),
    }
    return prompts


# ── Progress tracking ────────────────────────────────────────────────────

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"completed": {}, "failed": {}}


def save_progress(progress: dict):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def image_key(product_id, slot):
    return f"{product_id}:{slot}"


# ── Image generation ─────────────────────────────────────────────────────

def generate_one_image(client: genai.Client, prompt: str) -> bytes:
    """Call Gemini and return raw image bytes, or raise on failure."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[prompt],
            )
            for part in response.candidates[0].content.parts:
                if getattr(part, "inline_data", None) is not None:
                    return part.inline_data.data
            raise RuntimeError("No image data in response (model likely returned text only)")

        except genai_errors.ClientError as e:
            # 429 = rate limited, worth retrying with backoff
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                wait = RETRY_BACKOFF_BASE * (2 ** (attempt - 1))
                print(f"    rate limited, waiting {wait}s (attempt {attempt}/{MAX_RETRIES})...")
                time.sleep(wait)
                continue
            raise
        except genai_errors.ServerError as e:
            wait = RETRY_BACKOFF_BASE * (2 ** (attempt - 1))
            print(f"    server error, waiting {wait}s (attempt {attempt}/{MAX_RETRIES})...")
            time.sleep(wait)
            continue

    raise RuntimeError(f"Failed after {MAX_RETRIES} retries")


def process_product(client: genai.Client, product: dict, progress: dict) -> dict:
    """Generate all 5 images for one product. Returns dict of slot -> local path (relative)."""
    pid = product["id"]
    slug = product["slug"]
    folder_name = f"{pid}-{slug}"
    out_dir = OUTPUT_DIR / folder_name
    out_dir.mkdir(parents=True, exist_ok=True)

    prompts = build_prompts(product)
    result_paths = {}

    for i, slot in enumerate(IMAGE_SLOTS, start=1):
        filename = f"0{i}-{slot}.jpg"
        filepath = out_dir / filename
        key = image_key(pid, slot)

        # Skip already-completed images (safe re-run / resume)
        if key in progress["completed"] and filepath.exists():
            print(f"  [{slot}] already done, skipping")
            result_paths[slot] = f"{PUBLIC_PATH_PREFIX}/{folder_name}/{filename}"
            continue

        print(f"  [{slot}] generating...")
        try:
            image_bytes = generate_one_image(client, prompts[slot])
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            progress["completed"][key] = f"{PUBLIC_PATH_PREFIX}/{folder_name}/{filename}"
            progress["failed"].pop(key, None)
            result_paths[slot] = progress["completed"][key]
            print(f"  [{slot}] saved -> {filepath}")
        except Exception as e:
            print(f"  [{slot}] FAILED: {e}")
            progress["failed"][key] = str(e)
        finally:
            save_progress(progress)  # save after every single image, not just per-product
            time.sleep(REQUEST_DELAY_SECONDS)

    return result_paths


def build_images_array(product: dict, result_paths: dict) -> list:
    """Build a ProductImage[]-shaped list from generated paths, matching data.ts's schema."""
    images = []
    for i, slot in enumerate(IMAGE_SLOTS, start=1):
        if slot not in result_paths:
            continue  # this slot failed to generate; leave it out rather than write a broken entry
        images.append({
            "id": i,
            "url": result_paths[slot],
            "alt": f"{product['name']} — {ALT_TEXT_SUFFIX[slot]}",
            "primary": slot == "front",
        })
    return images


def update_products_json(all_products: list):
    """Write the full products list back to products.json, backing up the original once."""
    if not PRODUCTS_JSON_BACKUP.exists():
        import shutil
        shutil.copy(PRODUCTS_JSON, PRODUCTS_JSON_BACKUP)
        print(f"(backed up original to {PRODUCTS_JSON_BACKUP})")

    with open(PRODUCTS_JSON, "w") as f:
        json.dump(all_products, f, indent=2, ensure_ascii=False)


# ── Main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate product images with Gemini")
    parser.add_argument("--limit", type=int, default=None, help="Only process first N products")
    parser.add_argument("--ids", type=str, default=None, help="Comma-separated product ids to process")
    parser.add_argument("--retry-failed", action="store_true", help="Only retry images that failed last run")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: Set the GEMINI_API_KEY environment variable first.")
        print('  export GEMINI_API_KEY="your-key-here"')
        sys.exit(1)

    if not PRODUCTS_JSON.exists():
        print(f"ERROR: {PRODUCTS_JSON} not found.")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=api_key)
    progress = load_progress()

    with open(PRODUCTS_JSON) as f:
        all_products = json.load(f)  # full list; we mutate and write this back
    products_by_id = {p["id"]: p for p in all_products}

    if args.ids:
        wanted_ids = {int(x) for x in args.ids.split(",")}
        target_products = [p for p in all_products if p["id"] in wanted_ids]
    elif args.limit:
        target_products = all_products[: args.limit]
    else:
        target_products = list(all_products)

    if args.retry_failed:
        failed_ids = {int(k.split(":")[0]) for k in progress["failed"].keys()}
        target_products = [p for p in all_products if p["id"] in failed_ids]
        print(f"Retrying {len(target_products)} product(s) with failed images...\n")

    print(f"Processing {len(target_products)} product(s), {len(target_products) * len(IMAGE_SLOTS)} image(s) total\n")

    mapping = {}
    if MAPPING_FILE.exists():
        with open(MAPPING_FILE) as f:
            mapping = json.load(f)

    for idx, product in enumerate(target_products, start=1):
        print(f"[{idx}/{len(target_products)}] {product['name']} (id={product['id']})")
        paths = process_product(client, product, progress)

        mapping[str(product["id"])] = {
            "slug": product["slug"],
            "name": product["name"],
            "images": paths,
        }
        with open(MAPPING_FILE, "w") as f:
            json.dump(mapping, f, indent=2)

        # Only rewrite this product's images[] if ALL 5 slots succeeded, so we
        # never leave a product with a partial/broken images array.
        if len(paths) == len(IMAGE_SLOTS):
            products_by_id[product["id"]]["images"] = build_images_array(product, paths)
            update_products_json(all_products)
            print("  -> products.json updated")
        else:
            missing = [s for s in IMAGE_SLOTS if s not in paths]
            print(f"  -> products.json NOT updated for this product (missing: {missing})")
        print()

    # Summary
    total_done = len(progress["completed"])
    total_failed = len(progress["failed"])
    print("=" * 50)
    print(f"Done. {total_done} image(s) succeeded, {total_failed} failed.")
    if total_failed:
        print("Failed items logged in progress.json under 'failed'.")
        print("Re-run with --retry-failed to retry just those.")
    print(f"Mapping written to {MAPPING_FILE}")


if __name__ == "__main__":
    main()
