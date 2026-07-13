"""
Mimu Alien Script — TTF builder
Traces all 26 letters + 10 digits from the reference image into
cubic bezier outlines and packages them as a proper .ttf font.

Run:  python3 build-font.py
Output: assets/fonts/MimuAlienScript-Regular.ttf
"""

from fontTools.fontBuilder import FontBuilder
import math, os

# ─── coordinate helpers ───────────────────────────────────────────────────────

UPM   = 1000
CAP   = 700   # cap-height
DESC  = -150  # descender
ASC   = 750   # ascender


def circle_points(cx, cy, r, n=8):
    """Return 4-on-curve cubic approx of a circle (two contours worth via draw calls)."""
    k = 0.5522847498  # cubic bezier circle constant
    rk = r * k
    return [
        ("moveTo", ((cx, cy + r),)),
        ("curveTo", ((cx + rk, cy + r), (cx + r, cy + rk), (cx + r, cy))),
        ("curveTo", ((cx + r, cy - rk), (cx + rk, cy - r), (cx, cy - r))),
        ("curveTo", ((cx - rk, cy - r), (cx - r, cy - rk), (cx - r, cy))),
        ("curveTo", ((cx - r, cy + rk), (cx - rk, cy + r), (cx, cy + r))),
        ("endPath", ()),
    ]


def dot(cx, cy, r=28):
    return circle_points(cx, cy, r)


def stroke_rect(x, y, w, h, t=50):
    """Filled rectangle (for thick strokes drawn as outlines)."""
    return [
        ("moveTo", ((x, y),)),
        ("lineTo", ((x + w, y),)),
        ("lineTo", ((x + w, y + h),)),
        ("lineTo", ((x, y + h),)),
        ("endPath", ()),
    ]


def draw(pen, ops):
    for op, args in ops:
        if op == "moveTo":   pen.moveTo(*args)
        elif op == "lineTo": pen.lineTo(*args)
        elif op == "curveTo":pen.curveTo(*args)
        elif op == "qCurveTo": pen.qCurveTo(*args)
        elif op == "endPath":  pen.endPath()
        elif op == "closePath":pen.closePath()


# ─── glyph draw functions ─────────────────────────────────────────────────────
# Each function draws into `pen`.  Glyph box is nominally 600 wide.

def glyph_A(pen):
    # circle, two side marks, two dots below
    for op,args in circle_points(300,440,120): getattr(pen, op)(*args)
    for op,args in stroke_rect(80,380,50,120,50): getattr(pen, op)(*args)
    for op,args in stroke_rect(470,380,50,120,50): getattr(pen, op)(*args)
    for op,args in dot(230,180): getattr(pen, op)(*args)
    for op,args in dot(370,180): getattr(pen, op)(*args)

def glyph_B(pen):
    # stylised Z / zigzag with two horizontal bars beneath
    ops = [
        ("moveTo",((100,680),)),
        ("lineTo",((500,680),)),
        ("lineTo",((100,380),)),
        ("lineTo",((500,380),)),
        ("endPath",()),
    ]
    for op,args in ops: getattr(pen, op)(*args)
    for op,args in stroke_rect(100,680,400,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,325,400,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,380,400,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,220,400,55): getattr(pen, op)(*args)

def glyph_C(pen):
    # open S-curve with dot
    k=0.552
    cx,cy,r = 300,440,160
    pen.moveTo((cx, cy+r))
    pen.curveTo((cx+r*k, cy+r),(cx+r,cy+r*k),(cx+r,cy))
    pen.curveTo((cx+r,cy-r*k),(cx,cy-r),(cx-r*0.5,cy-r*0.5))
    pen.curveTo((cx-r,cy-r*0.3),(cx-r,cy+r*0.3),(cx-r*0.5,cy+r*0.5))
    pen.endPath()
    for op,args in dot(300,160): getattr(pen, op)(*args)

def glyph_D(pen):
    # tall rectangular bracket with vertical line and dots
    for op,args in stroke_rect(100,200,60,480): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,640,260,60): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,200,260,60): getattr(pen, op)(*args)
    for op,args in dot(420,520): getattr(pen, op)(*args)
    for op,args in dot(420,360): getattr(pen, op)(*args)

