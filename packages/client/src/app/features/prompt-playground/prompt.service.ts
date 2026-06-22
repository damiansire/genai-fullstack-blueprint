import { Injectable, inject, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_CONFIG } from '../../core/tokens/api-config';
import { z } from 'zod';

export const promptSchema = z.object({
  name: z.string(),
  content: z.string(),
  description: z.string().nullable(),
  updated_at: z.string(),
});

export const promptsArraySchema = z.array(promptSchema);
export type Prompt = z.infer<typeof promptSchema>;

@Injectable({ providedIn: 'root' })
export class PromptService {
  private readonly apiConfig = inject(API_CONFIG);

  private readonly _promptsResource = httpResource<unknown>(() => ({
    url: `${this.apiConfig.baseUrl}/admin/prompts`,
    method: 'GET',
  }));

  // AI-First Rule 3: Strict Validation at the boundary using Zod
  readonly prompts = computed<Prompt[]>(() => {
    const rawData = this._promptsResource.value();
    if (!rawData) return [];

    const parsed = promptsArraySchema.safeParse(rawData);
    if (!parsed.success) {
      console.error('API Error: Prompts payload schema mismatch', parsed.error);
      return [];
    }
    return parsed.data;
  });

  readonly isLoading = computed(() => this._promptsResource.isLoading());
  readonly error = computed(() => this._promptsResource.error());

  async updatePrompt(name: string, content: string, description: string): Promise<void> {
    const response = await fetch(`${this.apiConfig.baseUrl}/admin/prompts/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, description }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save prompt: ${response.statusText}`);
    }

    // AI-First Rule 4: Reactive refresh
    this._promptsResource.reload();
  }
}
