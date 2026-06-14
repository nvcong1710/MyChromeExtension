"""Split the Vimi sprite sheet into 5 poses, remove the background (AI), and
auto-crop each to its content. Outputs transparent PNGs into mascot/.

Run:  python make_mascot.py
"""
import os
from PIL import Image
from rembg import remove, new_session

SHEET = "../ChatGPT Image Jun 14, 2026, 12_25_14 AM.png"
OUT = "mascot"
NAMES = ["vimi-idle", "vimi-happy", "vimi-think", "vimi-sleep", "vimi-wave"]
PAD = 8  # transparent padding around the cropped subject


def autocrop(im, pad=PAD):
    """Crop to the bounding box of non-transparent pixels, with padding."""
    alpha = im.split()[3]
    bbox = alpha.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def main():
    os.makedirs(OUT, exist_ok=True)
    sheet = Image.open(SHEET).convert("RGBA")
    w, h = sheet.size
    cell = w // 5
    session = new_session("u2net")

    contact = Image.new("RGBA", (cell * 5, h), (0, 0, 0, 0))
    for i, name in enumerate(NAMES):
        frame = sheet.crop((i * cell, 0, (i + 1) * cell, h))
        cut = remove(frame, session=session)  # RGBA with bg removed
        cropped = autocrop(cut)
        cropped.save(os.path.join(OUT, name + ".png"))
        print(f"{name}.png  {cropped.size}")
        contact.paste(cut, (i * cell, 0), cut)

    contact.save(os.path.join(OUT, "_contact.png"))
    print("contact sheet -> mascot/_contact.png")


if __name__ == "__main__":
    main()
