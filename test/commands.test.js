import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { commandForTool, executeTool } from "../build/commands.js";

const pathTools = [
  ["flutter_run", "target", "flutter", ["run"]],
  ["dart_fix", "folder", "dart", ["fix", "--apply"]],
  ["dart_run", "file", "dart", ["run"]],
  ["flutter_test", "test", "flutter", ["test"]],
];

const commandCases = [
  ["flutter_run", {}, "flutter", ["run", "lib/main.dart"]],
  ["flutter_generate", {}, "flutter", ["pub", "run", "build_runner", "build", "--delete-conflicting-outputs"]],
  ["dart_fix", {}, "dart", ["fix", "--apply", "lib"]],
  ["dart_run", { file: "bin/main.dart" }, "dart", ["run", "bin/main.dart"]],
  ["flutter_build", {}, "flutter", ["build", "apk"]],
  ["flutter_analyze", {}, "flutter", ["analyze"]],
  ["flutter_test", {}, "flutter", ["test"]],
  ...["apk", "ios", "web"].map((platform) => ["flutter_build", { platform }, "flutter", ["build", platform]]),
];

test("all seven tools retain their command, defaults, and allowed platforms", () => {
  for (const [name, args, executable, argv] of commandCases) {
    assert.deepEqual(commandForTool(name, args), { executable, args: argv });
  }
  assert.deepEqual(commandForTool("flutter_run"), { executable: "flutter", args: ["run", "lib/main.dart"] });
});

test("paths with spaces and metacharacters remain one literal argument", () => {
  const path = 'lib/a b; $(echo injected) & `echo injected` "quoted".dart';
  for (const [name, parameter, executable, prefix] of pathTools) {
    assert.deepEqual(commandForTool(name, { [parameter]: path }), {
      executable,
      args: [...prefix, path],
    });
  }
});

test("invalid path arguments and option injection are rejected", () => {
  for (const [name, parameter] of pathTools) {
    for (const value of ["", "--version", "-h", "file\0.dart", null, false, 0, 1, [], {}, ["file.dart"]]) {
      assert.throws(() => commandForTool(name, { [parameter]: value }), `${name}: ${JSON.stringify(value)}`);
    }
  }
  assert.throws(() => commandForTool("dart_run", {}));
});

test("platform allowlist is enforced at runtime", () => {
  for (const platform of ["linux", "apk; touch injected", "$(touch injected)", "apk --release", "--help", "", null, 0, [], {}]) {
    assert.throws(() => commandForTool("flutter_build", { platform }));
  }
});

test("malformed argument objects, unexpected properties, and unknown tools are rejected", () => {
  for (const [name] of commandCases) {
    for (const args of [null, [], "", false, { unexpected: "value" }]) {
      assert.throws(() => commandForTool(name, args));
    }
  }
  for (const name of ["unknown", "sh", "constructor", "__proto__"]) {
    assert.throws(() => commandForTool(name), /Unknown tool/);
  }
});

// Use real child processes without requiring the Flutter/Dart SDKs. These
// POSIX executable fixtures intentionally do not invoke a shell themselves.
const supportsFixtures = process.platform !== "win32";
let root;
let repoPath;
let tracePath;
const originalPath = process.env.PATH;
const originalTrace = process.env.MCP_FLUTTER_TEST_TRACE;

before(async () => {
  if (!supportsFixtures) return;
  root = await mkdtemp(join(tmpdir(), "mcp-flutter-"));
  const bin = join(root, "bin");
  repoPath = join(root, "project with spaces");
  tracePath = join(root, "invocations.jsonl");
  await mkdir(bin);
  await mkdir(repoPath);
  await writeFile(tracePath, "");
  for (const executable of ["flutter", "dart"]) {
    const script = join(bin, executable);
    await writeFile(script, `#!/usr/bin/env node
const fs = require("node:fs");
const invocation = { executable: ${JSON.stringify(executable)}, args: process.argv.slice(2), cwd: process.cwd() };
fs.appendFileSync(process.env.MCP_FLUTTER_TEST_TRACE, JSON.stringify(invocation) + "\\n");
if (invocation.args.includes("stderr.dart")) { process.stderr.write("test warning"); }
else if (invocation.args.includes("failure.dart")) { process.stderr.write("test failure"); process.exitCode = 1; }
else { process.stdout.write(JSON.stringify(invocation)); }
`);
    await chmod(script, 0o755);
  }
  process.env.PATH = `${bin}${delimiter}${originalPath ?? ""}`;
  process.env.MCP_FLUTTER_TEST_TRACE = tracePath;
});

after(async () => {
  if (!supportsFixtures) return;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalTrace === undefined) delete process.env.MCP_FLUTTER_TEST_TRACE;
  else process.env.MCP_FLUTTER_TEST_TRACE = originalTrace;
  if (root) await rm(root, { recursive: true, force: true });
});

test("real processes receive expected arguments and repository working directory", { skip: !supportsFixtures }, async () => {
  for (const [name, args, executable, argv] of commandCases) {
    assert.deepEqual(JSON.parse(await executeTool(name, args, repoPath)), {
      executable,
      args: argv,
      cwd: repoPath,
    });
  }
});

test("shell payloads cannot execute commands through any of the four path parameters", { skip: !supportsFixtures }, async () => {
  const payloads = [
    "file.dart; touch injected",
    "file.dart && touch injected",
    "file.dart || touch injected",
    "file.dart | touch injected",
    "$(touch injected).dart",
    "`touch injected`.dart",
    "file.dart\ntouch injected",
    "file.dart > injected",
    'file with spaces "quotes" \'single quotes\'.dart',
    "lib/$HOME/*.dart",
  ];
  for (const [name, parameter, executable, prefix] of pathTools) {
    for (const payload of payloads) {
      const result = JSON.parse(await executeTool(name, { [parameter]: payload }, repoPath));
      assert.deepEqual(result, { executable, args: [...prefix, payload], cwd: repoPath });
      assert.equal(existsSync(join(repoPath, "injected")), false, `${name}: ${payload}`);
    }
  }
});

test("invalid inputs, including malicious platform, never start a process", { skip: !supportsFixtures }, async () => {
  const before = await readFile(tracePath, "utf8");
  for (const [name, parameter] of pathTools) {
    for (const value of ["--version", "file\0.dart", 123, {}, null]) {
      await assert.rejects(executeTool(name, { [parameter]: value }, repoPath));
    }
  }
  await assert.rejects(executeTool("dart_run", {}, repoPath));
  await assert.rejects(executeTool("flutter_build", { platform: "apk; touch injected" }, repoPath));
  await assert.rejects(executeTool("unknown", {}, repoPath));
  assert.equal(await readFile(tracePath, "utf8"), before);
  assert.equal(existsSync(join(repoPath, "injected")), false);
});

test("stderr and command failures retain existing error messages", { skip: !supportsFixtures }, async () => {
  assert.equal(await executeTool("dart_run", { file: "stderr.dart" }, repoPath), "Error: test warning");
  assert.match(await executeTool("dart_run", { file: "failure.dart" }, repoPath), /^Execution failed:.*\n?test failure/s);
  assert.match(await executeTool("flutter_analyze", {}, join(root, "missing")), /^Execution failed:/);
});
