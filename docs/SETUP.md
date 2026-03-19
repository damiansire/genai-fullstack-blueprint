# 🚀 Setup Completo - Nano Banana

## ✅ Estado Actual

### Backend

- ✅ Plugin Gemini Image Generation instalado
- ✅ SDK `@google/generative-ai` instalado
- ✅ Integración real con Gemini API
- ✅ Auto-registro del modelo `gemini-image-gen`

### Frontend

- ✅ Componente de Image Generation creado
- ✅ Navegación global con 3 opciones
- ✅ httpResource para llamadas HTTP reactivas
- ✅ Ejemplos de prompts precargados
- ✅ Upload de imágenes para edición

### Rutas Disponibles

- `/text-model` - Generación de texto
- `/image-ocr` - OCR de imágenes
- `/image-generation` - **Nano Banana** 🍌

---

## 🔑 Configuración Necesaria

### Paso 1: Obtén tu Gemini API Key

1. Ve a: **https://aistudio.google.com/app/apikey**
2. Inicia sesión con tu cuenta de Google
3. Click en "Create API Key"
4. Copia la key generada (empieza con `AIzaSy...`)

### Paso 2: Configura el Archivo .env

En la raíz del proyecto, crea o edita el archivo `.env`:

```bash
# Copia el ejemplo si no existe
cp env.example .env

# Edita y agrega tu API key
nano .env  # o usa tu editor favorito
```

Agrega esta línea con tu API key real:

```bash
GEMINI_API_KEY=AIzaSy... # Tu key aquí
```

### Paso 3: Verifica que el Servidor Esté Corriendo

El servidor ya está iniciando con `npm run dev`.

**URLs:**

- Backend API: http://localhost:3000
- Frontend Angular: http://localhost:4200

Si no está corriendo, ejecuta:

```bash
npm run dev
```

---

## 🎨 Prueba Nano Banana

### Opción 1: Interfaz Web (Recomendado)

1. Abre tu navegador en: **http://localhost:4200**
2. Click en el menú superior: **🎨 Image Generation**
3. Prueba con un ejemplo:
   - Click en "Photorealistic" o cualquier otro ejemplo
   - Observa cómo se llena el prompt automáticamente
4. Click en **🎨 Generate Image**
5. Espera unos segundos (la generación toma 2-5 segundos)
6. ¡Descarga tu imagen con el botón 💾 Download!

### Opción 2: API REST (Para Desarrolladores)

```bash
curl -X POST http://localhost:3000/api/models/gemini-image-gen/invoke \
  -H "X-API-Key: default-key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cute kawaii red panda eating bamboo, sticker style with bold outlines",
    "aspectRatio": "1:1",
    "responseModalities": ["Image", "Text"]
  }'
```

---

## 🎯 Ejemplos de Prompts

### Para Empezar (Simples)

```
A beautiful sunset over mountains with dramatic orange clouds
```

```
A cute cartoon cat wearing sunglasses
```

```
A minimalist logo with the letter "A" in modern style
```

### Nivel Intermedio

```
A photorealistic cappuccino on a wooden table with perfect latte art,
morning light, shallow depth of field
```

```
A kawaii-style sticker of a happy avocado character with sunglasses,
bold outlines, vibrant colors, white background
```

### Nivel Avanzado

```
A photorealistic close-up portrait of an elderly Japanese ceramicist with
deep, sun-etched wrinkles and a warm, knowing smile. He is carefully inspecting
a freshly glazed tea bowl. The setting is his rustic, sun-drenched workshop
with pottery wheels and shelves of clay pots in the background. The scene is
illuminated by soft, golden hour light streaming through a window, highlighting
the fine texture of the clay and the fabric of his apron. Captured with an 85mm
portrait lens, resulting in a soft, blurred background (bokeh). The overall mood
is serene and masterful.
```

---

## 🔧 Troubleshooting

### "GEMINI_API_KEY is not configured"

**Problema**: No se encuentra la API key.

**Solución:**

1. Verifica que `.env` existe en la raíz del proyecto
2. Verifica que contiene `GEMINI_API_KEY=...`
3. Reinicia el servidor (Ctrl+C y luego `npm run dev`)

### El Servidor No Inicia

**Solución:**

```bash
# Detén todos los procesos
pkill -f "tsx watch"
pkill -f "ng serve"

# Inicia de nuevo
npm run dev
```

### La Imagen No Se Genera

**Checklist:**

- ✅ ¿Agregaste `GEMINI_API_KEY` en `.env`?
- ✅ ¿La API key es válida?
- ✅ ¿El servidor se reinició después de agregar la key?
- ✅ ¿El prompt tiene al menos 10 caracteres?
- ✅ ¿Tienes conexión a internet?

### Error de Cuota Excedida

Si ves "Resource exhausted" o similar:

- Verifica tu cuota en Google AI Studio
- El tier gratuito tiene límites de requests por minuto
- Espera un minuto y reintenta

---

## 📊 Características Implementadas

### Text-to-Image ✅

- Genera desde descripciones de texto
- 10 aspect ratios disponibles
- Alta calidad y detalle

### Image Editing ✅

- Upload imágenes para modificarlas
- Añade o remueve elementos
- Cambia estilos y colores

### Ejemplos Precargados ✅

- Photorealistic
- Illustration/Sticker
- Product Photography
- Logo Design
- Comic Art

### Features Avanzados ✅

- Texto de alta fidelidad en imágenes
- Iluminación y cámara controlables
- Style transfer
- Multi-image composition

---

## 🎓 Aprende Más

**Documentación:**

- `/docs/NANO-BANANA.md` - Guía completa
- `/QUICKSTART-NANO-BANANA.md` - Inicio rápido
- `/docs/API.md` - API Reference

**Recursos Externos:**

- [Gemini API Docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google AI Studio](https://aistudio.google.com/)
- [Pricing Info](https://ai.google.dev/pricing)

---

## ✨ ¡Listo para Crear!

1. **Configura** tu `GEMINI_API_KEY` en `.env`
2. **Reinicia** el servidor si es necesario
3. **Navega** a http://localhost:4200
4. **Click** en 🎨 Image Generation
5. **Genera** tu primera imagen!

**🍌 ¡Disfruta Nano Banana!**
