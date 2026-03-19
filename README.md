> **⚠️ IMPORTANT NOTICE**
>
> | | |
> |---|---|
> | **Last modified** | March 19, 2026 |
> | **Status** | Under active improvement |
> | **Disclaimer** | The app is being migrated to Angular 21 with several improvements applied. Please note that while this message remains in the README, the application may be unstable. |
>
> ### Ongoing changes summary
>
> - **Angular 21 migration**: All `@angular/*` packages upgraded from v20 to v21.2.
> - **Signal Forms**: Replaced Reactive Forms (`FormGroup`/`FormControl`/`Validators`) with the new Signal Forms API (`form()`, `signal()`, `FormField`, `submit()`).
> - **Vitest instead of Karma/Jasmine**: Test runner migrated to Vitest using the `@angular/build:unit-test` builder.
> - **Zoneless Change Detection**: Complete removal of `zone.js`, now using `provideZonelessChangeDetection()`.
> - **Design Tokens & SCSS**: Colors and styles centralized into CSS custom properties, shared styles extracted to global utility classes.
> - **Accessibility (ARIA)**: Decorative emojis wrapped in `aria-hidden`, spinners with `role="status"`, `aria-invalid` and `aria-describedby` attributes on forms.
> - **Configuration cleanup**: Removed `apiKey` from client, aligned dependency versions, removed `experimentalDecorators`.

---

# 🚀 Full-Stack Multimodal AI Application: A Production Blueprint

This repository serves as a **production-ready blueprint** for building modern, scalable, and high-performance web applications using a cutting-edge tech stack: **Angular** for the frontend, **Node.js** for the backend, and **Google Gemini API** for multimodal AI capabilities.

The project is built from the ground up following strict industry best practices for **TypeScript full-stack development**, focusing on **maintainability**, **developer experience**, and **deployment readiness**.

---

> **🏗️ Architecture:** This project uses a modular monolithic architecture. Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the design decisions and why we chose this approach over microservices.

---

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
| **Backend**    | **Node.js**        | JavaScript runtime environment for the server side.                                                                                                        |
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

- **Node.js** (v18 or higher) and **npm**
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

> **Troubleshooting Docker:** If you encounter build errors, check the [Deployment Guide troubleshooting section](docs/DEPLOYMENT.md#-solución-de-problemas-de-docker)

---

## 🌟 AI Features

This platform includes three powerful AI capabilities powered by Google's models:

### 📝 Text Generation (Google Text Bison)

- Generate creative and contextual text from prompts
- Configurable parameters: max tokens, temperature, top-p, top-k
- Real-time streaming responses
- Token usage tracking

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
├── docs/                  # Documentation
│   ├── API.md             # API documentation
│   ├── DEVELOPMENT.md     # Development guide
│   ├── DEPLOYMENT.md      # Deployment guide
│   └── TROUBLESHOOTING.md # Problem solving guide
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

Comprehensive documentation is available in the `docs/` directory:

- **[Quick Start - Nano Banana](docs/QUICKSTART-NANO-BANANA.md)** - 🍌 Quick guide to get started with image generation
- **[Nano Banana Documentation](docs/NANO-BANANA.md)** - Complete guide for Gemini Image Generation features
- **[API Documentation](docs/API.md)** - Complete API reference with examples
- **[Development Guide](docs/DEVELOPMENT.md)** - Setup and development workflow
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Production deployment instructions
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common problems and solutions

### Additional Resources

- **[Setup Guide](docs/SETUP.md)** - Detailed installation and configuration instructions
- **[Architecture Decisions](docs/ARCHITECTURE.md)** - Why we chose a modular monolith over microservices
- **[Disclaimer](docs/DISCLAIMER.md)** - Important notes about using this repository

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

For detailed deployment instructions and troubleshooting, see the **[Deployment Guide](docs/DEPLOYMENT.md)**

---

## 🤝 Contributing

Contributions, suggestions, and improvements are welcome!  
Feel free to open a pull request or issue if you'd like to help enhance this blueprint.
