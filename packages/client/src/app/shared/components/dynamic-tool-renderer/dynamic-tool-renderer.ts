import { Component, input, effect, Type, computed, signal, inject, Injector } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';

@Component({
  selector: 'app-dynamic-tool-renderer',
  imports: [NgComponentOutlet],
  templateUrl: './dynamic-tool-renderer.html',
  styleUrl: './dynamic-tool-renderer.scss'
})
export class DynamicToolRenderer {
  toolCall = input<any>();
  
  isEngineResolving = signal<boolean>(false);
  resolvedComponentClass = signal<Type<any> | null>(null);

  constructor() {
    effect(() => {
      const call = this.toolCall();
      this.resolvedComponentClass.set(null);
      
      if (!call || !call.name) return;

      this.isEngineResolving.set(true);

      const loadComponent = async () => {
        try {
          if (call.name === 'render_chart') {
            const { ChartWidgetComponent } = await import('./chart-widget.component');
            this.resolvedComponentClass.set(ChartWidgetComponent);
          } else {
             // Fallback or other components
             this.resolvedComponentClass.set(null);
          }
        } catch (e) {
          console.error('Failed to load component dynamically', e);
        } finally {
          this.isEngineResolving.set(false);
        }
      };

      loadComponent();
    });
  }

  // Bindings dict is passed declaratively to ngComponentOutlet
  computedDataBindings = computed(() => {
    const call = this.toolCall();
    if (call?.name === 'render_chart') {
      return {
        data: call.args?.data || [50, 80, 20, 100],
        label: call.args?.label || 'AI Generated Data'
      };
    }
    return {};
  });
}
