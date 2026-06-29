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
  X,
} from 'lucide-react';
import Tree from 'react-d3-tree';
import './index.css';

/* ═══════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════ */

const DARK_SQUARE = { backgroundColor: '#b58863' };
const LIGHT_SQUARE = { backgroundColor: '#f0d9b5' };
const BOARD_STYLE = {
  borderRadius: '0.375rem',
  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)',
};

const PopularOpenings = [
  { Name: 'Italian Game', Moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5' },
  { Name: 'Ruy Lopez', Moves: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6' },
  { Name: 'Caro-Kann Defense', Moves: '1. e4 c6 2. d4 d5 3. Nc3 dxe4' },
  { Name: 'Sicilian Defense', Moves: '1. e4 c5 2. Nf3 d6 3. d4 cxd4' },
  { Name: 'French Defense', Moves: '1. e4 e6 2. d4 d5 3. Nc3 Nf6' },
];

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

/** Create a fresh Chess instance with the same move history. */
function cloneGame(g) {
  const c = new Chess();
  const pgn = g.pgn();
  if (pgn) c.loadPgn(pgn);
  return c;
}

/** Parse PGN text into an array of SAN strings. */
function pgnToMoves(pgn) {
  const t = new Chess();
  try {
    t.loadPgn(pgn);
    return t.history();
  } catch {
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════
   App
   ═══════════════════════════════════════════════════════════════════ */

export default function App() {
  /* ── Core state ── */
  const [game, setGame] = useState(new Chess());
  const [openingsDb, setOpeningsDb] = useState(null);
  const [detectedOpening, setDetectedOpening] = useState('Starting Position');
  const [isLoadingEco, setIsLoadingEco] = useState(true);
  const [lastError, setLastError] = useState('');

  /* ── Repertoire (localStorage-backed) ── */
  const [repertoire, setRepertoire] = useState(() => {
    try {
      const s = localStorage.getItem('chess_repertoire');
      if (s) return JSON.parse(s);
    } catch { /* ignore */ }
    return PopularOpenings;
  });

  /* ── Trainer mode ── */
  const [isTrainerMode, setIsTrainerMode] = useState(false);
  const [playerColor, setPlayerColor] = useState('w');
  const [targetOpening, setTargetOpening] = useState(() => {
    try {
      const s = localStorage.getItem('chess_repertoire');
      if (s) { const p = JSON.parse(s); if (p.length) return p[0]; }
    } catch { /* ignore */ }
    return PopularOpenings[0];
  });
  const [expectedMoves, setExpectedMoves] = useState([]);
  const [treeData, setTreeData] = useState({ name: 'Start' });
  const [muted, setMuted] = useState(false);

  /* ── Click-to-move ── */
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState([]);

  /* ── Stockfish eval ── */
  const [evalScore, setEvalScore] = useState(0.3);
  const [evalType, setEvalType] = useState('cp');
  const [isEvaluating, setIsEvaluating] = useState(false);

  /* ── Add-opening modal ── */
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newOpeningName, setNewOpeningName] = useState('');
  const [newOpeningMoves, setNewOpeningMoves] = useState('');
  const [addError, setAddError] = useState('');

  /* ── Refs ── */
  const treeContainerRef = useRef(null);
  const engineRef = useRef(null);
  const opponentTimer = useRef(null);

  /* ═══════════════════════════════════════════════════════════════
     Audio synthesis
     ═══════════════════════════════════════════════════════════════ */
  const playSound = useCallback(
    (isCapture = false) => {
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
      } catch { /* Web Audio unavailable */ }
    },
    [muted],
  );

  /* ═══════════════════════════════════════════════════════════════
     Stockfish worker bootstrap
     ═══════════════════════════════════════════════════════════════ */
  useEffect(() => {
    try {
      const wasm =
        typeof WebAssembly === 'object' &&
        WebAssembly.validate(
          Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00),
        );
      engineRef.current = new Worker(wasm ? '/stockfish.wasm.js' : '/stockfish.js');
    } catch {
      // Stockfish unavailable
    }
    return () => {
      engineRef.current?.terminate();
      engineRef.current = null;
      if (opponentTimer.current) clearTimeout(opponentTimer.current);
    };
  }, []);

  /* ═══════════════════════════════════════════════════════════════
     ECO database
     ═══════════════════════════════════════════════════════════════ */
  useEffect(() => {
    openingBook()
      .then((d) => { setOpeningsDb(d); setIsLoadingEco(false); })
      .catch(() => setIsLoadingEco(false));
  }, []);

  /* ═══════════════════════════════════════════════════════════════
     Move tree builder
     ═══════════════════════════════════════════════════════════════ */
  const buildTree = useCallback((moves, idx) => {
    const root = {
      name: 'Start',
      attributes: { status: 'Played', index: 0 },
      nodeSvgShape: {
        shape: 'circle',
        shapeProps: { r: 12, fill: '#b58863', stroke: '#1c1917', strokeWidth: 2 },
      },
    };
    let cur = root;
    moves.forEach((m, i) => {
      const played = i < idx;
      const next = i === idx;
      const node = {
        name: m,
        attributes: {
          status: played ? 'Played' : next ? 'Next' : 'Pending',
          index: i + 1,
        },
        nodeSvgShape: {
          shape: 'circle',
          shapeProps: {
            r: 10,
            fill: played ? '#b58863' : next ? '#f0d9b5' : '#57534e',
            stroke: '#1c1917',
            strokeWidth: 2,
          },
        },
      };
      cur.children = [node];
      cur = node;
    });
    setTreeData(root);
  }, []);

  /* ═══════════════════════════════════════════════════════════════
     Reset game
     ═══════════════════════════════════════════════════════════════ */
  const resetGame = useCallback(
    (overrideMoves) => {
      if (opponentTimer.current) {
        clearTimeout(opponentTimer.current);
        opponentTimer.current = null;
      }
      const moves = overrideMoves || expectedMoves;
      const fresh = new Chess();
      setLastError('');
      setDetectedOpening('Starting Position');
      buildTree(moves, 0);
      if (isTrainerMode && playerColor === 'b' && moves.length > 0) {
        try { fresh.move(moves[0]); buildTree(moves, 1); } catch { /* ignore */ }
      }
      setGame(fresh);
    },
    [expectedMoves, isTrainerMode, playerColor, buildTree],
  );

  /* ═══════════════════════════════════════════════════════════════
     Sync when target opening / color / mode changes
     ═══════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!targetOpening) return;
    const moves = pgnToMoves(targetOpening.Moves);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpectedMoves(moves);

    if (opponentTimer.current) {
      clearTimeout(opponentTimer.current);
      opponentTimer.current = null;
    }
    const fresh = new Chess();
    setLastError('');
    setDetectedOpening('Starting Position');
    buildTree(moves, 0);
    if (isTrainerMode && playerColor === 'b' && moves.length > 0) {
      try { fresh.move(moves[0]); buildTree(moves, 1); } catch { /* ignore */ }
    }
    setGame(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetOpening, playerColor, isTrainerMode]);

  /* ═══════════════════════════════════════════════════════════════
     Live Stockfish evaluation on every board change
     ═══════════════════════════════════════════════════════════════ */
  useEffect(() => {
    const w = engineRef.current;
    if (!w) return;
    w.postMessage('stop');
    setIsEvaluating(true);
    const fen = game.fen();
    const whiteToMove = fen.split(' ')[1] === 'w';

    const listener = (e) => {
      const l = e.data;
      if (typeof l !== 'string') return;
      if (l.includes('info depth')) {
        const cp = l.match(/score cp (-?\d+)/);
        const mt = l.match(/score mate (-?\d+)/);
        if (cp) { setEvalScore(whiteToMove ? +cp[1] / 100 : -(+cp[1]) / 100); setEvalType('cp'); }
        else if (mt) { setEvalScore(whiteToMove ? +mt[1] : -(+mt[1])); setEvalType('mate'); }
      }
      if (l.startsWith('bestmove')) { setIsEvaluating(false); w.removeEventListener('message', listener); }
    };
    w.addEventListener('message', listener);
    w.postMessage('ucinewgame');
    w.postMessage('position fen ' + fen);
    w.postMessage('go depth 12');
    return () => { w.postMessage('stop'); w.removeEventListener('message', listener); };
  }, [game]);

  /* ═══════════════════════════════════════════════════════════════
     Auto-play opponent move
     ═══════════════════════════════════════════════════════════════ */
  const autoPlayOpponent = useCallback(
    (currentGame, moveIdx, moves) => {
      const target = moves || expectedMoves;
      if (moveIdx >= target.length) { setLastError('Opening sequence completed! 🎉'); return; }
      const next = target[moveIdx];
      if (opponentTimer.current) clearTimeout(opponentTimer.current);
      opponentTimer.current = setTimeout(() => {
        const copy = cloneGame(currentGame);
        try {
          const r = copy.move(next);
          if (r) { setGame(copy); buildTree(target, moveIdx + 1); playSound(!!r.captured); }
        } catch { /* ignore */ }
        opponentTimer.current = null;
      }, 500);
    },
    [expectedMoves, buildTree, playSound],
  );

  /* ═══════════════════════════════════════════════════════════════
     Tree node click → jump board position
     ═══════════════════════════════════════════════════════════════ */
  const handleNodeClick = useCallback(
    (nodeDatum) => {
      if (!isTrainerMode) return;
      if (opponentTimer.current) { clearTimeout(opponentTimer.current); opponentTimer.current = null; }
      const ti = nodeDatum.attributes?.index !== undefined ? parseInt(nodeDatum.attributes.index, 10) : 0;
      const fresh = new Chess();
      for (let i = 0; i < ti && i < expectedMoves.length; i++) {
        try { fresh.move(expectedMoves[i]); } catch { break; }
      }
      setGame(fresh);
      buildTree(expectedMoves, ti);
      setLastError('');
      playSound(false);
      const opp = (playerColor === 'w' && ti % 2 !== 0) || (playerColor === 'b' && ti % 2 === 0);
      if (opp && ti < expectedMoves.length) autoPlayOpponent(fresh, ti);
    },
    [isTrainerMode, expectedMoves, playerColor, buildTree, playSound, autoPlayOpponent],
  );

  /* ═══════════════════════════════════════════════════════════════
     Stockfish deviation evaluator
     ═══════════════════════════════════════════════════════════════ */
  const evaluateDeviation = useCallback(
    async (expectedFen, actualFen, expectedMove, playedMove) => {
      setLastError('Analyzing mistake...');
      const getScore = (fen) =>
        new Promise((resolve) => {
          let tw;
          try {
            const wasm = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
            tw = new Worker(wasm ? '/stockfish.wasm.js' : '/stockfish.js');
          } catch { resolve(0); return; }
          let sc = 0;
          const to = setTimeout(() => { tw.terminate(); resolve(sc); }, 3000);
          const h = (e) => {
            const l = e.data;
            if (typeof l !== 'string') return;
            if (l.includes('info depth')) { const c = l.match(/score cp (-?\d+)/); if (c) sc = +c[1] / 100; }
            if (l.startsWith('bestmove')) { clearTimeout(to); tw.terminate(); resolve(fen.split(' ')[1] === 'w' ? sc : -sc); }
          };
          tw.addEventListener('message', h);
          tw.postMessage('ucinewgame');
          tw.postMessage('position fen ' + fen);
          tw.postMessage('go depth 12');
        });
      const es = await getScore(expectedFen);
      const as2 = await getScore(actualFen);
      const drop = playerColor === 'w' ? es - as2 : as2 - es;
      setLastError(`Mistake! Expected ${expectedMove}, but you played ${playedMove}. Eval drop: ${Math.max(0, drop).toFixed(1)}.`);
    },
    [playerColor],
  );

  /* ═══════════════════════════════════════════════════════════════
     Execute a move (from → to)
     ═══════════════════════════════════════════════════════════════ */
  const executeMove = useCallback(
    (from, to) => {
      const copy = cloneGame(game);
      const mi = copy.history().length;

      if (isTrainerMode) {
        const myTurn = (playerColor === 'w' && mi % 2 === 0) || (playerColor === 'b' && mi % 2 !== 0);
        if (!myTurn) return false;
      }

      try {
        const r = copy.move({ from, to, promotion: 'q' });
        if (!r) return false;
        playSound(!!r.captured);

        if (isTrainerMode) {
          const exp = expectedMoves[mi];
          if (r.san !== exp) {
            let alt = null;
            if (openingsDb) {
              try {
                const lc = cloneGame(copy);
                const res = lookupByMoves(lc, openingsDb);
                if (res?.opening?.name) alt = res.opening.name;
              } catch { /* ignore */ }
            }
            if (alt) {
              setLastError(`Valid Theory! You played the ${alt}. But we are practicing the ${targetOpening.Name}. Try again!`);
              return false;
            }
            try {
              const ec = cloneGame(game);
              ec.move(exp);
              evaluateDeviation(ec.fen(), copy.fen(), exp, r.san);
            } catch {
              setLastError(`Wrong move! Expected ${exp}, you played ${r.san}.`);
            }
            return false;
          }
          setLastError('');
          setGame(copy);
          buildTree(expectedMoves, mi + 1);
          autoPlayOpponent(copy, mi + 1);
          return true;
        }

        // Observation mode
        setLastError('');
        if (openingsDb) {
          try {
            const lc = cloneGame(copy);
            const res = lookupByMoves(lc, openingsDb);
            setDetectedOpening(res?.opening?.name || 'Unknown Position');
          } catch { setDetectedOpening('Unknown Position'); }
        }
        setGame(copy);
        return true;
      } catch { return false; }
    },
    [game, isTrainerMode, playerColor, expectedMoves, openingsDb, targetOpening, playSound, buildTree, autoPlayOpponent, evaluateDeviation],
  );

  /* ═══════════════════════════════════════════════════════════════
     Click-to-move handler  (react-chessboard v5 API)
     v5 onSquareClick receives { piece, square }
     v5 onPieceClick receives { isSparePiece, piece, square }
     ═══════════════════════════════════════════════════════════════ */
  const handleSquareClick = useCallback(
    ({ square }) => {
      // If we already selected a piece and clicked a legal target → move
      if (selectedSquare && legalMoveSquares.includes(square)) {
        executeMove(selectedSquare, square);
        setSelectedSquare(null);
        setLegalMoveSquares([]);
        return;
      }

      // Clicked the same square → deselect
      if (selectedSquare && square === selectedSquare) {
        setSelectedSquare(null);
        setLegalMoveSquares([]);
        return;
      }

      // Try to select a piece on this square
      const pc = game.get(square);
      if (!pc) { setSelectedSquare(null); setLegalMoveSquares([]); return; }

      // Must be that color's turn
      if (pc.color !== game.turn()) { setSelectedSquare(null); setLegalMoveSquares([]); return; }

      // In trainer mode only allow own color
      if (isTrainerMode && pc.color !== playerColor) { setSelectedSquare(null); setLegalMoveSquares([]); return; }

      const moves = game.moves({ square, verbose: true });
      if (moves.length === 0) { setSelectedSquare(null); setLegalMoveSquares([]); return; }

      setSelectedSquare(square);
      setLegalMoveSquares(moves.map((m) => m.to));
    },
    [selectedSquare, legalMoveSquares, game, isTrainerMode, playerColor, executeMove],
  );

  const handlePieceClick = useCallback(
    ({ square }) => {
      handleSquareClick({ square });
    },
    [handleSquareClick],
  );

  // Clear selection on game change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSquare(null);
    setLegalMoveSquares([]);
  }, [game]);

  /* ═══════════════════════════════════════════════════════════════
     Custom square styles for highlights
     ═══════════════════════════════════════════════════════════════ */
  const squareHighlights = (() => {
    const s = {};
    if (selectedSquare) {
      s[selectedSquare] = { backgroundColor: 'rgba(255, 191, 0, 0.45)' };
    }
    legalMoveSquares.forEach((sq) => {
      const occ = game.get(sq);
      s[sq] = occ
        ? { background: 'radial-gradient(circle, transparent 55%, rgba(239, 68, 68, 0.55) 56%)' }
        : { background: 'radial-gradient(circle, rgba(34, 197, 94, 0.55) 22%, transparent 23%)' };
    });
    return s;
  })();

  /* ═══════════════════════════════════════════════════════════════
     Custom opening CRUD
     ═══════════════════════════════════════════════════════════════ */
  const handleSaveOpening = useCallback(
    (e) => {
      e.preventDefault();
      setAddError('');
      if (!newOpeningName.trim()) { setAddError('Opening name is required.'); return; }
      if (!newOpeningMoves.trim()) { setAddError('Moves list is required.'); return; }
      const m = pgnToMoves(newOpeningMoves);
      if (m.length === 0) { setAddError('Invalid PGN. Format: 1. e4 e5 2. Nf3 Nc6'); return; }
      const item = { Name: newOpeningName.trim(), Moves: newOpeningMoves.trim() };
      const upd = [...repertoire, item];
      setRepertoire(upd);
      localStorage.setItem('chess_repertoire', JSON.stringify(upd));
      setTargetOpening(item);
      setNewOpeningName('');
      setNewOpeningMoves('');
      setAddModalOpen(false);
    },
    [newOpeningName, newOpeningMoves, repertoire],
  );

  const handleDeleteOpening = useCallback(
    (name) => {
      const upd = repertoire.filter((o) => o.Name !== name);
      if (upd.length === 0) { setLastError('Keep at least one opening.'); return; }
      setRepertoire(upd);
      localStorage.setItem('chess_repertoire', JSON.stringify(upd));
      if (targetOpening.Name === name) setTargetOpening(upd[0]);
    },
    [repertoire, targetOpening],
  );

  /* ═══════════════════════════════════════════════════════════════
     Derived
     ═══════════════════════════════════════════════════════════════ */
  const history = game.history();
  const movePairs = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({ num: Math.floor(i / 2) + 1, w: history[i], b: history[i + 1] || '' });
  }
  const whitePct =
    evalType === 'mate'
      ? evalScore > 0 ? 95 : 5
      : Math.min(Math.max(50 + (evalScore * 50) / 8, 5), 95);

  /* ═══════════════════════════════════════════════════════════════
     Chessboard options object  (react-chessboard v5 API)
     ═══════════════════════════════════════════════════════════════ */
  const boardOptions = {
    id: 'main-board',
    position: game.fen(),
    boardOrientation: playerColor === 'w' ? 'white' : 'black',
    allowDragging: false,
    onSquareClick: handleSquareClick,
    onPieceClick: handlePieceClick,
    darkSquareStyle: DARK_SQUARE,
    lightSquareStyle: LIGHT_SQUARE,
    boardStyle: BOARD_STYLE,
    squareStyles: squareHighlights,
    animationDurationInMs: 200,
  };

  /* ═══════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════ */
  return (
    <div className="flex h-screen w-full bg-stone-950 text-stone-100 overflow-hidden font-sans">
      {/* ─── Sidebar ─── */}
      <div className="w-[420px] flex flex-col border-r border-stone-800 bg-stone-900 shadow-2xl z-10 relative">
        {/* Header */}
        <div className="p-5 border-b border-stone-800 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold font-serif text-[#b58863] flex items-center gap-2 tracking-wide">
              Chess Repertoire Trainer
            </h1>
            <div className="flex gap-2">
              <button onClick={() => setMuted(!muted)} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-300 transition-colors" title={muted ? 'Unmute' : 'Mute'}>
                {muted ? <VolumeX className="w-4 h-4 text-stone-400" /> : <Volume2 className="w-4 h-4 text-stone-300" />}
              </button>
              <button onClick={() => resetGame()} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-300 transition-colors" title="Reset board">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button 
                onClick={() => SwitchMode('Quiz')}
                className={`px-3 py-1 text-xs rounded ${AppMode === 'Quiz' ? 'bg-purple-500 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                Quiz
              </button>
              <button 
                onClick={() => SwitchMode('Editor')}
                className={`px-3 py-1 text-xs rounded ${AppMode === 'Editor' ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-300'}`}
              >
                Editor
              </button>
            </div>
          </div>

          {/* Mode switcher */}
          <div className="grid grid-cols-2 gap-2 bg-stone-950 p-1 rounded-lg border border-stone-800">
            <button onClick={() => setIsTrainerMode(false)} className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${!isTrainerMode ? 'bg-[#b58863] text-stone-950 shadow-md font-bold' : 'text-stone-400 hover:text-stone-200'}`}>
              <Eye className="w-3.5 h-3.5" /><span>Observation</span>
            </button>
            <button onClick={() => setIsTrainerMode(true)} className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${isTrainerMode ? 'bg-[#b58863] text-stone-950 shadow-md font-bold' : 'text-stone-400 hover:text-stone-200'}`}>
              <BookOpen className="w-3.5 h-3.5" /><span>Trainer Mode</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoadingEco ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
              <Loader2 className="w-8 h-8 animate-spin text-[#b58863]" />
              <span className="text-sm text-stone-400 font-medium">Loading ECO database...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {isTrainerMode ? (
                <div className="bg-stone-950/40 border border-stone-800/80 p-4 rounded-xl space-y-4 shadow-inner">
                  {/* Opening selector */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Target opening</label>
                      <button onClick={() => setAddModalOpen(true)} className="text-xs text-[#b58863] hover:text-[#c99c75] flex items-center gap-0.5 font-medium hover:underline">
                        <Plus className="w-3.5 h-3.5" /><span>Add Custom</span>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <select value={targetOpening.Name} onChange={(e) => { const s = repertoire.find((o) => o.Name === e.target.value); if (s) setTargetOpening(s); }} className="flex-1 bg-stone-900 border border-stone-800 rounded-lg p-2 text-sm text-stone-200 focus:outline-none focus:border-[#b58863]">
                        {repertoire.map((o) => <option key={o.Name} value={o.Name}>{o.Name}</option>)}
                      </select>
                      {repertoire.length > 1 && !PopularOpenings.some((p) => p.Name === targetOpening.Name) && (
                        <button onClick={() => handleDeleteOpening(targetOpening.Name)} className="p-2 bg-red-950/10 text-red-400 hover:bg-red-900/20 rounded-lg border border-red-900/20 transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Color selector */}
                  <div>
                    <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1.5">Practice As</label>
                    <div className="grid grid-cols-2 gap-2 bg-stone-900 p-1 rounded-lg border border-stone-800/50">
                      <button onClick={() => setPlayerColor('w')} className={`py-1 text-xs font-medium rounded transition-all ${playerColor === 'w' ? 'bg-[#f0d9b5] text-stone-950 font-bold shadow' : 'text-stone-400 hover:text-stone-200'}`}>White</button>
                      <button onClick={() => setPlayerColor('b')} className={`py-1 text-xs font-medium rounded transition-all ${playerColor === 'b' ? 'bg-[#f0d9b5] text-stone-950 font-bold shadow' : 'text-stone-400 hover:text-stone-200'}`}>Black</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-stone-950/40 border border-stone-800 p-4 rounded-xl text-center shadow">
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-1">Detected Position Theory</span>
                  <div className="text-base font-bold text-[#b58863] leading-tight">{detectedOpening}</div>
                </div>
              )}

              {/* Move tree */}
              {isTrainerMode && (
                <div className="bg-stone-950/40 border border-stone-800 p-4 rounded-xl overflow-hidden shadow-inner flex flex-col">
                  <div className="pb-2 border-b border-stone-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Expected Move Sequence</span>
                    <span className="text-[10px] text-stone-500 flex items-center gap-0.5"><HelpCircle className="w-3 h-3" /><span>Click node to jump</span></span>
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
                          node: { circle: { cursor: 'pointer' }, name: { fill: '#e7e5e4', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' } },
                          leafNode: { circle: { cursor: 'pointer' }, name: { fill: '#e7e5e4', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' } },
                        },
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Move log */}
              <div className="bg-stone-950/30 border border-stone-800 rounded-xl overflow-hidden shadow flex flex-col">
                <div className="bg-stone-900/60 px-4 py-2 border-b border-stone-800">
                  <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Move Log</span>
                </div>
                <div className="p-3 h-[180px] overflow-y-auto font-mono text-sm space-y-1 bg-stone-950/40">
                  {movePairs.length === 0 ? (
                    <div className="text-stone-600 text-xs italic text-center py-10">No moves played yet.</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-y-1 gap-x-4 max-w-xs text-left mx-auto">
                      {movePairs.map((p) => (
                        <div key={p.num} className="contents">
                          <span className="text-stone-600 text-right">{p.num}.</span>
                          <span className="text-stone-200 font-semibold">{p.w}</span>
                          <span className="text-stone-400">{p.b}</span>
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
        {/* Status bar */}
        <div className="mb-4 text-center h-10 flex items-center justify-center">
          {lastError ? (
            <div className="text-red-400 bg-red-950/30 px-4 py-1.5 rounded-lg font-mono text-xs border border-red-500/20 shadow animate-pulse">{lastError}</div>
          ) : isEvaluating ? (
            <div className="text-stone-500 font-mono text-xs flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" /><span>Stockfish analyzing...</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center">
          {/* Eval bar */}
          <div className="mr-5 flex flex-col items-center justify-between h-[560px] w-6 bg-stone-950 border border-stone-800 rounded-md overflow-hidden relative shadow-2xl">
            <div className="w-full bg-[#b58863] transition-all duration-300 ease-out" style={{ height: `${100 - whitePct}%` }} />
            <div className="w-full bg-[#f0d9b5] transition-all duration-300 ease-out" style={{ height: `${whitePct}%` }} />
            <div className="absolute inset-x-0 bottom-2 text-center pointer-events-none select-none">
              <span className="text-[9px] font-extrabold px-1 py-0.5 rounded shadow-sm bg-stone-950 text-stone-100 border border-stone-800">
                {evalType === 'mate' ? (evalScore > 0 ? `M${evalScore}` : `-M${Math.abs(evalScore)}`) : `${evalScore > 0 ? '+' : ''}${evalScore.toFixed(1)}`}
              </span>
            </div>
          </div>

          {/* Chessboard — v5 API: single `options` prop */}
          <div className="w-[560px] h-[560px] relative">
            <Chessboard options={boardOptions} />
          </div>
        </div>

        <div className="mt-4 text-stone-500 text-[11px] font-mono select-none">
          Click a piece to see legal moves, then click a destination to play.
        </div>
      </div>

      {/* ─── Add Custom Opening Modal ─── */}
      {addModalOpen && (
        <div className="absolute inset-0 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
          <div className="w-[480px] bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-800 flex justify-between items-center bg-stone-950/30">
              <h3 className="text-base font-bold text-stone-200">Add Custom Practice Opening</h3>
              <button onClick={() => setAddModalOpen(false)} className="text-stone-400 hover:text-stone-200 p-1 hover:bg-stone-800 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSaveOpening} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1.5">Opening Name</label>
                <input type="text" value={newOpeningName} onChange={(e) => setNewOpeningName(e.target.value)} placeholder="e.g. Sicilian Defense: Najdorf Variation" className="w-full bg-stone-950 border border-stone-800 focus:border-[#b58863] rounded-lg p-2.5 text-sm text-stone-200 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1.5">Moves list (SAN/PGN)</label>
                <textarea rows="3" value={newOpeningMoves} onChange={(e) => setNewOpeningMoves(e.target.value)} placeholder="e.g. 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6" className="w-full bg-stone-950 border border-stone-800 focus:border-[#b58863] rounded-lg p-2.5 text-sm text-stone-200 font-mono focus:outline-none resize-none" />
              </div>
              {addError && <div className="text-xs text-red-400 bg-red-950/30 border border-red-500/20 p-2.5 rounded-lg font-mono">{addError}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAddModalOpen(false)} className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 font-semibold rounded-lg text-xs transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-[#b58863] hover:bg-[#c99c75] text-stone-950 font-bold rounded-lg text-xs transition-colors">Save Opening</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}