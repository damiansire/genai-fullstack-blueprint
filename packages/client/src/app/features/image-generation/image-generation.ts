import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { form, FormField, submit, required, minLength, maxLength } from '@angular/forms/signals';
import { httpResource } from '@angular/common/http';
import { ModelInvocationResponse } from '../../core/services/api';
import { API_CONFIG } from '../../core/tokens/api-config';
import { ModelResponse } from '../../shared/components/model-response/model-response';
import { FileUpload } from '../../shared/components/file-upload/file-upload';

@Component({
  selector: 'app-image-generation',
  imports: [
    FormField,
    ModelResponse,
    FileUpload
  ],
  templateUrl: './image-generation.html',
  styleUrl: './image-generation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImageGeneration {
  private readonly apiConfig = inject(API_CONFIG);

  selectedFiles = signal<File[]>([]);
  fileError = signal<string | null>(null);
  generationMode = signal<'text-to-image' | 'image-editing'>('text-to-image');

  requestParams = signal<{
    prompt: string;
    aspectRatio: string;
    responseModalities: string[];
    inputImages?: Array<{ data: string; mimeType: string }>;
  } | undefined>(undefined);

  imageGenResource = httpResource<ModelInvocationResponse>(() => {
    const params = this.requestParams();
    if (!params) {
      return undefined;
    }

    return {
      url: `${this.apiConfig.baseUrl}/models/gemini-image-gen/invoke`,
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/json'
      }
    };
  });

  imageGenModel = signal({
    prompt: '',
    aspectRatio: '1:1'
  });

  private readonly responseModalities = ['Image', 'Text'];

  imageGenForm = form(this.imageGenModel, (s) => {
    required(s.prompt, { message: 'Prompt is required' });
    minLength(s.prompt, 10, { message: 'Prompt must be at least 10 characters' });
    maxLength(s.prompt, 8192, { message: 'Prompt must not exceed 8192 characters' });
    required(s.aspectRatio, { message: 'Aspect Ratio is required' });
  });

  aspectRatios = [
    { value: '1:1', label: 'Square (1:1)', resolution: '1024×1024' },
    { value: '2:3', label: 'Portrait (2:3)', resolution: '832×1248' },
    { value: '3:2', label: 'Landscape (3:2)', resolution: '1248×832' },
    { value: '16:9', label: 'Widescreen (16:9)', resolution: '1344×768' },
    { value: '9:16', label: 'Mobile (9:16)', resolution: '768×1344' },
    { value: '4:3', label: 'Classic (4:3)', resolution: '1184×864' },
    { value: '21:9', label: 'Ultrawide (21:9)', resolution: '1536×672' }
  ];

  examples = [
    {
      category: 'Photorealistic',
      prompt: 'A photorealistic close-up portrait of an elderly Japanese ceramicist with deep wrinkles and a warm smile, inspecting a freshly glazed tea bowl in his rustic workshop. Soft golden hour light streaming through a window, 85mm portrait lens with bokeh.'
    },
    {
      category: 'Illustration',
      prompt: 'A kawaii-style sticker of a happy red panda wearing a tiny bamboo hat, munching on a green bamboo leaf. Bold clean outlines, cel-shading, vibrant colors. White background.'
    },
    {
      category: 'Product',
      prompt: 'A high-resolution studio-lit photograph of a minimalist ceramic coffee mug in matte black on polished concrete. Three-point softbox lighting, 45-degree angle, ultra-realistic with steam rising.'
    },
    {
      category: 'Logo',
      prompt: 'Create a modern minimalist logo for a coffee shop called "The Daily Grind". Clean bold sans-serif font with a stylized coffee bean icon. Black and white color scheme.'
    },
    {
      category: 'Comic',
      prompt: 'A gritty noir comic panel with high-contrast black and white. Detective in trench coat under flickering streetlamp in rain. Neon bar sign reflecting in puddle. Caption box: "The city keeps no secrets."'
    }
  ];

  onFileSelected(file: File): void {
    this.selectedFiles.update(files => [...files, file]);
    this.fileError.set(null);
    this.generationMode.set('image-editing');
  }

  onFileCleared(): void {
    this.selectedFiles.set([]);
    this.fileError.set(null);
    this.generationMode.set('text-to-image');
  }

  onFileError(errorMessage: string): void {
    this.fileError.set(errorMessage);
  }

  onSubmit(): void {
    submit(this.imageGenForm, async () => {
      const model = this.imageGenModel();
      const inputImages = await this.convertFilesToBase64(this.selectedFiles());

      this.requestParams.set({
        prompt: model.prompt,
        aspectRatio: model.aspectRatio,
        responseModalities: this.responseModalities,
        inputImages: inputImages.length > 0 ? inputImages : undefined
      });
    });
  }

  private async convertFilesToBase64(files: File[]): Promise<Array<{ data: string; mimeType: string }>> {
    const promises = files.map(async (file) => {
      const base64 = await this.fileToBase64(file);
      return {
        data: base64.split(',')[1],
        mimeType: file.type
      };
    });

    return Promise.all(promises);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  resetForm(): void {
    this.imageGenModel.set({
      prompt: '',
      aspectRatio: '1:1'
    });
    this.selectedFiles.set([]);
    this.fileError.set(null);
    this.requestParams.set(undefined);
    this.generationMode.set('text-to-image');
  }

  setExamplePrompt(example: string): void {
    this.imageGenModel.update(m => ({ ...m, prompt: example }));
  }
}
