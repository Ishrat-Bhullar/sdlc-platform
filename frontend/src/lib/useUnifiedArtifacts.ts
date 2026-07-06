/**
 * useUnifiedArtifacts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified hook for all artifact operations.
 * Single source of truth for fetching, parsing, and managing artifacts.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiRequest, FASTAPI_BASE_URL } from './api';
import { getSelectedProjectId } from './projectContext';
import type {
  Artifact,
  ArtifactType,
  RequirementsContent,
  UserStoriesContent,
  ArchitectureContent,
  DatabaseSchemaContent,
  ApiDesignContent,
  UIUXDesignContent,
  SecurityReportContent,
  ComplianceReportContent,
  GeneratedCodeContent,
  TestReportContent,
  DocumentationContent,
} from '../types/unified';

function parseContent(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw_text: raw };
    }
  }
  return raw as Record<string, unknown>;
}

export interface UseUnifiedArtifactsReturn {
  artifacts: Artifact[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  // Typed getters for each artifact type
  getRequirements: () => RequirementsContent | null;
  getUserStories: () => UserStoriesContent | null;
  getArchitecture: () => ArchitectureContent | null;
  getDatabaseSchema: () => DatabaseSchemaContent | null;
  getApiDesign: () => ApiDesignContent | null;
  getUIUXDesign: () => UIUXDesignContent | null;
  getSecurityReport: () => SecurityReportContent | null;
  getComplianceReport: () => ComplianceReportContent | null;
  getGeneratedCode: (type: 'frontend' | 'backend') => GeneratedCodeContent | null;
  getTestReport: () => TestReportContent | null;
  getDocumentation: () => DocumentationContent | null;

  // Generic getter
  getArtifact: (type: ArtifactType) => Record<string, unknown> | null;
  getRawArtifact: (type: ArtifactType) => Artifact | null;

  // Approval status
  getApprovalStatus: (type: ArtifactType) => string | null;
  isApproved: (type: ArtifactType) => boolean;

  // Download
  downloadArtifact: (type: ArtifactType, format?: string) => Promise<void>;
}

export function useUnifiedArtifacts(projectId: string | null): UseUnifiedArtifactsReturn {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestProjectIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setArtifacts([]);
      requestProjectIdRef.current = null;
      return;
    }

    requestProjectIdRef.current = projectId;
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<Artifact[]>(`/generated_artifacts?project_id=${projectId}`);
      if (requestProjectIdRef.current === projectId) {
        const normalized: Artifact[] = (data || []).map((a) => ({
          ...a,
          content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content),
        }));
        setArtifacts(normalized);
      }
    } catch (e) {
      if (requestProjectIdRef.current === projectId) {
        setError(e instanceof Error ? e.message : 'Failed to load artifacts');
      }
    } finally {
      if (requestProjectIdRef.current === projectId) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    requestProjectIdRef.current = projectId;
    setArtifacts([]);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const getArtifact = useCallback(
    (type: ArtifactType): Record<string, unknown> | null => {
      const match = artifacts.find((a) => a.artifact_type === type);
      if (!match) return null;
      return parseContent(match.content);
    },
    [artifacts]
  );

  const getRawArtifact = useCallback(
    (type: ArtifactType): Artifact | null => {
      return artifacts.find((a) => a.artifact_type === type) ?? null;
    },
    [artifacts]
  );

  const getApprovalStatus = useCallback(
    (type: ArtifactType): string | null => {
      const artifact = artifacts.find((a) => a.artifact_type === type);
      return artifact?.approval_status || null;
    },
    [artifacts]
  );

  const isApproved = useCallback(
    (type: ArtifactType): boolean => {
      return getApprovalStatus(type) === 'Approved';
    },
    [getApprovalStatus]
  );

  const downloadArtifact = useCallback(
    async (type: ArtifactType, format = 'txt') => {
      const artifact = getRawArtifact(type);
      if (!artifact) {
        throw new Error('Artifact not found');
      }

      const url = `${FASTAPI_BASE_URL}/documents/download/${artifact.id}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Download failed');

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${type}_${artifact.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    },
    [getRawArtifact]
  );

  // Typed getters
  const getRequirements = useCallback((): RequirementsContent | null => {
    const data = getArtifact('requirements_doc');
    if (!data) return null;
    return {
      requirements: (data.requirements as any[]) || [],
      assumptions: (data.assumptions as string[]) || [],
      risks: (data.risks as string[]) || [],
      dependencies: (data.dependencies as any[]) || [],
      summary: (data.summary as Record<string, unknown>) || {},
      user_roles: (data.user_roles as any[]) || [],
      traceability: (data.traceability as any[]) || [],
      error_scenarios: (data.error_scenarios as any[]) || [],
    };
  }, [getArtifact]);

  const getUserStories = useCallback((): UserStoriesContent | null => {
    const data = getArtifact('user_stories');
    if (!data) return null;
    return {
      epics: (data.epics as any[]) || [],
      total_stories: (data.total_stories as number) || 0,
      detailed_brd: (data.detailed_brd as string) || '',
      srs: (data.srs as string) || '',
      personas: (data.personas as any[]) || [],
      process_flows: (data.process_flows as any[]) || [],
      business_workflows: (data.business_workflows as string[]) || [],
      validation_rules: (data.validation_rules as string[]) || [],
      exception_handling: (data.exception_handling as string[]) || [],
      risk_analysis: (data.risk_analysis as any[]) || [],
      success_metrics: (data.success_metrics as any[]) || [],
    };
  }, [getArtifact]);

  const getArchitecture = useCallback((): ArchitectureContent | null => {
    const data = getArtifact('architecture_diagram') || getArtifact('architecture_proposals');
    if (!data) return null;
    // The architect agent now also emits `tech_stack_local` / `tech_stack_cloud`
    // (a richer dual-stack recommendation) and leaves the older single
    // `tech_stack` field empty. Fall back to flattening `tech_stack_local`
    // (excluding its narrative sub-fields) so real data still surfaces here.
    let techStack = (data.tech_stack as Record<string, string>) || (data.techStack as Record<string, string>) || {};
    if (Object.keys(techStack).length === 0 && data.tech_stack_local && typeof data.tech_stack_local === 'object') {
      const skip = new Set(['label', 'rationale', 'trade_offs', 'estimated_cost_profile', 'scalability_notes']);
      techStack = Object.fromEntries(
        Object.entries(data.tech_stack_local as Record<string, unknown>).filter(
          ([k, v]) => !skip.has(k) && typeof v === 'string'
        ) as [string, string][]
      );
    }
    return {
      architecture_summary: (data.architecture_summary as string) || (data.justification as string) || '',
      pattern: (data.pattern as string) || '',
      microservices: (data.microservices as any[]) || (data.services as any[]) || [],
      components: (data.components as any[]) || (data.services as any[]) || [],
      diagrams: Array.isArray(data.diagrams) ? data.diagrams as any[] : Object.entries((data.diagrams as Record<string, string>) || {}).map(([type, content]) => ({ type, content })),
      tech_stack: techStack,
      architecture_decisions: (data.architecture_decisions as any[]) || [],
    };
  }, [getArtifact]);

  const getDatabaseSchema = useCallback((): DatabaseSchemaContent | null => {
    const data = getArtifact('sql_schema') || getArtifact('database_schema');
    if (!data) return null;
    return {
      tables: (data.tables as any[]) || [],
      relationships: (data.relationships as any[]) || [],
      sql_ddl: (data.sql_ddl as string) || (data.migrationSQL as string) || '',
      normalization_notes: (data.normalization_notes as string) || '',
      audit_tables: (data.audit_tables as string[]) || [],
      sample_data: (data.sample_data as Record<string, any[]>) || {},
      scaling_strategy: (data.scaling_strategy as string) || '',
      partitioning_recommendations: (data.partitioning_recommendations as string) || '',
      design_decisions: (data.design_decisions as any[]) || [],
    };
  }, [getArtifact]);

  const getApiDesign = useCallback((): ApiDesignContent | null => {
    const data = getArtifact('api_design');
    if (!data) return null;
    return {
      api_style: (data.api_style as 'REST' | 'GraphQL' | 'gRPC') || 'REST',
      base_url: (data.base_url as string) || '',
      endpoints: (data.endpoints as any[]) || [],
      openapi_yaml: (data.openapi_yaml as string) || '',
    };
  }, [getArtifact]);

  const getUIUXDesign = useCallback((): UIUXDesignContent | null => {
    const data = getArtifact('uiux_design') || getArtifact('ui_ux_design');
    if (!data) return null;
    return {
      screens: (data.screens as UIUXDesignContent['screens']) || [],
      userFlows: (data.userFlows as UIUXDesignContent['userFlows']) || [],
      wireframes: (data.wireframes as UIUXDesignContent['wireframes']) || [],
      componentRecommendations: (data.componentRecommendations as UIUXDesignContent['componentRecommendations']) || [],
      uxRecommendations: (data.uxRecommendations as string[]) || [],
    };
  }, [getArtifact]);

  const getSecurityReport = useCallback((): SecurityReportContent | null => {
    const data = getArtifact('security_report') || getArtifact('security_architecture');
    if (!data) return null;
    return {
      securityArchitecture: (data.securityArchitecture as any) || {},
      threatModel: (data.threatModel as SecurityReportContent['threatModel']) || [],
      authentication: (data.authentication as any) || {},
      authorization: (data.authorization as any) || {},
      securityControls: (data.securityControls as SecurityReportContent['securityControls']) || [],
      securityChecklist: (data.securityChecklist as string[]) || [],
    };
  }, [getArtifact]);

  const getComplianceReport = useCallback((): ComplianceReportContent | null => {
    const data = getArtifact('compliance_report') || getArtifact('compliance_architecture');
    if (!data) return null;
    return {
      complianceAssessment: (data.complianceAssessment as any) || {},
      governanceControls: (data.governanceControls as ComplianceReportContent['governanceControls']) || [],
      auditRequirements: (data.auditRequirements as ComplianceReportContent['auditRequirements']) || [],
      dataRetentionPolicies: (data.dataRetentionPolicies as ComplianceReportContent['dataRetentionPolicies']) || [],
      riskAssessment: (data.riskAssessment as ComplianceReportContent['riskAssessment']) || [],
    };
  }, [getArtifact]);

  const getGeneratedCode = useCallback(
    (type: 'frontend' | 'backend'): GeneratedCodeContent | null => {
      const artifactType = type === 'frontend' ? 'react_code' : 'backend_code';
      const data = getArtifact(artifactType);
      if (!data) return null;
      return {
        framework: (data.framework as string) || '',
        modules: (data.modules as string[]) || [],
        implementation: (data.implementation as string) || '',
        files: (data.files as any[]) || [],
        folder_structure: (data.folder_structure as string[]) || [],
        component_architecture: (data.component_architecture as any[]) || [],
        routing: (data.routing as any[]) || [],
        state_management: (data.state_management as any) || {},
        api_integration_plan: (data.api_integration_plan as any[]) || [],
        forms: (data.forms as any[]) || [],
        error_handling: (data.error_handling as string[]) || [],
        reusable_components: (data.reusable_components as any[]) || [],
        api_specifications: (data.api_specifications as any[]) || [],
        authentication: (data.authentication as any) || {},
        authorization: (data.authorization as any) || {},
        service_layer: (data.service_layer as any[]) || [],
        repository_layer: (data.repository_layer as any[]) || [],
        validation: (data.validation as string[]) || [],
        exception_handling: (data.exception_handling as any[]) || [],
        background_jobs: (data.background_jobs as any[]) || [],
      };
    },
    [getArtifact]
  );

  const getTestReport = useCallback((): TestReportContent | null => {
    const data = getArtifact('test_report');
    if (!data) return null;
    return {
      summary: (data.summary as string) || '',
      suites: (data.suites as string[]) || [],
      status: (data.status as 'passed' | 'failed' | 'pending') || 'pending',
      coverage_targets: (data.coverage_targets as Record<string, number>) || {},
      unit_tests: (data.unit_tests as any[]) || [],
      integration_tests: (data.integration_tests as any[]) || [],
      api_tests: (data.api_tests as any[]) || [],
      ui_tests: (data.ui_tests as any[]) || [],
      performance_tests: (data.performance_tests as any[]) || [],
      security_tests: (data.security_tests as any[]) || [],
      edge_cases: (data.edge_cases as string[]) || [],
      test_data: (data.test_data as any[]) || [],
    };
  }, [getArtifact]);

  const getDocumentation = useCallback((): DocumentationContent | null => {
    const data = getArtifact('documentation');
    if (!data) return null;
    return {
      documents: (data.documents as string[]) || [],
      format: (data.format as 'Markdown' | 'PDF' | 'HTML') || 'Markdown',
      status: (data.status as 'generated' | 'pending' | 'failed') || 'pending',
      developer_guide: (data.developer_guide as string) || '',
      deployment_guide: (data.deployment_guide as string) || '',
      installation_guide: (data.installation_guide as string) || '',
      api_documentation: (data.api_documentation as string) || '',
      operations_guide: (data.operations_guide as string) || '',
      maintenance_guide: (data.maintenance_guide as string) || '',
      troubleshooting: (data.troubleshooting as any[]) || [],
      faqs: (data.faqs as any[]) || [],
    };
  }, [getArtifact]);

  return {
    artifacts,
    loading,
    error,
    reload: load,
    getRequirements,
    getUserStories,
    getArchitecture,
    getDatabaseSchema,
    getApiDesign,
    getUIUXDesign,
    getSecurityReport,
    getComplianceReport,
    getGeneratedCode,
    getTestReport,
    getDocumentation,
    getArtifact,
    getRawArtifact,
    getApprovalStatus,
    isApproved,
    downloadArtifact,
  };
}

/**
 * Convenience hook using the currently selected project from context.
 */
export function useSelectedProjectArtifacts() {
  const projectId = getSelectedProjectId();
  return useUnifiedArtifacts(projectId);
}
