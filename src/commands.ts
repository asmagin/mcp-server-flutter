import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// Paths are single positional arguments, never command-line options or shell text.
const PathArgumentSchema = z.string().min(1).refine(
  (value) => !value.startsWith("-") && !value.includes("\0"),
  "Expected a path, not a command-line option or a string containing NUL"
);

const ToolArgumentSchemas = {
  flutter_run: z.object({ target: PathArgumentSchema.default("lib/main.dart") }).strict(),
  flutter_generate: z.object({}).strict(),
  dart_fix: z.object({ folder: PathArgumentSchema.default("lib") }).strict(),
  dart_run: z.object({ file: PathArgumentSchema }).strict(),
  flutter_build: z.object({ platform: z.enum(["apk", "ios", "web"]).default("apk") }).strict(),
  flutter_analyze: z.object({}).strict(),
  flutter_test: z.object({ test: PathArgumentSchema.optional() }).strict(),
};

interface Command {
  executable: "flutter" | "dart";
  args: string[];
}

// Validate at the server boundary: MCP inputSchema is not enforcement.
export function commandForTool(name: string, args: unknown = {}): Command {
  switch (name) {
    case "flutter_run": {
      const { target } = ToolArgumentSchemas.flutter_run.parse(args);
      return { executable: "flutter", args: ["run", target] };
    }
    case "flutter_generate": {
      ToolArgumentSchemas.flutter_generate.parse(args);
      return {
        executable: "flutter",
        args: ["pub", "run", "build_runner", "build", "--delete-conflicting-outputs"],
      };
    }
    case "dart_fix": {
      const { folder } = ToolArgumentSchemas.dart_fix.parse(args);
      return { executable: "dart", args: ["fix", "--apply", folder] };
    }
    case "dart_run": {
      const { file } = ToolArgumentSchemas.dart_run.parse(args);
      return { executable: "dart", args: ["run", file] };
    }
    case "flutter_build": {
      const { platform } = ToolArgumentSchemas.flutter_build.parse(args);
      return { executable: "flutter", args: ["build", platform] };
    }
    case "flutter_analyze": {
      ToolArgumentSchemas.flutter_analyze.parse(args);
      return { executable: "flutter", args: ["analyze"] };
    }
    case "flutter_test": {
      const { test } = ToolArgumentSchemas.flutter_test.parse(args);
      return { executable: "flutter", args: test === undefined ? ["test"] : ["test", test] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function executeTool(name: string, args: unknown, repoPath: string): Promise<string> {
  const command = commandForTool(name, args);
  try {
    // Only the fixed executables above may run. Never enable a shell here, even
    // as a fallback for platforms whose SDK launchers are batch files.
    const { stdout, stderr } = await execFileAsync(command.executable, command.args, {
      cwd: repoPath,
      shell: false,
    });
    if (stderr) {
      return `Error: ${stderr}`;
    }
    return stdout;
  } catch (error) {
    return `Execution failed: ${(error as Error).message}`;
  }
}
