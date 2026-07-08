import React, { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import UIRenderer from './UIRenderer';

const PageNode = ({ data }: { data: any }) => {
  return (
    <div className="bg-gray-900 border-2 border-indigo-500 rounded-xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto transition-transform hover:scale-[1.02]">
      <Handle type="target" position={Position.Left} style={{ background: '#a855f7', width: '10px', height: '10px' }} />
      
      {/* Browser-like Header */}
      <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex justify-between items-center gap-4">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
        </div>
        <div className="flex-1 text-center">
          <h3 className="text-gray-300 font-medium text-xs truncate">{data.page_name || 'Webpage'}</h3>
        </div>
        <span className="text-[10px] bg-black/40 text-gray-400 px-2 py-0.5 rounded-full font-mono shrink-0">
          {data.path || '/'}
        </span>
      </div>
      
      <div className="relative bg-white overflow-hidden" style={{ width: '400px', height: '300px' }}>
        <div 
          className="absolute top-0 left-0 origin-top-left bg-white text-black"
          style={{ 
            width: '1280px', 
            height: '960px',
            transform: 'scale(0.3125)' // 400 / 1280
          }}
        >
          {data.component_tree ? (
            <UIRenderer node={data.component_tree} />
          ) : (
            <div className="flex items-center justify-center w-full h-full text-4xl text-gray-400 bg-gray-100">
              No Component Tree Generated
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#a855f7', width: '10px', height: '10px' }} />
    </div>
  );
};

const nodeTypes = {
  pageNode: PageNode,
};

const DesignViewer = ({ spec }: { spec: any }) => {
  if (!spec) return null;

  // Normalize raw array response if AI hallucinates
  let normalizedSpec = spec;
  if (Array.isArray(spec)) {
    // Check if it looks like the old wireframes schema or the new pages schema
    if (spec[0]?.component_tree) {
       normalizedSpec = { pages: spec };
    } else {
       normalizedSpec = { wireframes: spec };
    }
  } else if (typeof spec !== 'object') {
    return (
      <div className="w-full h-full p-8 overflow-y-auto bg-black/20 text-gray-300 font-sans rounded-xl border border-white/10 whitespace-pre-wrap">
        {String(spec)}
      </div>
    );
  }

  // Support both 'pages' (high-fidelity mockups) and 'wireframes' (old format fallback)
  const { project_name, design_system, pages = [], wireframes = [], user_flows = [] } = normalizedSpec;
  
  // Use pages if available, otherwise wireframes
  const nodesData = pages.length > 0 ? pages : wireframes;

  const { nodes, edges } = useMemo(() => {
    const initialNodes: any[] = [];
    const initialEdges: any[] = [];

    nodesData.forEach((page: any, i: number) => {
      initialNodes.push({
        id: `node-${i}`,
        type: 'pageNode',
        position: { x: i * 500 + 50, y: (i % 2 === 0 ? 50 : 200) },
        data: page,
      });

      // Connect Home page (node 0) to all subpages
      if (i > 0) {
        initialEdges.push({
          id: `edge-0-${i}`,
          source: 'node-0',
          target: `node-${i}`,
          animated: true,
          style: { stroke: '#a855f7', strokeWidth: 3 },
        });
      }
    });

    return { nodes: initialNodes, edges: initialEdges };
  }, [nodesData]);

  return (
    <div className="w-full h-full flex flex-col bg-[#0f111a] rounded-xl overflow-hidden relative border border-white/10 shadow-2xl">
      <style>{`
        .react-flow__controls-button {
          background-color: #1f2937 !important;
          border-bottom: 1px solid #374151 !important;
        }
        .react-flow__controls-button svg {
          fill: #9ca3af !important;
        }
        .react-flow__controls-button:hover {
          background-color: #374151 !important;
        }
      `}</style>
      
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent drop-shadow-md">
          {project_name || 'High-Fidelity Mockups'}
        </h1>
        {design_system && (
          <div className="mt-4 flex gap-2 pointer-events-auto">
             {Object.entries(design_system.colors || {}).map(([name, hex]) => (
                <div key={name} className="w-8 h-8 rounded-full border border-white/20 shadow-lg" style={{ backgroundColor: hex }} title={`${name}: ${hex}`} />
             ))}
          </div>
        )}
      </div>

      {nodesData.length > 0 ? (
        <div className="flex-1 w-full h-full">
          <ReactFlow 
            nodes={nodes} 
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            className="bg-black/20"
          >
            <Background color="#333" gap={16} />
            <Controls />
          </ReactFlow>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4 items-center justify-center text-gray-500">
           <p>No pages generated yet.</p>
           <pre className="text-xs bg-black/50 p-4 rounded text-left max-w-[80%] overflow-x-auto">
             {JSON.stringify(normalizedSpec, null, 2)}
           </pre>
        </div>
      )}
    </div>
  );
};

export default DesignViewer;
