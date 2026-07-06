import { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = '', hover = false, glow = false, onClick }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`card ${hover ? 'card-hover cursor-pointer' : ''} ${glow ? 'glow-effect' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
  icon?: ReactNode;
  color?: 'yellow' | 'green' | 'blue' | 'red' | 'gray';
}

export function KPICard({ title, value, change, trend, icon, color = 'gray' }: KPICardProps) {
  const colorClasses: Record<string, string> = {
    yellow: 'text-ey-yellow',
    green: 'text-status-success',
    blue: 'text-status-info',
    red: 'text-status-error',
    gray: 'text-text-secondary',
  };

  const trendColors = {
    up: 'text-status-success',
    down: 'text-status-error',
    neutral: 'text-text-muted',
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-secondary">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary">{value}</p>
          {change !== undefined && (
            <p className={`mt-1 text-xs ${trend ? trendColors[trend] : 'text-text-muted'}`}>
              {trend === 'up' && '+'}
              {change}% from last week
            </p>
          )}
        </div>
        {icon && (
          <div className={`rounded-lg p-2 bg-dark-bg ${colorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

interface PreviewBadgeProps {
  label?: string;
  className?: string;
}

/**
 * Marks a module that isn't wired to a real backend agent yet (or whose
 * output isn't production-grade yet) so users don't mistake demo/preview
 * content for a genuine AI-generated result.
 */
export function PreviewBadge({ label = 'Preview — Planned Functionality', className = '' }: PreviewBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-ey-yellow/30 bg-ey-yellow/10 px-3 py-1 text-xs font-medium text-ey-yellow ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-ey-yellow" />
      {label}
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  children: ReactNode;
  className?: string;
}

export function StatusBadge({ status, children, className = '' }: StatusBadgeProps) {
  const statusClasses: Record<string, string> = {
    success: 'status-badge-success',
    connected: 'status-badge-success',
    completed: 'status-badge-success',
    approved: 'status-badge-success',
    warning: 'status-badge-warning',
    syncing: 'status-badge-warning',
    waiting: 'status-badge-warning',
    running: 'status-badge-info',
    info: 'status-badge-info',
    error: 'status-badge-error',
    failed: 'status-badge-error',
    rejected: 'status-badge-error',
    disconnected: 'status-badge-error',
    idle: 'bg-dark-border text-text-secondary border border-dark-border-light',
    pending: 'bg-dark-border text-text-secondary border border-dark-border-light',
  };

  return (
    <span className={`status-badge ${statusClasses[status] || statusClasses.idle} ${className}`}>
      {children}
    </span>
  );
}

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: 'yellow' | 'green' | 'blue' | 'red' | 'gray';
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ProgressBar({ value, max = 100, color = 'yellow', showLabel = false, size = 'md', className = '' }: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  const colorClasses = {
    yellow: 'bg-ey-yellow',
    green: 'bg-status-success',
    blue: 'bg-status-info',
    red: 'bg-status-error',
    gray: 'bg-text-muted',
  };

  const sizeClasses = {
    sm: 'h-1',
    md: 'h-1.5',
    lg: 'h-2.5',
  };

  return (
    <div className={`w-full ${className}`}>
      <div className={`progress-bar ${sizeClasses[size]}`}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={`h-full rounded-full ${colorClasses[color]}`}
        />
      </div>
      {showLabel && (
        <p className="mt-1 text-xs text-text-muted text-right">{Math.round(percentage)}%</p>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="mb-4 text-text-muted">{icon}</div>}
      <h3 className="text-lg font-medium text-text-primary">{title}</h3>
      {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

interface ButtonProps {
  children: ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  onClick?: () => void;
}

export function Button({ children, className = '', variant = 'primary', onClick }: ButtonProps) {
  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
  };

  return (
    <button
      className={`${variantClasses[variant]} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
