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
  Approval,
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
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestProjectIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setArtifacts([]);
      setApprovals([]);
      requestProjectIdRef.current = null;
      return;
    }

    requestProjectIdRef.current = projectId;
    setLoading(true);
    setError(null);

    try {
      // GeneratedArtifactOut never carries an approval_status field — the
      // backend's generated_artifacts table has no such column (approvals
      // are their own table, per artifact_type, not per artifact row). Fetch
      // both in parallel and cross-reference by artifact_type below, rather
      // than reading a field the API response never actually contains.
      const [data, approvalsData] = await Promise.all([
        apiRequest<Artifact[]>(`/generated_artifacts?project_id=${projectId}`),
        apiRequest<Approval[]>(`/projects/${projectId}/approvals`).catch(() => [] as Approval[]),
      ]);
      if (requestProjectIdRef.current === projectId) {
        const normalized: Artifact[] = (data || []).map((a) => ({
          ...a,
          content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content),
        }));
        setArtifacts(normalized);
        setApprovals(approvalsData || []);
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
    setApprovals([]);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // GET /generated_artifacts returns every row ever created for the project,
  // oldest first (created_at ASC) — an agent can be re-run any number of times
  // (retry after failure, explicit re-run, Resume) and each run inserts a new
  // row rather than overwriting the old one. Picking the *first* match of a
  // type therefore returns the earliest generation, not the current one; on
  // any project with a re-run this silently showed stale/empty content (e.g.
  // an early failed attempt's 0-file result instead of the successful retry).
  // Sort by created_at (id as a tiebreaker) and take the last one instead.
  const latestByType = useCallback(
    (type: ArtifactType): Artifact | null => {
      const matches = artifacts.filter((a) => a.artifact_type === type);
      if (matches.length === 0) return null;
      return matches.reduce((latest, a) => {
        const latestTime = Date.parse(latest.created_at) || 0;
        const aTime = Date.parse(a.created_at) || 0;
        if (aTime !== latestTime) return aTime > latestTime ? a : latest;
        return Number(a.id) > Number(latest.id) ? a : latest;
      });
    },
    [artifacts]
  );

  const getArtifact = useCallback(
    (type: ArtifactType): Record<string, unknown> | null => {
      const match = latestByType(type);
      if (!match) return null;
      return parseContent(match.content);
    },
    [latestByType]
  );

  const getRawArtifact = useCallback(
    (type: ArtifactType): Artifact | null => {
      return latestByType(type);
    },
    [latestByType]
  );

  const getApprovalStatus = useCallback(
    (type: ArtifactType): string | null => {
      // Approvals live in their own table (Approval.artifact_type), not as a
      // field on GeneratedArtifact — the backend response for
      // /generated_artifacts never carries approval_status. Same
      // latest-wins tie-break as latestByType: an artifact_type can accrue
      // more than one Approval row over a project's lifetime (e.g. a reject
      // + resubmit), so take the highest id, not the first.
      const matches = approvals.filter((a) => a.artifact_type === type);
      if (matches.length === 0) return null;
      const latest = matches.reduce((acc, a) => (Number(a.id) > Number(acc.id) ? a : acc));
      return latest.status || null;
    },
    [approvals]
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
    // DatabaseAgent (agents/database/) — the platform's single Database Agent
    // implementation — emits `entities` (table_name/columns[].data_type/
    // primary_keys[]/unique_constraints[]) and `relationships` keyed by
    // source_table/target_table/relation_type/foreign_key. This UI's
    // TableDef/RelationshipDef shapes (tables/type/from_table/to_table)
    // predate that and were never updated to match, so real generated
    // schemas silently rendered as "0 tables" here. Map field names at this
    // boundary rather than changing either schema's own vocabulary.
    const rawEntities = (data.entities as any[]) || (data.tables as any[]) || [];
    const tables = rawEntities.map((e) => {
      if (e && Array.isArray(e.columns) && e.columns.length > 0 && 'data_type' in e.columns[0]) {
        const primaryKeys: string[] = e.primary_keys || [];
        const uniqueConstraints: string[] = e.unique_constraints || [];
        return {
          name: e.table_name || e.name || '',
          columns: (e.columns || []).map((c: any) => ({
            name: c.name,
            type: c.data_type,
            nullable: c.nullable,
            primary_key: primaryKeys.includes(c.name),
            unique: uniqueConstraints.includes(c.name),
            default: c.default_value,
          })),
          indexes: e.indexes || [],
        };
      }
      return e; // already in {name, columns:[{type,...}], indexes} shape
    });
    const rawRelationships = (data.relationships as any[]) || [];
    const relationships = rawRelationships.map((r) =>
      'source_table' in r
        ? { from_table: r.source_table, to_table: r.target_table, type: r.relation_type, via: r.foreign_key || undefined }
        : r
    );
    return {
      tables,
      relationships,
      sql_ddl: (data.sql_ddl as string) || (data.migrationSQL as string) || '',
      normalization_notes: (data.normalization_notes as string) || '',
      audit_tables: (data.audit_tables as string[]) || [],
      sample_data: (data.sample_data as Record<string, any[]>) || {},
      migrations: (data.migrations as DatabaseSchemaContent['migrations']) || null,
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
      designSystem: (data.designSystem as UIUXDesignContent['designSystem']) || null,
      styleOptions: (data.styleOptions as UIUXDesignContent['styleOptions']) || [],
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
