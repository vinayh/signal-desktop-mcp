# Signal Desktop MCP Server

An MCP (Model Context Protocol) server for accessing your local Signal Desktop messages. Enables Claude and other AI assistants to read your Signal chat history directly from your machine.

Ported to Node.js/TypeScript from the [stefanstranger/signal-mcp-server](https://github.com/stefanstranger/signal-mcp-server) Python project for easier use with Claude Desktop and MCPB packaging.

## Features

- List all Signal chats with contact names and message counts
- Retrieve messages from specific chats with pagination
- Search for text within chat messages
- Prompt templates for chat summarization and analysis
- All data stays local - no external API calls

## Installation

### Option 1: MCPB Bundle (Recommended)

1. Download the latest `.mcpb` bundle from [Releases](https://github.com/vinayh/signal-desktop-mcp/releases)
2. Double-click the file or drag it into Claude Desktop
3. Follow the installation prompts

### Option 2: Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/vinayh/signal-desktop-mcp.git
   cd signal-desktop-mcp
   npm install
   npm run build
   ```

2. Add to your Claude Desktop configuration:

   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   ```json
   {
     "mcpServers": {
       "signal-desktop-mcp": {
         "command": "node",
         "args": ["/path/to/signal-desktop-mcp/dist/index.js"]
       }
     }
   }
   ```

3. Restart Claude Desktop

## Prerequisites

- Node.js 18 or higher
- Signal Desktop installed with existing message history
- macOS, Windows, or Linux

## Configuration

### Signal Data Directory

The server automatically detects your Signal data directory:

| OS | Default Path |
|----|--------------|
| macOS | `~/Library/Application Support/Signal` |
| Windows | `%APPDATA%\Signal` |
| Linux | `~/.config/Signal` |
| Linux (Flatpak) | `~/.var/app/org.signal.Signal/config/Signal` |

### Encryption Key

Signal Desktop encrypts its database using SQLCipher. The server handles this automatically:

- **macOS**: Retrieves the key from the system Keychain ("Signal Safe Storage")
- **Other platforms**: Reads from `config.json` in the Signal data directory

### Environment Variables (Optional)

- `SIGNAL_SOURCE_DIR`: Custom path to Signal Desktop data directory
- `SIGNAL_KEY`: Encryption key in hex format (if auto-detection fails)

## Available Tools

### `signal_list_chats`

Lists all Signal chats with their details.

**Parameters:**
- `include_empty` (boolean): Include chats with no messages (default: false)

**Example response:**
```json
[
  {
    "id": "abc123",
    "name": "John Doe",
    "number": "+1234567890",
    "type": "private",
    "totalMessages": 150
  }
]
```

### `signal_get_chat_messages`

Retrieves messages from a specific chat.

**Parameters:**
- `chat_name` (string, required): Name of the contact or group
- `limit` (number): Maximum messages to return (default: 50)
- `offset` (number): Skip messages for pagination (default: 0)

**Example response:**
```json
[
  {
    "date": "2024-01-15T10:30:00.000Z",
    "sender": "John Doe",
    "body": "Hello!",
    "reactions": [],
    "attachments": ""
  }
]
```

### `signal_search_chat`

Search for text within a chat's messages.

**Parameters:**
- `chat_name` (string, required): Name of the contact or group
- `query` (string, required): Text to search for (case-insensitive)
- `limit` (number): Maximum results to return (default: 20)

## Available Prompts

- `signal_summarize_chat` - Summarize recent messages in a chat
- `signal_chat_topics` - Analyze main discussion topics
- `signal_search_and_summarize` - Search for a topic and summarize relevant messages

## Building the MCPB Bundle

To create a distributable `.mcpb` bundle:

```bash
npm install
npm run bundle
```

This creates `signal-desktop-mcp-X.X.X.mcpb` in the project root.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Create MCPB bundle
npm run bundle
```

## Important Notes

- **Signal Desktop must be closed** when accessing the database to avoid lock conflicts
- All data is read locally - nothing is sent to external servers
- Uses Signal's official `@signalapp/better-sqlite3` fork with SQLCipher support

## Security & Privacy

This server provides access to your personal Signal messages. Please:

- Only run this server locally
- Never expose it to the internet
- Be mindful of the privacy of others in your conversations
- Review which AI tools you grant access to your messages

## Troubleshooting

### "Database is locked" error
Close Signal Desktop before using this MCP server.

### "Could not find encryption key" error
On macOS, ensure Signal Desktop has run at least once. On other platforms, check that `config.json` exists in your Signal data directory.

### Node version mismatch
The native SQLite module must be compiled for your Node.js version. Run `npm rebuild @signalapp/better-sqlite3` if you see module version errors.

## License

MIT License

## Credits

- Original Python implementation: [stefanstranger/signal-mcp-server](https://github.com/stefanstranger/signal-mcp-server)
- Signal's SQLCipher fork: [@signalapp/better-sqlite3](https://github.com/nicmcd/better-sqlite3-sqlcipher)
