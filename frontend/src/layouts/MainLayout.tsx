import { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getSelectedProjectId, subscribeToSelectedProject } from '../lib/projectContext';
import { apiRequest } from '../lib/api';
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  Building2,
  Database,
  Code2,
  Bot,
  CheckCircle2,
  Plug,
  Activity,
  Clock,
  BookOpen,
  Settings,
  Home,
  Search,
  Bell,
  User,
  ChevronDown,
  Shield,
  Zap,
  Video,
  Monitor,
  Lock,
  FileCheck,
  TestTube,
} from 'lucide-react';
import { AIReviewCopilot } from '../components/shared/AIReviewCopilot';
import { useAuth } from '../lib/auth';

const navItems = [
  { path: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/app/projects', label: 'Projects', icon: FolderKanban },
  { path: '/app/requirements', label: 'Requirements', icon: FileText },
  { path: '/app/business-analyst', label: 'Business Analyst', icon: FileText },
  { path: '/app/architecture', label: 'Architecture', icon: Building2 },
  { path: '/app/database', label: 'Database', icon: Database },
  { path: '/app/uiux', label: 'UI/UX Design', icon: Monitor },
  { path: '/app/security', label: 'Security', icon: Shield },
  { path: '/app/compliance', label: 'Compliance', icon: FileCheck },
  { path: '/app/frontend', label: 'Frontend', icon: Code2 },
  { path: '/app/backend', label: 'Backend', icon: Code2 },
  { path: '/app/testing', label: 'Testing', icon: TestTube },
  { path: '/app/docs', label: 'Documentation', icon: BookOpen },
  { path: '/app/development', label: 'Development Studio', icon: Code2 },
  { path: '/app/agents', label: 'Agent Control Center', icon: Bot },
  { path: '/app/approvals', label: 'Approvals Center', icon: CheckCircle2 },
  { path: '/app/mcp', label: 'MCP Integration Center', icon: Plug },
  { path: '/app/monitoring', label: 'Monitoring Center', icon: Activity },
  { path: '/app/temporal', label: 'Temporal Replay Center', icon: Clock },
  { path: '/app/video-generation', label: 'Video Generation Agent', icon: Video },
];

export function MainLayout() {
  const [sidebarCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeProjectName, setActiveProjectName] = useState<string>('');

  const loadProjectName = useCallback(async () => {
    const pid = getSelectedProjectId();
    if (!pid) { setActiveProjectName(''); return; }
    try {
      const p = await apiRequest<{ name: string }>(`/projects/${pid}`);
      setActiveProjectName(p.name || '');
    } catch { setActiveProjectName(''); }
  }, []);

  useEffect(() => {
    loadProjectName();
    return subscribeToSelectedProject(() => loadProjectName());
  }, [loadProjectName]);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const profileRef = useRef<HTMLDivElement>(null);

  const userEmail = user?.email || '';
  const userInitial = userEmail ? userEmail[0].toUpperCase() : 'U';
  const userName = userEmail ? userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'User';

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/signin');
  };

  return (
    <div className="flex h-screen bg-dark-bg">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-dark-border bg-dark-card transition-all duration-300 ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-dark-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ey-yellow">
            <Zap className="h-5 w-5 text-dark-bg" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-text-primary">EY Autonomous</span>
              <span className="text-xs text-text-muted">SDLC Studio</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-0.5 px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
                    title={item.label}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Settings */}
        <div className="border-t border-dark-border p-2">
          <NavLink
            to="/app/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
          >
            <Settings className="h-5 w-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-sm">Settings</span>}
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-dark-border bg-dark-card px-6">
          <div className="flex items-center gap-4">
            {/* Project Selector */}
            <div className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3 py-1.5">
              <div className="h-2 w-2 rounded-full bg-status-success" />
              <span className="text-sm font-medium text-text-primary">{activeProjectName || 'Select Project'}</span>
              <ChevronDown className="h-4 w-4 text-text-muted" />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="btn-ghost text-sm"
            >
              <Home className="mr-2 h-4 w-4" />
              Back to Home
            </button>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search..."
                className="input-field w-64 pl-9 text-sm"
              />
            </div>

            {/* Notifications */}
            <button className="relative rounded-lg p-2 text-text-secondary hover:bg-dark-cardHover hover:text-text-primary">
              <Bell className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-status-error" />
            </button>

            {/* System Health */}
            <div className="flex items-center gap-2 rounded-lg bg-dark-bg px-3 py-1.5">
              <div className="h-2 w-2 rounded-full bg-status-success animate-pulse" />
              <span className="text-xs text-text-secondary">All Systems Operational</span>
            </div>

            {/* User Profile */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-dark-cardHover"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ey-yellow/20">
                  <span className="text-xs font-semibold text-ey-yellow">{userInitial}</span>
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-text-primary">{userName}</p>
                  <p className="text-xs text-text-muted truncate max-w-[150px]">{userEmail}</p>
                </div>
                <ChevronDown className={`h-4 w-4 text-text-muted transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-dark-border bg-dark-card shadow-xl py-2 z-50">
                  <div className="px-4 py-2 border-b border-dark-border">
                    <p className="text-sm font-medium text-text-primary">{userName}</p>
                    <p className="text-xs text-text-muted truncate">{userEmail}</p>
                  </div>
                  <NavLink to="/app/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:bg-dark-bg hover:text-text-primary">
                    <User className="h-4 w-4" />
                    Profile & Settings
                  </NavLink>
                  <button onClick={handleSignOut} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-status-error hover:bg-dark-bg">
                    <Shield className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-dark-bg p-6">
          <Outlet />
        </main>

        <AIReviewCopilot />
      </div>
    </div>
  );
}
