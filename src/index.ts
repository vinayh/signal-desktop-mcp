#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SignalDatabase } from "./signal-db.js";

// Configuration
const SERVER_NAME = "signal-desktop-mcp";
const SERVER_VERSION = "0.1.0";

// Logging utilities
function log(level: "INFO" | "DEBUG" | "ERROR" | "WARN", message: string, data?: object): void {
  const timestamp = new Date().toISOString();
  const logMessage = data
    ? `[${timestamp}] [${level}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] [${level}] ${message}`;
  console.error(logMessage);
}

// Create the MCP server
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

// Tool definitions with complete schemas
const TOOLS = [
  {
    name: "signal_list_chats",
    description:
      "List all Signal chats with their details including contact names, phone numbers, and message counts. Returns an array of chat objects sorted by activity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        include_empty: {
          type: "boolean",
          description: "Include chats with no messages (default: false)",
          default: false,
        },
      },
    },
  },
  {
    name: "signal_get_chat_messages",
    description:
      "Retrieve messages from a specific Signal chat by contact name or group name. Supports pagination for large conversations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_name: {
          type: "string",
          description: "The name of the chat (contact name or group name) to retrieve messages from",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return (default: 50)",
          default: 50,
        },
        offset: {
          type: "number",
          description: "Number of messages to skip for pagination (default: 0)",
          default: 0,
        },
      },
      required: ["chat_name"],
    },
  },
  {
    name: "signal_search_chat",
    description:
      "Search for specific text within messages in a Signal chat. Returns matching messages with context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_name: {
          type: "string",
          description: "The name of the chat to search within",
        },
        query: {
          type: "string",
          description: "The text to search for in messages (case-insensitive)",
        },
        limit: {
          type: "number",
          description: "Maximum number of matching messages to return (default: 20)",
          default: 20,
        },
      },
      required: ["chat_name", "query"],
    },
  },
];

// Register tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("DEBUG", "Listing available tools");
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log("INFO", `Tool call received: ${name}`, { arguments: args });

  try {
    // Create database connection
    const sourceDir = process.env.SIGNAL_SOURCE_DIR || undefined;
    const key = process.env.SIGNAL_KEY || undefined;

    log("DEBUG", "Creating database connection", {
      sourceDir: sourceDir || "(auto-detect)",
      keyProvided: !!key,
    });

    const db = new SignalDatabase(sourceDir, undefined, key);

    try {
      switch (name) {
        case "signal_list_chats": {
          log("DEBUG", "Listing chats");
          const chats = db.listChats({
            includeEmpty: (args?.include_empty as boolean) ?? false,
          });

          log("INFO", `Found ${chats.length} chats`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(chats, null, 2),
              },
            ],
          };
        }

        case "signal_get_chat_messages": {
          const chatName = args?.chat_name as string;
          if (!chatName) {
            throw new Error("chat_name is required");
          }

          const limit = (args?.limit as number) ?? 50;
          const offset = (args?.offset as number) ?? 0;

          log("DEBUG", `Getting messages for chat: ${chatName}`, { limit, offset });
          const messages = db.getChatMessages(chatName, { limit, offset });

          log("INFO", `Retrieved ${messages.length} messages from "${chatName}"`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(messages, null, 2),
              },
            ],
          };
        }

        case "signal_search_chat": {
          const chatName = args?.chat_name as string;
          const query = args?.query as string;

          if (!chatName) {
            throw new Error("chat_name is required");
          }
          if (!query) {
            throw new Error("query is required");
          }

          const limit = (args?.limit as number) ?? 20;

          log("DEBUG", `Searching chat "${chatName}" for: ${query}`, { limit });
          const messages = db.searchChat(chatName, query, { limit });

          log("INFO", `Found ${messages.length} matching messages in "${chatName}"`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(messages, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } finally {
      db.close();
      log("DEBUG", "Database connection closed");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("ERROR", `Tool ${name} failed`, { error: errorMessage });
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Prompt definitions
const PROMPTS = [
  {
    name: "signal_summarize_chat",
    description: "Generate a summary of recent messages in a Signal chat",
    arguments: [
      {
        name: "chat_name",
        description: "The name of the chat to summarize",
        required: true,
      },
    ],
  },
  {
    name: "signal_chat_topics",
    description: "Analyze and list the main topics discussed in a Signal chat",
    arguments: [
      {
        name: "chat_name",
        description: "The name of the chat to analyze",
        required: true,
      },
    ],
  },
  {
    name: "signal_search_and_summarize",
    description: "Search for a topic in a chat and summarize the relevant messages",
    arguments: [
      {
        name: "chat_name",
        description: "The name of the chat to search",
        required: true,
      },
      {
        name: "query",
        description: "The topic or text to search for",
        required: true,
      },
    ],
  },
];

// Register prompts handler
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  log("DEBUG", "Listing available prompts");
  return { prompts: PROMPTS };
});

// Handle prompt requests
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log("DEBUG", `Prompt requested: ${name}`, { arguments: args });

  switch (name) {
    case "signal_summarize_chat": {
      const chatName = args?.chat_name;
      if (!chatName) {
        throw new Error("chat_name is required");
      }
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please use the signal_get_chat_messages tool to retrieve recent messages from the Signal chat "${chatName}", then provide a concise summary of the conversation topics, key points, and any action items mentioned.`,
            },
          },
        ],
      };
    }

    case "signal_chat_topics": {
      const chatName = args?.chat_name;
      if (!chatName) {
        throw new Error("chat_name is required");
      }
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please use the signal_get_chat_messages tool to retrieve messages from the Signal chat "${chatName}", then analyze and list the main topics that have been discussed. Group related messages together and provide a brief description of each topic.`,
            },
          },
        ],
      };
    }

    case "signal_search_and_summarize": {
      const chatName = args?.chat_name;
      const query = args?.query;
      if (!chatName) {
        throw new Error("chat_name is required");
      }
      if (!query) {
        throw new Error("query is required");
      }
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please use the signal_search_chat tool to search for "${query}" in the Signal chat "${chatName}", then summarize the relevant messages and any conclusions or decisions that were made about this topic.`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// Start the server
async function main(): Promise<void> {
  log("INFO", "Signal Desktop MCP Server starting...");
  log("INFO", `Node.js version: ${process.version}`);
  log("INFO", `Platform: ${process.platform}`);

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("INFO", "Signal Desktop MCP Server started and ready for connections");
  } catch (error) {
    log("ERROR", "Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main().catch((error) => {
  log("ERROR", "Fatal error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
