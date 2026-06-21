/**
 * MCP Handlers — Patrón 2: Servidor Nativo MCP
 *
 * Implements the full set of MCP method handlers:
 *   - initialize         → handshake + capabilities negotiation
 *   - tools/list         → lists tools from the SQLite Tool Registry (Patrón 1)
 *   - tools/call         → executes a tool via the Worker Pool (existing infra)
 *   - resources/list     → exposes SQLite data, request logs, registered models
 *   - resources/read     → reads a specific resource by URI
 *   - prompts/list       → lists available system prompt templates
 *   - prompts/get        → returns a specific prompt template
 *
 * No MCP SDK, no external transport libraries. Pure Node.js.
 */

import { modelFactory } from '../ai/factory.js';
import { dbService } from '../database/db.js';
import { CPUWorkerService } from '../workers/workerPool.js';
import { getContext } from '../../core/async-context.js';
import { logger } from '../../core/logger.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeResult,
  McpToolsListResult,
  McpToolCallParams,
  McpToolCallResult,
  McpResourcesListResult,
  McpResourceReadResult,
  McpPromptsListResult,
  JsonRpcError,
} from './mcp.types.js';
import { JSON_RPC_ERRORS } from './mcp.types.js';

// MCP protocol version this server implements
const MCP_PROTOCOL_VERSION = '2024-11-05';

// ─── Response Builders ────────────────────────────────────────────────────────

function ok<T>(id: JsonRpcRequest['id'], result: T): JsonRpcResponse<T> {
  return { jsonrpc: '2.0', id, result };
}

function err(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcError = { code, message, ...(data !== undefined && { data }) };
  return { jsonrpc: '2.0', id, error };
}

// ─── Handler Map ──────────────────────────────────────────────────────────────

type Handler = (req: JsonRpcRequest) => Promise<JsonRpcResponse>;