def glyph_E(pen):
    # horizontal bar with two notches top + dots underneath (like ÷ with extra bar)
    for op,args in stroke_rect(80,460,440,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(80,580,440,55): getattr(pen, op)(*args)
    for op,args in dot(190,650,28): getattr(pen, op)(*args)
    for op,args in dot(410,650,28): getattr(pen, op)(*args)
    for op,args in stroke_rect(80,340,440,55): getattr(pen, op)(*args)
    for op,args in dot(190,280,28): getattr(pen, op)(*args)
    for op,args in dot(410,280,28): getattr(pen, op)(*args)

def glyph_F(pen):
    # curved shape pointing right with dot — like a stylized arrow
    pen.moveTo((150,680))
    pen.curveTo((150,680),(500,620),(500,440))
    pen.curveTo((500,260),(300,180),(150,200))
    pen.endPath()
    for op,args in dot(300,620): getattr(pen, op)(*args)

def glyph_G(pen):
    # circle with an open spiral/hook on lower left
    for op,args in circle_points(300,480,150): getattr(pen, op)(*args)
    pen.moveTo((230,350))
    pen.curveTo((100,280),(80,100),(250,80))
    pen.curveTo((380,60),(420,180),(320,220))
    pen.endPath()

def glyph_H(pen):
    # circle on a stick with two dots flanking the stick
    for op,args in circle_points(300,560,110): getattr(pen, op)(*args)
    for op,args in stroke_rect(270,200,60,290): getattr(pen, op)(*args)
    for op,args in dot(160,300): getattr(pen, op)(*args)
    for op,args in dot(440,300): getattr(pen, op)(*args)

def glyph_I(pen):
    # horizontal bar with dot above and dot below (÷ style)
    for op,args in stroke_rect(80,460,440,55): getattr(pen, op)(*args)
    for op,args in dot(300,600): getattr(pen, op)(*args)
    for op,args in dot(300,320): getattr(pen, op)(*args)

def glyph_J(pen):
    # S-curve with a dot below
    pen.moveTo((300,700))
    pen.curveTo((440,700),(480,580),(380,480))
    pen.curveTo((280,380),(180,300),(300,180))
    pen.curveTo((380,100),(460,140),(460,200))
    pen.endPath()
    for op,args in dot(300,80): getattr(pen, op)(*args)

def glyph_K(pen):
    # vertical bar with two angled lines left + dots
    for op,args in stroke_rect(100,200,55,480): getattr(pen, op)(*args)
    pen.moveTo((155,460))
    pen.lineTo((420,680))
    pen.endPath()
    pen.moveTo((155,420))
    pen.lineTo((420,200))
    pen.endPath()
    for op,args in dot(460,560): getattr(pen, op)(*args)
    for op,args in dot(460,320): getattr(pen, op)(*args)

def glyph_L(pen):
    # vertical line with right-bracket and dot
    for op,args in stroke_rect(130,200,55,480): getattr(pen, op)(*args)
    for op,args in stroke_rect(130,200,200,55): getattr(pen, op)(*args)
    pen.moveTo((185,440))
    pen.lineTo((380,540))
    pen.endPath()
    for op,args in dot(420,420): getattr(pen, op)(*args)

def glyph_M(pen):
    # square outline with 4 dots inside (2×2 grid)
    for op,args in stroke_rect(100,220,400,480): getattr(pen, op)(*args)
    # inner hollow
    for op,args in stroke_rect(150,270,300,380): getattr(pen, op)(*args)
    for op,args in dot(210,560): getattr(pen, op)(*args)
    for op,args in dot(390,560): getattr(pen, op)(*args)
    for op,args in dot(210,380): getattr(pen, op)(*args)
    for op,args in dot(390,380): getattr(pen, op)(*args)

def glyph_N(pen):
    # open bracket curving left with dots
    pen.moveTo((380,680))
    pen.curveTo((180,640),(100,520),(130,440))
    pen.curveTo((160,360),(300,340),(300,260))
    pen.endPath()
    for op,args in dot(380,460): getattr(pen, op)(*args)
    for op,args in dot(420,280): getattr(pen, op)(*args)

def glyph_O(pen):
    # large circle with small inner circle and dot
    for op,args in circle_points(300,440,180): getattr(pen, op)(*args)
    for op,args in circle_points(300,440,60): getattr(pen, op)(*args)

def glyph_P(pen):
    # upward arrow / cross with dots
    for op,args in stroke_rect(270,200,60,480): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,420,400,60): getattr(pen, op)(*args)
    # arrowhead up
    pen.moveTo((300,720))
    pen.lineTo((200,560))
    pen.lineTo((400,560))
    pen.endPath()
    for op,args in dot(200,280): getattr(pen, op)(*args)
    for op,args in dot(400,280): getattr(pen, op)(*args)

