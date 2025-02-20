#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Configuration schema
const ConfigSchema = z.object({
  repoPath: z.string().min(1, "Repository path is required")
});

// Tool execution function
async function executeCommand(command: string, repoPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: repoPath });
    if (stderr) {
      return `Error: ${stderr}`;
    }
    return stdout;
  } catch (error) {
    return `Execution failed: ${(error as Error).message}`;
  }
}

async function startServer(repoPath: string) {
  // Validate configuration
  const configResult = ConfigSchema.safeParse({ repoPath });
  if (!configResult.success) {
    console.error("Configuration error:", configResult.error.message);
    process.exit(1);
  }

  const config = configResult.data;

  // Initialize MCP server
  const server = new Server(
    {
      name: "flutter-dart-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Define available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "flutter_run",
          description: "Run a Flutter application",
          inputSchema: {
            type: "object",
            properties: {
              target: { type: "string", description: "Target file to run (default: lib/main.dart)" }
            }
          }
        },
        {
          name: "flutter_generate",
          description: "Generate Dart files using build_runner",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "dart_fix",
          description: "Automatically fix Dart style issues",
          inputSchema: {
            type: "object",
            properties: {
              folder: { type: "string", description: "Target folder (default: lib)" }
            }
          }
        },
        {
          name: "dart_run",
          description: "Run a Dart file",
          inputSchema: {
            type: "object",
            properties: {
              file: { type: "string", description: "Dart file to run" }
            },
            required: ["file"]
          }
        },
        {
          name: "flutter_build",
          description: "Build a Flutter application",
          inputSchema: {
            type: "object",
            properties: {
              platform: { 
                type: "string", 
                enum: ["apk", "ios", "web"], 
                description: "Target platform"
              }
            }
          }
        },
        {
          name: "flutter_analyze",
          description: "Run Flutter analyzer to find issues",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "flutter_test",
          description: "Run Flutter tests",
          inputSchema: {
            type: "object",
            properties: {
              test: { type: "string", description: "Specific test file to run (optional)" }
            }
          }
        }
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments || {};
    
    switch (request.params.name) {
      case "flutter_run": {
        const target = args.target || "lib/main.dart";
        const result = await executeCommand(`flutter run ${target}`, config.repoPath);
        return { toolResult: result };
      }
      
      case "flutter_generate": {
        const result = await executeCommand(
          "flutter pub run build_runner build --delete-conflicting-outputs",
          config.repoPath
        );
        return { toolResult: result };
      }
      
      case "dart_fix": {
        const folder = args.folder || "lib";
        const result = await executeCommand(`dart fix --apply ${folder}`, config.repoPath);
        return { toolResult: result };
      }
      
      case "dart_run": {
        const file = args.file;
        const result = await executeCommand(`dart run ${file}`, config.repoPath);
        return { toolResult: result };
      }
      
      case "flutter_build": {
        const platform = args.platform || "apk";
        const result = await executeCommand(`flutter build ${platform}`, config.repoPath);
        return { toolResult: result };
      }
      
      case "flutter_analyze": {
        const result = await executeCommand("flutter analyze", config.repoPath);
        return { toolResult: result };
      }

      case "flutter_test": {
        const testFile = args.test ? args.test : "";
        const result = await executeCommand(`flutter test ${testFile}`, config.repoPath);
        return { toolResult: result };
      }
      
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  });

  // Connect server to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.log(`Flutter/Dart MCP server running with repo: ${config.repoPath}`);
}

// Handle command line execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const repoPath = args[0];
  
  if (!repoPath) {
    console.error("Usage: npx mcp-flutter-server <repo-path>");
    process.exit(1);
  }
  
  startServer(repoPath).catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}

export { startServer };