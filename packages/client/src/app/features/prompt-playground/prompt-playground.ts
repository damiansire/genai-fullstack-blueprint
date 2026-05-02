import {
  Component,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_CONFIG } from '../../core/tokens/api-config';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface Prompt {
  name: string;
  content: string;
  description: string | null;
  updated_at: string;
}

@Component({
  selector: 'app-prompt-playground',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prompt-playground.html',
  styleUrl: './prompt-playground.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptPlayground {
  private readonly apiConfig = inject(API_CONFIG);

  icons = { terminal: '💻', save: '💾', check: '✅', warning: '⚠️' };

  // ─── Prompt List ─────────────────────────────────────────────────────────────

  promptsResource = httpResource<Prompt[]>(() => ({
    url: `${this.apiConfig.baseUrl}/admin/prompts`,
    method: 'GET'
  }));

  prompts = computed<Prompt[]>(() => this.promptsResource.value() ?? []);

  // ─── Selection & Editing ───────────────────────────────────────────────────

  selectedPromptName = signal<string | null>(null);
  
  // These hold the drafted state
  draftContent = signal<string>('');
  draftDescription = signal<string>('');
  
  // UI States
  isSaving = signal(false);
  saveSuccess = signal(false);

  selectedPrompt = computed(() => {
    const name = this.selectedPromptName();
    if (!name) return null;
    return this.prompts().find(p => p.name === name) || null;
  });

  selectPrompt(name: string): void {
    this.selectedPromptName.set(name);
    const prompt = this.prompts().find(p => p.name === name);
    if (prompt) {
      this.draftContent.set(prompt.content);
      this.draftDescription.set(prompt.description || '');
    }
    this.saveSuccess.set(false);
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async savePrompt(): Promise<void> {
    const name = this.selectedPromptName();
    if (!name) return;

    this.isSaving.set(true);
    this.saveSuccess.set(false);

    try {
      const response = await fetch(`${this.apiConfig.baseUrl}/admin/prompts/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: this.draftContent(),
          description: this.draftDescription()
        }),
      });

      if (!response.ok) throw new Error('Failed to save prompt');
      
      // Reload the resource
      this.promptsResource.reload();
      this.saveSuccess.set(true);
      
      // Hide success message after 3 seconds
      setTimeout(() => this.saveSuccess.set(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      this.isSaving.set(false);
    }
  }

  readonly isLoading = computed(() => this.promptsResource.isLoading());
}
