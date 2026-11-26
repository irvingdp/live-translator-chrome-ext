# Subsets jf open huninn to the characters the site uses and renames it
# (OFL: a modified font must not carry the Reserved Font Names "open huninn"
# or "huninn"). Run again whenever site copy adds new characters:
#   pip install fonttools brotli
#   python site/scripts/subset-font.py jf-openhuninn-2.1.ttf site/public/fonts/blc-rounded.woff2 site/src
# Source: https://github.com/justfont/open-huninn-font (v2.1).
import pathlib, sys
from fontTools import subset
from fontTools.ttLib import TTFont
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); roots = sys.argv[3:]
text = set(chr(c) for c in range(0x20, 0x7f))
text |= set("，。、！？：；「」『』（）—…·’‘“”–")
for r in roots:
    for f in pathlib.Path(r).rglob('*'):
        if f.suffix in {'.ts', '.astro', '.md'}:
            text |= set(f.read_text(encoding='utf-8'))
text = ''.join(sorted(c for c in text if c.isprintable()))
opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.name_IDs = ['*']
font = subset.load_font(str(src), opts)
s = subset.Subsetter(opts); s.populate(text=text); s.subset(font)
# OFL Reserved Font Names: a modified (subset) font must not carry them.
for rec in font['name'].names:
    if rec.nameID in (1, 3, 4, 6, 16, 17):
        name = {1: 'BLC Rounded', 3: 'BLC Rounded Subset', 4: 'BLC Rounded', 6: 'BLCRounded', 16: 'BLC Rounded', 17: 'Regular'}[rec.nameID]
        rec.string = name
font.save(str(out))
print(len(text), 'chars ->', out.stat().st_size, 'bytes')
