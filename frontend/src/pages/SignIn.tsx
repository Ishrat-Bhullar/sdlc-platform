import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function SignIn() {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }
    setLoading(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const { error } = await fn(email.trim(), password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    if (mode === 'signup') {
      setError('Account created. You are now signed in.');
    }
    navigate('/app/dashboard');
  };

  return (
    <div className="min-h-screen bg-dark-bg flex flex-col">
      {/* Header */}
      <header className="border-b border-dark-border bg-dark-card/50 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link to="/" className="flex items-center gap-3 w-fit">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ey-yellow">
              <Zap className="h-6 w-6 text-dark-bg" />
            </div>
            <span className="text-lg font-semibold text-text-primary">EY Autonomous SDLC Studio</span>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="mb-8 text-center">
            <Link to="/" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary mb-4">
              <ArrowLeft className="h-3 w-3" />
              Back to home
            </Link>
            <h1 className="text-2xl font-bold text-text-primary">
              {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              {mode === 'signin'
                ? 'Sign in to your autonomous SDLC workspace'
                : 'Sign up to start building with AI agents'}
            </p>
          </div>

          {/* Form Card */}
          <div className="rounded-lg border border-dark-border bg-dark-card p-6 space-y-4">
            {error && (
              <div className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                error.includes('Account created')
                  ? 'border-status-success/30 bg-status-success/10 text-status-success'
                  : 'border-status-error/30 bg-status-error/10 text-status-error'
              }`}>
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-text-muted mb-1 block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="input-field w-full pl-9 text-sm"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-text-muted mb-1 block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-field w-full pl-9 pr-9 text-sm"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {mode === 'signin' && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-dark-border-light bg-dark-bg text-ey-yellow focus:ring-ey-yellow"
                    />
                    <span className="text-xs text-text-secondary">Remember me</span>
                  </label>
                  <button type="button" className="text-xs text-ey-yellow hover:text-ey-yellow/80">
                    Forgot Password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full text-sm"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                {mode === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            </form>

            <div className="border-t border-dark-border pt-4 text-center">
              <p className="text-xs text-text-muted">
                {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <button
                  onClick={() => {
                    setMode(mode === 'signin' ? 'signup' : 'signin');
                    setError(null);
                  }}
                  className="text-ey-yellow hover:text-ey-yellow/80 font-medium"
                >
                  {mode === 'signin' ? 'Sign Up' : 'Sign In'}
                </button>
              </p>
            </div>
          </div>

          <p className="mt-4 text-center text-[10px] text-text-muted">
            By continuing, you agree to the Terms of Service and Privacy Policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
}