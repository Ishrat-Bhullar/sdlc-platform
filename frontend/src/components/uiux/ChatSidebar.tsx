import React, { useState } from 'react';

export default function ChatSidebar({ messages, loading, error, onSend }: { messages: any[], loading: boolean, error: string | null, onSend: any }) {
  const [prompt, setPrompt] = useState('');

  const handleSend = () => {
    if (!prompt.trim()) return;
    onSend(prompt.trim());
    setPrompt('');
  };

  return (
    <aside className="w-[400px] flex flex-col p-6 gap-5 bg-gray-900 border border-gray-800 rounded-xl h-full shadow-lg">
      <div>
        <h1 className="text-2xl font-extrabold m-0 mb-2 bg-gradient-to-br from-[#a855f7] to-[#6366f1] bg-clip-text text-transparent">
          UI/UX Agent
        </h1>
        <p className="m-0 text-gray-400 text-sm">Conversational Editor</p>
      </div>
      
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2">
        {messages.filter((m: any) => m.role === 'user').map((msg: any, i: number) => (
           <div key={i} className="bg-white/10 p-4 rounded-2xl rounded-tr-sm text-sm text-textPrimary self-end max-w-[90%] shadow-sm">
             {msg.content}
           </div>
        ))}
        
        {loading && (
          <div className="text-[#a855f7] font-semibold text-sm self-start mt-2 flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-[#a855f7] border-t-transparent rounded-full animate-spin"></div>
            Architecting Design...
          </div>
        )}
        
        {error && <div className="text-red-500 text-sm mt-2 p-3 bg-red-500/10 rounded-xl">{error}</div>}
      </div>
      
      <div className="flex gap-3 mt-auto pt-4 border-t border-white/10">
        <input 
          type="text"
          className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none transition-all duration-200 focus:border-[#a855f7]"
          placeholder="Edit UI (e.g. Make buttons rounded)..."
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
        />
        <button 
          className="bg-[#a855f7] text-white border-none rounded-xl px-5 font-semibold cursor-pointer transition-all duration-200 hover:bg-[#9333ea] active:scale-95 disabled:opacity-50 flex items-center justify-center min-w-[80px]" 
          onClick={handleSend}
          disabled={loading || !prompt.trim()}
        >
          Send
        </button>
      </div>
    </aside>
  );
}
