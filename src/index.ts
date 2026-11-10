#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { executeTool } from "./commands.js";

// Configuration schema
const ConfigSchema = z.object({
  repoPath: z.string().min(1, "Repository path is required")
});

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
    const result = await executeTool(
      request.params.name,
      request.params.arguments ?? {},
      config.repoPath
    );
    return { toolResult: result };
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
