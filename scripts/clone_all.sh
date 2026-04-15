#!/bin/bash
# clone_all.sh — Run at Hour 24 after deadline
ORG="TENSOR-26"
DEST=~/tensor26-repos
mkdir -p "$DEST" && cd "$DEST"
echo "Cloning all repos from $ORG..."
gh repo list "$ORG" --limit 300 --json name -q '.[].name' | while read repo; do
  [ -d "$repo" ] || git clone "https://github.com/$ORG/$repo.git" --quiet && echo "Cloned: $repo"
done
echo "Done. Total: $(ls | wc -l) repos"