def glyph_Q(pen):
    # reversed C / open circle with dot inside
    k=0.552
    cx,cy,r=300,440,160
    pen.moveTo((cx,cy+r))
    pen.curveTo((cx-r*k,cy+r),(cx-r,cy+r*k),(cx-r,cy))
    pen.curveTo((cx-r,cy-r*k),(cx-r*k,cy-r),(cx,cy-r))
    pen.curveTo((cx+r*0.5,cy-r),(cx+r,cy-r*0.5),(cx+r*0.8,cy))
    pen.endPath()
    for op,args in dot(300,440): getattr(pen, op)(*args)

def glyph_R(pen):
    # K-like bracket shape with dots
    for op,args in stroke_rect(100,200,55,480): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,640,200,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,200,200,55): getattr(pen, op)(*args)
    pen.moveTo((300,440))
    pen.lineTo((480,680))
    pen.endPath()
    pen.moveTo((300,440))
    pen.lineTo((480,200))
    pen.endPath()
    for op,args in dot(370,440): getattr(pen, op)(*args)

def glyph_S(pen):
    # wavy/squiggly path with two dots
    pen.moveTo((200,680))
    pen.curveTo((400,680),(460,560),(300,480))
    pen.curveTo((140,400),(200,280),(380,200))
    pen.endPath()
    for op,args in dot(200,560): getattr(pen, op)(*args)
    for op,args in dot(400,320): getattr(pen, op)(*args)

def glyph_T(pen):
    # inverted triangle / arrow pointing down with dot
    pen.moveTo((300,200))
    pen.lineTo((160,520))
    pen.lineTo((440,520))
    pen.endPath()
    for op,args in stroke_rect(270,520,60,160): getattr(pen, op)(*args)
    for op,args in dot(300,160): getattr(pen, op)(*args)

def glyph_U(pen):
    # U shape with small circles at tips
    pen.moveTo((130,680))
    pen.curveTo((130,680),(130,360),(300,280))
    pen.curveTo((470,200),(470,360),(470,680))
    pen.endPath()
    for op,args in circle_points(130,680,35): getattr(pen, op)(*args)
    for op,args in circle_points(470,680,35): getattr(pen, op)(*args)

def glyph_V(pen):
    # Y/V shape with dots at the ends
    pen.moveTo((300,200))
    pen.lineTo((130,680))
    pen.endPath()
    pen.moveTo((300,200))
    pen.lineTo((470,680))
    pen.endPath()
    for op,args in dot(130,680): getattr(pen, op)(*args)
    for op,args in dot(470,680): getattr(pen, op)(*args)
    for op,args in dot(300,200): getattr(pen, op)(*args)

def glyph_W(pen):
    # cross/plus with dots at all ends
    for op,args in stroke_rect(270,200,60,480): getattr(pen, op)(*args)
    for op,args in stroke_rect(80,420,440,60): getattr(pen, op)(*args)
    for op,args in dot(300,720): getattr(pen, op)(*args)
    for op,args in dot(300,160): getattr(pen, op)(*args)
    for op,args in dot(55,450): getattr(pen, op)(*args)
    for op,args in dot(545,450): getattr(pen, op)(*args)

def glyph_X(pen):
    # diagonal cross with tick marks
    pen.moveTo((130,680))
    pen.lineTo((470,200))
    pen.endPath()
    pen.moveTo((470,680))
    pen.lineTo((130,200))
    pen.endPath()
    for op,args in stroke_rect(80,620,120,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(400,620,120,55): getattr(pen, op)(*args)

def glyph_Y(pen):
    # Y-shape with dots at tips
    pen.moveTo((130,680))
    pen.lineTo((300,440))
    pen.endPath()
    pen.moveTo((470,680))
    pen.lineTo((300,440))
    pen.endPath()
    for op,args in stroke_rect(270,200,60,240): getattr(pen, op)(*args)
    for op,args in dot(130,680): getattr(pen, op)(*args)
    for op,args in dot(470,680): getattr(pen, op)(*args)

def glyph_Z(pen):
    # Z shape with two horizontal bars
    for op,args in stroke_rect(100,640,400,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,200,400,55): getattr(pen, op)(*args)
    pen.moveTo((500,640))
    pen.lineTo((100,255))
    pen.endPath()
    for op,args in stroke_rect(100,560,400,40): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,285,400,40): getattr(pen, op)(*args)

# ── Numbers ──────────────────────────────────────────────────────────────────

def glyph_zero(pen):
    # concentric circles: outer + inner ring + center dot + bottom dot
    for op,args in circle_points(300,440,190): getattr(pen, op)(*args)
    for op,args in circle_points(300,440,110): getattr(pen, op)(*args)
    for op,args in dot(300,440,30): getattr(pen, op)(*args)
    for op,args in dot(300,180,28): getattr(pen, op)(*args)

