import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  X,
  Send,
  Building2,
  Database,
  Monitor,
  Code,
  Shield,
  TestTube,
  Rocket,
  Sparkles,
  Loader2,
  ChevronRight,
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type ReviewType =
  | 'architecture'
  | 'database'
  | 'ui'
  | 'code'
  | 'security'
  | 'testing'
  | 'deployment';

const reviewCapabilities: { type: ReviewType; label: string; icon: React.ElementType; desc: string }[] = [
  { type: 'architecture', label: 'Review Architecture', icon: Building2, desc: 'Analyze system design, patterns & tradeoffs' },
  { type: 'database', label: 'Review Database Design', icon: Database, desc: 'Check schema, indexes & normalization' },
  { type: 'ui', label: 'Review UI Design', icon: Monitor, desc: 'Evaluate UX, accessibility & consistency' },
  { type: 'code', label: 'Review Source Code', icon: Code, desc: 'Inspect code quality & best practices' },
  { type: 'security', label: 'Review Security Risks', icon: Shield, desc: 'Identify vulnerabilities & threats' },
  { type: 'testing', label: 'Review Test Coverage', icon: TestTube, desc: 'Assess test gaps & quality' },
  { type: 'deployment', label: 'Review Deployment Plans', icon: Rocket, desc: 'Validate CI/CD & infra readiness' },
];

const reviewResponses: Record<ReviewType, string[]> = {
  architecture: [
    'Analyzed the system architecture. The microservices decomposition is well-structured with clear bounded contexts. The API Gateway pattern correctly handles cross-cutting concerns.',
    'Recommendation: Consider adding a service mesh (e.g., Istio) for inter-service communication. Event-driven communication via Kafka is well-placed for the notification service.',
    'Tradeoff detected: The current trade-off between consistency and availability favors availability. For banking transactions, consider using the Saga pattern for distributed transactions.',
  ],
  database: [
    'Reviewed the database schema design. Proper use of UUID primary keys. The indexing strategy on users.email and transactions.created_at is optimal for query patterns.',
    'Recommendation: Add a composite index on (account_id, created_at) for the transactions table to optimize account statement queries.',
    'Consider adding soft-delete columns (deleted_at) to the users and accounts tables for audit compliance requirements.',
  ],
  ui: [
    'The UI design follows consistent spacing and typography. Component hierarchy is clean with proper separation of concerns.',
    'Accessibility: Missing ARIA labels on the form inputs. Add role attributes and ensure color contrast ratios meet WCAG 2.1 AA standards.',
    'Recommendation: The dashboard layout should implement responsive breakpoints. Mobile view needs a bottom navigation pattern for better thumb reachability.',
  ],
  code: [
    'Code quality is strong. TypeScript strict mode is enabled. Proper error handling patterns with try-catch blocks and graceful degradation.',
    'Issue found: The auth.service.ts has a potential race condition in the token refresh logic. Use a mutex or queue-based approach to prevent concurrent refresh calls.',
    'Best practice: Extract magic numbers into named constants. The timeout value of 30000 should be AUTH_TIMEOUT_MS for clarity.',
  ],
  security: [
    'Security review complete. OAuth 2.0 + MFA implementation follows industry standards. Password hashing uses bcrypt with appropriate work factor.',
    'Vulnerability: The API endpoints are missing rate limiting. Implement a sliding window rate limiter (e.g., 100 req/min per IP) to prevent brute force attacks.',
    'Recommendation: Add CSP headers and enable HSTS. The JWT token expiry should be reduced from 24h to 15min with refresh token rotation.',
  ],
  testing: [
    'Test coverage analysis: Current coverage is 94.2%. Unit tests are comprehensive for services, but integration test coverage for the API layer is at 62%.',
    'Gap identified: No E2E tests for the fund transfer flow. Critical path tests are needed for: login, account creation, and transaction processing.',
    'Recommendation: Add contract tests between services using Pact. Include performance testing in CI for API endpoints with p99 latency thresholds.',
  ],
  deployment: [
    'Deployment plan reviewed. The Terraform IaC is well-structured with proper module separation. Blue-green deployment strategy minimizes downtime.',
    'Issue: The CI/CD pipeline lacks automated rollback. Add a health check gate after deployment with automatic rollback on failure within 5 minutes.',
    'Recommendation: Container images should be scanned for vulnerabilities in the pipeline. Add Trivy or Snyk scanning before the push stage.',
  ],
};

