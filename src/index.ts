#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient, AcceloError } from "./accelo/client.js";
import { collectTools } from "./tools/register.js";

async function main() {
  const config = loadConfig();
  const client = createClient(config);
  const server = new McpServer({ name: "accelo-mcp", version: "0.1.0" });

  for (const tool of collectTools(client, config)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        try {
          return await tool.handler(args ?? {});
        } catch (e) {
          const message =
            e instanceof AcceloError ? `[${e.code}] ${e.message}` : `Unexpected error: ${(e as Error).message}`;
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`accelo-mcp connected for deployment "${config.deployment}".`);
}

main().catch((e) => {
  console.error(`accelo-mcp failed to start: ${(e as Error).message}`);
  process.exit(1);
});
