"""Upload screenshots to the orphan `issue-assets` branch of Maji-Studio/noma-dmrv in one commit.
Usage: python3 -I upload-shots.py "<commit message>" <local_file>=<repo_path> [...]
repo_path convention: issues/<n>/<slug>.png, prs/<n>/before-<slug>.png, prs/<n>/after-<slug>.png
Prints one raw URL per file. Creates the branch (orphan, README only) if missing."""
import base64, json, subprocess, sys
REPO = "Maji-Studio/noma-dmrv"
BRANCH = "issue-assets"
RAW = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/"
README = """# issue-assets

Orphan branch that only holds screenshots for GitHub issues and PR before/after comparisons.
No code, no workflows. Never merge it anywhere.

- `issues/<n>/<slug>.png`: screenshots attached to issue #n
- `prs/<n>/before-<slug>.png`, `prs/<n>/after-<slug>.png`: before/after pairs for PR #n

Reference files by `https://raw.githubusercontent.com/Maji-Studio/noma-dmrv/issue-assets/<path>`.
"""

def api(method, path, body=None, ok404=False):
    cmd = ["gh", "api", "-X", method, f"repos/{REPO}/{path}"]
    if body is not None:
        cmd += ["--input", "-"]
    p = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True)
    if p.returncode != 0:
        if ok404 and "404" in (p.stdout + p.stderr):
            return None
        sys.exit(f"gh api {method} {path} failed: {p.stdout} {p.stderr}")
    return json.loads(p.stdout)

def blob(data: bytes):
    return api("POST", "git/blobs", {"content": base64.b64encode(data).decode(), "encoding": "base64"})["sha"]

msg, pairs = sys.argv[1], [a.split("=", 1) for a in sys.argv[2:]]
ref = api("GET", f"git/ref/heads/{BRANCH}", ok404=True)
if ref is None:
    tree = api("POST", "git/trees", {"tree": [{"path": "README.md", "mode": "100644", "type": "blob", "sha": blob(README.encode())}]})["sha"]
    root = api("POST", "git/commits", {"message": "chore: start issue-assets branch", "tree": tree, "parents": []})["sha"]
    api("POST", "git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": root})
    parent = root
else:
    parent = ref["object"]["sha"]
base_tree = api("GET", f"git/commits/{parent}")["tree"]["sha"]
entries = [{"path": dst, "mode": "100644", "type": "blob", "sha": blob(open(src, "rb").read())} for src, dst in pairs]
tree = api("POST", "git/trees", {"base_tree": base_tree, "tree": entries})["sha"]
commit = api("POST", "git/commits", {"message": msg, "tree": tree, "parents": [parent]})["sha"]
api("PATCH", f"git/refs/heads/{BRANCH}", {"sha": commit})
for _, dst in pairs:
    print(RAW + dst)
