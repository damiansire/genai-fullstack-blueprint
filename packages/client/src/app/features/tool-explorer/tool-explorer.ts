/**
 * ToolExplorer — Patrón 6: Signal Forms Dinámicos (Feature page)
 *
 * Full end-to-end demonstration of the Signal Forms pattern:
 *   1. Fetches all registered tools from GET /api/tools/search?query=
 *   2. User selects a tool → toolName signal updates
 *   3. <app-dynamic-tool-form> reacts: fetches schema, generates Signal form
 *   4. On submit: executes the tool via POST /api/models (or /api/tools/search for search_tools)
 *   5. Response rendered via <app-model-response> + AiStreamService
 */
import { Component, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_CONFIG } from '../../core/tokens/api-config';
import { AiStreamService } from '../../core/services/ai-stream.service';
import { DynamicToolFormComponent } from '../../shared/components/dynamic-tool-form/dynamic-tool-form';

interface ToolSummary {
  name: string;
  description: string;
  category: string;
}

interface ToolSearchResponse {
  count: number;
  tools: ToolSummary[];
}

@Component({
  selector: 'app-tool-explorer',
  imports: [DynamicToolFormComponent],
  templateUrl: './tool-explorer.html',
  styleUrl: './tool-explorer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolExplorer {
  private readonly apiConfig = inject(API_CONFIG);
  readonly aiStream = inject(AiStreamService);

  icons = { wrench: '🔧', search: '🔍', empty: '📭' };

  // ─── Tool List ─────────────────────────────────────────────────────────────

  searchQuery = signal('');

  toolListResource = httpResource<ToolSearchResponse>(() => ({
    url: `${this.apiConfig.baseUrl}/tools/search`,
    method: 'POST',
    body: { query: this.searchQuery() || '', limit: 20 },
    headers: { 'Content-Type': 'application/json' },
  }));

  tools = computed<ToolSummary[]>(() => this.toolListResource.value()?.tools ?? []);

  // Group tools by category for the sidebar
  groupedTools = computed<Map<string, ToolSummary[]>>(() => {
    const map = new Map<string, ToolSummary[]>();
    for (const tool of this.tools()) {
      const group = map.get(tool.category) ?? [];
      group.push(tool);
      map.set(tool.category, group);
    }
    return map;
  });

  groupedCategories = computed<string[]>(() => Array.from(this.groupedTools().keys()).sort());

  // ─── Selection ─────────────────────────────────────────────────────────────

  /** Currently selected tool name — drives <app-dynamic-tool-form>. */
  selectedTool = signal<string | null>(null);

  selectTool(name: string): void {
    this.selectedTool.set(name);
    // Reset any previous execution result
    this.aiStream.resetStream();
    this.executionResult.set(null);
    this.executionError.set(null);
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  executionResult = signal<Record<string, unknown> | null>(null);
  executionError = signal<string | null>(null);
  isExecuting = signal(false);

  async onToolSubmit(dto: Record<string, string | number | boolean>): Promise<void> {
    const tool = this.selectedTool();
    if (!tool) return;

    this.isExecuting.set(true);
    this.executionResult.set(null);
    this.executionError.set(null);

    try {
      const response = await fetch(`${this.apiConfig.baseUrl}/tools/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: dto['query'] ?? tool, limit: 5 }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.executionResult.set(data);
    } catch (err) {
      this.executionError.set(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      this.isExecuting.set(false);
    }
  }

  onToolCancel(): void {
    this.selectedTool.set(null);
    this.executionResult.set(null);
  }

  // ─── UI helpers ────────────────────────────────────────────────────────────

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  readonly hasResults = computed(() => this.tools().length > 0);
  readonly isToolListLoading = computed(() => this.toolListResource.isLoading());

  readonly shouldShowResult = computed(
    () => this.executionResult() !== null || this.executionError() !== null || this.isExecuting(),
  );

  trackByName(_: number, tool: ToolSummary): string {
    return tool.name;
  }

  trackByCategory(_: number, category: string): string {
    return category;
  }

  /** Formats the execution result as indented JSON for display. */
  resultJson = computed(() => {
    const r = this.executionResult();
    return r ? JSON.stringify(r, null, 2) : '';
  });
}
