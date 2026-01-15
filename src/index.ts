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

// Create the MCP server
const server = new Server(
  {
    name: "signal-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

// Define the tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "signal_list_chats",
        description:
          "List all Signal chats with their details including contact names, numbers, and message counts",
        inputSchema: {
          type: "object" as const,
          properties: {
            source_dir: {
              type: "string",
              description: "Path to the Signal data directory (optional)",
            },
            password: {
              type: "string",
              description: "Password for encrypted data, if applicable",
            },
            key: {
              type: "string",
              description: "Key for encrypted data, if applicable",
            },
            chats: {
              type: "string",
              description: "Comma-separated list of chat IDs to filter",
            },
            include_empty: {
              type: "boolean",
              description: "Whether to include empty chats",
              default: false,
            },
            include_disappearing: {
              type: "boolean",
              description: "Whether to include disappearing messages",
              default: true,
            },
          },
        },
      },
      {
        name: "signal_get_chat_messages",
        description:
          "Get Signal messages from a specific chat by name with pagination support",
        inputSchema: {
          type: "object" as const,
          properties: {
            chat_name: {
              type: "string",
              description: "The name of the chat to retrieve messages from",
            },
            limit: {
              type: "number",
              description: "Maximum number of messages to return",
            },
            offset: {
              type: "number",
              description: "Number of messages to skip before starting to collect results",
              default: 0,
            },
            source_dir: {
              type: "string",
              description: "Path to the Signal data directory (optional)",
            },
            password: {
              type: "string",
              description: "Password for encrypted data, if applicable",
            },
            key: {
              type: "string",
              description: "Key for encrypted data, if applicable",
            },
            chats: {
              type: "string",
              description: "Comma-separated list of chat IDs to filter",
            },
            include_empty: {
              type: "boolean",
              description: "Whether to include empty chats",
              default: false,
            },
            include_disappearing: {
              type: "boolean",
              description: "Whether to include disappearing messages",
              default: true,
            },
          },
          required: ["chat_name"],
        },
      },
      {
        name: "signal_search_chat",
        description: "Search for specific text within a Signal chat",
        inputSchema: {
          type: "object" as const,
          properties: {
            chat_name: {
              type: "string",
              description: "The name of the chat to search within",
            },
            query: {
              type: "string",
              description: "The text to search for in messages",
            },
            limit: {
              type: "number",
              description: "Maximum number of matching messages to return",
            },
            source_dir: {
              type: "string",
              description: "Path to the Signal data directory (optional)",
            },
            password: {
              type: "string",
              description: "Password for encrypted data, if applicable",
            },
            key: {
              type: "string",
              description: "Key for encrypted data, if applicable",
            },
            chats: {
              type: "string",
              description: "Comma-separated list of chat IDs to filter",
            },
            include_empty: {
              type: "boolean",
              description: "Whether to include empty chats",
              default: false,
            },
            include_disappearing: {
              type: "boolean",
              description: "Whether to include disappearing messages",
              default: true,
            },
          },
          required: ["chat_name", "query"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Create a new database connection with any provided overrides
    const db = new SignalDatabase(
      (args?.source_dir as string) || process.env.SIGNAL_SOURCE_DIR,
      (args?.password as string) || process.env.SIGNAL_PASSWORD,
      (args?.key as string) || process.env.SIGNAL_KEY
    );

    try {
      switch (name) {
        case "signal_list_chats": {
          const chats = db.listChats({
            chats: args?.chats as string,
            includeEmpty: args?.include_empty as boolean,
            includeDisappearing: args?.include_disappearing as boolean,
          });

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

          const messages = db.getChatMessages(chatName, {
            limit: args?.limit as number,
            offset: args?.offset as number,
            chats: args?.chats as string,
            includeEmpty: args?.include_empty as boolean,
            includeDisappearing: args?.include_disappearing as boolean,
          });

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

          const messages = db.searchChat(chatName, query, {
            limit: args?.limit as number,
            chats: args?.chats as string,
            includeEmpty: args?.include_empty as boolean,
            includeDisappearing: args?.include_disappearing as boolean,
          });

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
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Define the prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "signal_summarize_chat_prompt",
        description: "Generate a summary prompt for recent messages in a specific chat",
        arguments: [
          {
            name: "chat_name",
            description: "The name of the chat to summarize",
            required: true,
          },
        ],
      },
      {
        name: "signal_chat_topic_prompt",
        description: "Generate a prompt to analyze discussion topics in a chat",
        arguments: [
          {
            name: "chat_name",
            description: "The name of the chat to analyze",
            required: true,
          },
        ],
      },
      {
        name: "signal_chat_sentiment_prompt",
        description: "Generate a prompt to analyze message sentiment in a chat",
        arguments: [
          {
            name: "chat_name",
            description: "The name of the chat to analyze",
            required: true,
          },
        ],
      },
      {
        name: "signal_search_chat_prompt",
        description: "Generate a search prompt for finding specific text in a chat",
        arguments: [
          {
            name: "chat_name",
            description: "The name of the chat to search",
            required: true,
          },
          {
            name: "query",
            description: "The text to search for",
            required: true,
          },
        ],
      },
    ],
  };
});

// Handle prompt requests
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "signal_summarize_chat_prompt": {
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
              text: `Summarize the recent messages in the Signal chat named '${chatName}'.`,
            },
          },
        ],
      };
    }

    case "signal_chat_topic_prompt": {
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
              text: `What are the topics of discussion in the Signal chat named '${chatName}'?`,
            },
          },
        ],
      };
    }

    case "signal_chat_sentiment_prompt": {
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
              text: `Analyze the sentiment of messages in the Signal chat named '${chatName}'.`,
            },
          },
        ],
      };
    }

    case "signal_search_chat_prompt": {
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
              text: `Search for the text '${query}' in the Signal chat named '${chatName}'.`,
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
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Signal MCP Server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
