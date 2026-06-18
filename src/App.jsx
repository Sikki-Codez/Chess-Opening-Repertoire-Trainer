import { useState, useEffect, useRef } from 'react';
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
import StockfishWorker from './stockfishWorker?worker';
import './index.css';

// Curated list of popular openings for default repertoire
const PopularOpenings = [
  { Name: "Italian Game", Moves: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5" },
  { Name: "Ruy Lopez", Moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6" },
  { Name: "Caro-Kann Defense", Moves: "1. e4 c6 2. d4 d5 3. Nc3 dxe4" },
  { Name: "Sicilian Defense", Moves: "1. e4 c5 2. Nf3 d6 3. d4 cxd4" },
  { Name: "French Defense", Moves: "1. e4 e6 2. d4 d5 3. Nc3 Nf6" }
];

export default function App() {
  const [Game, SetGame] = useState(new Chess());
  const [Openings, SetOpenings] = useState(null);
  const [DetectedOpening, SetDetectedOpening] = useState('Starting Position');
  const [IsLoadingEco, SetIsLoadingEco] = useState(true);
  const [LastError, SetLastError] = useState('');
  
  // Repertoire state loaded from LocalStorage
  const [Repertoire, SetRepertoire] = useState(() => {
    const Saved = localStorage.getItem('chess_repertoire');
    if (Saved) {
      try {
        return JSON.parse(Saved);
      } catch (e) {
        console.error("Failed to parse chess repertoire from localStorage", e);
      }
    }
    return PopularOpenings;
  });

  // Trainer Mode Settings
  const [IsTrainerMode, SetIsTrainerMode] = useState(false);
  const [PlayerColor, SetPlayerColor] = useState('w');
  const [TargetOpening, SetTargetOpening] = useState(Repertoire[0] || PopularOpenings[0]);
  const [ExpectedMoves, SetExpectedMoves] = useState([]);
  const [TreeData, SetTreeData] = useState({ name: 'Start' });
  const [Muted, SetMuted] = useState(false);

  // Live evaluation states
  const [EvalScore, SetEvalScore] = useState(0.3); // Starting eval slightly favors white
  const [EvalType, SetEvalType] = useState('cp');
  const [IsEvaluating, SetIsEvaluating] = useState(false);

  // Custom opening modal states
  const [AddModalOpen, SetAddModalOpen] = useState(false);
  const [NewOpeningName, SetNewOpeningName] = useState('');
  const [NewOpeningMoves, SetNewOpeningMoves] = useState('');
  const [AddError, SetAddError] = useState('');

  const TreeContainerRef = useRef(null);
  const EngineWorkerRef = useRef(null);

  // Web Audio Context for move and capture sound effects
  const PlaySound = (isCapture = false) => {
    if (Muted) return;
    try {
      const AudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const Osc = AudioCtx.createOscillator();
      const GainNode = AudioCtx.createGain();
      
      Osc.connect(GainNode);
      GainNode.connect(AudioCtx.destination);
      
      if (isCapture) {
        // Double tone pulse for captures
        Osc.type = 'triangle';
        Osc.frequency.setValueAtTime(320, AudioCtx.currentTime);
        Osc.frequency.exponentialRampToValueAtTime(140, AudioCtx.currentTime + 0.15);
        GainNode.gain.setValueAtTime(0.15, AudioCtx.currentTime);
        GainNode.gain.exponentialRampToValueAtTime(0.01, AudioCtx.currentTime + 0.15);
        Osc.start();
        Osc.stop(AudioCtx.currentTime + 0.15);
      } else {
        // High to low pop for normal moves
        Osc.type = 'sine';
        Osc.frequency.setValueAtTime(400, AudioCtx.currentTime);
        Osc.frequency.exponentialRampToValueAtTime(260, AudioCtx.currentTime + 0.08);
        GainNode.gain.setValueAtTime(0.1, AudioCtx.currentTime);
        GainNode.gain.exponentialRampToValueAtTime(0.01, AudioCtx.currentTime + 0.08);
        Osc.start();
        Osc.stop(AudioCtx.currentTime + 0.08);
      }
    } catch (e) {
      console.warn("Web Audio API failed to initialize", e);
    }
  };

  // 1. Initialize Stockfish worker
  useEffect(() => {
    EngineWorkerRef.current = new StockfishWorker();
    return () => {
      if (EngineWorkerRef.current) {
        EngineWorkerRef.current.terminate();
      }
    };
  }, []);

  // 2. Load opening ECO database
  useEffect(() => {
    openingBook().then((Data) => {
      SetOpenings(Data);
      SetIsLoadingEco(false);
    }).catch((Error) => {
      console.error("Failed to load ECO database", Error);
      SetIsLoadingEco(false);
    });
  }, []);

  // 3. Keep target opening synchronized
  useEffect(() => {
    if (TargetOpening) {
      const TempGame = new Chess();
      try {
        TempGame.loadPgn(TargetOpening.Moves);
        const MovesArray = TempGame.history();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        SetExpectedMoves(MovesArray);
        ResetGame(MovesArray);
      } catch (err) {
        console.error("Error parsing target opening PGN", err);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TargetOpening, PlayerColor, IsTrainerMode]);

  // 4. Background Stockfish Position Evaluator on every Board State change
  useEffect(() => {
    if (!EngineWorkerRef.current) return;

    // Interrupt any active analysis
    EngineWorkerRef.current.postMessage('stop');
    SetIsEvaluating(true);

    const Fen = Game.fen();
    const IsWhiteToMove = Fen.split(' ')[1] === 'w';

    const Listener = (e) => {
      const Line = e.data;
      if (typeof Line !== 'string') return;

      if (Line.includes('info depth')) {
        const CpMatch = Line.match(/score cp (-?\d+)/);
        const MateMatch = Line.match(/score mate (-?\d+)/);

        if (CpMatch) {
          const Score = parseInt(CpMatch[1], 10) / 100;
          // Normalize score to white's perspective
          SetEvalScore(IsWhiteToMove ? Score : -Score);
          SetEvalType('cp');
        } else if (MateMatch) {
          const MateIn = parseInt(MateMatch[1], 10);
          // Normalize mate to white's perspective
          SetEvalScore(IsWhiteToMove ? MateIn : -MateIn);
          SetEvalType('mate');
        }
      }

      if (Line.startsWith('bestmove')) {
        SetIsEvaluating(false);
        EngineWorkerRef.current.removeEventListener('message', Listener);
      }
    };

    EngineWorkerRef.current.addEventListener('message', Listener);
    EngineWorkerRef.current.postMessage('ucinewgame');
    EngineWorkerRef.current.postMessage('position fen ' + Fen);
    // Depth 12 is extremely fast (under 400ms) but very accurate for opening evaluation
    EngineWorkerRef.current.postMessage('go depth 12');

    return () => {
      if (EngineWorkerRef.current) {
        EngineWorkerRef.current.postMessage('stop');
        EngineWorkerRef.current.removeEventListener('message', Listener);
      }
    };
  }, [Game]);

  // Build a tree of moves
  function BuildMoveTree(MovesArray, CurrentIndex) {
    let RootNode = { 
      name: 'Start', 
      attributes: { status: 'Played', index: 0 },
      nodeSvgShape: {
        shape: 'circle',
        shapeProps: { r: 12, fill: '#10b981', stroke: '#1e293b', strokeWidth: 2 }
      }
    };
    let CurrentNode = RootNode;

    MovesArray.forEach((Move, Index) => {
      const NewNode = { 
        name: Move, 
        attributes: { 
          status: Index < CurrentIndex ? 'Played' : (Index === CurrentIndex ? 'Next' : 'Pending'),
          index: Index + 1
        },
        nodeSvgShape: {
          shape: 'circle',
          shapeProps: {
            r: 10,
            fill: Index < CurrentIndex ? '#10b981' : (Index === CurrentIndex ? '#3b82f6' : '#475569'),
            stroke: '#1e293b',
            strokeWidth: 2
          }
        }
      };
      CurrentNode.children = [NewNode];
      CurrentNode = NewNode;
    });
    SetTreeData(RootNode);
  }

  function ResetGame(OverrideMoves = ExpectedMoves) {
    const NewGame = new Chess();
    SetLastError('');
    SetDetectedOpening('Starting Position');
    BuildMoveTree(OverrideMoves, 0);

    // If practicing as black, auto play the first move for white instantly
    if (IsTrainerMode && PlayerColor === 'b' && OverrideMoves.length > 0) {
      NewGame.move(OverrideMoves[0]);
      BuildMoveTree(OverrideMoves, 1);
    }
    
    SetGame(NewGame);
  }

  // Handle Tree Node clicks to jump the board state
  const HandleNodeClick = (NodeDatum) => {
    if (!IsTrainerMode) return;
    const TargetIndex = NodeDatum.attributes?.index !== undefined ? parseInt(NodeDatum.attributes.index, 10) : 0;
    
    const NewGame = new Chess();
    for (let i = 0; i < TargetIndex; i++) {
      if (ExpectedMoves[i]) {
        NewGame.move(ExpectedMoves[i]);
      }
    }
    SetGame(NewGame);
    BuildMoveTree(ExpectedMoves, TargetIndex);
    SetLastError('');
    PlaySound(false);
  };

  const AutoPlayOpponentMove = (CurrentGameCopy, MoveIndex) => {
    if (MoveIndex >= ExpectedMoves.length) {
      SetLastError("Opening sequence completed!");
      return;
    }

    const NextMove = ExpectedMoves[MoveIndex];
    
    setTimeout(() => {
      const AutoGameCopy = new Chess();
      AutoGameCopy.loadPgn(CurrentGameCopy.pgn());
      
      const MoveResult = AutoGameCopy.move(NextMove);
      SetGame(AutoGameCopy);
      BuildMoveTree(ExpectedMoves, MoveIndex + 1);
      PlaySound(MoveResult.captured !== undefined);
    }, 500);
  };

  const EvaluateDeviation = async (ExpectedFen, ActualFen, ExpectedMove, PlayedMove) => {
    SetLastError('Analyzing mistake...');
    
    const GetScoreFromWhitePerspective = (Fen) => {
      return new Promise((resolve) => {
        let Score = 0;
        let TimeoutId = null;
        
        const Cleanup = () => {
          if (TimeoutId) clearTimeout(TimeoutId);
          EngineWorkerRef.current.removeEventListener('message', Listener);
        };

        const Listener = (e) => {
          const Line = e.data;
          if (typeof Line !== 'string') return;
          if (Line.includes('info depth')) {
            const CpMatch = Line.match(/score cp (-?\d+)/);
            if (CpMatch) {
              Score = parseInt(CpMatch[1], 10) / 100;
            }
          }
          if (Line.startsWith('bestmove')) {
            Cleanup();
            const IsWhite = Fen.split(' ')[1] === 'w';
            resolve(IsWhite ? Score : -Score);
          }
        };

        TimeoutId = setTimeout(() => {
          Cleanup();
          resolve(Score);
        }, 3000);

        EngineWorkerRef.current.addEventListener('message', Listener);
        EngineWorkerRef.current.postMessage('ucinewgame');
        EngineWorkerRef.current.postMessage('position fen ' + Fen);
        EngineWorkerRef.current.postMessage('go depth 12');
      });
    };

    const ExpectedScore = await GetScoreFromWhitePerspective(ExpectedFen);
    const ActualScore = await GetScoreFromWhitePerspective(ActualFen);
    
    const Drop = PlayerColor === 'w' ? (ExpectedScore - ActualScore) : (ActualScore - ExpectedScore);
    
    SetLastError(`Mistake! Expected ${ExpectedMove}, but you played ${PlayedMove}. Evaluation dropped by ${Math.max(0, Drop).toFixed(1)} points.`);
  };

  function OnPieceDrop({ sourceSquare, targetSquare }) {
    const GameCopy = new Chess();
    GameCopy.loadPgn(Game.pgn());
    const CurrentMoveIndex = GameCopy.history().length;

    try {
      const MoveResult = GameCopy.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      if (MoveResult === null) return false;

      // Play Move/Capture sound effect
      PlaySound(MoveResult.captured !== undefined);

      if (IsTrainerMode) {
        const ExpectedMove = ExpectedMoves[CurrentMoveIndex];

        if (MoveResult.san !== ExpectedMove) {
          // Check if deviation is valid opening theory
          let AlternativeOpeningName = null;
          if (Openings) {
            const Result = lookupByMoves(GameCopy, Openings);
            if (Result && Result.opening && Result.opening.name) {
              AlternativeOpeningName = Result.opening.name;
            }
          }

          if (AlternativeOpeningName) {
            SetLastError(`Valid Theory! You played the ${AlternativeOpeningName}. Great move, but we are practicing the ${TargetOpening.Name}. Try again!`);
            return false;
          }

          // Otherwise, evaluate deviation with Stockfish
          const ExpectedGameCopy = new Chess();
          ExpectedGameCopy.loadPgn(Game.pgn());
          ExpectedGameCopy.move(ExpectedMove);
          
          EvaluateDeviation(ExpectedGameCopy.fen(), GameCopy.fen(), ExpectedMove, MoveResult.san);
          return false;
        }

        SetLastError('');
        SetGame(GameCopy);
        BuildMoveTree(ExpectedMoves, CurrentMoveIndex + 1);

        // Auto opponent response
        AutoPlayOpponentMove(GameCopy, CurrentMoveIndex + 1);
        return true;
      }

      // Observation mode
      SetLastError('');
      if (Openings) {
        const Result = lookupByMoves(GameCopy, Openings);
        SetDetectedOpening(Result && Result.opening ? Result.opening.name : 'Unknown Position');
      }
      SetGame(GameCopy);
      return true;

    } catch {
      return false;
    }
  }

  // Custom Opening Addition
  const HandleSaveOpening = (e) => {
    e.preventDefault();
    SetAddError('');

    if (!NewOpeningName.trim()) {
      SetAddError('Opening name is required.');
      return;
    }
    if (!NewOpeningMoves.trim()) {
      SetAddError('Moves list is required.');
      return;
    }

    const TempGame = new Chess();
    try {
      TempGame.loadPgn(NewOpeningMoves);
      if (TempGame.history().length === 0) {
        SetAddError('Unable to extract moves from input. Format: 1. e4 e5 2. Nf3 Nc6');
        return;
      }
    } catch (err) {
      SetAddError(`Invalid PGN formatting: ${err.message}`);
      return;
    }

    const NewItem = {
      Name: NewOpeningName.trim(),
      Moves: NewOpeningMoves.trim()
    };

    const UpdatedRepertoire = [...Repertoire, NewItem];
    SetRepertoire(UpdatedRepertoire);
    localStorage.setItem('chess_repertoire', JSON.stringify(UpdatedRepertoire));
    SetTargetOpening(NewItem);

    // Reset Form
    SetNewOpeningName('');
    SetNewOpeningMoves('');
    SetAddModalOpen(false);
  };

  const HandleDeleteOpening = (Name) => {
    const Updated = Repertoire.filter(op => op.Name !== Name);
    if (Updated.length === 0) {
      SetLastError("Cannot delete all openings. Keep at least one opening in the list.");
      return;
    }
    SetRepertoire(Updated);
    localStorage.setItem('chess_repertoire', JSON.stringify(Updated));
    if (TargetOpening.Name === Name) {
      SetTargetOpening(Updated[0]);
    }
  };

  // Convert Move History Array to pairs for SAN log
  const RenderMoveHistory = () => {
    const History = Game.history();
    const Pairs = [];
    for (let i = 0; i < History.length; i += 2) {
      Pairs.push({
        num: Math.floor(i / 2) + 1,
        w: History[i],
        b: History[i + 1] || ''
      });
    }
    return Pairs;
  };

  // Calculate Evaluation Bar Percentages
  // Standard limits: cp +8 (fully white) to -8 (fully black)
  const GetWhitePercentage = () => {
    if (EvalType === 'mate') {
      return EvalScore > 0 ? 95 : 5;
    }
    return Math.min(Math.max(50 + (EvalScore * 50 / 8), 5), 95);
  };

  const WhitePct = GetWhitePercentage();

  const ChessboardOptions = {
    position: Game.fen(),
    boardOrientation: PlayerColor === 'w' ? 'white' : 'black',
    onPieceDrop: OnPieceDrop,
    customDarkSquareStyle: { backgroundColor: '#b58863' },
    customLightSquareStyle: { backgroundColor: '#f0d9b5' },
    customBoardStyle: { borderRadius: '0.375rem', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' },
    animationDuration: 200
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      
      {/* Sidebar - Control and Analysis Panel */}
      <div className="w-[420px] flex flex-col border-r border-slate-800 bg-slate-900/90 shadow-2xl z-10 relative">
        
        {/* Sidebar Header */}
        <div className="p-5 border-b border-slate-800 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
              <span>♟️ Repertoire Trainer</span>
            </h1>
            <div className="flex gap-2">
              <button 
                onClick={() => SetMuted(!Muted)} 
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title={Muted ? "Unmute sound effects" : "Mute sound effects"}
              >
                {Muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button 
                onClick={() => ResetGame()} 
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1 text-xs"
                title="Reset active board"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Mode Switcher Buttons */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800/80">
            <button 
              onClick={() => SetIsTrainerMode(false)}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${!IsTrainerMode ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Observation</span>
            </button>
            <button 
              onClick={() => SetIsTrainerMode(true)}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all ${IsTrainerMode ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Trainer Mode</span>
            </button>
          </div>
        </div>

        {/* Sidebar Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {IsLoadingEco ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="text-sm text-slate-400 font-medium">Loading ECO opening database...</span>
            </div>
          ) : (
            <div className="space-y-4">
              
              {/* Trainer Mode Selection Panel */}
              {IsTrainerMode ? (
                <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-xl space-y-4 shadow-inner">
                  {/* Select Opening Row */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Target opening</label>
                      <button 
                        onClick={() => SetAddModalOpen(true)}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5 hover:underline font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Custom</span>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <select 
                        value={TargetOpening.Name}
                        onChange={(e) => {
                          const Selected = Repertoire.find(Op => Op.Name === e.target.value);
                          if (Selected) SetTargetOpening(Selected);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700/80 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        {Repertoire.map(Op => <option key={Op.Name} value={Op.Name}>{Op.Name}</option>)}
                      </select>
                      {Repertoire.length > 1 && !PopularOpenings.some(pop => pop.Name === TargetOpening.Name) && (
                        <button 
                          onClick={() => HandleDeleteOpening(TargetOpening.Name)}
                          className="p-2 bg-red-950/20 text-red-400 hover:bg-red-900/40 rounded-lg border border-red-900/30 transition-colors"
                          title="Delete custom opening"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Play As Select Row */}
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Practice As</label>
                    <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700/50">
                      <button 
                        onClick={() => SetPlayerColor('w')}
                        className={`py-1 text-xs font-medium rounded transition-all ${PlayerColor === 'w' ? 'bg-slate-100 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        White
                      </button>
                      <button 
                        onClick={() => SetPlayerColor('b')}
                        className={`py-1 text-xs font-medium rounded transition-all ${PlayerColor === 'b' ? 'bg-slate-800 text-white font-bold border border-slate-600' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Black
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Observation Mode Context Panel */
                <div className="bg-gradient-to-r from-blue-950/20 to-slate-900 border border-slate-800/80 p-4 rounded-xl text-center shadow">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-1">Detected Position Theory</span>
                  <div className="text-base font-bold text-emerald-400 leading-tight">{DetectedOpening}</div>
                </div>
              )}

              {/* Move Visualizer Tree Diagram */}
              {IsTrainerMode && (
                <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl overflow-hidden shadow-inner flex flex-col">
                  <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800/60 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Expected Move Sequence</span>
                    <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                      <HelpCircle className="w-3 h-3" />
                      <span>Click node to jump</span>
                    </span>
                  </div>
                  <div className="h-[220px] w-full" ref={TreeContainerRef}>
                    <Tree 
                      data={TreeData} 
                      orientation="vertical"
                      translate={{ x: 180, y: 35 }}
                      pathFunc="step"
                      nodeSize={{ x: 70, y: 50 }}
                      onNodeClick={HandleNodeClick}
                      textLayout={{ textAnchor: "middle", y: 22 }}
                      styles={{
                        links: { stroke: '#334155', strokeWidth: 2 },
                        nodes: { 
                          node: { 
                            circle: { cursor: 'pointer' },
                            name: { fill: '#cbd5e1', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' } 
                          },
                          leafNode: { 
                            circle: { cursor: 'pointer' },
                            name: { fill: '#cbd5e1', fontSize: 11, fontWeight: '600', fontFamily: 'monospace' } 
                          } 
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Game Notation Scroll Panel */}
              <div className="bg-slate-950/30 border border-slate-800/80 rounded-xl overflow-hidden shadow flex flex-col">
                <div className="bg-slate-900/60 px-4 py-2 border-b border-slate-800/60">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Move Log</span>
                </div>
                <div className="p-3 h-[180px] overflow-y-auto font-mono text-sm space-y-1 bg-slate-950/60">
                  {RenderMoveHistory().length === 0 ? (
                    <div className="text-slate-600 text-xs italic text-center py-10">No moves played yet.</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-y-1 gap-x-4 max-w-xs text-left mx-auto">
                      {RenderMoveHistory().map((pair) => (
                        <div key={pair.num} className="contents">
                          <span className="text-slate-600 text-right">{pair.num}.</span>
                          <span className="text-slate-200 font-semibold">{pair.w}</span>
                          <span className="text-slate-400">{pair.b}</span>
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

      {/* Main Chessboard Board Area */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative p-8">
        
        {/* Live Evaluation/Status Display */}
        <div className="mb-4 text-center h-10 flex items-center justify-center">
          {LastError ? (
            <div className="text-red-400 bg-red-950/30 px-4 py-1.5 rounded-lg font-mono text-xs border border-red-500/20 shadow animate-pulse">
              {LastError}
            </div>
          ) : (
            IsEvaluating && (
              <div className="text-slate-500 font-mono text-xs flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                <span>Stockfish analyzing...</span>
              </div>
            )
          )}
        </div>

        {/* Board and Evaluation Bar Wrapper */}
        <div className="flex items-center">
          
          {/* Vertical Live Stockfish Evaluation Bar */}
          <div className="mr-5 flex flex-col items-center justify-between h-[560px] w-6 bg-slate-950 border border-slate-800 rounded-md overflow-hidden relative shadow-2xl">
            {/* Black Score Section */}
            <div 
              className="w-full bg-slate-900 transition-all duration-300 ease-out" 
              style={{ height: `${100 - WhitePct}%` }} 
            />
            {/* White Score Section */}
            <div 
              className="w-full bg-slate-100 transition-all duration-300 ease-out" 
              style={{ height: `${WhitePct}%` }} 
            />
            
            {/* Overlay Indicator Text */}
            <div className="absolute inset-x-0 bottom-2 text-center pointer-events-none select-none">
              <span className={`text-[9px] font-extrabold px-1 py-0.5 rounded shadow-sm ${WhitePct > 50 ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>
                {EvalType === 'mate' 
                  ? (EvalScore > 0 ? `M${EvalScore}` : `-M${Math.abs(EvalScore)}`) 
                  : `${EvalScore > 0 ? '+' : ''}${EvalScore.toFixed(1)}`
                }
              </span>
            </div>
          </div>

          {/* Graphical Chessboard */}
          <div className="w-[560px] h-[560px] relative select-none">
            <Chessboard options={ChessboardOptions} />
          </div>
        </div>

        {/* Visual Board Footer */}
        <div className="mt-4 text-slate-500 text-[11px] font-mono select-none">
          Drag and drop pieces to play theory. Deviations trigger automatic Stockfish analysis.
        </div>
      </div>

      {/* Add Custom Opening Modal Overlay */}
      {AddModalOpen && (
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
          <div className="w-[480px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-250">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/30">
              <h3 className="text-base font-bold text-slate-200">Add Custom Practice Opening</h3>
              <button 
                onClick={() => SetAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Modal Form */}
            <form onSubmit={HandleSaveOpening} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Opening Name</label>
                <input 
                  type="text" 
                  value={NewOpeningName}
                  onChange={(e) => SetNewOpeningName(e.target.value)}
                  placeholder="e.g. Sicilian Defense: Najdorf Variation"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-lg p-2.5 text-sm text-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">Moves list (SAN/PGN)</label>
                <textarea 
                  rows="3"
                  value={NewOpeningMoves}
                  onChange={(e) => SetNewOpeningMoves(e.target.value)}
                  placeholder="e.g. 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-lg p-2.5 text-sm text-slate-200 font-mono focus:outline-none resize-none"
                />
              </div>

              {AddError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-500/20 p-2.5 rounded-lg font-mono">
                  {AddError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => SetAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-xs transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-xs transition-colors shadow-lg shadow-blue-500/15"
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