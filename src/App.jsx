import { useState, useEffect, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import Tree from 'react-d3-tree';
import { italianGameData } from './data/italianGame';
import './index.css';

function App() {
  const [chess] = useState(new Chess());
  const [fen, setFen] = useState(chess.fen());
  const [currentNode, setCurrentNode] = useState(italianGameData);
  const [feedback, setFeedback] = useState('idle'); // 'idle', 'correct', 'incorrect'
  
  // To handle resizing of the tree container
  const treeContainerRef = useRef(null);
  const [translate, setTranslate] = useState({ x: 200, y: 50 });

  useEffect(() => {
    if (treeContainerRef.current) {
      const dimensions = treeContainerRef.current.getBoundingClientRect();
      setTranslate({
        x: dimensions.width / 2,
        y: 50
      });
    }
  }, []);

  const resetGame = () => {
    chess.reset();
    setFen(chess.fen());
    setCurrentNode(italianGameData);
    setFeedback('idle');
  };

  const getExpectedMoves = () => {
    return currentNode.children || [];
  };

  const onDrop = (sourceSquare, targetSquare, piece) => {
    console.log("ON DROP CALLED:", { sourceSquare, targetSquare, piece });
    const moveInfo = {
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q', // always promote to queen for simplicity here
    };

    try {
      // Create a test instance to validate move locally without committing immediately
      const testChess = new Chess(chess.fen());
      let move;
      try {
        move = testChess.move(moveInfo);
      } catch (e) {
        setFeedback('error: ' + e.message);
        return false;
      }
      
      if (!move) {
        setFeedback('invalid move returned false');
        return false; // Illegal move
      }

      const expectedMoves = getExpectedMoves();
      const expectedMoveNode = expectedMoves.find(m => m.move === move.san);

      if (expectedMoveNode) {
        // Correct move
        chess.move(moveInfo);
        setFen(chess.fen());
        setCurrentNode(expectedMoveNode);
        setFeedback('correct');

        // Automate computer response if there's only one follow-up or pick the main line
        if (expectedMoveNode.children && expectedMoveNode.children.length > 0) {
          setTimeout(() => {
            const nextNode = expectedMoveNode.children[0];
            chess.move(nextNode.move);
            setFen(chess.fen());
            setCurrentNode(nextNode);
            setFeedback('idle');
          }, 500);
        } else {
          setTimeout(() => setFeedback('idle'), 1000);
        }
        return true;
      } else {
        // Incorrect move
        setFeedback('incorrect: expected ' + expectedMoves.map(m=>m.move).join(', ') + ' but got ' + move.san);
        setTimeout(() => setFeedback('idle'), 2000);
        return false;
      }

    } catch (e) {
      setFeedback('outer error: ' + e.message);
      return false; // Invalid move
    }
  };

  const renderCustomNodeElement = ({ nodeDatum, toggleNode }) => {
    const isCurrent = nodeDatum.id === currentNode.id;
    return (
      <g>
        <circle 
          r="15" 
          fill={isCurrent ? "#3b82f6" : "#1e293b"} 
          stroke={isCurrent ? "#93c5fd" : "#475569"} 
          strokeWidth="3"
        />
        <text 
          fill={isCurrent ? "#93c5fd" : "#cbd5e1"} 
          strokeWidth="1" 
          x="20" 
          dy="5"
          className="text-sm font-medium"
        >
          {nodeDatum.name}
        </text>
      </g>
    );
  };

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      
      {/* Sidebar / Tree Area */}
      <div className="w-1/3 flex flex-col border-r border-slate-700 bg-slate-800 shadow-xl z-10 relative">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/80 backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">Opening Trainer</h1>
            <p className="text-sm text-slate-400 mt-1">Italian Game (Mock)</p>
          </div>
          <button 
            onClick={resetGame}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            Reset
          </button>
        </div>
        
        <div className="flex-1 w-full relative" ref={treeContainerRef}>
          <div className="absolute inset-0">
            <Tree 
              data={italianGameData} 
              orientation="vertical"
              pathFunc="step"
              translate={translate}
              nodeSize={{x: 100, y: 80}}
              renderCustomNodeElement={renderCustomNodeElement}
              styles={{
                links: { stroke: '#475569', strokeWidth: 2 },
              }}
            />
          </div>
        </div>
      </div>

      {/* Main Board Area */}
      <div className="w-2/3 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 relative">
        
        {/* Background Decorative Blob */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="mb-8 text-center z-10">
          <h2 className="text-3xl font-semibold mb-2">Your Move</h2>
          <p className="text-slate-400 h-6">
            {feedback === 'incorrect' && <span className="text-red-400 font-medium">Incorrect move. Try again!</span>}
            {feedback === 'correct' && <span className="text-emerald-400 font-medium">Excellent!</span>}
            {feedback === 'idle' && <span>Follow the opening line...</span>}
          </p>
        </div>

        <div 
          className={`w-[600px] h-[600px] rounded-lg shadow-2xl p-4 transition-colors duration-300 z-10 
            ${feedback === 'correct' ? 'bg-emerald-500/20 shadow-emerald-500/20' : 
              feedback === 'incorrect' ? 'bg-red-500/20 shadow-red-500/20' : 'bg-slate-800/50'}`}
        >
          <Chessboard 
            position={fen} 
            onPieceDrop={onDrop}
            customDarkSquareStyle={{ backgroundColor: 'var(--color-board-dark)' }}
            customLightSquareStyle={{ backgroundColor: 'var(--color-board-light)' }}
            customBoardStyle={{
              borderRadius: '0.25rem',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.5)',
            }}
            animationDuration={300}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
