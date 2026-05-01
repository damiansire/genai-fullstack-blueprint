import { z } from 'zod';

export const aiResponseSchema = z.object({
  message: z.string().describe('El mensaje principal generado por el LLM'),
  confidence: z.number().min(0).max(1).optional().describe('Nivel de confianza en la respuesta (0-1)'),
  intent: z.enum(['inform', 'action', 'error']).optional().describe('La intención semántica de la respuesta'),
  data: z.record(z.string(), z.any()).optional().describe('Payload estructurado arbitrario devuelto por el modelo')
});

export type AiResponse = z.infer<typeof aiResponseSchema>;
