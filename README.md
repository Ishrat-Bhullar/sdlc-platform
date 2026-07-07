# Autonomous SDLC Platform

An AI-powered Multi-Agent Software Development Lifecycle (SDLC) Automation Platform that transforms business requirements into production-ready software artifacts through autonomous AI agents.

> This project demonstrates an enterprise-grade AI orchestration platform capable of automating multiple phases of the Software Development Lifecycle using specialized AI agents.

---

# Overview

The Autonomous SDLC Platform enables organizations to accelerate software development by orchestrating multiple AI agents that collaborate throughout the SDLC.

The platform accepts project requirements and automatically generates:

- Business Requirements
- Functional Requirements
- User Stories
- Solution Architecture
- Database Design
- UI/UX Designs
- Backend APIs
- Frontend Components
- Technical Documentation
- Progress Tracking
- Human Approval Workflows

---

# Key Features

## Multi-Agent Workflow

- Memory Agent
- Requirements Analysis Agent
- Business Analyst Agent
- Human Review Checkpoint
- Solution Architect Agent
- Database Design Agent
- UI/UX Design Agent
- Security Architect Agent
- Compliance Architect Agent

---

## Project Management

- Project Creation Wizard
- Dashboard
- Workflow Monitoring
- Agent Status Tracking
- Pipeline Progress
- Approval Management

---

## AI Capabilities

- Large Language Model Integration
- AI-generated Documentation
- Automated Requirement Analysis
- Architecture Generation
- Database Schema Generation
- Design Recommendations

---

## Documentation Generation

The platform automatically generates:

- BRD
- Functional Requirements
- User Stories
- Architecture Documents
- Database Design
- API Specifications
- UI Design Documents

---

# Technology Stack

## Frontend

- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Vite

## Backend

- FastAPI
- Python

## AI Framework

- LangGraph
- Ollama
- Azure OpenAI (Configurable)

## Database

- PostgreSQL

## DevOps

- Docker
- GitHub

---

# High-Level Workflow

```
User Input
      │
      ▼
Memory Agent
      │
      ▼
Requirements Agent
      │
      ▼
Business Analyst Agent
      │
      ▼
Human Review
      │
      ▼
Solution Architect
      │
      ▼
Database Design
      │
      ▼
 ┌───────────────┬──────────────────┐
 ▼               ▼                  ▼
UI/UX       Security          Compliance
Design      Architect         Architect
 └───────────────┴──────────────────┘
                │
                ▼
        Generated Deliverables
```

---

# Current Implementation

Current modules include:

- Project Dashboard
- Agent Workspace
- Requirement Generation
- Business Analysis
- Solution Architecture
- Database Design
- Human Approval Workflow
- Pipeline Progress Tracking
- Documentation Viewer

---

# Folder Structure

```
frontend/
backend/
agents/
services/
routes/
controllers/
database/
docs/
```

---

# Installation

Clone the repository

```bash
git clone <repository-url>
```

Navigate into the project

```bash
cd Autonomous-SDLC-Platform
```

Install frontend dependencies

```bash
cd frontend
npm install
```

Run frontend

```bash

cd frontend
npm run dev
```

Install backend dependencies

```bash
pip install -r requirements.txt
```

Run backend

```bash
cd backend
uvicorn fastapi_agents.main:app --reload
```

---

# Project Status

🚧 Active Development

Current focus:

- Agent Integration
- Workflow Automation
- Documentation Generation
- Human Approval System
- AI Orchestration

---

# Future Roadmap

- Frontend Code Generation
- Backend Code Generation
- API Generation
- Automated Testing
- Security Review
- DevOps Automation
- CI/CD Integration
- Deployment Automation
- Monitoring & Analytics

---

# Disclaimer

This repository is an internship demonstration project developed as part of ongoing enterprise AI automation research. Features are under active development and subject to continuous enhancement.

---

# Author

**Ishrat Bhullar**
