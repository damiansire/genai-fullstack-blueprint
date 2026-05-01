import { InvokeModelUseCase } from '../src/application/useCases/invoke-model.usecase.js';
import { ModelFactory } from '../src/infrastructure/ai/factory.js';
import { SchemaRegistry } from '../src/infrastructure/ai/registry.js';
import { Strategy } from '../src/domain/ai/strategy.interface.js';

class MockAgenticStrategy implements Strategy {
  private callCount = 0;

  async process(data: any, context: any) {
    this.callCount++;
    
    // Simulate first response asking for a tool
    if (this.callCount === 1) {
      console.log('🤖 AI: "I need to calculate the Fibonacci of 10"');
      return {
        tool_calls: [{
          id: 'call_123',
          name: 'calculate_fibonacci',
          args: { n: 10 }
        }]
      };
    }
    
    // Simulate second response asking for a chart
    if (this.callCount === 2) {
      console.log('🤖 AI: "Thanks for the result. Now I will generate a chart."');
      console.log('📥 Received Tool Context:', JSON.stringify(data.messages[1].results));
      return {
        tool_calls: [{
          id: 'call_456',
          name: 'render_chart',
          args: { label: 'Fibonacci Growth', data: [1, 1, 2, 3, 5, 8, 13] }
        }]
      };
    }

    // Final text response
    if (this.callCount === 3) {
      console.log('🤖 AI: "Here is your chart and final response."');
      return {
        text: 'The calculation and chart are complete.',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      };
    }
  }

  isSupported() { return true; }
  getName() { return 'MockAgent'; }
}

async function run() {
  console.log('🚀 Starting Native Agentic Loop Test...');
  
  const registry = new SchemaRegistry();
  const factory = new ModelFactory();
  factory.register('agent-model', () => new MockAgenticStrategy());

  const useCase = new InvokeModelUseCase(factory);

  try {
    const result = await useCase.execute({
      modelId: 'agent-model',
      body: { prompt: 'Do some agentic work' },
      context: { traceId: 'test-trace' }
    });

    console.log('\\n✅ Final Output from UseCase:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

run();
