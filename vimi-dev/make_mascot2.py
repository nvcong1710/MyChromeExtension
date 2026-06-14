"""Process the new Vimi art in raw_img/ into mascot assets.

 - Two 4-frame sheets (walk, talk) -> animated transparent WebP.
 - Five single poses (read, point, celebrate, shy, love) -> transparent PNG.

Background removed with rembg; frames of an animation are cropped to a common
bounding box so they stay aligned. All output is 300px tall to match the
existing poses. Run:  python make_mascot2.py
"""
import glob
from PIL import Image, PngImagePlugin
from rembg import remove, new_session

RAW = sorted(glob.glob("raw_img/*.png"))
OUT = "mascot"
H = 300
PAD = 8
session = new_session("u2net")

# sorted order = (1)..(7)
SHEETS = {0: ("vimi-walk.png", 130), 1: ("vimi-talk.png", 200)}
POSES = {2: "vimi-read", 3: "vimi-point", 4: "vimi-celebrate", 5: "vimi-shy", 6: "vimi-love"}


def cut(im):
    return remove(im.convert("RGBA"), session=session)


def resize_h(im):
    w = round(im.width * H / im.height)
    return im.resize((w, H), Image.LANCZOS)


def head_cx(content):
    """Horizontal centroid of the top ~25% of the figure (the head) — a stable
    anchor for aligning walk/talk frames so the body doesn't jump."""
    import numpy as np
    a = np.array(content.split()[3]) > 16
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max()
    head = ys <= top + 0.25 * (bot - top)
    return float(xs[head].mean())


def sheet_to_webp(path, frames, out, dur):
    sheet = Image.open(path).convert("RGBA")
    w, h = sheet.size
    cw = w // frames
    cuts = [cut(sheet.crop((i * cw, 0, (i + 1) * cw, h))) for i in range(frames)]
    # Tightly crop each frame to its own content, then re-align them all on a
    # common canvas by head-centre (X) and feet (bottom Y).
    contents, cxs = [], []
    for c in cuts:
        cc = c.crop(c.split()[3].getbbox())
        contents.append(cc)
        cxs.append(head_cx(cc))
    left = max(cxs)                                   # space needed left of head
    right = max(cc.width - cx for cc, cx in zip(contents, cxs))
    cw2 = int(round(left + right)) + PAD * 2
    ch2 = max(cc.height for cc in contents) + PAD * 2
    anchorX = left + PAD
    frs = []
    for cc, cx in zip(contents, cxs):
        canvas = Image.new("RGBA", (cw2, ch2), (0, 0, 0, 0))
        x = int(round(anchorX - cx))
        y = ch2 - PAD - cc.height                     # feet on the baseline
        canvas.paste(cc, (x, y), cc)
        frs.append(resize_h(canvas))
    # APNG with per-frame dispose=background + blend=source so each frame fully
    # replaces the previous one (no ghosting / stacking of transparent frames).
    frs[0].save(
        f"{OUT}/{out}", save_all=True, append_images=frs[1:],
        duration=dur, loop=0,
        disposal=PngImagePlugin.Disposal.OP_BACKGROUND,
        blend=PngImagePlugin.Blend.OP_SOURCE,
    )
    print(out, frs[0].size, f"{frames} frames")


def pose_to_png(path, name):
    c = cut(Image.open(path))
    bbox = c.split()[3].getbbox()
    l = max(0, bbox[0] - PAD)
    t = max(0, bbox[1] - PAD)
    r = min(c.width, bbox[2] + PAD)
    b = min(c.height, bbox[3] + PAD)
    out = resize_h(c.crop((l, t, r, b)))
    out.save(f"{OUT}/{name}.png")
    print(f"{name}.png", out.size)


def main():
    for i, f in enumerate(RAW):
        if i in SHEETS:
            name, dur = SHEETS[i]
            sheet_to_webp(f, 4, name, dur)
        elif i in POSES:
            pose_to_png(f, POSES[i])


if __name__ == "__main__":
    main()
