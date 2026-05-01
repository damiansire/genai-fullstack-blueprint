import { Component, input, effect, ViewContainerRef, inject, Type } from '@angular/core';
import { ChartWidgetComponent } from './chart-widget.component';

@Component({
  selector: 'app-dynamic-tool-renderer',
  standalone: true,
  template: `<!-- Container for dynamic injection -->`
})
export class DynamicToolRenderer {
  toolCall = input<any>();
  private vcr = inject(ViewContainerRef);

  constructor() {
    effect(() => {
      const call = this.toolCall();
      this.vcr.clear(); // Clear previous
      
      if (!call || !call.name) return;

      // Map tool names to components
      let componentType: Type<any> | null = null;
      let inputs: Record<string, any> = {};

      if (call.name === 'render_chart') {
        componentType = ChartWidgetComponent;
        inputs = { 
          data: call.args?.data || [50, 80, 20, 100], 
          label: call.args?.label || 'AI Generated Data' 
        };
      }

      if (componentType) {
        const ref = this.vcr.createComponent(componentType);
        Object.keys(inputs).forEach(key => {
          ref.setInput(key, inputs[key]);
        });
      }
    });
  }
}
