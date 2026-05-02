import {
  Component,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { form, required, minLength, submit, FormField } from '@angular/forms/signals';
import { PromptService } from './prompt.service';

@Component({
  selector: 'app-prompt-playground',
  standalone: true,
  imports: [CommonModule, FormField],
  templateUrl: './prompt-playground.html',
  styleUrl: './prompt-playground.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptPlayground {
  private readonly promptService = inject(PromptService);

  icons = { terminal: '💻', save: '💾', check: '✅', warning: '⚠️' };

  // ─── Prompt List ─────────────────────────────────────────────────────────────

  readonly prompts = this.promptService.prompts;
  readonly isLoading = this.promptService.isLoading;
  readonly loadError = this.promptService.error;

  // ─── Selection & Editing ───────────────────────────────────────────────────

  selectedPromptName = signal<string | null>(null);
  
  draftModel = signal({
    content: '',
    description: ''
  });

  promptForm = form(this.draftModel, (s) => {
    required(s.content, { message: 'Prompt content is required' });
    minLength(s.content, 5, { message: 'Prompt content must be at least 5 characters' });
  });
  
  // UI States
  isSaving = signal(false);
  saveSuccess = signal(false);
  saveError = signal<string | null>(null);

  selectedPrompt = computed(() => {
    const name = this.selectedPromptName();
    if (!name) return null;
    return this.prompts().find(p => p.name === name) || null;
  });

  selectPrompt(name: string): void {
    this.selectedPromptName.set(name);
    const prompt = this.prompts().find(p => p.name === name);
    if (prompt) {
      this.draftModel.set({
        content: prompt.content,
        description: prompt.description || ''
      });
    }
    this.saveSuccess.set(false);
    this.saveError.set(null);
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  onSubmit(): void {
    submit(this.promptForm, async () => {
      const name = this.selectedPromptName();
      if (!name) return;

      this.isSaving.set(true);
      this.saveSuccess.set(false);
      this.saveError.set(null);

      try {
        const { content, description } = this.draftModel();
        await this.promptService.updatePrompt(name, content, description);
        this.saveSuccess.set(true);
      } catch (err: any) {
        this.saveError.set(err.message || 'An unexpected error occurred while saving.');
      } finally {
        this.isSaving.set(false);
      }
    });
  }
}
