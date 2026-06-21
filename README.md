
# 🚀 Full-Stack Multimodal AI Application: A Production Blueprint

This repository serves as a **production-ready blueprint** for building modern, scalable, and high-performance web applications using a cutting-edge tech stack: **Angular** for the frontend, **Node.js** for the backend, and **Google Gemini API** for multimodal AI capabilities.

The project is built from the ground up following strict industry best practices for **TypeScript full-stack development**, focusing on **maintainability**, **developer experience**, and **deployment readiness**.

---

> **🏗️ Architecture:** All architectural decisions and documentation are centrally maintained in `REGISTRY.md`.

## 🧱 Core Architectural Principles

The architecture is designed around several key principles to ensure robustness and scalability:

### 🧩 Monorepo with npm Workspaces

Frontend and backend coexist in a single repository but are managed as independent packages. This simplifies dependency management and scripting while maintaining a clear separation of concerns.

### 🔗 Decoupled Architecture

The Angular client and Node.js server are completely independent applications communicating through a well-defined RESTful API. Each can be developed, tested, and deployed autonomously.

### 🧠 Layered Backend

The Node.js API follows a layered structure (**Routes → Controllers → Services**), cleanly separating HTTP request handling from business logic. This improves organization, testability, and reasoning about the codebase.

### ⚙️ Feature-Oriented Frontend

The Angular app abandons NgModules in favor of a **100% Standalone Component architecture**. The folder structure is organized by **features**, not file type, grouping related code together for better modularity.

---

## 🧰 Tech Stack Overview

| Area           | Technology         | Description                                                                                                                                                |
| -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**   | **Angular 21**     | Modern framework for building UIs using Standalone Components, Signal Forms, Signals for state management, and `ChangeDetectionStrategy.OnPush` for optimal performance. |
| **Backend**    | **Node.js v22+**   | Uses "Built-in over dependencies" strategy: native SQLite, Worker Threads for CPU tasks, `fetch` API, and native test runner.                              |
|                | **Express.js**     | Minimalist framework for building RESTful APIs.                                                                                                            |
|                | **Multer**         | Middleware for handling file uploads (multipart/form-data).                                                                                                |
| **AI**         | **Google Gemini**  | API for multimodal (text and image) content generation.                                                                                                    |
| **Language**   | **TypeScript**     | Used end-to-end for strict typing and better developer experience.                                                                                         |
| **Deployment** | **Docker & Nginx** | Containerization for consistent and isolated deployments. Nginx serves the production Angular app as a high-performance web server.                        |

---

## ⚡ Getting Started

Follow these steps to set up and run the project locally.

### Prerequisites

Make sure you have the following installed:

- **Node.js** (v22 or higher) and **npm**
- **Angular CLI** (`npm install -g @angular/cli`)
- **Docker** and **Docker Compose** (optional)

---

### Installation and Configuration

Clone the repository:

```bash
git clone https://github.com/damiansire/GenAI-Scaffold.git
cd GenAI-Scaffold
```

Create your environment file by copying the example:

```bash
cp env.example .env
```

Edit `.env` and add your Google Gemini API key:

```
GEMINI_API_KEY=YOUR_API_KEY_HERE
```

**Get your Gemini API key here:** https://aistudio.google.com/app/apikey

> **Note:** The Gemini API key is required for the **Image Generation (Nano Banana)** feature. Without it, you can still use the Text Generation and Image OCR features in demo mode.

Install dependencies (npm Workspaces will handle both frontend and backend):

```bash
npm install
```

### Running the Application

#### Option 1: Development Mode (Recommended for development)

```bash
npm run dev
```

- **Angular frontend**: http://localhost:4200
- **Node.js backend**: http://localhost:3000

#### Option 2: Docker Mode (Recommended for production/testing)

```bash
# Start Docker Desktop first (macOS)
open -a Docker

# Build and run with Docker
docker compose up --build -d

# Check service status
docker compose ps

# View logs
docker compose logs -f
```

- **Angular frontend**: http://localhost:8080
- **Node.js backend**: http://localhost:3000

**Health Checks:**

```bash
curl http://localhost:3000/health  # API
curl http://localhost:8080/health  # Frontend
```

> **Troubleshooting Docker:** Refer to `REGISTRY.md` for current deployment architectures and known edge cases.

---

## 🌟 AI Features

This platform includes three powerful AI capabilities powered by Google's models:

### 📝 Multi-Tiered Generation & Generative UI

