import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { openingBook, lookupByMoves } from '@chess-openings/eco.json';
import { 
  Loader2, 
  Plus, 
  Trash2, 
  Volume2, 
  VolumeX, 
  RefreshCw, 
  Eye, 
  BookOpen, 
  HelpCircle,
  X
} from 'lucide-react';
import Tree from 'react-d3-tree';
import './index.css';

// Static style constants for Chessboard to optimize rendering performance
const DARK_SQUARE_STYLE = { backgroundColor: '#b58863' };
const LIGHT_SQUARE_STYLE = { backgroundColor: '#f0d9b5' };
const BOARD_STYLE = { borderRadius: '0.375rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' };

// Curated list of popular openings for default repertoire
const PopularOpenings = [
  { Name: "Italian Game", Moves: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5" },
  { Name: "Ruy Lopez", Moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6" },
  { Name: "Caro-Kann Defense", Moves: "1. e4 c6 2. d4 d5 3. Nc3 dxe4" },
  { Name: "Sicilian Defense", Moves: "1. e4 c5 2. Nf3 d6 3. d4 cxd4" },
  { Name: "French Defense", Moves: "1. e4 e6 2. d4 d5 3. Nc3 Nf6" }
];

/**
 * Helper: Clone a Chess.js game by replaying its PGN into a fresh instance.
 * This guarantees a distinct object identity so React always detects state changes.
 */
function cloneGame(game) {
  const copy = new Chess();
  const pgn = game.pgn();
  if (pgn) {
    copy.loadPgn(pgn);
  }
  return copy;
}

/**
 * Helper: Parse a PGN string into an array of SAN moves.
 */
function pgnToMoves(pgn) {
  const temp = new Chess();
  try {
    temp.loadPgn(pgn);
    return temp.history();
  } catch {
    return [];
  }
}

export default function App() {
  // ──────────────────────── Core game state ────────────────────────
  const [game, setGame] = useState(new Chess());
  const [openings, setOpenings] = useState(null);
  const [detectedOpening, setDetectedOpening] = useState('Starting Position');
  const [isLoadingEco, setIsLoadingEco] = useState(true);
  const [lastError, setLastError] = useState('');

  // Repertoire state (persisted in localStorage)
  const [repertoire, setRepertoire] = useState(() => {
    const saved = localStorage.getItem('chess_repertoire');
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return PopularOpenings;
  });

  // Trainer Mode Settings
  const [isTrainerMode, setIsTrainerMode] = useState(false);
  const [playerColor, setPlayerColor] = useState('w');
  const [targetOpening, setTargetOpening] = useState(() => {
    const saved = localStorage.getItem('chess_repertoire');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed[0];
      } catch { /* ignore */ }
    }
    return PopularOpenings[0];
  });
  const [expectedMoves, setExpectedMoves] = useState([]);
  const [treeData, setTreeData] = useState({ name: 'Start' });
  const [muted, setMuted] = useState(false);

  // Live evaluation states
  const [evalScore, setEvalScore] = useState(0.3);
  const [evalType, setEvalType] = useState('cp');
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Click-to-move selection state
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState([]);

  // Custom opening modal states
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newOpeningName, setNewOpeningName] = useState('');
  const [newOpeningMoves, setNewOpeningMoves] = useState('');
  const [addError, setAddError] = useState('');

  // Refs
  const treeContainerRef = useRef(null);
  const engineWorkerRef = useRef(null);
  const opponentTimeoutRef = useRef(null);

  // ──────────────────────── Audio ────────────────────────
  const playSound = useCallback((isCapture = false) => {
    if (muted) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (isCapture) {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch {
      // Web Audio not available
    }
  }, [muted]);

  // ──────────────────────── Stockfish worker init ────────────────────────
  useEffect(() => {
    try {
      const wasmSupported =
        typeof WebAssembly === 'object' &&
        WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
      engineWorkerRef.current = new Worker(
        wasmSupported ? '/stockfish.wasm.js' : '/stockfish.js'
      );
    } catch (e) {
      console.warn('Failed to initialize Stockfish worker:', e);
    }

    return () => {
      if (engineWorkerRef.current) {
        engineWorkerRef.current.terminate();
        engineWorkerRef.current = null;
      }
      if (opponentTimeoutRef.current) {
        clearTimeout(opponentTimeoutRef.current);
      }
    };
  }, []);

  // ──────────────────────── ECO database loading ────────────────────────
  useEffect(() => {
    openingBook()
      .then((data) => {
        setOpenings(data);
        setIsLoadingEco(false);
      })
      .catch((err) => {
        console.error('Failed to load ECO database:', err);
        setIsLoadingEco(false);
      });
  }, []);

  // ──────────────────────── Move tree builder ────────────────────────
  const buildMoveTree = useCallback((movesArray, currentIndex) => {
    const rootNode = {
      name: 'Start',
      attributes: { status: 'Played', index: 0 },
      nodeSvgShape: {
        shape: 'circle',
        shapeProps: { r: 12, fill: '#b58863', stroke: '#1c1917', strokeWidth: 2 },
      },
    };
    let currentNode = rootNode;

    movesArray.forEach((move, idx) => {
      const isPlayed = idx < currentIndex;
      const isNext = idx === currentIndex;
      const newNode = {
        name: move,
        attributes: {
          status: isPlayed ? 'Played' : isNext ? 'Next' : 'Pending',
          index: idx + 1,
        },
        nodeSvgShape: {
          shape: 'circle',
          shapeProps: {
            r: 10,
            fill: isPlayed ? '#b58863' : isNext ? '#f0d9b5' : '#57534e',
            stroke: '#1c1917',
            strokeWidth: 2,
          },
        },
      };
      currentNode.children = [newNode];
      currentNode = newNode;
    });

    setTreeData(rootNode);
  }, []);

  // ──────────────────────── Reset game ────────────────────────
  const resetGame = useCallback(
    (overrideMoves) => {
      if (opponentTimeoutRef.current) {
        clearTimeout(opponentTimeoutRef.current);
        opponentTimeoutRef.current = null;
      }

      const moves = overrideMoves || expectedMoves;
      const fresh = new Chess();
      setLastError('');
      setDetectedOpening('Starting Position');
      buildMoveTree(moves, 0);

      // If practicing as black, auto-play the first move for white
      if (isTrainerMode && playerColor === 'b' && moves.length > 0) {
        try {
          fresh.move(moves[0]);
          buildMoveTree(moves, 1);
        } catch {
          // First move invalid — leave board at start
        }
      }

      setGame(fresh);
    },
    [expectedMoves, isTrainerMode, playerColor, buildMoveTree]
  );

  // ──────────────────────── Sync target opening ────────────────────────
  useEffect(() => {
    if (targetOpening) {
      const moves = pgnToMoves(targetOpening.Moves);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpectedMoves(moves);

      // Reset with the new moves
      if (opponentTimeoutRef.current) {
        clearTimeout(opponentTimeoutRef.current);
        opponentTimeoutRef.current = null;
      }

      const fresh = new Chess();
      setLastError('');
      setDetectedOpening('Starting Position');
      buildMoveTree(moves, 0);

      if (isTrainerMode && playerColor === 'b' && moves.length > 0) {
        try {
          fresh.move(moves[0]);
          buildMoveTree(moves, 1);
        } catch {
          // ignore
        }
      }

      setGame(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetOpening, playerColor, isTrainerMode]);

  // ──────────────────────── Stockfish evaluation ────────────────────────
  useEffect(() => {
    const worker = engineWorkerRef.current;
    if (!worker) return;

    worker.postMessage('stop');
    setIsEvaluating(true);

    const fen = game.fen();
    const isWhiteToMove = fen.split(' ')[1] === 'w';

    const listener = (e) => {
      const line = e.data;
      if (typeof line !== 'string') return;

      if (line.includes('info depth')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (cpMatch) {
          const score = parseInt(cpMatch[1], 10) / 100;
          setEvalScore(isWhiteToMove ? score : -score);
          setEvalType('cp');
        } else if (mateMatch) {
          const mateIn = parseInt(mateMatch[1], 10);
          setEvalScore(isWhiteToMove ? mateIn : -mateIn);
          setEvalType('mate');
        }
      }

      if (line.startsWith('bestmove')) {
        setIsEvaluating(false);
        worker.removeEventListener('message', listener);
      }
    };

    worker.addEventListener('message', listener);
    worker.postMessage('ucinewgame');
    worker.postMessage('position fen ' + fen);
    worker.postMessage('go depth 12');

    return () => {
      worker.postMessage('stop');
      worker.removeEventListener('message', listener);
    };
  }, [game]);

  // ──────────────────────── Auto-play opponent move ────────────────────────
  const autoPlayOpponentMove = useCallback(
    (currentGame, moveIndex, moves) => {
      const targetMoves = moves || expectedMoves;
      if (moveIndex >= targetMoves.length) {
        setLastError('Opening sequence completed! 🎉');
        return;
      }

      const nextMove = targetMoves[moveIndex];

      if (opponentTimeoutRef.current) {
        clearTimeout(opponentTimeoutRef.current);
      }

      opponentTimeoutRef.current = setTimeout(() => {
        const copy = cloneGame(currentGame);
        try {
          const result = copy.move(nextMove);
          if (result) {
            setGame(copy);
            buildMoveTree(targetMoves, moveIndex + 1);
            playSound(!!result.captured);
          }
        } catch {
          // opponent move failed — leave board as is
        }
        opponentTimeoutRef.current = null;
      }, 500);
    },
    [expectedMoves, buildMoveTree, playSound]
  );

  // ──────────────────────── Tree node click handler ────────────────────────
  const handleNodeClick = useCallback(
    (nodeDatum) => {
      if (!isTrainerMode) return;

      if (opponentTimeoutRef.current) {
        clearTimeout(opponentTimeoutRef.current);
        opponentTimeoutRef.current = null;
      }

      const targetIndex =
        nodeDatum.attributes?.index !== undefined
          ? parseInt(nodeDatum.attributes.index, 10)
          : 0;

      const fresh = new Chess();
      for (let i = 0; i < targetIndex && i < expectedMoves.length; i++) {
        try { fresh.move(expectedMoves[i]); } catch { break; }
      }

      setGame(fresh);
      buildMoveTree(expectedMoves, targetIndex);
      setLastError('');
      playSound(false);

      // Trigger opponent response if it's their turn after the jump
      const isOpponentTurn =
        (playerColor === 'w' && targetIndex % 2 !== 0) ||
        (playerColor === 'b' && targetIndex % 2 === 0);
      if (isOpponentTurn && targetIndex < expectedMoves.length) {
        autoPlayOpponentMove(fresh, targetIndex);
      }
    },
    [isTrainerMode, expectedMoves, playerColor, buildMoveTree, playSound, autoPlayOpponentMove]
  );

  // ──────────────────────── Evaluate deviation via Stockfish ────────────────────────
  const evaluateDeviation = useCallback(
    async (expectedFen, actualFen, expectedMove, playedMove) => {
      setLastError('Analyzing mistake...');

      const getScore = (fen) =>
        new Promise((resolve) => {
          let tempWorker;
          try {
            const wasmSupported =
              typeof WebAssembly === 'object' &&
              WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
            tempWorker = new Worker(wasmSupported ? '/stockfish.wasm.js' : '/stockfish.js');
          } catch {
            resolve(0);
            return;
          }

          let score = 0;
          const timeout = setTimeout(() => {
            tempWorker.terminate();
            resolve(score);
          }, 3000);

          const handler = (e) => {
            const line = e.data;
            if (typeof line !== 'string') return;
            if (line.includes('info depth')) {
              const cpMatch = line.match(/score cp (-?\d+)/);
              if (cpMatch) score = parseInt(cpMatch[1], 10) / 100;
            }
            if (line.startsWith('bestmove')) {
              clearTimeout(timeout);
              tempWorker.terminate();
              const isWhite = fen.split(' ')[1] === 'w';
              resolve(isWhite ? score : -score);
            }
          };

          tempWorker.addEventListener('message', handler);
          tempWorker.postMessage('ucinewgame');
          tempWorker.postMessage('position fen ' + fen);
          tempWorker.postMessage('go depth 12');
        });

      const expectedScore = await getScore(expectedFen);
      const actualScore = await getScore(actualFen);

      const drop =
        playerColor === 'w'
          ? expectedScore - actualScore
          : actualScore - expectedScore;

      setLastError(
        `Mistake! Expected ${expectedMove}, but you played ${playedMove}. Evaluation dropped by ${Math.max(0, drop).toFixed(1)} points.`
      );
    },
    [playerColor]
  );

  // ──────────────────────── Execute a move (shared by click-to-move) ────────────────────────
  const executeMove = useCallback(
    (sourceSquare, targetSquare) => {
      const gameCopy = cloneGame(game);
      const currentMoveIndex = gameCopy.history().length;

      // In Trainer Mode, only allow the player to move on their own turn
      if (isTrainerMode) {
        const isPlayerTurn =
          (playerColor === 'w' && currentMoveIndex % 2 === 0) ||
          (playerColor === 'b' && currentMoveIndex % 2 !== 0);
        if (!isPlayerTurn) return false;
      }

      try {
        const moveResult = gameCopy.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: 'q',
        });
        if (moveResult === null) return false;

        playSound(!!moveResult.captured);

        if (isTrainerMode) {
          const expectedMove = expectedMoves[currentMoveIndex];

          if (moveResult.san !== expectedMove) {
            let alternativeOpeningName = null;
            if (openings) {
              try {
                const lookupCopy = cloneGame(gameCopy);
                const result = lookupByMoves(lookupCopy, openings);
                if (result?.opening?.name) {
                  alternativeOpeningName = result.opening.name;
                }
              } catch {
                // ECO lookup failed
              }
            }

            if (alternativeOpeningName) {
              setLastError(
                `Valid Theory! You played the ${alternativeOpeningName}. Great move, but we are practicing the ${targetOpening.Name}. Try again!`
              );
              return false;
            }

            try {
              const expectedGameCopy = cloneGame(game);
              expectedGameCopy.move(expectedMove);
              evaluateDeviation(
                expectedGameCopy.fen(),
                gameCopy.fen(),
                expectedMove,
                moveResult.san
              );
            } catch {
              setLastError(
                `Wrong move! Expected ${expectedMove}, but you played ${moveResult.san}.`
              );
            }
            return false;
          }

          setLastError('');
          setGame(gameCopy);
          buildMoveTree(expectedMoves, currentMoveIndex + 1);
          autoPlayOpponentMove(gameCopy, currentMoveIndex + 1);
          return true;
        }

        // Observation mode
        setLastError('');
        if (openings) {
          try {
            const lookupCopy = cloneGame(gameCopy);
            const result = lookupByMoves(lookupCopy, openings);
            setDetectedOpening(result?.opening?.name || 'Unknown Position');
          } catch {
            setDetectedOpening('Unknown Position');
          }
        }
        setGame(gameCopy);
        return true;
      } catch {
        return false;
      }
    },
    [
      game,
      isTrainerMode,
      playerColor,
      expectedMoves,
      openings,
      targetOpening,
      playSound,
      buildMoveTree,
      autoPlayOpponentMove,
      evaluateDeviation,
    ]
  );

  // ──────────────────────── Click-to-move: square click handler ────────────────────────
  const onSquareClick = useCallback(
    (square) => {
      // If a piece is already selected and user clicks a legal destination → execute
      if (selectedSquare) {
        if (legalMoveSquares.includes(square)) {
          const ok = executeMove(selectedSquare, square);
          setSelectedSquare(null);
          setLegalMoveSquares([]);
          if (ok) return;
        }

        // Clicked the same square again → deselect
        if (square === selectedSquare) {
          setSelectedSquare(null);
          setLegalMoveSquares([]);
          return;
        }
      }

      // Try to select a new piece on this square
      const piece = game.get(square);
      if (!piece) {
        setSelectedSquare(null);
        setLegalMoveSquares([]);
        return;
      }

      // In trainer mode, only allow selecting the player's own pieces
      if (isTrainerMode) {
        if (piece.color !== playerColor) {
          setSelectedSquare(null);
          setLegalMoveSquares([]);
          return;
        }
      }

      // Only allow selecting pieces whose turn it is
      const turn = game.turn(); // 'w' or 'b'
      if (piece.color !== turn) {
        setSelectedSquare(null);
        setLegalMoveSquares([]);
        return;
      }

      // Compute legal moves for this piece
      const moves = game.moves({ square, verbose: true });
      if (moves.length === 0) {
        setSelectedSquare(null);
        setLegalMoveSquares([]);
        return;
      }

      setSelectedSquare(square);
      setLegalMoveSquares(moves.map((m) => m.to));
    },
    [selectedSquare, legalMoveSquares, game, isTrainerMode, playerColor, executeMove]
  );

  // Clear selection whenever the game state changes (e.g. after opponent auto-play)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSquare(null);
    setLegalMoveSquares([]);
  }, [game]);

  // ──────────────────────── Build custom square styles for highlights ────────────────────────
  const customSquareStyles = (() => {
    const styles = {};

    // Highlight the selected piece's square
    if (selectedSquare) {
      styles[selectedSquare] = {
        backgroundColor: 'rgba(255, 191, 0, 0.45)',
        borderRadius: '0',
      };
    }

    // Highlight legal move destinations
    legalMoveSquares.forEach((sq) => {
      const occupant = game.get(sq);
      if (occupant) {
        // Capture target — red-tinted ring
        styles[sq] = {
          background: 'radial-gradient(circle, transparent 55%, rgba(239, 68, 68, 0.55) 56%)',
          borderRadius: '0',
        };
      } else {
        // Empty square — green dot
        styles[sq] = {
          background: 'radial-gradient(circle, rgba(34, 197, 94, 0.55) 22%, transparent 23%)',
          borderRadius: '0',
        };
      }
    });

    return styles;
  })();

  // ──────────────────────── Custom opening CRUD ────────────────────────
  const handleSaveOpening = useCallback(
    (e) => {
      e.preventDefault();
      setAddError('');

      if (!newOpeningName.trim()) {
        setAddError('Opening name is required.');
        return;
      }
      if (!newOpeningMoves.trim()) {
        setAddError('Moves list is required.');
        return;
      }

      const moves = pgnToMoves(newOpeningMoves);
      if (moves.length === 0) {
        setAddError('Unable to extract moves from input. Format: 1. e4 e5 2. Nf3 Nc6');
        return;
      }

      const newItem = { Name: newOpeningName.trim(), Moves: newOpeningMoves.trim() };
      const updated = [...repertoire, newItem];
      setRepertoire(updated);
      localStorage.setItem('chess_repertoire', JSON.stringify(updated));
      setTargetOpening(newItem);
      setNewOpeningName('');
      setNewOpeningMoves('');
      setAddModalOpen(false);
    },
    [newOpeningName, newOpeningMoves, repertoire]
  );

  const handleDeleteOpening = useCallback(
    (name) => {
      const updated = repertoire.filter((op) => op.Name !== name);
      if (updated.length === 0) {
        setLastError('Cannot delete all openings. Keep at least one.');
        return;
      }
      setRepertoire(updated);
      localStorage.setItem('chess_repertoire', JSON.stringify(updated));
      if (targetOpening.Name === name) {
        setTargetOpening(updated[0]);
      }
    },
    [repertoire, targetOpening]
  );

  // ──────────────────────── Derived values ────────────────────────
  const moveHistory = game.history();
  const movePairs = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    movePairs.push({
      num: Math.floor(i / 2) + 1,
      w: moveHistory[i],
      b: moveHistory[i + 1] || '',
    });
  }

  // Evaluation bar: cp ±8 maps to 5%–95%
  const whitePct =
    evalType === 'mate'
      ? evalScore > 0
        ? 95
        : 5
      : Math.min(Math.max(50 + (evalScore * 50) / 8, 5), 95);

  // ──────────────────────── Render ────────────────────────
  return (
    <div className="flex h-screen w-full bg-stone-950 text-stone-100 overflow-hidden font-sans">
      {/* ─── Sidebar ─── */}
      <div className="w-[420px] flex flex-col border-r border-stone-800 bg-stone-900 shadow-2xl z-10 relative">
        {/* Header */}
        <div className="p-5 border-b border-stone-800 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold font-serif text-[#b58863] flex items-center gap-2 tracking-wide">
              <span>Chess Repertoire Trainer</span>
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => setMuted(!muted)}
                className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-300 transition-colors"
                title={muted ? 'Unmute sound effects' : 'Mute sound effects'}
              >
                {muted ? (
                  <VolumeX className="w-4 h-4 text-stone-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-stone-300" />
                )}
              </button>
              <button
                onClick={() => resetGame()}
                className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-300 transition-colors"
                title="Reset active board"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2 bg-stone-950 p-1 rounded-lg border border-stone-800">
            <button
              onClick={() => setIsTrainerMode(false)}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                !isTrainerMode
                  ? 'bg-[#b58863] text-stone-950 shadow-md font-bold'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Observation</span>
            </button>
            <button
              onClick={() => setIsTrainerMode(true)}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                isTrainerMode
                  ? 'bg-[#b58863] text-stone-950 shadow-md font-bold'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Trainer Mode</span>
            </button>
          </div>
        </div>

        {/* Sidebar Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoadingEco ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
              <Loader2 className="w-8 h-8 animate-spin text-[#b58863]" />
              <span className="text-sm text-stone-400 font-medium">Loading ECO database...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Trainer Mode Panel */}
              {isTrainerMode ? (
                <div className="bg-stone-950/40 border border-stone-800/80 p-4 rounded-xl space-y-4 shadow-inner">
                  {/* Opening selector */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                        Target opening
                      </label>
                      <button
                        onClick={() => setAddModalOpen(true)}
                        className="text-xs text-[#b58863] hover:text-[#c99c75] flex items-center gap-0.5 font-medium hover:underline"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Custom</span>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={targetOpening.Name}
                        onChange={(e) => {
                          const selected = repertoire.find((op) => op.Name === e.target.value);
                          if (selected) setTargetOpening(selected);
                        }}
                        className="flex-1 bg-stone-900 border border-stone-800 rounded-lg p-2 text-sm text-stone-200 focus:outline-none focus:border-[#b58863]"
                      >
                        {repertoire.map((op) => (
                          <option key={op.Name} value={op.Name}>
                            {op.Name}
                          </option>
                        ))}
                      </select>
                      {repertoire.length > 1 &&
                        !PopularOpenings.some((pop) => pop.Name === targetOpening.Name) && (
                          <button
                            onClick={() => handleDeleteOpening(targetOpening.Name)}
                            className="p-2 bg-red-950/10 text-red-400 hover:bg-red-900/20 rounded-lg border border-red-900/20 transition-colors"
                            title="Delete custom opening"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Color selector */}
                  <div>
                    <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1.5">
                      Practice As
                    </label>
                    <div className="grid grid-cols-2 gap-2 bg-stone-900 p-1 rounded-lg border border-stone-800/50">
                      <button
                        onClick={() => setPlayerColor('w')}
                        className={`py-1 text-xs font-medium rounded transition-all ${
                          playerColor === 'w'
                            ? 'bg-[#f0d9b5] text-stone-950 font-bold shadow'
                            : 'text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        White
                      </button>
                      <button
                        onClick={() => setPlayerColor('b')}
                        className={`py-1 text-xs font-medium rounded transition-all ${
                          playerColor === 'b'
                            ? 'bg-[#f0d9b5] text-stone-950 font-bold shadow'
                            : 'text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        Black
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Observation Mode Panel */
                <div className="bg-stone-950/40 border border-stone-800 p-4 rounded-xl text-center shadow">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1">
                    Detected Position Theory
                  </span>
                  <div className="text-base font-bold text-[#b58863] leading-tight">
                    {detectedOpening}
                  </div>
                </div>
              )}

              {/* Move Tree */}
              {isTrainerMode && (
                <div className="bg-stone-950/40 border border-stone-800 p-4 rounded-xl overflow-hidden shadow-inner flex flex-col">
                  <div className="pb-2 border-b border-stone-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                      Expected Move Sequence
                    </span>
                    <span className="text-[10px] text-stone-500 flex items-center gap-0.5">
                      <HelpCircle className="w-3 h-3" />
                      <span>Click node to jump</span>
                    </span>
                  </div>
                  <div className="h-[220px] w-full" ref={treeContainerRef}>
                    <Tree
                      data={treeData}
                      orientation="vertical"
                      translate={{ x: 180, y: 35 }}
                      pathFunc="step"
                      nodeSize={{ x: 70, y: 50 }}
                      onNodeClick={handleNodeClick}
                      textLayout={{ textAnchor: 'middle', y: 22 }}
                      styles={{
                        links: { stroke: '#44403c', strokeWidth: 2 },
                        nodes: {
                          node: {
                            circle: { cursor: 'pointer' },
                            name: {
                              fill: '#e7e5e4',
                              fontSize: 11,
                              fontWeight: '600',
                              fontFamily: 'monospace',
                            },
                          },
                          leafNode: {
                            circle: { cursor: 'pointer' },
                            name: {
                              fill: '#e7e5e4',
                              fontSize: 11,
                              fontWeight: '600',
                              fontFamily: 'monospace',
                            },
                          },
                        },
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Move Log */}
              <div className="bg-stone-950/30 border border-stone-800 rounded-xl overflow-hidden shadow flex flex-col">
                <div className="bg-stone-900/60 px-4 py-2 border-b border-stone-800">
                  <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Move Log
                  </span>
                </div>
                <div className="p-3 h-[180px] overflow-y-auto font-mono text-sm space-y-1 bg-stone-950/40">
                  {movePairs.length === 0 ? (
                    <div className="text-stone-600 text-xs italic text-center py-10">
                      No moves played yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-y-1 gap-x-4 max-w-xs text-left mx-auto">
                      {movePairs.map((pair) => (
                        <div key={pair.num} className="contents">
                          <span className="text-stone-600 text-right">{pair.num}.</span>
                          <span className="text-stone-200 font-semibold">{pair.w}</span>
                          <span className="text-stone-400">{pair.b}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Main Board Area ─── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-stone-950 via-stone-900 to-stone-950 relative p-8">
        {/* Status / Error display */}
        <div className="mb-4 text-center h-10 flex items-center justify-center">
          {lastError ? (
            <div className="text-red-400 bg-red-950/30 px-4 py-1.5 rounded-lg font-mono text-xs border border-red-500/20 shadow animate-pulse">
              {lastError}
            </div>
          ) : (
            isEvaluating && (
              <div className="text-stone-500 font-mono text-xs flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
                <span>Stockfish analyzing...</span>
              </div>
            )
          )}
        </div>

        {/* Board + Eval bar */}
        <div className="flex items-center">
          {/* Evaluation Bar */}
          <div className="mr-5 flex flex-col items-center justify-between h-[560px] w-6 bg-stone-950 border border-stone-800 rounded-md overflow-hidden relative shadow-2xl">
            {/* Black section */}
            <div
              className="w-full bg-[#b58863] transition-all duration-300 ease-out"
              style={{ height: `${100 - whitePct}%` }}
            />
            {/* White section */}
            <div
              className="w-full bg-[#f0d9b5] transition-all duration-300 ease-out"
              style={{ height: `${whitePct}%` }}
            />
            {/* Score label */}
            <div className="absolute inset-x-0 bottom-2 text-center pointer-events-none select-none">
              <span className="text-[9px] font-extrabold px-1 py-0.5 rounded shadow-sm bg-stone-950 text-stone-100 border border-stone-800">
                {evalType === 'mate'
                  ? evalScore > 0
                    ? `M${evalScore}`
                    : `-M${Math.abs(evalScore)}`
                  : `${evalScore > 0 ? '+' : ''}${evalScore.toFixed(1)}`}
              </span>
            </div>
          </div>

          {/* Chessboard */}
          <div className="w-[560px] h-[560px] relative">
            <Chessboard
              id="main-board"
              position={game.fen()}
              boardOrientation={playerColor === 'w' ? 'white' : 'black'}
              onSquareClick={onSquareClick}
              onPieceClick={(piece, square) => onSquareClick(square)}
              arePiecesDraggable={false}
              customDarkSquareStyle={DARK_SQUARE_STYLE}
              customLightSquareStyle={LIGHT_SQUARE_STYLE}
              customBoardStyle={BOARD_STYLE}
              customSquareStyles={customSquareStyles}
              animationDuration={200}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-stone-500 text-[11px] font-mono select-none">
          Click a piece to see legal moves, then click a destination to play.
        </div>
      </div>

      {/* ─── Add Custom Opening Modal ─── */}
      {addModalOpen && (
        <div className="absolute inset-0 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
          <div className="w-[480px] bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-stone-800 flex justify-between items-center bg-stone-950/30">
              <h3 className="text-base font-bold text-stone-200">Add Custom Practice Opening</h3>
              <button
                onClick={() => setAddModalOpen(false)}
                className="text-stone-400 hover:text-stone-200 p-1 hover:bg-stone-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveOpening} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1.5">
                  Opening Name
                </label>
                <input
                  type="text"
                  value={newOpeningName}
                  onChange={(e) => setNewOpeningName(e.target.value)}
                  placeholder="e.g. Sicilian Defense: Najdorf Variation"
                  className="w-full bg-stone-950 border border-stone-800 focus:border-[#b58863] rounded-lg p-2.5 text-sm text-stone-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1.5">
                  Moves list (SAN/PGN)
                </label>
                <textarea
                  rows="3"
                  value={newOpeningMoves}
                  onChange={(e) => setNewOpeningMoves(e.target.value)}
                  placeholder="e.g. 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6"
                  className="w-full bg-stone-950 border border-stone-800 focus:border-[#b58863] rounded-lg p-2.5 text-sm text-stone-200 font-mono focus:outline-none resize-none"
                />
              </div>

              {addError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-500/20 p-2.5 rounded-lg font-mono">
                  {addError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 font-semibold rounded-lg text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#b58863] hover:bg-[#c99c75] text-stone-950 font-bold rounded-lg text-xs transition-colors"
                >
                  Save Opening
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}