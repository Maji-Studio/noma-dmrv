# One gh invocation for all managed branches, with paginated linked issues.
# Sourced by worktree.sh; no repository or database writes.
WORKTREE_PR_PAGE_SIZE=100
WORKTREE_ISSUE_PAGE_SIZE=100
WORKTREE_NESTED_PAGE_SIZE=100
REPO="Maji-Studio/noma-dmrv"
REPO_OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"

read_worktree_github() {
  local branches="$1" refs query branch_names pages
  command -v gh >/dev/null && command -v jq >/dev/null || return 1
  branch_names="$(printf '%s\n' "$branches" | jq -Rsc 'split("\n") | map(select(length > 0)) | unique')"
  # Search PR heads rather than remote refs: merged PRs survive branch deletion.
  refs="$(printf '%s' "$branch_names" | jq -rc --argjson count "$WORKTREE_PR_PAGE_SIZE" --argjson nested "$WORKTREE_NESTED_PAGE_SIZE" --arg repo "$REPO" '
    to_entries | map("branch\(.key):search(type:ISSUE,query:\("repo:" + $repo + " is:pr sort:created-desc head:" + (.value | tojson) | tojson),first:\($count)){nodes{... on PullRequest{number state createdAt headRefName closingIssuesReferences(first:\($nested)){nodes{number}}}}}") | join(" ")')"
  query="query(\$endCursor:String){
    $refs
    repository(owner:\"$REPO_OWNER\",name:\"$REPO_NAME\"){
      issues(first:$WORKTREE_ISSUE_PAGE_SIZE,after:\$endCursor){nodes{number linkedBranches(first:$WORKTREE_NESTED_PAGE_SIZE){nodes{ref{name}}}} pageInfo{hasNextPage endCursor}}
    }
  }"
  # Capture first: a page followed by a gh failure must not become partial rows.
  pages="$(gh api graphql --paginate -f query="$query" 2>/dev/null)" || return 1
  printf '%s' "$pages" | jq -src --argjson branches "$branch_names" '
    if any(.[]; (.errors | length) > 0 or .data.repository == null) then error("GitHub read failed") else
    [.[].data] as $pages |
    [$pages[].repository.issues.nodes[] | .number as $issue | .linkedBranches.nodes[] | select(.ref != null) | {branch:.ref.name,issue:$issue}] as $links |
    [$branches | to_entries[] | .value as $branch | .key as $index |
      ($pages[0]["branch\($index)"].nodes | map(select(.headRefName == $branch)) | sort_by(.createdAt) | last) as $pr |
      {branch:$branch,pr:(if $pr == null then "no PR" else "#\($pr.number) \($pr.state)" end),
       issue: (([$pr.closingIssuesReferences.nodes[]?.number] | unique | map("#\(.)") | join(",")) as $closing |
         if $closing != "" then $closing else ([$links[] | select(.branch == $branch) | .issue] | unique | map("#\(.)") | join(",")) end)}] |
    .[] | [.branch,.pr,(if .issue == "" then "-" else .issue end)] | @tsv end' 2>/dev/null
}
