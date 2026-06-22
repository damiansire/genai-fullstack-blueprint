import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { ApiError } from '../../core/ApiError.js';

export interface GetModelInfoDTO {
  modelId: string;
}

import { UseCase } from '../../core/UseCase.js';

export class GetModelInfoUseCase extends UseCase<
  GetModelInfoDTO,
  { modelId: string; available: boolean; registeredAt: string }
> {
  constructor(private readonly modelFactory: ModelFactory) {
    super();
  }

  protected async executeImpl(
    dto: GetModelInfoDTO,
  ): Promise<{ modelId: string; available: boolean; registeredAt: string }> {
    if (!dto.modelId) {
      throw ApiError.badRequest('Model ID is required');
    }

    if (!this.modelFactory.isRegistered(dto.modelId)) {
      throw ApiError.notFound(`Model '${dto.modelId}' is not available`);
    }

    // In a full implementation, you could fetch real metadata from the registry/strategy
    return {
      modelId: dto.modelId,
      available: true,
      registeredAt: new Date().toISOString(),
    };
  }
}
