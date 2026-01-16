import Database from "@signalapp/better-sqlite3";
import { homedir, platform } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { pbkdf2Sync, createDecipheriv } from "crypto";
function getDefaultSignalDir() {
    const home = homedir();
    const os = platform();
    switch (os) {
        case "win32":
            return join(home, "AppData", "Roaming", "Signal");
        case "darwin":
            return join(home, "Library", "Application Support", "Signal");
        case "linux": {
            // Check for Flatpak first
            const flatpakPath = join(home, ".var", "app", "org.signal.Signal", "config", "Signal");
            if (existsSync(flatpakPath)) {
                return flatpakPath;
            }
            return join(home, ".config", "Signal");
        }
        default:
            throw new Error(`Unsupported OS: ${os}`);
    }
}
function decryptKey(password, encryptedKeyHex) {
    const encryptedKey = Buffer.from(encryptedKeyHex, "hex");
    const prefix = Buffer.from("v10");
    if (!encryptedKey.subarray(0, 3).equals(prefix)) {
        throw new Error("Encrypted key does not start with v10");
    }
    const ciphertext = encryptedKey.subarray(3);
    const salt = Buffer.from("saltysalt");
    const iterations = 1003;
    // Key length 16 bytes (128 bits)
    const key = pbkdf2Sync(password, salt, iterations, 16, "sha1");
    const iv = Buffer.alloc(16, 0x20); // 16 spaces
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf-8");
}
function getEncryptionKey(sourceDir, providedKey) {
    if (providedKey) {
        return providedKey;
    }
    // Try to read the key from Signal's config
    const configPath = join(sourceDir, "config.json");
    if (existsSync(configPath)) {
        try {
            const config = JSON.parse(readFileSync(configPath, "utf-8"));
            if (config.key) {
                return config.key;
            }
            else if (config.encryptedKey && platform() === "darwin") {
                try {
                    const password = execSync('security find-generic-password -ws "Signal Safe Storage"', { encoding: 'utf-8' }).trim();
                    return decryptKey(password, config.encryptedKey);
                }
                catch (e) {
                    console.error("Failed to retrieve password from Keychain or decrypt key:", e);
                }
            }
        }
        catch {
            // Config file may not be readable or may not contain key
        }
    }
    return null;
}
// Check if a value is a valid path (not an unsubstituted template variable)
function isValidPath(value) {
    if (!value)
        return false;
    // Check for unsubstituted MCPB template variables like ${user_config.xxx}
    if (value.startsWith('${') && value.includes('}'))
        return false;
    return true;
}
export class SignalDatabase {
    password;
    key;
    db = null;
    sourceDir;
    selfServiceId = null;
    constructor(sourceDir, password, key) {
        this.password = password;
        this.key = key;
        // Handle MCPB template variables that weren't substituted (user didn't set config)
        const envSourceDir = process.env.SIGNAL_SOURCE_DIR;
        const resolvedSourceDir = isValidPath(sourceDir) ? sourceDir :
            isValidPath(envSourceDir) ? envSourceDir :
                undefined;
        this.sourceDir = resolvedSourceDir || getDefaultSignalDir();
    }
    open() {
        if (this.db) {
            return this.db;
        }
        const dbPath = join(this.sourceDir, "sql", "db.sqlite");
        if (!existsSync(dbPath)) {
            throw new Error(`Signal database not found at: ${dbPath}`);
        }
        // Get the encryption key from config.json or provided key
        // Handle MCPB template variables that weren't substituted
        const envKey = process.env.SIGNAL_KEY;
        const providedKey = isValidPath(this.key) ? this.key :
            isValidPath(envKey) ? envKey :
                undefined;
        const encKey = getEncryptionKey(this.sourceDir, providedKey);
        if (!encKey) {
            throw new Error(`Could not find Signal encryption key. ` +
                `Make sure config.json exists in ${this.sourceDir} or provide the key manually.`);
        }
        try {
            // Open database with SQLCipher encryption using Signal's fork of better-sqlite3
            this.db = new Database(dbPath, { readonly: true });
            // Set up SQLCipher with Signal's specific settings
            this.db.pragma(`key = "x'${encKey}'"`);
            this.db.pragma("cipher_page_size = 4096");
            this.db.pragma("kdf_iter = 64000");
            this.db.pragma("cipher_hmac_algorithm = HMAC_SHA512");
            this.db.pragma("cipher_kdf_algorithm = PBKDF2_HMAC_SHA512");
            // Try a simple query to verify the database is accessible
            this.db.prepare("SELECT 1").get();
            // Get self contact info
            this.loadSelfContact();
            return this.db;
        }
        catch (error) {
            throw new Error(`Failed to open Signal database: ${error instanceof Error ? error.message : String(error)}. ` +
                `Make sure Signal Desktop is closed before accessing.`);
        }
    }
    loadSelfContact() {
        if (!this.db)
            return;
        try {
            const result = this.db
                .prepare("SELECT json FROM items WHERE id = 'uuid_id'")
                .get();
            if (result) {
                const data = JSON.parse(result.json);
                this.selfServiceId = data.value || null;
            }
        }
        catch {
            // Self contact info may not be available
        }
    }
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    listChats(options = {}) {
        const db = this.open();
        const { includeEmpty = false } = options;
        // Get all conversations
        const conversations = db
            .prepare(`
        SELECT
          id,
          serviceId,
          name,
          profileName,
          e164 as number,
          type,
          json
        FROM conversations
        WHERE type IN ('private', 'group')
      `)
            .all();
        const chatInfos = [];
        for (const conv of conversations) {
            // Count messages for this conversation
            const countResult = db
                .prepare("SELECT COUNT(*) as count FROM messages WHERE conversationId = ?")
                .get(conv.id);
            const messageCount = countResult.count;
            if (!includeEmpty && messageCount === 0) {
                continue;
            }
            // Parse additional info from JSON if available
            let displayName = conv.name || conv.profileName;
            if (!displayName && conv.json) {
                try {
                    const jsonData = JSON.parse(conv.json);
                    displayName = jsonData.name || jsonData.profileName || jsonData.groupName;
                }
                catch {
                    // Ignore JSON parse errors
                }
            }
            chatInfos.push({
                id: conv.id,
                serviceId: conv.serviceId || conv.id,
                name: displayName || null,
                number: conv.number,
                profileName: conv.profileName,
                type: conv.type,
                totalMessages: messageCount,
            });
        }
        // Filter by chat IDs if specified
        if (options.chats) {
            const chatIds = options.chats.split(",").map((c) => c.trim());
            return chatInfos.filter((c) => chatIds.includes(c.id) || chatIds.includes(c.serviceId));
        }
        return chatInfos;
    }
    getChatMessages(chatName, options = {}) {
        const db = this.open();
        const { limit, offset = 0 } = options;
        // Find the conversation by name
        const conversation = db
            .prepare(`
        SELECT id, name, profileName, e164, json
        FROM conversations
        WHERE name = ? OR profileName = ?
        LIMIT 1
      `)
            .get(chatName, chatName);
        if (!conversation) {
            return [];
        }
        // Get contact name for display
        let contactName = conversation.name || conversation.profileName;
        if (!contactName && conversation.json) {
            try {
                const jsonData = JSON.parse(conversation.json);
                contactName = jsonData.name || jsonData.profileName || jsonData.groupName;
            }
            catch {
                // Ignore
            }
        }
        // Build query for messages
        let query = `
      SELECT
        id,
        conversationId,
        timestamp,
        sent_at as sentAt,
        source,
        sourceServiceId,
        body,
        json,
        hasAttachments,
        type
      FROM messages
      WHERE conversationId = ?
      ORDER BY timestamp DESC
    `;
        if (limit) {
            query += ` LIMIT ${limit} OFFSET ${offset}`;
        }
        else if (offset > 0) {
            query += ` LIMIT -1 OFFSET ${offset}`;
        }
        const messages = db.prepare(query).all(conversation.id);
        return messages.map((msg) => this.formatMessage(msg, contactName || "Unknown"));
    }
    searchChat(chatName, query, options = {}) {
        const db = this.open();
        const { limit } = options;
        // Find the conversation by name
        const conversation = db
            .prepare(`
        SELECT id, name, profileName, e164, json
        FROM conversations
        WHERE name = ? OR profileName = ?
        LIMIT 1
      `)
            .get(chatName, chatName);
        if (!conversation) {
            return [];
        }
        // Get contact name for display
        let contactName = conversation.name || conversation.profileName;
        if (!contactName && conversation.json) {
            try {
                const jsonData = JSON.parse(conversation.json);
                contactName = jsonData.name || jsonData.profileName || jsonData.groupName;
            }
            catch {
                // Ignore
            }
        }
        // Search messages with LIKE (case-insensitive in SQLite by default for ASCII)
        let searchQuery = `
      SELECT
        id,
        conversationId,
        timestamp,
        sent_at as sentAt,
        source,
        sourceServiceId,
        body,
        json,
        hasAttachments,
        type
      FROM messages
      WHERE conversationId = ?
        AND body LIKE ?
      ORDER BY timestamp DESC
    `;
        if (limit) {
            searchQuery += ` LIMIT ${limit}`;
        }
        const messages = db
            .prepare(searchQuery)
            .all(conversation.id, `%${query}%`);
        return messages.map((msg) => this.formatMessage(msg, contactName || "Unknown"));
    }
    formatMessage(msg, contactName) {
        // Determine timestamp
        const ts = msg.sentAt || msg.timestamp;
        const date = ts ? new Date(ts).toISOString() : "";
        // Determine sender
        const isFromSelf = msg.sourceServiceId === this.selfServiceId ||
            msg.type === "outgoing";
        const sender = isFromSelf ? "Me" : contactName;
        // Parse json
        let jsonLoaded = {};
        if (msg.json) {
            try {
                jsonLoaded = JSON.parse(msg.json);
            }
            catch {
                // Ignore parse errors
            }
        }
        // Parse reactions
        let reactions = [];
        if (jsonLoaded.reactions) {
            reactions = jsonLoaded.reactions;
        }
        // Parse quote
        let quote = "";
        if (jsonLoaded.quote) {
            quote = jsonLoaded.quote.text || "";
        }
        // Parse sticker
        let sticker = "";
        if (jsonLoaded.sticker) {
            sticker = jsonLoaded.sticker.emoji || jsonLoaded.sticker.packId || "";
        }
        return {
            date,
            sender,
            body: msg.body || "",
            quote,
            sticker,
            reactions,
            attachments: msg.hasAttachments ? "yes" : "",
        };
    }
}
//# sourceMappingURL=signal-db.js.map