- Routing across the **Google** model plugins that ship today (`google-text-bison`, `gemini-image-gen`, `google-vision-ocr`). *Multi-provider routing to other frontier models (e.g. Claude 3.5 Sonnet, Gemini 1.5 Pro) and local SLMs is on the roadmap — there is currently no Anthropic/OpenAI integration in the codebase.*
- **Server-Driven Generative UI**: Angular dynamically renders visual components via `@defer` based on LLM Tool Calls.
- **Iterative Refinement (RCI)**: Recursive generation and quality scoring in worker threads.
- Token usage tracking and real-time streaming via SSE.

### 🔍 Image OCR (Google Vision OCR)

- Extract text from images with high accuracy
- Multi-language support (10+ languages)
- Bounding box detection for text positioning
- Confidence scores for each annotation
- Supports JPEG, PNG, GIF, WEBP, BMP formats

### 🎨 Image Generation - Nano Banana (Gemini 2.5 Flash Image)

**NEW!** Generate and edit images using Gemini's native image generation:

**Modes:**

- **Text-to-Image**: Create images from descriptive prompts
- **Image Editing**: Modify existing images with text instructions
- **Style Transfer**: Apply artistic styles to photos
- **Multi-Image Composition**: Combine elements from multiple images
- **Iterative Refinement**: Conversational image editing

**Capabilities:**

- 10 aspect ratios (Square, Portrait, Landscape, Widescreen, etc.)
- High-fidelity text rendering in images (logos, diagrams, posters)
- Photorealistic rendering with advanced lighting and camera controls
- Illustration and sticker generation
- Product mockups and commercial photography
- Sequential art (comic panels, storyboards)

**Prompting Best Practices:**

- Describe scenes narratively, not just keywords
- Use photography terms for realism (lens type, lighting, camera angle)
- Be hyper-specific about details
- Iterate conversationally for refinement
- Use step-by-step instructions for complex scenes

**Note:** All generated images include a SynthID watermark.

---

## 🏢 Enterprise AI Platform Capabilities

Beyond being a simple starter template, GenAI-Scaffold is architected as a **B2B SaaS-ready AI Platform**. It includes built-in enterprise features that address the most critical business requirements:

### 🧠 Integrated RAG Infrastructure (Retrieval-Augmented Generation)
- **Chat with Private Data**: Seamlessly ingest and query private documents and customer databases without the prohibitive cost of fine-tuning models.
- **Native Vector DB (optional, off by default)**: *Designed* to use the `sqlite-vec` extension for in-memory semantic search. `sqlite-vec` is **not a bundled dependency**: it must be provided as an external SQLite extension at runtime. If it is not loadable, the database logs `Semantic vector search disabled` and only the exact-match (SHA-256) cache path operates.
- **Dynamic Context Injection**: Automatically enriches LLM prompts with relevant semantic context to reduce hallucinations.

### 🛡️ Guardrails & AI Safety Firewall
- **Prompt Injection Heuristic**: Pre-flight validation of user inputs via a basic keyword/substring check. *(A local SLM such as Phi-3.5 running in a background Worker Thread is on the roadmap — not yet implemented.)*
- **PII Masking**: Automatic detection and masking of Personally Identifiable Information (emails, credit cards) *before* data leaves your infrastructure to reach public APIs.
- **Toxicity Filters**: Guarantees brand safety by actively blocking inappropriate or non-compliant generations.

### 📊 Comprehensive LLMOps & Observability
- **ROI & Billing Visibility**: Granular tracking of Token Consumption and Latency (TTFT) per user and per tenant, essential for B2B billing models.
- **Distributed Tracing**: Uses Node.js `AsyncLocalStorage` and native OTLP telemetry to trace every interaction from the HTTP request down to the SQLite vector cache and the LLM API call.
- **Low-Cost Caching**: The **exact-match** cache (SHA-256 of the prompt) serves identical repeat queries with ~0ms latency and 0 token cost. The **semantic** (paraphrase-tolerant) path requires the optional `sqlite-vec` extension and is off by default; without it, paraphrased queries are not cache hits.

### 🏢 Multi-Tenant Architecture (design, not yet implemented)
> ⚠️ **Roadmap, not shipped.** The codebase authenticates by API key only; there is **no JWT verification, no per-tenant binding, and no data segregation by `tenant_id`** yet. Do **not** rely on this for compliance — the items below describe the intended design.
- **Tenant Isolation (planned)**: The architecture is intended to bind tenant IDs to JWTs and segregate all contextual data (RAG vectors, chat histories, token budgets) per tenant. Implementing this binding and per-tenant query scoping is a prerequisite before any GDPR/HIPAA claim can be made.
- **Tier-Based RBAC (partial)**: `rbac` middleware can gate models by tier, but the tier is not yet populated from a real identity source, so every request currently resolves to the most restrictive (`free`) tier.

