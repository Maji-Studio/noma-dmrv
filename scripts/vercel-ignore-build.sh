#!/bin/sh
# Vercel Ignored Build Step (root vercel.json `ignoreCommand`, which overrides any dashboard
# setting). Exit 0 skips the build, exit 1 builds.
# Only `staging` and `main` build on push. Feature-branch previews were most of the build bill
# and nothing consumed them. To get a preview for one branch, push a commit whose message
# contains [preview]. A deployment with no git branch (a CLI deploy) always builds.
ref="${VERCEL_GIT_COMMIT_REF:-}"
echo "ignore-build: branch=${ref:-none}"

case "$ref" in
  staging | main | "") exit 1 ;;
esac

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[preview]"*)
    echo "ignore-build: [preview] in the commit message, building"
    exit 1
    ;;
esac

echo "ignore-build: not staging or main, skipping"
exit 0
