import { Component, input, output, viewChild, ElementRef, ChangeDetectionStrategy, computed, signal } from '@angular/core';

@Component({
  selector: 'app-file-upload',
  imports: [],
  templateUrl: './file-upload.html',
  styleUrl: './file-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FileUpload {
  accept = input('image/*');
  maxSizeMB = input(10);
  allowedTypes = input<string[]>(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);
  selectedFile = input<File | null>(null);
  
  fileSelected = output<File>();
  fileCleared = output<void>();
  error = output<string>();
  
  fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  // Internal state for INP optimization (immediate visual feedback)
  isProcessing = signal(false);

  // Computed signals
  fileSize = computed(() => {
    const file = this.selectedFile();
    if (!file) return '0 Bytes';
    
    const bytes = file.size;
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  });

  fileTypeIcon = computed(() => {
    const file = this.selectedFile();
    if (!file) return '📄';
    
    if (file.type.startsWith('image/')) {
      return '🖼️';
    }
    return '📄';
  });

  allowedTypesString = computed(() => {
    return this.allowedTypes()
      .map(type => type.split('/')[1])
      .join(', ')
      .toUpperCase();
  });

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      
      // INP Optimization: Immediate visual feedback before blocking work
      this.isProcessing.set(true);

      // INP Optimization: Yield to main thread.
      // This allows the browser to paint the visual feedback before the parent component 
      // blocks the main thread with heavy synchronous processing.
      await new Promise(resolve => setTimeout(resolve, 0));

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

        this.fileSelected.emit(file);
      } finally {
        this.isProcessing.set(false);
        // Reset input value so the same file can be selected again
        if (input) {
          input.value = '';
        }
      }
    }
  }

  async clearFile(): Promise<void> {
    // INP Optimization: Immediate visual feedback for the click interaction
    this.isProcessing.set(true);
    
    // Yield to main thread to ensure button click visual state is painted
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const inputEl = this.fileInput();
      if (inputEl) {
        inputEl.nativeElement.value = '';
      }
      this.fileCleared.emit();
    } finally {
      this.isProcessing.set(false);
    }
  }
}

