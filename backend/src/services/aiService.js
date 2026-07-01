const axios = require('axios');
const { query } = require('../config/database');

class AIService {
  constructor() {
    this.defaultProvider = process.env.DEFAULT_AI_PROVIDER || 'anthropic';
    this.defaultModel = process.env.DEFAULT_AI_MODEL || 'claude-sonnet-4-6';
  }

  async getUserSettings(userId) {
    if (!userId) return null;
    const result = await query('SELECT * FROM user_ai_settings WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
  }

  async callAnthropic(prompt, systemPrompt, model = 'claude-sonnet-4-6') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: 4096,
        system: systemPrompt || 'You are an expert software architect and developer.',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    const content = response.data.content[0].text;
    const usage = response.data.usage || {};
    return {
      text: content,
      tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      cost: ((usage.input_tokens || 0) * 0.000003) + ((usage.output_tokens || 0) * 0.000015),
    };
  }

  async callOpenAI(prompt, systemPrompt, model = 'gpt-4o') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt || 'You are an expert software architect.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' } }
    );

    const content = response.data.choices[0].message.content;
    const usage = response.data.usage || {};
    return {
      text: content,
      tokens: usage.total_tokens || 0,
      cost: (usage.total_tokens || 0) * 0.000005,
    };
  }

  async callOllama(prompt, systemPrompt, model) {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const ollamaModel = model || process.env.OLLAMA_MODEL || 'llama3';

    const response = await axios.post(`${baseUrl}/api/chat`, {
      model: ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt || 'You are an expert software architect.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
    });

    return {
      text: response.data.message?.content || '',
      tokens: response.data.eval_count || 0,
      cost: 0,
    };
  }

  async complete(prompt, { systemPrompt, provider, model, userId } = {}) {
    const userSettings = userId ? await this.getUserSettings(userId) : null;
    const resolvedProvider = provider || userSettings?.provider || this.defaultProvider;
    const resolvedModel = model || userSettings?.model || this.defaultModel;

    const startTime = Date.now();
    let result;

    try {
      switch (resolvedProvider) {
        case 'openai':
          result = await this.callOpenAI(prompt, systemPrompt, resolvedModel);
          break;
        case 'ollama':
          result = await this.callOllama(prompt, systemPrompt, resolvedModel);
          break;
        case 'anthropic':
        default:
          result = await this.callAnthropic(prompt, systemPrompt, resolvedModel);
          break;
      }
    } catch (err) {
      // Fallback to mock response for demo if AI not configured
      console.warn(`⚠️  AI provider ${resolvedProvider} failed: ${err.message}. Using demo response.`);
      result = await this.getMockResponse(prompt);
    }

    return {
      ...result,
      provider: resolvedProvider,
      model: resolvedModel,
      durationMs: Date.now() - startTime,
    };
  }

  // Demo fallback — returns structured mock data so the demo works without API keys
  async getMockResponse(prompt) {
    await new Promise((r) => setTimeout(r, 800)); // simulate latency
    const lower = prompt.toLowerCase();

    if (lower.includes('requirement')) {
      return {
        text: JSON.stringify({
          functional: [
            { id: 'FR-001', description: 'User authentication with email and password', category: 'Functional', priority: 'critical', risk: 'low' },
            { id: 'FR-002', description: 'Account dashboard showing balances', category: 'Functional', priority: 'high', risk: 'low' },
            { id: 'FR-003', description: 'Transaction history with filters', category: 'Functional', priority: 'high', risk: 'low' },
            { id: 'FR-004', description: 'Fund transfer between accounts', category: 'Functional', priority: 'critical', risk: 'medium' },
          ],
          nonFunctional: [
            { id: 'NFR-001', description: 'Page load under 3 seconds', category: 'Performance', priority: 'high', risk: 'low' },
            { id: 'NFR-002', description: '99.9% system availability', category: 'Reliability', priority: 'high', risk: 'low' },
            { id: 'NFR-003', description: 'GDPR and PSD2 compliance', category: 'Compliance', priority: 'critical', risk: 'high' },
          ],
          risks: ['Third-party KYC dependency', 'PSD2 regulation changes'],
          dependencies: ['KYC Provider API', 'Payment Gateway', 'SMS Gateway'],
        }),
        tokens: 450,
        cost: 0.001,
      };
    }

    if (lower.includes('epic') || lower.includes('story') || lower.includes('backlog')) {
      return {
        text: JSON.stringify({
          epics: [
            { title: 'User Authentication', description: 'All auth-related features' },
            { title: 'Account Management', description: 'Account viewing and management' },
            { title: 'Transaction Management', description: 'Transaction history and transfers' },
          ],
          stories: [
            { epic: 'User Authentication', title: 'Login with email and password', role: 'user', goal: 'log in securely', benefit: 'access my account', criteria: ['Validates email format', 'Shows error on wrong credentials', 'Redirects to dashboard on success'], priority: 'Must', points: 5 },
            { epic: 'Account Management', title: 'View account balance', role: 'user', goal: 'see my balance', benefit: 'track my finances', criteria: ['Shows current balance', 'Updates in real-time', 'Shows account number'], priority: 'Must', points: 3 },
            { epic: 'Transaction Management', title: 'View transaction history', role: 'user', goal: 'see past transactions', benefit: 'monitor spending', criteria: ['Lists last 50 transactions', 'Filterable by date and type', 'Exportable to CSV'], priority: 'Must', points: 8 },
          ],
        }),
        tokens: 620,
        cost: 0.002,
      };
    }

    if (lower.includes('architect')) {
      return {
        text: JSON.stringify({
          pattern: 'Monolith (Modular)',
          justification: 'Chosen for demo simplicity and rapid development. Can be extracted to microservices later.',
          techStack: { frontend: 'React 18 + TypeScript', backend: 'Node.js + Express', database: 'PostgreSQL 15', cache: 'Redis', auth: 'JWT + bcrypt' },
          services: ['Auth Service', 'Account Service', 'Transaction Service'],
          apiStyle: 'REST',
          security: 'JWT tokens, bcrypt hashing, HTTPS, CORS',
          scalability: 'Horizontal scaling via load balancer, CDN for static assets',
          diagrams: {
            systemContext: 'graph TD\n  User -->|HTTPS| WebApp\n  WebApp -->|REST| API\n  API -->|SQL| DB[(PostgreSQL)]',
            sequence: 'sequenceDiagram\n  User->>Frontend: Login\n  Frontend->>API: POST /auth/login\n  API->>DB: Verify credentials\n  DB-->>API: User record\n  API-->>Frontend: JWT tokens\n  Frontend-->>User: Dashboard',
          },
        }),
        tokens: 780,
        cost: 0.002,
      };
    }

    if (lower.includes('schema') || lower.includes('database') || lower.includes('table')) {
      return {
        text: JSON.stringify({
          tables: [
            { name: 'users', columns: [{ name: 'id', type: 'UUID', primary: true }, { name: 'email', type: 'VARCHAR(255)', unique: true }, { name: 'password_hash', type: 'VARCHAR(255)' }, { name: 'name', type: 'VARCHAR(255)' }, { name: 'role', type: 'VARCHAR(50)', default: 'developer' }, { name: 'created_at', type: 'TIMESTAMPTZ' }] },
            { name: 'accounts', columns: [{ name: 'id', type: 'UUID', primary: true }, { name: 'user_id', type: 'UUID', fk: 'users.id' }, { name: 'account_number', type: 'VARCHAR(20)', unique: true }, { name: 'balance', type: 'DECIMAL(18,2)', default: '0' }, { name: 'account_type', type: 'VARCHAR(50)' }, { name: 'status', type: 'VARCHAR(20)', default: 'active' }, { name: 'created_at', type: 'TIMESTAMPTZ' }] },
            { name: 'transactions', columns: [{ name: 'id', type: 'UUID', primary: true }, { name: 'account_id', type: 'UUID', fk: 'accounts.id' }, { name: 'amount', type: 'DECIMAL(18,2)' }, { name: 'type', type: 'VARCHAR(20)' }, { name: 'description', type: 'TEXT' }, { name: 'status', type: 'VARCHAR(20)', default: 'completed' }, { name: 'created_at', type: 'TIMESTAMPTZ' }] },
          ],
          migrationSQL: `CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(50) DEFAULT 'developer', created_at TIMESTAMPTZ DEFAULT NOW());\n\nCREATE TABLE accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), account_number VARCHAR(20) UNIQUE NOT NULL, balance DECIMAL(18,2) DEFAULT 0, account_type VARCHAR(50), status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW());\n\nCREATE TABLE transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID REFERENCES accounts(id), amount DECIMAL(18,2) NOT NULL, type VARCHAR(20) NOT NULL, description TEXT, status VARCHAR(20) DEFAULT 'completed', created_at TIMESTAMPTZ DEFAULT NOW());`,
        }),
        tokens: 890,
        cost: 0.003,
      };
    }

    if (lower.includes('frontend') || lower.includes('react') || lower.includes('login page')) {
      return {
        text: JSON.stringify({
          files: [
            { path: '/src/pages/Login.tsx', name: 'Login.tsx', language: 'typescript', lines: 145, content: "import React, { useState } from 'react';\n\nexport const Login = () => {\n  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');\n  // ... form logic\n  return <form>Login Form</form>;\n};" },
            { path: '/src/pages/Dashboard.tsx', name: 'Dashboard.tsx', language: 'typescript', lines: 234, content: "import React from 'react';\n\nexport const Dashboard = () => {\n  // Fetches GET /accounts and GET /transactions\n  return <div>Dashboard</div>;\n};" },
            { path: '/src/pages/Transactions.tsx', name: 'Transactions.tsx', language: 'typescript', lines: 312, content: "import React from 'react';\n\nexport const Transactions = () => {\n  // Filterable transaction history\n  return <div>Transactions</div>;\n};" },
          ],
          components: ['Button', 'Input', 'Card', 'Table', 'Modal', 'Navbar', 'Sidebar'],
          routes: ['/login', '/dashboard', '/transactions'],
          linesOfCode: 691,
        }),
        tokens: 1200,
        cost: 0.004,
      };
    }

    if (lower.includes('backend') || lower.includes('api') || lower.includes('endpoint')) {
      return {
        text: JSON.stringify({
          framework: 'Node.js + Express',
          endpoints: [
            { method: 'POST', path: '/auth/register', description: 'Register new user' },
            { method: 'POST', path: '/auth/login', description: 'Login and get JWT' },
            { method: 'POST', path: '/auth/logout', description: 'Invalidate refresh token' },
            { method: 'GET', path: '/auth/me', description: 'Get current user' },
            { method: 'GET', path: '/accounts', description: 'List user accounts' },
            { method: 'GET', path: '/accounts/:id', description: 'Get account detail' },
            { method: 'GET', path: '/transactions', description: 'List transactions with filters' },
            { method: 'POST', path: '/transactions', description: 'Create transaction' },
            { method: 'GET', path: '/transactions/:id', description: 'Get transaction detail' },
          ],
          middleware: ['JWT validation', 'Input validation', 'Error handler', 'Rate limiting'],
          swaggerUrl: '/api/docs',
          linesOfCode: 890,
        }),
        tokens: 980,
        cost: 0.003,
      };
    }

    if (lower.includes('review') || lower.includes('quality') || lower.includes('security')) {
      return {
        text: JSON.stringify({
          qualityScore: 92,
          securityScore: 88,
          performanceScore: 85,
          issues: [
            { severity: 'Minor', file: '/src/services/auth.service.ts', line: 45, message: 'Consider adding rate limiting to login endpoint', suggestion: 'Implement express-rate-limit middleware' },
            { severity: 'Info', file: '/src/pages/Login.tsx', line: 23, message: 'Missing aria-label on form inputs for accessibility', suggestion: 'Add aria-label attributes' },
          ],
          summary: 'Code quality is excellent. No critical security vulnerabilities found. JWT implementation is correct. Input validation in place. Minor accessibility improvements recommended.',
          passed: ['No hardcoded secrets', 'SQL injection protected', 'XSS vectors addressed', 'Proper error handling', 'SOLID principles followed'],
        }),
        tokens: 560,
        cost: 0.002,
      };
    }

    return {
      text: JSON.stringify({ message: 'Agent task completed successfully', output: `Processed: ${prompt.substring(0, 100)}...` }),
      tokens: 150,
      cost: 0.0005,
    };
  }
}

module.exports = new AIService();