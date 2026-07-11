/**
 * mockData.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Only `mockProjectTemplates` remains here — it's UI-owned seed text for the
 * "New Project" prompt textarea on AIWorkspace (a starting point the user
 * edits), not data presented as coming from the backend. Every other export
 * that used to live in this file (mockAgents, mockAlerts, mockApprovals,
 * mockMCPIntegrations, mockSDLCStages, mockTimelineEvents, mockUserStories,
 * mockArchitectureComponents, mockDatabaseTables, mockGeneratedFiles,
 * agentTypes) was fabricated data rendered as if it were real backend/agent
 * state — those call sites (MonitoringCenter, AgentControlCenter) were
 * rewired to real endpoints and no longer need it.
 */

export const mockProjectTemplates = [
  {
    id: '1',
    name: 'Enterprise Banking Platform',
    description: 'Multi-tenant banking with KYC, payments, compliance',
    icon: 'Landmark',
  },
  {
    id: '2',
    name: 'E-Commerce Platform',
    description: 'Full marketplace with inventory, payments, analytics',
    icon: 'ShoppingCart',
  },
  {
    id: '3',
    name: 'Healthcare Management',
    description: 'HIPAA-compliant patient management system',
    icon: 'HeartPulse',
  },
  {
    id: '4',
    name: 'Supply Chain',
    description: 'Real-time inventory and logistics tracking',
    icon: 'Truck',
  },
  {
    id: '5',
    name: 'Insurance Platform',
    description: 'Claims processing and policy management',
    icon: 'ShieldCheck',
  },
  {
    id: '6',
    name: 'CRM System',
    description: 'Customer relationship and sales pipeline',
    icon: 'Users',
  },
];
