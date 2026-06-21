import { Component, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_CONFIG } from '../../core/tokens/api-config';
import { AiStreamService } from '../../core/services/ai-stream.service';
import { ModelResponse } from '../../shared/components/model-response/model-response';
import { ChatSidebar } from '../../shared/components/chat-sidebar/chat-sidebar';

@Component({
  selector: 'app-document-chat',
  imports: [CommonModule, FormsModule, ModelResponse, ChatSidebar],
  templateUrl: './document-chat.html',
  styleUrl: './document-chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentChat {
  private readonly apiConfig = inject(API_CONFIG);
  readonly aiStream = inject(AiStreamService);

  icons = { doc: '📄', upload: '📤', send: '🚀', spark: '✨' };

  // UI State
  activeSessionId = signal<string | null>(null);
  selectedDocument = signal<File | null>(null);
  isUploading = signal(false);
  
  // Chat State
  prompt = signal('');

  // Example document viewer text
  documentContent = signal<string>(
    'En un ecosistema B2B, la arquitectura multi-tenant asegura que los datos de la Empresa A jamás sean visibles para la Empresa B. ' +
    'El RAG (Retrieval-Augmented Generation) es clave para reducir alucinaciones, inyectando contexto verificado extraído de manuales internos.'
  );

  loadSession(id: string): void {
    this.activeSessionId.set(id);
    this.aiStream.resetStream();
  }

  resetForm(): void {
    this.activeSessionId.set(null);
    this.selectedDocument.set(null);
    this.prompt.set('');
    this.aiStream.resetStream();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedDocument.set(input.files[0]!);
    }
  }

  async uploadDocument(): Promise<void> {
    const doc = this.selectedDocument();
    if (!doc) return;

    this.isUploading.set(true);
    try {
      // Fake upload delay
      await new Promise(r => setTimeout(r, 1000));
      // In a real app we would POST to /api/domain/rag/ingest here.
    } finally {
      this.isUploading.set(false);
    }
  }

  onSubmit(): void {
    if (!this.prompt().trim()) return;

    // Simulate sending a RAG augmented prompt
    this.aiStream.startStream('google-text-bison', {
      prompt: `Usando el documento subido como contexto:\n\n${this.prompt()}`,
      maxTokens: 512,
      stream: true,
    });
    
    this.prompt.set('');
  }

  // Response computed from stream
  readonly activeResponse = computed(() => this.aiStream.streamAsResponse() ?? null);
  readonly isLoading = computed(() => this.aiStream.isStreaming());
  readonly activeError = computed(() => this.aiStream.streamError());
}
