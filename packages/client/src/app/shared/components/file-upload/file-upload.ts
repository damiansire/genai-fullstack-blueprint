import { Component, input, output, viewChild, ElementRef, ChangeDetectionStrategy, computed, signal, model, linkedSignal, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-file-upload',
  imports: [],
  templateUrl: './file-upload.html',
  styleUrl: './file-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FileUpload implements OnDestroy {
  accept = input('image/*');
  maxSizeMB = input(10);
  allowedTypes = input<string[]>(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);
  
  // Prediction 3: Signals Evolve -> Replacing separate input/outputs with a unified model()
  file = model<File | null>(null);
  
  error = output<string>();
  
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  // Internal state for INP optimization (immediate visual feedback)
  isProcessing = signal(false);
  isDragging = signal(false);

  private static nextId = 0;
  public readonly idSuffix = FileUpload.nextId++;
  public readonly inputId = `file-input-${this.idSuffix}`;
  public readonly labelId = `file-label-${this.idSuffix}`;



  ngOnDestroy(): void {
    const currentUrl = this.previewUrl();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
    }
  }

  // Computed signals
  fileSize = computed(() => {
    const file = this.file();
    if (!file) return '0 Bytes';
    
    const bytes = file.size;
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  });

  icons = {
    processing: '⏳',
    folder: '📁',
    document: '📄',
    image: '🖼️',
    close: '✕'
  };

  fileTypeIcon = computed(() => {
    const file = this.file();
    if (!file) return this.icons.document;
    
    if (file.type.startsWith('image/')) {
      return this.icons.image;
    }
    return this.icons.document;
  });

  allowedTypesString = computed(() => {
    return this.allowedTypes()
      .map(type => type.split('/')[1])
      .join(', ')
      .toUpperCase();
  });

  private async yieldToMain(): Promise<void> {
    // Modern INP optimization ceding control to main thread, with fallback to setTimeout
    if ('scheduler' in globalThis && 'yield' in (globalThis as any).scheduler) {
      return await (globalThis as any).scheduler.yield();
    }
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    
    if (input.files && input.files.length > 0) {
      await this.processFile(input.files[0], input);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isProcessing()) {
      this.isDragging.set(true);
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    
    if (this.isProcessing()) return;

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const inputEl = this.fileInput()?.nativeElement;
      await this.processFile(event.dataTransfer.files[0], inputEl);
    }
  }

  private async processFile(file: File, inputElement?: HTMLInputElement): Promise<void> {
    // INP Optimization: Immediate visual feedback before blocking work
    this.isProcessing.set(true);

    // INP Optimization: Yield to main thread.
    // This allows the browser to paint the visual feedback before the parent component 
    // blocks the main thread with heavy synchronous processing.
    await this.yieldToMain();

    try {
      // Validate file type
      if (!this.allowedTypes().includes(file.type)) {
        const allowedExtensions = this.allowedTypes().map(type => type.split('/')[1]).join(', ');
        this.error.emit(`Please select a valid file (${allowedExtensions.toUpperCase()})`);
        return;
      }

      // Validate file size
      const maxSize = this.maxSizeMB() * 1024 * 1024;
      if (file.size > maxSize) {
        this.error.emit(`File size must not exceed ${this.maxSizeMB()}MB`);
        return;
      }

      this.file.set(file);
    } finally {
      this.isProcessing.set(false);
      // Reset input value so the same file can be selected again
      if (inputElement) {
        inputElement.value = '';
      }
    }
  }

  // Prediction 3: Linked signals provide precision reactivity for derived values
  previewUrl = linkedSignal<File | null, string | null>({
    source: this.file,
    computation: (newFile, previous) => {
      // Clean up previous blob URL to prevent memory leaks
      if (previous?.value) {
        URL.revokeObjectURL(previous.value);
      }
      
      if (!newFile || !newFile.type.startsWith('image/')) {
        return null;
      }
      return URL.createObjectURL(newFile);
    }
  });

  async clearFile(): Promise<void> {
    // INP Optimization: Immediate visual feedback for the click interaction
    this.isProcessing.set(true);
    
    // Yield to main thread to ensure button click visual state is painted
    await this.yieldToMain();

    try {
      const inputEl = this.fileInput();
      if (inputEl) {
        inputEl.nativeElement.value = '';
      }
      this.file.set(null);
    } finally {
      this.isProcessing.set(false);
    }
  }
}

