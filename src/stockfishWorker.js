import Stockfish from 'stockfish.js';

let engine;
try {
  engine = typeof Stockfish === 'function' ? Stockfish() : Stockfish;
} catch (e) {
  console.error("Failed to initialize Stockfish", e);
}

if (engine) {
  engine.onmessage = (event) => {
    const line = typeof event === 'string' ? event : event.data;
    if (line) {
      postMessage(line);
    }
  };

  onmessage = (event) => {
    engine.postMessage(event.data);
  };
} else {
  console.error("Stockfish engine not initialized.");
}
