"""Extract pasted images from a Claude Code session transcript.
Usage: python3 -I extract-images.py <transcript.jsonl> <out_dir>
Writes img-<n>.<ext> plus index.tsv (n, timestamp, file, first 300 chars of the user text in the same message)."""
import base64, json, sys, os
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
n = 0
rows = []
with open(src) as f:
    for line in f:
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get("type") != "user":
            continue
        content = (rec.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        for c in content:
            if isinstance(c, dict) and c.get("type") == "image":
                s = c.get("source") or {}
                if s.get("type") != "base64":
                    continue
                n += 1
                name = f"img-{n}.{ext.get(s.get('media_type'), 'png')}"
                with open(os.path.join(out, name), "wb") as g:
                    g.write(base64.b64decode(s["data"]))
                snippet = " ".join(texts).replace("\n", " ").replace("\t", " ")[:300]
                rows.append(f"{n}\t{rec.get('timestamp','')}\t{name}\t{snippet}")
with open(os.path.join(out, "index.tsv"), "w") as g:
    g.write("\n".join(rows) + "\n")
print("\n".join(rows))