export function AIReviewCopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Hello! I am the AI Review Copilot. I can review your architecture, database design, UI, source code, security risks, test coverage, and deployment plans. Select a review type below to get started.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleReview = (type: ReviewType) => {
    const capability = reviewCapabilities.find((c) => c.type === type)!;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: capability.label,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsAnalyzing(true);

    const responses = reviewResponses[type];
    responses.forEach((response, index) => {
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${index}`,
            role: 'assistant',
            content: response,
            timestamp: new Date(),
          },
        ]);
        if (index === responses.length - 1) {
          setIsAnalyzing(false);
        }
      }, (index + 1) * 1200);
    });
  };

  const handleSendMessage = () => {
    if (!input.trim() || isAnalyzing) return;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsAnalyzing(true);

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-response`,
          role: 'assistant',
          content: 'I can help with detailed reviews. Please select one of the review types below (Architecture, Database, UI, Code, Security, Testing, or Deployment) for a comprehensive analysis of your project artifacts.',
          timestamp: new Date(),
        },
      ]);
      setIsAnalyzing(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ey-yellow shadow-lg shadow-ey-yellow/30 hover:scale-110 transition-transform"
            title="AI Review Copilot"
          >
            <Bot className="h-6 w-6 text-dark-bg" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="absolute h-full w-full animate-ping rounded-full bg-status-success opacity-75" />
              <span className="relative h-4 w-4 rounded-full bg-status-success" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-40 flex h-[600px] max-h-[80vh] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-dark-border bg-dark-card shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-dark-border bg-dark-bg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ey-yellow">
                  <Bot className="h-5 w-5 text-dark-bg" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">AI Review Copilot</span>
                    <span className="flex h-2 w-2 rounded-full bg-status-success animate-pulse" />
                  </div>
                  <p className="text-[10px] text-text-muted">Intelligent review assistant</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-dark-cardHover hover:text-text-primary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      message.role === 'user'
                        ? 'bg-ey-yellow/20 text-text-primary'
                        : 'bg-dark-bg border border-dark-border text-text-secondary'
                    }`}
                  >
                    {message.role === 'assistant' && message.id !== '0' && (
                      <div className="mb-1 flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-ey-yellow" />
                        <span className="text-[10px] font-medium text-ey-yellow">AI Reviewer</span>
                      </div>
                    )}
                    {message.content}
                  </div>
                </motion.div>
              ))}

              {isAnalyzing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="flex items-center gap-2 rounded-lg bg-dark-bg border border-dark-border px-3 py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-ey-yellow" />
                    <span className="text-xs text-text-muted">Analyzing...</span>
                  </div>
                </motion.div>
              )}

              {/* Review Capabilities - always visible when no active analysis */}
              {!isAnalyzing && messages.length <= 2 && (
                <div className="space-y-2 pt-2 border-t border-dark-border">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide pt-2">Quick Reviews</p>
                  {reviewCapabilities.map((cap) => {
                    const Icon = cap.icon;
                    return (
                      <button
                        key={cap.type}
                        onClick={() => handleReview(cap.type)}
                        className="w-full flex items-center gap-3 rounded-lg border border-dark-border bg-dark-bg p-2 hover:border-ey-yellow/50 hover:bg-dark-cardHover transition-all group"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-dark-card group-hover:bg-ey-yellow/10 transition-colors">
                          <Icon className="h-4 w-4 text-text-muted group-hover:text-ey-yellow transition-colors" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-xs font-medium text-text-primary">{cap.label}</p>
                          <p className="text-[10px] text-text-muted">{cap.desc}</p>
                        </div>
                        <ChevronRight className="h-3 w-3 text-text-muted group-hover:text-ey-yellow transition-colors" />
                      </button>
                    );
                  })}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-dark-border p-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Ask about reviews or analysis..."
                  className="input-field flex-1 text-sm"
                  disabled={isAnalyzing}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || isAnalyzing}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-ey-yellow text-dark-bg hover:bg-ey-yellow/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}