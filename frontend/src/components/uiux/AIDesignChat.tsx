import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';

export interface ChatMessage {
  sender: 'user' | 'agent';
  text: string;
  time: string;
}

interface AIDesignChatProps {
  chatHistory: ChatMessage[];
  refining: boolean;
  onSendMessage: (text: string) => void;
}

// Ported from Bhumika's conversational design chat, simplified: the fake
// setInterval progress simulation is gone (there's no streaming backend for
// this), and onSendMessage now drives a real, blocking POST /agents/uiux
// refinement call — see UIUXWorkspace's handleRefine.
export function AIDesignChat({ chatHistory, refining, onSendMessage }: AIDesignChatProps) {
  const [input, setInput] = useState<string>('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, refining]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || refining) return;
    onSendMessage(text);
    setInput('');
  };

  const chips = [
    { label: 'More blue', pr: 'Shift the primary color palette toward blue tones' },
    { label: 'Pill buttons', pr: 'Use fully rounded, pill-shaped buttons throughout' },
    { label: 'Denser layout', pr: 'Reduce spacing and increase information density' },
    { label: 'Add a screen', pr: 'Add a settings screen for managing account preferences' },
  ];

  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-4 space-y-3 shadow-xl">
      <div className="flex items-center justify-between border-b border-dark-border pb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-ey-yellow" />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-primary">Refine with AI</span>
        </div>
        {refining && (
          <span className="text-[8px] text-ey-yellow font-mono uppercase flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> Refining...
          </span>
        )}
      </div>

      <div className="h-[210px] overflow-y-auto space-y-3 pr-1 text-[11px]">
        {chatHistory.length === 0 && (
          <p className="text-[10px] text-text-muted">Ask the UI/UX Agent to adjust colors, layout, or add/remove screens.</p>
        )}
        {chatHistory.map((ch, i) => (
          <div key={i} className={`flex flex-col ${ch.sender === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`p-2.5 rounded-xl max-w-[90%] leading-relaxed ${
                ch.sender === 'user' ? 'bg-ey-yellow text-black font-semibold rounded-tr-none' : 'bg-dark-bg text-text-secondary border border-dark-border rounded-tl-none'
              }`}
            >
              {ch.text}
            </div>
            <span className="text-[8px] text-text-muted mt-1 px-1">{ch.time}</span>
          </div>
        ))}
        <div ref={chatBottomRef} />
      </div>

      <div className="flex flex-wrap gap-1 border-t border-dark-border pt-2">
        {chips.map((chip) => (
          <button
            key={chip.label}
            onClick={() => onSendMessage(chip.pr)}
            disabled={refining}
            className="text-[8px] font-medium bg-dark-bg border border-dark-border hover:border-ey-yellow text-text-muted hover:text-ey-yellow px-2 py-0.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type adjustments (e.g. 'rounded corners', 'blue theme')..."
          className="flex-1 bg-dark-bg border border-dark-border rounded-xl p-2 text-xs text-white focus:outline-none focus:border-ey-yellow"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || refining}
          className="p-2 bg-ey-yellow text-black font-bold rounded-xl hover:opacity-90 disabled:opacity-40"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
