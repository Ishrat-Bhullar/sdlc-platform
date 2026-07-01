import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { AIWorkspace } from './pages/AIWorkspace';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { RequirementsWorkspace } from './pages/RequirementsWorkspace';
import { ArchitectureWorkspace } from './pages/ArchitectureWorkspace';
import { DatabaseWorkspace } from './pages/DatabaseWorkspace';
import { DevelopmentStudio } from './pages/DevelopmentStudio';
import { AgentControlCenter } from './pages/AgentControlCenter';
import { ApprovalCenter } from './pages/ApprovalCenter';
import { MCPIntegrationCenter } from './pages/MCPIntegrationCenter';
import { MonitoringCenter } from './pages/MonitoringCenter';
import { TemporalReplayCenter } from './pages/TemporalReplayCenter';
import { DocumentationCenter } from './pages/DocumentationCenter';
import { VideoGenerationWorkspace } from './pages/VideoGenerationWorkspace';
import { Settings } from './pages/Settings';
import { Projects } from './pages/Projects';
import { BusinessAnalystWorkspace } from './pages/BusinessAnalystWorkspace';
import { UIUXWorkspace } from './pages/UIUXWorkspace';
import { SecurityWorkspace } from './pages/SecurityWorkspace';
import { ComplianceWorkspace } from './pages/ComplianceWorkspace';
import { FrontendWorkspace } from './pages/FrontendWorkspace';
import { BackendWorkspace } from './pages/BackendWorkspace';
import { TestingWorkspace } from './pages/TestingWorkspace';
import { DocumentationWorkspace } from './pages/DocumentationWorkspace';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './components/ui/Toast';
import { Loader2 } from 'lucide-react';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-dark-bg">
        <Loader2 className="h-8 w-8 animate-spin text-ey-yellow" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/signin" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AIWorkspace />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/app" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="requirements" element={<RequirementsWorkspace />} />
        <Route path="business-analyst" element={<BusinessAnalystWorkspace />} />
        <Route path="architecture" element={<ArchitectureWorkspace />} />
        <Route path="database" element={<DatabaseWorkspace />} />
        <Route path="development" element={<DevelopmentStudio />} />
        <Route path="agents" element={<AgentControlCenter />} />
        <Route path="approvals" element={<ApprovalCenter />} />
        <Route path="mcp" element={<MCPIntegrationCenter />} />
        <Route path="monitoring" element={<MonitoringCenter />} />
        <Route path="temporal" element={<TemporalReplayCenter />} />
        <Route path="documentation" element={<DocumentationCenter />} />
        <Route path="video-generation" element={<VideoGenerationWorkspace />} />
        <Route path="uiux" element={<UIUXWorkspace />} />
        <Route path="security" element={<SecurityWorkspace />} />
        <Route path="compliance" element={<ComplianceWorkspace />} />
        <Route path="frontend" element={<FrontendWorkspace />} />
        <Route path="backend" element={<BackendWorkspace />} />
        <Route path="testing" element={<TestingWorkspace />} />
        <Route path="docs" element={<DocumentationWorkspace />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <AppRoutes />
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;