const handlers: Record<string, Handler> = {

  // ─── initialize ─────────────────────────────────────────────────────────────
  // Called by every MCP client after establishing the transport connection.
  // Negotiates protocol version and declares server capabilities.
  async initialize(req) {
    const result: McpInitializeResult = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: 'GenAI-Scaffold Gateway',
        version: '1.0.0',
      },
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    };
    logger.info('[MCP] Client initialized', { traceId: getContext()?.traceId });
    return ok(req.id, result);
  },

  // ─── initialized (notification — no response required) ──────────────────────
  async 'notifications/initialized'(req) {
    logger.info('[MCP] Received initialized notification');
    // Notifications have no response per JSON-RPC spec — return null result
    return ok(req.id, null);
  },

  // ─── tools/list ─────────────────────────────────────────────────────────────
  // Returns all tools registered in the SQLite Tool Registry (Patrón 1).
  // MCP clients (Claude Desktop, Cursor, Zed) use this to discover capabilities.
  async 'tools/list'(req) {
    const registeredTools = dbService.searchTools('', 100); // empty query = all tools

    // Also expose the built-in "search_tools" meta-tool
    const metaTool = {
      name: 'search_tools',
      description:
        'Searches the tool registry for relevant tool schemas. ' +
        'Use this before calling any domain tool to retrieve its exact JSON schema JIT, ' +
        'avoiding System Prompt saturation and protecting the prompt cache.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Keyword to search for in tool names and descriptions' },
          limit: { type: 'number', description: 'Maximum number of results (default: 5, max: 20)' },
        },
        required: ['query'],
      },
    };

    const tools = [
      metaTool,
      ...registeredTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object' as const,
          properties: (t.schema as any)['properties'] ?? {},
          ...((t.schema as any)['required'] ? { required: (t.schema as any)['required'] } : {}),
        },
      })),
    ];

    const result: McpToolsListResult = { tools };
    return ok(req.id, result);
  },

  // ─── tools/call ─────────────────────────────────────────────────────────────
  // Executes a tool call. Routes to the Worker Pool for CPU-intensive tools
  // (existing infrastructure) or to the JIT search handler for `search_tools`.
  async 'tools/call'(req) {
    const params = req.params as unknown as McpToolCallParams | undefined;

    if (!params?.name) {
      return err(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, 'params.name is required');
    }

    logger.info(`[MCP] tools/call: ${params.name}`, {
      traceId: getContext()?.traceId,
      args: params.arguments,
    });

    try {
      let resultData: unknown;

      if (params.name === 'search_tools') {
        // JIT Tool Search (Patrón 1) — read from SQLite
        const query = (params.arguments?.['query'] as string) ?? '';
        const limit = (params.arguments?.['limit'] as number) ?? 5;
        resultData = dbService.searchTools(query, limit);
      } else {
        // Delegate to the Worker Pool (existing infra from prior sessions)
        resultData = await CPUWorkerService.executeTool(
          params.name,
          params.arguments ?? {}
        );
      }

      const result: McpToolCallResult = {
        content: [
          {
            type: 'text',
            text: typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2),
          },
        ],
      };
      return ok(req.id, result);

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`[MCP] tools/call failed: ${params.name}`, { error: message });
      const result: McpToolCallResult = {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
      return ok(req.id, result); // MCP spec: tool errors go in result, not JSON-RPC error
    }
  },

  // ─── resources/list ─────────────────────────────────────────────────────────
  // Exposes internal Gateway data as MCP resources — readable by the LLM.
  async 'resources/list'(req) {
    const models = modelFactory.getRegisteredModels();

    const result: McpResourcesListResult = {
      resources: [
        {
          uri: 'gateway://models',
          name: 'Registered AI Models',
          description: `${models.length} model(s) currently registered in the Gateway`,
          mimeType: 'application/json',
        },
        {
          uri: 'gateway://logs/recent',
          name: 'Recent Request Logs',
          description: 'Last 50 HTTP request logs with trace IDs and durations',
          mimeType: 'application/json',
        },
        {
          uri: 'gateway://tools/registry',
          name: 'Tool Registry',
          description: 'All tools registered in the SQLite Tool Registry (Patrón 1)',
          mimeType: 'application/json',
        },
      ],
    };
    return ok(req.id, result);
  },

  // ─── resources/read ─────────────────────────────────────────────────────────
  // Returns the content of a specific resource by URI.
  async 'resources/read'(req) {
    const uri = (req.params?.['uri'] as string) ?? '';

    let content: unknown;
    const mimeType = 'application/json';

    switch (uri) {
      case 'gateway://models':
        content = {
          models: modelFactory.getRegisteredModels().map((id) => ({ modelId: id })),
          total: modelFactory.getRegisteredModels().length,
        };
        break;

      case 'gateway://logs/recent':
        content = { logs: dbService.getRecentLogs(50) };
        break;

      case 'gateway://tools/registry':
        content = { tools: dbService.searchTools('', 100) };
        break;

      default:
        return err(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown resource URI: ${uri}`);
    }

    const result: McpResourceReadResult = {
      contents: [
        {
          uri,
          mimeType,
          text: JSON.stringify(content, null, 2),
        },
      ],
    };
    return ok(req.id, result);
  },

  // ─── prompts/list ────────────────────────────────────────────────────────────
  // Exposes reusable prompt templates for AI interactions.
  async 'prompts/list'(req) {
    const result: McpPromptsListResult = {
      prompts: [
        {
          name: 'invoke_model',
          description: 'Invoke an AI model with a structured prompt',
          arguments: [
            { name: 'modelId', description: 'Target model ID', required: true },
            { name: 'prompt', description: 'User prompt text', required: true },
            { name: 'maxTokens', description: 'Maximum tokens to generate', required: false },
          ],
        },
        {
          name: 'analyze_logs',
          description: 'Analyze recent Gateway request logs for patterns or anomalies',
          arguments: [
            { name: 'limit', description: 'Number of recent logs to analyze (default: 50)', required: false },
          ],
        },
      ],
    };
    return ok(req.id, result);
  },

  // ─── prompts/get ─────────────────────────────────────────────────────────────
  async 'prompts/get'(req) {
    const name = (req.params?.['name'] as string) ?? '';

    const promptTemplates: Record<string, unknown> = {
      invoke_model: {
        description: 'Invoke an AI model with a structured prompt',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Please invoke model {{modelId}} with the following prompt: {{prompt}}. Use maxTokens={{maxTokens}}.',
            },
          },
        ],
      },
      analyze_logs: {
        description: 'Analyze recent Gateway request logs',
        messages: [
          {
            role: 'user',
            content: {
              type: 'resource',
              resource: { uri: 'gateway://logs/recent', mimeType: 'application/json' },
            },
          },
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Analyze the above logs. Identify slow requests (>1000ms), error patterns, and the most frequently accessed models.',
            },
          },
        ],
      },
    };

    if (!promptTemplates[name]) {
      return err(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown prompt: ${name}`);
    }

    return ok(req.id, promptTemplates[name]);
  },

  // ─── ping ────────────────────────────────────────────────────────────────────
  async ping(req) {
    return ok(req.id, {});
  },
};

// ─── Main Dispatcher ──────────────────────────────────────────────────────────

/**
 * Dispatches a parsed JSON-RPC request to the appropriate handler.
 * Returns a JsonRpcResponse ready to be serialized and sent back to the client.
 */
export async function handleMcpRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const handler = handlers[req.method];

  if (!handler) {
    // Per MCP spec, some notifications (like 'notifications/initialized') may
    // not require a response. We still return an error for unknown methods.
    logger.warn(`[MCP] Unknown method: ${req.method}`);
    return err(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
  }

  try {
    return await handler(req);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`[MCP] Handler error for method ${req.method}`, { error: message });
    return err(req.id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal server error', message);
  }
}
