// Stability: 2 - Stable (node:fs)
import { promises as fs } from 'node:fs';
// Stability: 2 - Stable (node:path)
import path from 'node:path';
// Stability: 2 - Stable (node:url)
import { fileURLToPath } from 'node:url';
// Stability: 2 - Stable (node:assert/strict)
import assert from 'node:assert/strict';
import { ModelFactory } from './factory.js';
import { SchemaRegistry } from './registry.js';
import { logger } from '../../core/logger.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Interface for plugin module exports
 * Each plugin must export these properties
 */
interface PluginModule {
  /** Unique identifier for the model strategy */
  modelId: string;
  /** JSON Schema for input validation */
  configSchema: any;
  /** Constructor function for the model strategy */
  ModelStrategy: new (...args: any[]) => any;
}

/**
 * Load all plugins from the plugins directory
 * @param factory - ModelFactory instance to register strategies
 * @param schemaRegistry - SchemaRegistry instance to register schemas
 * @returns Promise that resolves when all plugins are loaded
 */
export async function loadPlugins(
  factory: ModelFactory,
  schemaRegistry: SchemaRegistry
): Promise<void> {
  // In production (compiled), plugins are in dist/plugins relative to this file
  // In development, they're in src/plugins
  const pluginsDir = path.join(__dirname, '..', '..', 'plugins');
  
  try {
    // Check if plugins directory exists
    await fs.access(pluginsDir);
  } catch (error) {
    logger.warn(`Plugins directory not found: ${pluginsDir}. Skipping plugin loading.`);
    return;
  }

  try {
    // Read all subdirectories in the plugins folder
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    const pluginDirectories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    if (pluginDirectories.length === 0) {
      logger.info('No plugin directories found. Skipping plugin loading.');
      return;
    }

    logger.info(`Found ${pluginDirectories.length} plugin directories: ${pluginDirectories.join(', ')}`);

    // Load each plugin
    const loadPromises = pluginDirectories.map(async (pluginDir) => {
      try {
        await loadSinglePlugin(pluginDir, factory, schemaRegistry);
        logger.info(`✅ Successfully loaded plugin: ${pluginDir}`);
      } catch (error) {
        logger.error(`❌ Failed to load plugin '${pluginDir}'`, {}, error instanceof Error ? error : new Error(String(error)));
        // Continue loading other plugins even if one fails
      }
    });

    // Wait for all plugins to load (or fail)
    await Promise.allSettled(loadPromises);
    
    logger.info(`Plugin loading completed. Registered ${factory.getRegisteredModels().length} strategies and ${schemaRegistry.getRegisteredModels().length} schemas.`);
  } catch (error) {
    logger.error('Error reading plugins directory', {}, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Load a single plugin from a directory
 * @param pluginDir - Name of the plugin directory
 * @param factory - ModelFactory instance
 * @param schemaRegistry - SchemaRegistry instance
 */
async function loadSinglePlugin(
  pluginDir: string,
  factory: ModelFactory,
  schemaRegistry: SchemaRegistry
): Promise<void> {
  // Path relative to this compiled file
  const pluginPath = path.join(__dirname, '..', '..', 'plugins', pluginDir);
  
  // Try to import index.js (compiled) first, then index.ts (development)
  const possibleFiles = ['index.js', 'index.ts'];
  let modulePath: string | null = null;
  
  for (const filename of possibleFiles) {
    const fullPath = path.join(pluginPath, filename);
    try {
      await fs.access(fullPath);
      modulePath = fullPath;
      break;
    } catch {
      // File doesn't exist, try next one
      continue;
    }
  }

  if (!modulePath) {
    throw new Error(`No index.js or index.ts found in plugin directory: ${pluginDir}`);
  }

  // Dynamic import of the plugin module
  // Use file:// URL for dynamic imports
  const moduleUrl = new URL(`file://${modulePath}`);
  const pluginModule = await import(moduleUrl.href);
  
  // Validate plugin module structure
  validatePluginModule(pluginModule, pluginDir);
  
  const { modelId, configSchema, ModelStrategy } = pluginModule as PluginModule;
  
  // Register the strategy in the factory
  factory.register(modelId, () => new ModelStrategy());
  
  // Register the schema in the registry
  schemaRegistry.register(modelId, configSchema);
}

/**
 * Validate that a plugin module has the required exports
 * @param module - The imported module
 * @param pluginDir - Name of the plugin directory (for error messages)
 * @throws Error if module is invalid
 */
function validatePluginModule(module: any, pluginDir: string): void {
  const requiredExports = ['modelId', 'configSchema', 'ModelStrategy'];
  const missingExports = requiredExports.filter(exportName => !(exportName in module));
  
  assert.ok(
    missingExports.length === 0,
    `Plugin '${pluginDir}' is missing required exports: ${missingExports.join(', ')}. ` +
    `Required exports: modelId (string), configSchema (object), ModelStrategy (constructor function)`
  );

  // Additional type validation using strict equality and truthiness assertions
  assert.strictEqual(
    typeof module.modelId,
    'string',
    `Plugin '${pluginDir}': modelId must be a string, got ${typeof module.modelId}`
  );

  assert.ok(
    typeof module.configSchema === 'object' && module.configSchema !== null,
    `Plugin '${pluginDir}': configSchema must be an object, got ${typeof module.configSchema}`
  );

  assert.strictEqual(
    typeof module.ModelStrategy,
    'function',
    `Plugin '${pluginDir}': ModelStrategy must be a constructor function, got ${typeof module.ModelStrategy}`
  );
}
