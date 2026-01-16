#!/usr/bin/env node

/**
 * Build script for creating an MCPB (MCP Bundle) package.
 *
 * This script:
 * 1. Compiles TypeScript to JavaScript
 * 2. Creates a clean bundle directory structure
 * 3. Copies server files and production dependencies
 * 4. Creates the .mcpb zip archive
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { createGzip } from 'zlib';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const BUILD_DIR = join(ROOT_DIR, 'bundle-build');
const DIST_DIR = join(ROOT_DIR, 'dist');

function log(message) {
  console.log(`[build] ${message}`);
}

function error(message) {
  console.error(`[build] ERROR: ${message}`);
  process.exit(1);
}

function execCommand(command, options = {}) {
  log(`Running: ${command}`);
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      ...options
    });
  } catch (e) {
    error(`Command failed: ${command}`);
  }
}

function cleanDirectory(dir) {
  if (existsSync(dir)) {
    log(`Cleaning ${dir}`);
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

function copyDirectory(src, dest, filter = () => true) {
  if (!existsSync(src)) {
    log(`Source directory does not exist: ${src}`);
    return;
  }

  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (!filter(srcPath, entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, filter);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

// Simple zip implementation using Node.js built-in modules
async function createZip(sourceDir, outputFile) {
  const archiver = await import('archiver').catch(() => null);

  if (archiver) {
    // Use archiver if available
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputFile);
      const archive = archiver.default('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        log(`Bundle created: ${outputFile} (${archive.pointer()} bytes)`);
        resolve();
      });

      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  } else {
    // Fallback to system zip command
    log('archiver not found, using system zip command');
    const outputFileName = outputFile.split('/').pop();
    execCommand(`cd "${sourceDir}" && zip -r "${outputFile}" .`, { stdio: 'pipe' });
    log(`Bundle created: ${outputFile}`);
  }
}

async function main() {
  log('Starting MCPB bundle build...');

  // Step 1: Compile TypeScript
  log('Step 1: Compiling TypeScript...');
  execCommand('npm run build');

  // Step 2: Clean and create bundle directory
  log('Step 2: Creating bundle directory structure...');
  cleanDirectory(BUILD_DIR);
  mkdirSync(join(BUILD_DIR, 'server'), { recursive: true });

  // Step 3: Copy manifest.json to root of bundle
  log('Step 3: Copying manifest.json...');
  cpSync(join(ROOT_DIR, 'manifest.json'), join(BUILD_DIR, 'manifest.json'));

  // Step 4: Copy compiled server files
  log('Step 4: Copying server files...');
  cpSync(join(DIST_DIR, 'index.js'), join(BUILD_DIR, 'server', 'index.js'));
  cpSync(join(DIST_DIR, 'signal-db.js'), join(BUILD_DIR, 'server', 'signal-db.js'));

  // Copy declaration files if they exist (useful for debugging)
  if (existsSync(join(DIST_DIR, 'index.d.ts'))) {
    cpSync(join(DIST_DIR, 'index.d.ts'), join(BUILD_DIR, 'server', 'index.d.ts'));
  }
  if (existsSync(join(DIST_DIR, 'signal-db.d.ts'))) {
    cpSync(join(DIST_DIR, 'signal-db.d.ts'), join(BUILD_DIR, 'server', 'signal-db.d.ts'));
  }

  // Step 5: Install production dependencies in bundle
  log('Step 5: Installing production dependencies...');

  // Create a minimal package.json for the bundle
  const bundlePackageJson = {
    name: 'signal-desktop-mcp-bundle',
    version: '0.1.0',
    type: 'module',
    dependencies: {
      '@modelcontextprotocol/sdk': '^1.0.0',
      '@signalapp/better-sqlite3': '^9.0.13'
    }
  };

  writeFileSync(
    join(BUILD_DIR, 'package.json'),
    JSON.stringify(bundlePackageJson, null, 2)
  );

  // Install dependencies in build directory
  execCommand('npm install --production --omit=dev', { cwd: BUILD_DIR });

  // Step 6: Create .mcpb bundle (zip file)
  log('Step 6: Creating .mcpb bundle...');
  const manifest = JSON.parse(readFileSync(join(ROOT_DIR, 'manifest.json'), 'utf-8'));
  const bundleName = `${manifest.name}-${manifest.version}.mcpb`;
  const bundlePath = join(ROOT_DIR, bundleName);

  // Remove old bundle if exists
  if (existsSync(bundlePath)) {
    rmSync(bundlePath);
  }

  await createZip(BUILD_DIR, bundlePath);

  // Step 7: Verify bundle
  log('Step 7: Verifying bundle...');
  if (!existsSync(bundlePath)) {
    error('Bundle file was not created');
  }

  const stats = statSync(bundlePath);
  log(`Bundle size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  log('');
  log('Build complete!');
  log(`Bundle: ${bundlePath}`);
  log('');
  log('To install in Claude Desktop:');
  log('  1. Open Claude Desktop');
  log(`  2. Double-click ${bundleName}`);
  log('  3. Or drag and drop the file into Claude Desktop');
}

main().catch(e => {
  error(e.message);
});
