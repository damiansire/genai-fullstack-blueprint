import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { ProcessContext } from '../../domain/ai/strategy.interface.js';
import { ApiError } from '../../core/ApiError.js';

export interface InvokeModelDTO {
  modelId: string;
  body: Record<string, any>;
  file?: {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
    path?: string;
  };
  files?: any;
  context: ProcessContext;
}

export class InvokeModelUseCase {
  constructor(private readonly modelFactory: ModelFactory) {}

  public async execute(dto: InvokeModelDTO): Promise<any> {
    if (!dto.modelId) {
      throw ApiError.badRequest('Model ID is required');
    }

    if (!this.modelFactory.isRegistered(dto.modelId)) {
      throw ApiError.notFound(`Model '${dto.modelId}' is not available`);
    }

    const strategy = this.modelFactory.create(dto.modelId);

    const requestData: any = {
      ...dto.body,
    };

    if (dto.file) {
      requestData.file = dto.file;
    }

    if (dto.files) {
      requestData.files = dto.files;
    }

    // Process using the underlying strategy
    return await strategy.process(requestData, dto.context);
  }
}
