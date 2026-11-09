import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = join(process.cwd(), ".claude/hooks/block-process-kill.sh");
const EXIT_USAGE = 2;
const PREAMBLE = "Safety rules. Do not run pkill -f or killall or kill on processes you did not start.";
const KILL_COMMANDS = ["pkill -f server", "killall node"];
const temporaryDirectories: string[] = [];

// Guard careless pattern kills; deliberate cat redefinitions are outside the threat model.
function run(input: string, env = process.env) {
  return spawnSync("/bin/bash", [HOOK], { input, encoding: "utf8", env });
}

function runCommand(command: string) {
  return run(JSON.stringify({ tool_input: { command } }));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("block-process-kill hook", () => {
  const heredocHeaders = ["'EOF'", '"EOF"', "\\EOF"].flatMap((delimiter) =>
    ["<<", "<<-"].flatMap((operator) =>
      [">", ">>"].flatMap((redirect) => [
        `cat ${redirect} prompt.md ${operator}${delimiter}`,
        `cat ${operator}${delimiter} ${redirect} prompt.md`,
      ])
    )
  );

  it.each(heredocHeaders)("allows a literal preamble in %s", (header) => {
    const indent = header.includes("<<-") ? "\t" : "";
    const result = runCommand(`echo before\n${header}\n${indent}${PREAMBLE}\n${indent}EOF\necho after`);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.each(["cat > 'prompt file.md' <<'END-DOC'", 'cat <<"END.DOC" >> "prompt file.md"'])(
    "allows plain quoted paths and delimiter punctuation: %s", (header) => {
      const terminator = header.includes("END-DOC") ? "END-DOC" : "END.DOC";
      const result = runCommand(`${header}\n${PREAMBLE}\n${terminator}`);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    }
  );

  it.each(["echo ordinary", "kill 1234", "pkill -x node"])("keeps existing allow behaviour for %s", (command) => {
    const result = runCommand(command);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  const literalCommands = [
    `A=/tmp/x/codex; mkdir -p "$A" && cat > "$A/prompt.md" <<'EOF'\n${PREAMBLE}\nEOF\n"$CODEX" exec -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -C "$PWD" -o "$A/report.md" - < "$A/prompt.md"`,
    `PROMPT="$(mktemp -d)"\ncat <<'EOF' > "$PROMPT/prompt.md"\n${PREAMBLE}\nEOF`,
    `cat > \${TMPDIR}/prompt.md <<'PROMPT_EOF'\n${PREAMBLE}\ncat <<'INNER'\nINNER\nPROMPT_EOF`,
    ...["&&", ";", "||"].map((separator) => `echo before ${separator} cat > f.md <<'EOF'\n${PREAMBLE}\nEOF`),
    ...["$PROMPT.md", "'\${TMPDIR}/prompt file.md'", '"\${TMPDIR}/prompt file.md"'].map(
      (target) => `cat > ${target} <<'EOF'\n${PREAMBLE}\nEOF`
    ),
    // Inner heredoc examples are literal body text and cannot execute.
    ...KILL_COMMANDS.map((command) => `cat > prompt.md <<'EOF'\ncat <<'INNER'\n${command}\nINNER\nEOF`),
    `cat > first.md <<'EOF'\n${PREAMBLE}\nEOF\ncat > second.md <<'END'\nordinary text`,
    `cat > outer.txt <<-OUTER\nordinary\n\tOUTER\ncat > prompt.md <<'EOF'\n${PREAMBLE}\nEOF`,
    `cat <<FIRST <<'SECOND'\nordinary\nFIRST\nordinary\nSECOND\ncat > prompt.md <<'EOF'\n${PREAMBLE}\nEOF`,
    `cat > first.md <<'EOF'\nAn operator's ordinary note.\nEOF\ncat > second.md <<'END'\n${PREAMBLE}\nEND`,
    `echo "an escaped quote: \\""\ncat > prompt.md <<'EOF'\n${PREAMBLE}\nEOF`,
    ...['echo "# ordinary"', "echo '# ordinary'", "echo \\#", "echo word#ordinary"].map(
      (prefix) => `${prefix}; cat > prompt.md <<'EOF'\n${PREAMBLE}\nEOF`
    ),
    `cat <<'EOF' > prompt.txt\n${PREAMBLE}\nEOF`,
  ];
  it.each(literalCommands)("allows literal file-writing bodies: %s", (command) => {
    const result = runCommand(command);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  const deniedCommands = KILL_COMMANDS.flatMap((command) => [
    command,
    ...[
      "# Previous command", "echo before # comment", "echo before;# comment", "echo before &# comment",
      "echo before |# comment", "(# comment", "\t# comment",
    ].map(
      (prefix) => `${prefix}; cat > prompt.md <<'EOF'\n${command}\nEOF`
    ),
    // A commented delimiter must not consume the next real heredoc header.
    `# cat <<'EOF'\ncat <<OUTER\ncat > prompt.md <<'EOF'\n$(${command})\nEOF\nOUTER`,
    `# cat <<'COMMENT'\ncat <<OUTER\nCOMMENT\ncat > prompt.md <<'EOF'\n$(${command})\nEOF\nOUTER`,
    ...["&&", ";", "||"].map((separator) => `echo before ${separator} cat > f <<'EOF'\n${command}\nEOF`),
    ...["f", "$PROMPT", '"$PROMPT"', "prompt.MD", "prompt.md.sh"].map(
      (target) => `cat > ${target} <<'EOF'\n${command}\nEOF`
    ),
    `PROMPT="$(mktemp -d)/prompt.md"\ncat <<'EOF' > "$PROMPT"\n${command}\nEOF`,
    `cat > /tmp/restart.sh <<'EOF'\n${command}\nEOF\nbash /tmp/restart.sh`,
    `cat > f.sh <<'EOF'\n${command}\nEOF\nchmod +x f.sh && ./f.sh`,
    ...["bash", "sh", "zsh", "python"].map((shell) => `${shell} <<'EOF'\n${command}\nEOF`),
    `cat <<'EOF' | bash\n${command}\nEOF`,
    `cat > prompt.md <<EOF\n$(${command})\nEOF`,
    ...['"', "'"].flatMap((quote) => [
      `bash -c ${quote}\ncat > prompt.md <<'EOF'\n$(${command})\nEOF\n${quote}`,
      `bash -c ${quote}; cat > prompt.md <<'EOF'\n$(${command})\nEOF\n${quote}`,
    ]),
    `cat > outer.sh <<OUTER\ncat > inner.txt <<'INNER'\n$(${command})\nINNER\nOUTER`,
    // Fail closed even though the inner cat body is literal in the shell.
    `bash <<'OUTER'\ncat > inner.txt <<'INNER'\n${command}\nINNER\nOUTER`,
    `cat > outer.sh <<-OUTER\ncat > inner.txt <<'INNER'\n$(${command})\nINNER\n\tOUTER`,
    `cat > prompt.md <<'EOF'\nsafe\nEOF\n${command}`,
    `${command}\ncat > prompt.md <<'EOF'\nsafe\nEOF`,
    `${command}; cat > f <<'EOF'\nsafe\nEOF`,
    `cat > >(bash) <<'EOF'\n${command}\nEOF`,
    `cat > "$(${command})/prompt.md" <<'EOF'\n${command}\nEOF`,
    ...["bash -s", "env", "echo", "x |"].map((prefix) => `${prefix} cat > f <<'EOF'\n${command}\nEOF`),
    `grep '${command}' prompt.md`,
    `echo '${command}'`,
    `cat > prompt.md <<'EOF'\n${command}`,
    `cat > prompt.md <<'EOF' <<'SECOND'\n${command}\nEOF\nSECOND`,
    `bash \\\ncat > prompt.md <<'EOF'\n${command}\nEOF`,
  ]);
  it.each(deniedCommands)("denies executable or ambiguous text: %s", (command) => {
    const result = runCommand(command);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it.each(["{broken", "", "null"])("fails closed on malformed input: %s", (input) => {
    expect(run(input).status).toBe(EXIT_USAGE);
  });

  it("fails closed on a non-string command", () => {
    expect(run('{"tool_input":{"command":42}}').status).toBe(EXIT_USAGE);
  });

  it("preserves the existing empty response for a missing command field", () => {
    const result = run("{}");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fails closed without jq", () => {
    const directory = mkdtempSync(join(tmpdir(), "hook-no-jq-"));
    temporaryDirectories.push(directory);
    const result = run('{"tool_input":{"command":"echo ordinary"}}', { ...process.env, PATH: directory });
    expect(result.status).toBe(EXIT_USAGE);
    expect(result.stderr).toContain("jq is required");
  });
});