def glyph_one(pen):
    # single vertical bar with two dots
    for op,args in stroke_rect(270,200,60,480): getattr(pen, op)(*args)
    for op,args in dot(200,560): getattr(pen, op)(*args)
    for op,args in dot(400,560): getattr(pen, op)(*args)

def glyph_two(pen):
    # curved 2 with dots
    pen.moveTo((160,620))
    pen.curveTo((160,780),(440,780),(440,600))
    pen.curveTo((440,440),(160,360),(160,200))
    pen.lineTo((460,200))
    pen.endPath()
    for op,args in dot(200,420): getattr(pen, op)(*args)
    for op,args in dot(400,420): getattr(pen, op)(*args)

def glyph_three(pen):
    # Z-like zigzag with extra bar underneath
    for op,args in stroke_rect(100,620,400,55): getattr(pen, op)(*args)
    pen.moveTo((500,620))
    pen.lineTo((100,380))
    pen.endPath()
    for op,args in stroke_rect(100,325,400,55): getattr(pen, op)(*args)
    for op,args in stroke_rect(100,200,400,55): getattr(pen, op)(*args)

def glyph_four(pen):
    # plus / cross shape (decorated)
    for op,args in stroke_rect(270,200,60,480): getattr(pen, op)(*args)
    for op,args in stroke_rect(80,400,440,60): getattr(pen, op)(*args)
    # cap ends with small bars
    for op,args in stroke_rect(200,660,200,40): getattr(pen, op)(*args)
    for op,args in stroke_rect(200,200,200,40): getattr(pen, op)(*args)
    for op,args in stroke_rect(80,380,40,120): getattr(pen, op)(*args)
    for op,args in stroke_rect(480,380,40,120): getattr(pen, op)(*args)

def glyph_five(pen):
    # stylised 5 / hook
    pen.moveTo((440,680))
    pen.lineTo((160,680))
    pen.lineTo((160,460))
    pen.curveTo((160,460),(420,440),(420,320))
    pen.curveTo((420,180),(260,160),(160,240))
    pen.endPath()

def glyph_six(pen):
    # spiral / swirl
    pen.moveTo((460,600))
    pen.curveTo((460,780),(140,780),(140,520))
    pen.curveTo((140,260),(360,200),(420,360))
    pen.curveTo((460,480),(360,560),(280,500))
    pen.curveTo((220,460),(240,380),(300,380))
    pen.endPath()

def glyph_seven(pen):
    # Z-like with dot
    for op,args in stroke_rect(100,620,400,55): getattr(pen, op)(*args)
    pen.moveTo((500,620))
    pen.lineTo((160,200))
    pen.endPath()
    for op,args in dot(400,320): getattr(pen, op)(*args)

def glyph_eight(pen):
    # two stacked circles (figure-8 style)
    for op,args in circle_points(300,560,120): getattr(pen, op)(*args)
    for op,args in circle_points(300,300,110): getattr(pen, op)(*args)

def glyph_nine(pen):
    # circle with descending tail
    for op,args in circle_points(300,520,160): getattr(pen, op)(*args)
    pen.moveTo((460,520))
    pen.curveTo((480,280),(420,160),(280,180))
    pen.endPath()

# ─── glyph table ─────────────────────────────────────────────────────────────

GLYPHS = {
    'A': glyph_A, 'B': glyph_B, 'C': glyph_C, 'D': glyph_D,
    'E': glyph_E, 'F': glyph_F, 'G': glyph_G, 'H': glyph_H,
    'I': glyph_I, 'J': glyph_J, 'K': glyph_K, 'L': glyph_L,
    'M': glyph_M, 'N': glyph_N, 'O': glyph_O, 'P': glyph_P,
    'Q': glyph_Q, 'R': glyph_R, 'S': glyph_S, 'T': glyph_T,
    'U': glyph_U, 'V': glyph_V, 'W': glyph_W, 'X': glyph_X,
    'Y': glyph_Y, 'Z': glyph_Z,
    '0': glyph_zero, '1': glyph_one, '2': glyph_two, '3': glyph_three,
    '4': glyph_four, '5': glyph_five, '6': glyph_six, '7': glyph_seven,
    '8': glyph_eight, '9': glyph_nine,
}

LOWERCASE_SAME = True  # lowercase maps to uppercase

# ─── build font ──────────────────────────────────────────────────────────────

