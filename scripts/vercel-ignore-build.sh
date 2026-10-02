#!/bin/sh
# Vercel Ignored Build Step for both projects that build from this repo (root vercel.json applies to
# both, overriding any dashboard setting). Exit 0 skips the build, exit 1 builds; when in doubt, build.
#   noma-site: builds when site/ or the fonts it loads from src/styles/fonts changed.
#   noma-dmrv: builds when anything outside site/ changed.
APP_PROJECT_ID="prj_MAe7LnlVetbWRIPtOLm7kAo2XlJM"
SITE_PROJECT_ID="prj_ClEafU9NNMK2pCUMzQfnrMd5AtYw"

prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
project="${VERCEL_PROJECT_ID:-}"
echo "ignore-build: project=${project:-unknown} previous=${prev:-none}"

# A branch from before the site existed has nothing for noma-site to build.
[ "$project" = "$SITE_PROJECT_ID" ] && [ ! -d site ] && { echo "ignore-build: no site/ on this branch, skipping"; exit 0; }

# No previous deployment on this branch, or its commit is outside Vercel's shallow clone.
[ -n "$prev" ] || exit 1
if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  echo "ignore-build: previous commit not in the clone, building"
  exit 1
fi

case "$project" in
  "$SITE_PROJECT_ID") git diff --quiet "$prev" HEAD -- site src/styles/fonts ;;
  "$APP_PROJECT_ID") git diff --quiet "$prev" HEAD -- . ':(exclude)site' ;;
  *) echo "ignore-build: unknown project, building"; exit 1 ;;
esac
# git diff: 0 = unchanged (skip), 1 = changed, >1 = error; build on anything but 0.
[ $? -eq 0 ] && { echo "ignore-build: no relevant changes, skipping"; exit 0; }
exit 1
