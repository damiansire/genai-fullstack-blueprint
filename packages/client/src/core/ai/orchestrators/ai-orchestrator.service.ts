import { Injectable, signal, computed } from '@angular/core';
import { aiResponseSchema, AiResponse } from '../schemas/ai-response.schema';

declare global {
  interface Document {
    startViewTransition(updateCallback: () => Promise<void> | void): {
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
      finished: Promise<void>;
      skipTransition: () => void;
    };
  }
}

@Injectable({
  providedIn: 'root'
})
export class AiOrchestratorService {
  // Signals para manejar el estado de forma síncrona y reactiva (Angular v16+)
  private readonly _state = signal<{
    data: AiResponse | null;
    isLoading: boolean;
    error: string | null;
    requiresHumanApproval: boolean;
    pendingAction: unknown | null;
  }>({
    data: null,
    isLoading: false,
    error: null,
    requiresHumanApproval: false,
    pendingAction: null
  });

  // Signals computados expuestos públicamente a la vista
  public readonly response = computed(() => this._state().data);
  public readonly isLoading = computed(() => this._state().isLoading);
  public readonly error = computed(() => this._state().error);
  public readonly requiresHumanApproval = computed(() => this._state().requiresHumanApproval);

  /**
   * Stub del Tool Calling.
   * Recibe el payload en crudo del LLM. Aplica validación estricta Zod en la frontera
   * antes de pasarlo al Signal (state global), garantizando resiliencia.
   */
  public async handleAiIntent(rawPayload: unknown): Promise<void> {
    this._state.update(s => ({ ...s, isLoading: true, error: null }));

    try {
      // 1. Validación estricta - la frontera de confianza (usando parseAsync para asegurar asincronía)
      const parsedData = await aiResponseSchema.parseAsync(rawPayload);
      
      // 2. Transición de estado segura con View Transitions API (Nativo del Browser)
      const isAction = parsedData.intent === 'action';

      const updateState = () => {
        this._state.update(s => ({
          ...s,
          data: parsedData,
          isLoading: false,
          requiresHumanApproval: isAction,
          pendingAction: isAction ? parsedData.data : null
        }));
      };

      if ('startViewTransition' in document) {
        document.startViewTransition(() => updateState());
      } else {
        updateState();
      }
    } catch (err) {
      // 3. Graceful degradation ante alucinaciones o estructuras JSON corruptas
      console.error('[AiOrchestrator] Falló la validación estricta de Zod:', err);
      this._state.update(s => ({
        ...s,
        error: 'Error de validación en la frontera: El LLM devolvió un payload corrupto o inesperado.',
        isLoading: false
      }));
    }
  }

  /**
   * Patrón "Human in the Loop": Confirma o rechaza una acción propuesta por el LLM.
   */
  public resolvePendingAction(approved: boolean): void {
    if (approved) {
      console.log('[AiOrchestrator] Acción aprobada por el usuario:', this._state().pendingAction);
      // Aquí despacharíamos el verdadero Tool Call a otro servicio (ej. API remota)
    } else {
      console.warn('[AiOrchestrator] Acción rechazada por el usuario.');
    }
    
    this._state.update(s => ({
      ...s,
      requiresHumanApproval: false,
      pendingAction: null
    }));
  }

  public resetState(): void {
    const update = () => {
      this._state.set({ 
        data: null, 
        isLoading: false, 
        error: null,
        requiresHumanApproval: false,
        pendingAction: null
      });
    };

    if ('startViewTransition' in document) {
      document.startViewTransition(() => update());
    } else {
      update();
    }
  }

  /**
   * Streaming UI: Partial JSON Parsing
   * Simula la lógica de inyectar deltas en el UI antes de que el JSON se complete.
   */
  public handlePartialStream(partialChunk: string): void {
    // Aquí implementamos un parser tolerante a fallos
    // que lee propiedades incompletas de JSON y va actualizando el Signal progresivamente.
    // Ej: Si viene {"intent":"message","data":{"response":"Hola mu...
    try {
      // Intento de parseo rápido (muy simplificado, requiere un AST/Parser real)
      const partialObj = JSON.parse(partialChunk + '"}'); // forced closure
      // Si pasa, actualizar UI temporalmente...
    } catch (e) {
      // Silencioso, seguimos esperando el próximo chunk
    }
  }
}