---

## 🗂️ Project Structure

Optimized for scalability and clarity:

```
/GenAI-Scaffold/
├── packages/               # Monorepo packages
│   ├── client/            # Angular 21 Application
│   │   ├── src/app/
│   │   │   ├── core/       # Singleton services, DI tokens
│   │   │   ├── shared/     # Reusable components (file-upload, navigation)
│   │   │   └── features/   # Functional components (text-model, image-model)
│   │   └── package.json
│   └── api/               # Node.js API
│       ├── src/
│       │   ├── api/        # Routes, controllers, middleware
│       │   ├── core/       # Base classes (ApiError)
│       │   ├── models/     # Factory, Registry, Loader
│       │   └── plugins/    # AI model strategies
│       └── package.json
├── .docker/               # Dockerfiles for production
│   ├── Dockerfile.client  # Angular + Nginx
│   ├── Dockerfile.server  # Node.js API
│   └── nginx.conf         # Nginx configuration
├── REGISTRY.md            # Master Architectural Registry (Decisions & Patterns)
├── package.json           # Workspace configuration
├── package-lock.json      # Dependency lock file
├── .env.example           # Environment variables template
└── docker-compose.yml     # Container orchestration
```

---

## ✅ Best Practices Implemented

### Backend (Node.js)

- **Secure API Key Handling**: All secrets are managed via environment variables — never hardcoded.
- **File Uploads**: `multer` configured per route to efficiently and securely handle multipart/form-data.
- **Strict CORS Policy**: Only trusted origins are allowed in production.

### Frontend (Angular 21)

- **100% Standalone Components**: No NgModules — less boilerplate, simpler dependency management.
- **Signal Forms**: Uses Angular 21's `form()` / `FormField` API from `@angular/forms/signals` for type-safe, model-driven forms.
- **Reactive State with Signals**: Uses `signal()`, `computed()`, and `httpResource()` for high-performance state management.
- **Zoneless Change Detection**: Runs without `zone.js` via `provideZonelessChangeDetection()` for smaller bundles and better performance.
- **OnPush Change Detection**: All components use `ChangeDetectionStrategy.OnPush`.
- **Vitest Test Runner**: Unit tests run with Vitest via `@angular/build:unit-test` for fast, modern testing.
- **Design Tokens**: Centralized CSS custom properties in `:root` for consistent theming across components.
- **Accessibility (ARIA)**: Decorative emojis wrapped in `aria-hidden`, form inputs with `aria-invalid` / `aria-describedby`, spinners with `role="status"`.
- **Lazy Loading with `loadComponent`**: Reduces initial bundle size and improves performance.
- **Modern Dependency Injection**: Uses `inject()` with `InjectionToken` for API configuration.
- **Native Control Flow**: Leverages `@if`, `@for`, and `@switch` syntax for cleaner, faster templates.

---

## 📚 Documentation

All comprehensive documentation, architecture decisions, and setup instructions have been consolidated into a single source of truth:

- **[Master Architectural Registry (REGISTRY.md)](./REGISTRY.md)** - Contains API references, setup workflow, component structures, and Node.js native patterns.

## 🐳 Production Deployment with Docker

The project is fully containerized and ready for production deployment.

- **Multi-stage Builds**: Each Dockerfile separates build and runtime environments for smaller, secure images.
- **Workspace Support**: Dockerfiles are configured for npm workspaces (monorepo architecture)
- **Nginx for Frontend**: The built Angular app is served via an optimized Nginx container for SPA delivery.
- **Health Checks**: Both services include health check endpoints for monitoring
- **Single Command Orchestration**: The `docker-compose.yml` file spins up the full production stack easily.

To build and run production containers:

```bash
# Start Docker Desktop first (macOS)
open -a Docker

# Build and run all services
docker compose build
docker compose up -d

# Check status (both services should be healthy)
docker compose ps

# View logs
docker compose logs -f

# Stop services
docker compose down
```

**Useful Commands:**

```bash
# Rebuild without cache
docker compose build --no-cache

# Build specific service
docker compose build api
docker compose build client

# View service logs
docker compose logs -f api
docker compose logs -f client

# Execute commands in running container
docker compose exec api sh
docker compose exec client sh
```

**Architecture Notes:**

- The API service uses a multi-stage build with TypeScript compilation
- Dependencies are installed using `npm ci --workspace` for monorepo support
- Production TypeScript configuration relaxes strictness for deployment
- Nginx serves the Angular app with SPA routing support and compression

For detailed orchestration and operational guidelines, refer to the `REGISTRY.md`.

---

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome!  
Feel free to open a pull request or issue if you'd like to help enhance this blueprint.
