#!/usr/bin/env python3
"""Build the single-file Claude artifact version from the same sources as the GitHub Pages site.

Usage: python3 build_artifact.py [output.html]
"""
import pathlib, re, sys

root = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "dist" / "solartouch-artifact.html"

index = (root / "index.html").read_text(encoding="utf-8")
shell = re.search(r"<!--SHELL-->(.*?)<!--/SHELL-->", index, re.S).group(1)
css = (root / "styles.css").read_text(encoding="utf-8")
app = (root / "app.js").read_text(encoding="utf-8")
logo_js = (root / "logo-data.js").read_text(encoding="utf-8")
proposal_js = (root / "proposal.js").read_text(encoding="utf-8")
proposal_assets = (root / "proposal-assets.js").read_text(encoding="utf-8")
logo_uri = logo_js.split('"')[1]
shell = shell.replace('src="logo.png"', f'src="{logo_uri}"')
for name, src in (("app.js", app), ("proposal.js", proposal_js)):
    assert "</script" not in src.replace("<\\/script", ""), f"{name} must not contain a raw closing script tag"

page = f"""<title>SOLARTOUCH Project Hub</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
{css}
</style>
{shell}
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script>window.SOLARTOUCH_ARTIFACT=true;window.SOLARTOUCH_CONFIG={{}};</script>
<script>
{logo_js}
</script>
<script>
{proposal_js}
</script>
<script>
{proposal_assets}
</script>
<script>
{app}
</script>
"""
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(page, encoding="utf-8")
print(f"wrote {out} ({len(page)//1024} KB)")
