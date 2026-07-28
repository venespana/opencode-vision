import { readFileSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import stripJsonComments from 'strip-json-comments';
import { PluginConfigSchema, type PluginConfig } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// JSONC reader — strips comments then parses
// ─────────────────────────────────────────────────────────────────────────────
export function readJSONC(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const stripped = stripJsonComments(raw);
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep overlay — first-defined-wins per leaf (field-by-field)
// Recursively overlays source over target for nested objects.
// ─────────────────────────────────────────────────────────────────────────────
export function overlayDeep(
  layers: Array<Record<string, unknown> | null>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const existing = result[key];
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
          result[key] = overlayDeep([existing as Record<string, unknown>, value as Record<string, unknown>]);
        } else {
          result[key] = overlayDeep([value as Record<string, unknown>]);
        }
      } else {
        // First-defined-wins: only set if not already defined
        if (!(key in result)) {
          result[key] = value;
        }
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply schema defaults — fills in missing fields per PluginConfigSchema defaults
// ─────────────────────────────────────────────────────────────────────────────
export function applyDefaults(merged: Record<string, unknown>): PluginConfig {
  // Schema defaults handle all missing fields — merged values override them
  const cfg = PluginConfigSchema.parse(merged);
  return cfg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load config: 4-level precedence
//  1. inline options (passed directly)
//  2. project .opencode/opencode-vision.{jsonc,json}
//  3. user ~/.config/opencode/opencode-vision.{jsonc,json}
//  4. defaults (applied via applyDefaults)
// ─────────────────────────────────────────────────────────────────────────────
export function loadConfig(inlineOpts?: Partial<PluginConfig>): PluginConfig {
  const homeDir = process.env.HOME || os.homedir();
  const projectConfigPath = resolve('.opencode', 'opencode-vision');
  const userConfigPath = resolve(homeDir, '.config', 'opencode', 'opencode-vision');

  // Try jsonc first, then json — per spec plugin-config-002
  function tryReadConfig(basePath: string): Record<string, unknown> | null {
    const jsonc = `${basePath}.jsonc`;
    const json = `${basePath}.json`;
    // jsonc before json
    const jsoncData = readJSONC(jsonc);
    if (jsoncData) return jsoncData;
    return readJSONC(json);
  }

  const projectConfig = tryReadConfig(projectConfigPath);
  const userConfig = tryReadConfig(userConfigPath);

  const layers: Array<Record<string, unknown> | null> = [
    inlineOpts ?? null,
    projectConfig,
    userConfig,
    {}, // defaults layer — filled by applyDefaults
  ];

  const merged = overlayDeep(layers);
  return applyDefaults(merged);
}

