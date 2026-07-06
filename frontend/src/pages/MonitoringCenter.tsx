import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Cpu,
  HardDrive,
  Network,
  Clock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Zap,
  Users,
  Server,
  Bell,
  BellOff,
} from 'lucide-react';
import { Card, StatusBadge, ProgressBar, PreviewBadge } from '../components/ui/Card';
import { mockAlerts } from '../data/mockData';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

const availabilityData = [
  { time: '00:00', value: 99.9 },
  { time: '04:00', value: 99.8 },
  { time: '08:00', value: 99.9 },
  { time: '12:00', value: 99.7 },
  { time: '16:00', value: 99.9 },
  { time: '20:00', value: 100 },
  { time: '24:00', value: 99.9 },
];

const latencyData = [
  { time: '00:00', api: 45, db: 12 },
  { time: '04:00', api: 52, db: 15 },
  { time: '08:00', api: 68, db: 18 },
  { time: '12:00', api: 85, db: 22 },
  { time: '16:00', api: 62, db: 16 },
  { time: '20:00', api: 48, db: 13 },
  { time: '24:00', api: 42, db: 11 },
];

export function MonitoringCenter() {
  const [alertFilter, setAlertFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');

  const filteredAlerts = mockAlerts.filter((a) =>
    alertFilter === 'all' ? true : a.severity === alertFilter
  );

  const criticalAlerts = mockAlerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length;
  const warningAlerts = mockAlerts.filter((a) => a.severity === 'warning' && !a.acknowledged).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">Monitoring Center</h1>
            <PreviewBadge />
          </div>
          <p className="mt-1 text-sm text-text-muted">System health, metrics, and alerting — showcasing planned functionality with sample data</p>
        </div>
        <div className="flex items-center gap-3">
          {criticalAlerts > 0 && (
            <StatusBadge status="error">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {criticalAlerts} Critical
            </StatusBadge>
          )}
          {warningAlerts > 0 && (
            <StatusBadge status="warning">
              <Bell className="mr-1 h-3 w-3" />
              {warningAlerts} Warnings
            </StatusBadge>
          )}
          <StatusBadge status="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            99.9% Uptime
          </StatusBadge>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-6">
        <Card className="text-center">
          <Activity className="h-5 w-5 text-status-success mx-auto mb-2" />
          <p className="text-xl font-bold text-status-success">99.9%</p>
          <p className="text-[10px] text-text-muted">Availability</p>
        </Card>
        <Card className="text-center">
          <Clock className="h-5 w-5 text-ey-yellow mx-auto mb-2" />
          <p className="text-xl font-bold text-text-primary">58ms</p>
          <p className="text-[10px] text-text-muted">Avg Latency</p>
        </Card>
        <Card className="text-center">
          <Network className="h-5 w-5 text-status-info mx-auto mb-2" />
          <p className="text-xl font-bold text-text-primary">12.4K</p>
          <p className="text-[10px] text-text-muted">Req/min</p>
        </Card>
        <Card className="text-center">
          <AlertTriangle className="h-5 w-5 text-status-warning mx-auto mb-2" />
          <p className="text-xl font-bold text-status-warning">0.2%</p>
          <p className="text-[10px] text-text-muted">Error Rate</p>
        </Card>
        <Card className="text-center">
          <DollarSign className="h-5 w-5 text-ey-yellow mx-auto mb-2" />
          <p className="text-xl font-bold text-ey-yellow">$892</p>
          <p className="text-[10px] text-text-muted">Infra Cost</p>
        </Card>
        <Card className="text-center">
          <Zap className="h-5 w-5 text-status-info mx-auto mb-2" />
          <p className="text-xl font-bold text-text-primary">2.4M</p>
          <p className="text-[10px] text-text-muted">Tokens Used</p>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Availability Chart */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title mb-0">System Availability</h3>
            <span className="text-xs text-text-muted">Last 24 hours</span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={availabilityData}>
                <defs>
                  <linearGradient id="colorAvailability" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FFE600" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FFE600" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="time" stroke="#64748B" fontSize={10} />
                <YAxis domain={[99, 100]} stroke="#64748B" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111',
                    border: '1px solid #222',
                    borderRadius: '8px',
                    color: '#E2E8F0',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#FFE600"
                  fillOpacity={1}
                  fill="url(#colorAvailability)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Latency Chart */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title mb-0">API & Database Latency</h3>
            <span className="text-xs text-text-muted">Last 24 hours</span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis dataKey="time" stroke="#64748B" fontSize={10} />
                <YAxis stroke="#64748B" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111',
                    border: '1px solid #222',
                    borderRadius: '8px',
                    color: '#E2E8F0',
                  }}
                />
                <Line type="monotone" dataKey="api" stroke="#3B82F6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="db" stroke="#22C55E" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-2">
            <span className="text-xs text-status-info flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-info" />
              API Latency
            </span>
            <span className="text-xs text-status-success flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-status-success" />
              DB Latency
            </span>
          </div>
        </Card>
      </div>

      {/* Resources & Alerts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Resource Usage */}
        <Card>
          <h3 className="section-title">Resource Usage</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-ey-yellow" />
                  <span className="text-xs text-text-primary">CPU Usage</span>
                </div>
                <span className="text-xs text-text-primary">42%</span>
              </div>
              <ProgressBar value={42} color="yellow" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-status-info" />
                  <span className="text-xs text-text-primary">Memory</span>
                </div>
                <span className="text-xs text-text-primary">68%</span>
              </div>
              <ProgressBar value={68} color="blue" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-status-success" />
                  <span className="text-xs text-text-primary">Network I/O</span>
                </div>
                <span className="text-xs text-text-primary">23%</span>
              </div>
              <ProgressBar value={23} color="green" />
            </div>
          </div>
        </Card>

        {/* Cost Optimization */}
        <Card>
          <h3 className="section-title">Cost Optimization</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
              <span className="text-xs text-text-muted">Output Velocity</span>
              <span className="text-sm font-semibold text-status-success flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                +12%
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
              <span className="text-xs text-text-muted">Token Burn Rate</span>
              <span className="text-sm font-semibold text-status-warning flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                -5%
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
              <span className="text-xs text-text-muted">Model Efficiency</span>
              <span className="text-sm font-semibold text-ey-yellow">89%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
              <span className="text-xs text-text-muted">Cost Savings</span>
              <span className="text-sm font-semibold text-status-success">$234/mo</span>
            </div>
          </div>
        </Card>

        {/* Active Users & System Health */}
        <Card>
          <h3 className="section-title">System Status</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Active Users</span>
              <span className="text-sm text-text-primary flex items-center gap-1">
                <Users className="h-3 w-3" />
                145
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Running Agents</span>
              <span className="text-sm text-text-primary flex items-center gap-1">
                <Server className="h-3 w-3" />
                3
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Security Status</span>
              <StatusBadge status="success">Protected</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Compliance</span>
              <StatusBadge status="success">Active</StatusBadge>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-dark-border">
            <p className="text-[10px] text-text-muted">Next maintenance window</p>
            <p className="text-xs text-text-primary mt-1">Sunday 02:00 - 04:00 UTC</p>
          </div>
        </Card>
      </div>

      {/* Alerts */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title mb-0">Active Alerts</h3>
          <div className="flex gap-2">
            {(['all', 'critical', 'warning', 'info'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setAlertFilter(f)}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  alertFilter === f
                    ? 'bg-ey-yellow/20 text-ey-yellow'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {filteredAlerts.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={`flex items-center gap-4 rounded-lg p-3 ${
                alert.severity === 'critical' ? 'bg-status-error/5 border border-status-error/20' :
                alert.severity === 'warning' ? 'bg-status-warning/5 border border-status-warning/20' :
                'bg-dark-bg border border-dark-border'
              }`}
            >
              {alert.severity === 'critical' && <AlertTriangle className="h-5 w-5 text-status-error" />}
              {alert.severity === 'warning' && <AlertTriangle className="h-5 w-5 text-status-warning" />}
              {alert.severity === 'info' && <Activity className="h-5 w-5 text-status-info" />}
              <div className="flex-1">
                <p className="text-sm text-text-primary">{alert.message}</p>
<p className="text-[10px] text-text-muted mt-0.5">
                  {alert.source} | {(() => {
                    const ts = new Date(alert.timestamp);
                    return isNaN(ts.getTime()) ? '-' : ts.toLocaleTimeString();
                  })()}
                </p>
              </div>
              {alert.acknowledged ? (
                <CheckCircle2 className="h-4 w-4 text-text-muted" />
              ) : (
                <button className="btn-ghost text-xs">
                  <BellOff className="mr-1 h-3 w-3" />
                  Acknowledge
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  );
}
