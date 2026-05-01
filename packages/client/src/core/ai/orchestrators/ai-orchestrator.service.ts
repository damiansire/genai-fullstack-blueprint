import { Injectable, signal, computed } from '@angular/core';
import { aiResponseSchema, AiResponse } from '../schemas/ai-response.schema';

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
      
      // 2. Transición de estado segura y evaluación de 'Human in the Loop'
      const isAction = parsedData.intent === 'action';

      this._state.update(s => ({
        ...s,
        data: parsedData,
        isLoading: false,
        requiresHumanApproval: isAction,
        pendingAction: isAction ? parsedData.data : null
      }));
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
    this._state.set({ 
      data: null, 
      isLoading: false, 
      error: null,
      requiresHumanApproval: false,
      pendingAction: null
    });
  }
}
