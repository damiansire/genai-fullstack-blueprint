import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { UseCase } from '../../core/UseCase.js';

interface ListModelsResponse {
  models: { modelId: string; available: boolean; registeredAt: string }[];
  total: number;
}

export class ListModelsUseCase extends UseCase<void, ListModelsResponse> {
  constructor(private readonly modelFactory: ModelFactory) {
    super();
  }

  protected async executeImpl(): Promise<ListModelsResponse> {
    const registeredModels = this.modelFactory.getRegisteredModels();
    
    const models = registeredModels.map(modelId => ({
      modelId,
      available: true,
      registeredAt: new Date().toISOString()
    }));

    return {
      models,
      total: models.length
    };
  }
}