def _common_setup(fb, glyph_names, char_to_name, metrics):
    """Apply shared tables to a FontBuilder instance."""
    fb.setupGlyphOrder(glyph_names)
    fb.setupCharacterMap(char_to_name)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASC, descent=DESC)
    fb.setupNameTable({
        "familyName": "Mimu Alien Script",
        "styleName": "Regular",
        "uniqueFontIdentifier": "MimuAlienScript-Regular",
        "fullName": "Mimu Alien Script Regular",
        "version": "Version 1.000",
        "psName": "MimuAlienScript-Regular",
    })
    fb.setupOS2(sTypoAscender=ASC, sTypoDescender=DESC, sTypoLineGap=100,
                usWinAscent=ASC, usWinDescent=abs(DESC),
                fsType=0, sxHeight=500, sCapHeight=CAP,
                ulUnicodeRange1=0b1, achVendID="MIMU")
    fb.setupPost()
    fb.setupHead(unitsPerEm=UPM)


def _name_table(glyph_names, char_to_name):
    """Build glyph order, cmap, and metrics shared by both formats."""
    glyph_names_out = []
    char_to_name_out = {}
    glyph_names_out.append(".notdef")
    glyph_names_out.append("space")
    char_to_name_out[0x0020] = "space"
    for ch in GLYPHS:
        name = f"uni{ord(ch):04X}"
        glyph_names_out.append(name)
        char_to_name_out[ord(ch)] = name
        if ch.isupper():
            lname = f"uni{ord(ch.lower()):04X}"
            glyph_names_out.append(lname)
            char_to_name_out[ord(ch.lower())] = lname
    metrics = {".notdef": (600, 0), "space": (300, 0)}
    for ch in GLYPHS:
        metrics[f"uni{ord(ch):04X}"] = (620, 10)
        if ch.isupper():
            metrics[f"uni{ord(ch.lower()):04X}"] = (620, 10)
    return glyph_names_out, char_to_name_out, metrics


def build():
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib.tables._g_l_y_f import Glyph as TtGlyph

    glyph_names, char_to_name, metrics = _name_table([], {})

    fb = FontBuilder(UPM, isTTF=True)
    _common_setup(fb, glyph_names, char_to_name, metrics)

    def make_empty():
        g = TtGlyph()
        g.numberOfContours = 0
        g.coordinates = []
        g.flags = []
        g.components = []
        return g

    glyphset: dict = {".notdef": make_empty(), "space": make_empty()}
    for ch, fn in GLYPHS.items():
        pen = TTGlyphPen(None)
        fn(pen)
        g = pen.glyph()
        glyphset[f"uni{ord(ch):04X}"] = g
        if ch.isupper():
            glyphset[f"uni{ord(ch.lower()):04X}"] = g

    fb.setupGlyf(glyphset, validateGlyphFormat=False)

    out_dir = os.path.join(os.path.dirname(__file__), "assets", "fonts")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "MimuAlienScript-Regular.ttf")
    fb.font.save(out_path)
    print(f"Saved → {out_path}")
    return out_path


def build_otf():
    """Build an OTF (CFF) version using the same cubic bezier outlines."""
    from fontTools.pens.t2CharStringPen import T2CharStringPen

    glyph_names, char_to_name, metrics = _name_table([], {})

    fb = FontBuilder(UPM, isTTF=False)
    _common_setup(fb, glyph_names, char_to_name, metrics)

    # Build CFF charstrings dict
    charstrings: dict = {}

    def record_cs(name, draw_fn):
        pen = T2CharStringPen(width=620, glyphSet=None)
        draw_fn(pen)
        charstrings[name] = pen.getCharString()

    # .notdef and space — empty charstrings
    pen = T2CharStringPen(width=600, glyphSet=None)
    pen.endPath()
    charstrings[".notdef"] = pen.getCharString()

    pen = T2CharStringPen(width=300, glyphSet=None)
    pen.endPath()
    charstrings["space"] = pen.getCharString()

    for ch, fn in GLYPHS.items():
        name = f"uni{ord(ch):04X}"
        record_cs(name, fn)
        if ch.isupper():
            lname = f"uni{ord(ch.lower()):04X}"
            record_cs(lname, fn)

    fb.setupCFF(
        psName="MimuAlienScript-Regular",
        fontInfo={"FullName": "Mimu Alien Script Regular", "Weight": "Regular"},
        charStringsDict=charstrings,
        privateDict={},
    )

    out_dir = os.path.join(os.path.dirname(__file__), "assets", "fonts")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "MimuAlienScript-Regular.otf")
    fb.font.save(out_path)
    print(f"Saved → {out_path}")
    return out_path


if __name__ == "__main__":
    build()
    build_otf()
