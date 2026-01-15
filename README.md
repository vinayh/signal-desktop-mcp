# Signal MCP Server (TypeScript)

MCP Server for retrieving Signal messages using Node.js, packaged in MCPB format.

## Overview

This is the TypeScript/Node.js port of the Signal MCP Server. It enables AI agents and tools to access Signal Desktop chat messages via the Model Context Protocol (MCP).

## Prerequisites

- Node.js 18 or higher
- Signal Desktop installed with existing message database
- Windows, macOS, or Linux operating system

## Installation

### Using MCPB (Recommended)

1. Package the extension:
   ```bash
   npm install -g @anthropic-ai/mcpb
   mcpb pack ./ts
   ```

2. Install the generated `.mcpb` file in Claude Desktop or other MCP-compatible clients.

### Manual Installation

1. Install dependencies:
   ```bash
   cd ts
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Add to your Claude Desktop configuration (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "signal-mcp-server": {
         "command": "node",
         "args": ["/path/to/signal-mcp-server/ts/dist/index.js"]
       }
     }
   }
   ```

## Configuration

### Environment Variables

- `SIGNAL_SOURCE_DIR`: Path to Signal Desktop data directory (auto-detected if not set)
- `SIGNAL_PASSWORD`: Database password (if encrypted)
- `SIGNAL_KEY`: Encryption key (if encrypted)

### Signal Data Directory Locations

The server automatically detects your Signal data directory:

- **Windows**: `%APPDATA%\Signal`
- **macOS**: `~/Library/Application Support/Signal`
- **Linux**: `~/.config/Signal` (or Flatpak: `~/.var/app/org.signal.Signal/config/Signal`)

## Available Tools

### 1. `signal_list_chats`

Lists all Signal chats with their details.

**Parameters:**
- `source_dir` (optional): Custom Signal data directory path
- `password` (optional): Database password
- `key` (optional): Encryption key
- `chats` (optional): Comma-separated list of chat IDs to filter
- `include_empty` (optional): Include chats with no messages (default: false)
- `include_disappearing` (optional): Include disappearing messages (default: true)

### 2. `signal_get_chat_messages`

Retrieves messages from a specific chat by name.

**Parameters:**
- `chat_name` (required): Name of the chat contact
- `limit` (optional): Maximum number of messages to return
- `offset` (optional): Number of messages to skip (for pagination)
- Other parameters same as `signal_list_chats`

### 3. `signal_search_chat`

Search for specific text within Signal chat messages.

**Parameters:**
- `chat_name` (required): Name of the chat to search within
- `query` (required): Text to search for in message bodies
- `limit` (optional): Maximum number of matching messages to return
- Other parameters same as `signal_list_chats`

## Available Prompts

1. `signal_summarize_chat_prompt` - Generate a summary of recent messages
2. `signal_chat_topic_prompt` - Analyze discussion topics in a chat
3. `signal_chat_sentiment_prompt` - Analyze message sentiment
4. `signal_search_chat_prompt` - Search for specific text in a chat

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

## Limitations

- Signal Desktop must be closed when accessing the database
- SQLCipher encrypted databases may require additional setup (better-sqlite3 doesn't natively support SQLCipher)
- For encrypted databases on some systems, you may need to provide the encryption key

## Security & Privacy

**Important**: This server provides access to your personal Signal messages. Please:

- Only run this server locally
- Never expose it to the internet
- Be cautious about which AI agents you grant access
- Consider the privacy of others in your conversations

## License

MIT License
