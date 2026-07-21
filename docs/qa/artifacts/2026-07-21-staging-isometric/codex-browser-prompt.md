Execute the complete QA brief at:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/prompts/run-1-staging-isometric-integration.md

Treat every `<ARTIFACT_DIR>` in that brief as this exact directory:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-21-staging-isometric

Repository:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

This is the user-authorized interactive, unsandboxed autonomous browser run described by
the brief. You may securely use the supplied staging noma credentials and Isometric
sandbox credentials, and you may create and submit obviously synthetic records through
the staging UI. Never print, paste, screenshot, log, or save credentials, tokens,
cookies, authorization headers, or signed URLs.

You are already the gpt-5.6-sol computer-use/browser driver. Do NOT launch `codex exec`,
do NOT delegate browser work to another process, and do NOT recursively invoke this
prompt. Use your connected `node_repl` browser/computer-use capability directly for every
browser action. The repository `codex-computer-use` skill's launcher step has already been
performed by the parent session; apply its browser-driving and evidence rules from here.

Resume status from the parent session:

- Step 0 already passed: both staging noma and the exact sandbox registry project were
  authenticated. Reconfirm both sessions are still live before mutation, but do not redo
  credential handling. The pre-mutation registry screenshot is already at
  `01-registry-baseline-overview.png`.
- Step 1 already passed. Opus successfully called the Isometric MCP `how_to` tool first and
  wrote the authoritative input sheet at `00-known-good-inputs.md`. Read and use that file.
  Do NOT invoke Opus or Claude again.
- Read-only recon found 34 app pages, no open PRs, and local staging equal to origin/staging
  at `6c81f29d989c9b11c07cb421f4cbb62841eec158`. Continue from Step 2 and perform the full
  browser route/API inventory yourself before building the synthetic chain.

Follow the brief exactly. In particular:

- Drive every browser flow yourself with computer use as gpt-5.6-sol, serially.
- First establish authenticated sessions in both the staging app and the linked Isometric
  sandbox project. If either login fails, halt before all testing and report the blocker.
- Before any Isometric reasoning, invoke the connected Isometric MCP `how_to` tool.
- Use the locally installed `claude` CLI with model `opus` only for the Isometric
  research/interpretation step and generation of `00-known-good-inputs.md`; do not delegate
  browser interaction to it.
- Never access production Isometric. The only registry target is
  https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview
- Do not run any database mutation or reset/push command. Do not edit source code. Do not
  create branches, commits, PRs, or issues.
- Write the required final ledger only to
  /Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/2026-07-21-staging-isometric-integration.md
- Write all supporting artifacts only to the artifact directory above.
- Do not write any other files. Findings only; do not implement fixes.

Credentials are not in this prompt. Use only an already-authenticated session, credentials
securely supplied through the interactive computer-use environment, or the browser's own
secure credential facility. Do not inspect or expose credential values from unrelated
files. If the required staging or sandbox credentials are unavailable, treat that as the
Step 0 login blocker and stop as required by the brief.

At the end, report which files were written and a concise run verdict. The authoritative
deliverables remain the ledger and artifacts required by the brief.
