# Chess Opening Repertoire Trainer

An interactive, responsive React and Vite web application built to help chess players practice, train, and build custom opening repertoires. It combines real-time theory detection, interactive visual move trees, sound synthesis, and an integrated Stockfish engine to analyze deviations from standard opening theory.

![License](https://img.shields.io/badge/license-MIT-green.svg)
![React](https://img.shields.io/badge/React-19-blue.svg)
![Vite](https://img.shields.io/badge/Vite-8-purple.svg)
![Tailwind](https://img.shields.io/badge/Tailwind-4-blueviolet.svg)

---

## Key Features

*   **Real-Time Theory Detection**: Play moves on the board in Observation Mode to detect openings automatically, referencing a built-in ECO database.
*   **Interactive Repertoire Trainer**: Choose a target opening sequence and color (White/Black) to play. The computer automatically plays the opponent's moves.
*   **Interactive Visual Move Tree**: The application generates an interactive node tree (rendered via `react-d3-tree`) detailing the opening path. Click on any past move in the tree to jump the chessboard to that position.
*   **Integrated Stockfish.js Engine**: A background Web Worker runs Stockfish to evaluate positions. If you play a non-theoretical move, Stockfish analyzes the board and calculates your exact drop in evaluation score.
*   **Live Evaluation Bar**: Displays dynamic positional balance (e.g. `+0.4` or `-1.2`) alongside the board, adjusting in real-time.
*   **Custom Repertoire Builder**: Import and save custom openings in PGN format to local storage. Create, practice, and delete your own training lines.
*   **Audio Synthesis**: Realistic move and capture sound effects synthetically generated via the browser's native Web Audio API (no static audio files required).
*   **Move History Log**: Scrollable notation log showing your games in Standard Algebraic Notation (SAN).
*   **Premium HCI Theme**: Modern Slate dark-mode design, clean glassmorphic selectors, smooth transitions, and board highlights.

---

## Tech Stack

*   **Core**: React 19 + Vite + ESNext JavaScript
*   **Chess Logic**: `chess.js` (move validation and history)
*   **Chess UI**: `react-chessboard` (board rendering)
*   **Visualizations**: `react-d3-tree` (move hierarchy)
*   **Analysis Engine**: `stockfish.js` (WebAssembly/Web Worker chess engine)
*   **Styling**: Tailwind CSS v4 + custom Vanilla CSS themes
*   **Icons**: `lucide-react`

---

## Developer Installation & Setup

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/MuhammadAhmadF2005/Chess-Opening-Repertoire-Trainer.git
    cd Chess-Opening-Repertoire-Trainer
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Run in Development Mode**:
    ```bash
    npm run dev
    ```
    Open your browser and navigate to `http://localhost:5173`.

4.  **Lint and Build**:
    ```bash
    # Check for lint errors
    npm run lint

    # Build production bundle
    npm run build
    ```

---

## How to Use the Trainer

1.  **Select a Mode**: Toggle between Observation (free exploration) and Trainer (practice).
2.  **Practice an Opening**:
    *   In Trainer Mode, choose an opening from the dropdown (e.g. Italian Game).
    *   Pick your color (White or Black).
    *   Try making the correct theoretical moves on the board. The computer opponent will automatically reply to your moves.
    *   If you play an incorrect/deviated move, the trainer checks if it is alternative chess theory. If it isn't, it will run Stockfish to calculate the evaluation penalty.
3.  **Use the Tree Navigation**: Click on any node in the move tree visualization on the sidebar. The chessboard will automatically jump back to that point in history.
4.  **Create Custom Openings**:
    *   Click Custom Openings in the sidebar.
    *   Enter a name (e.g., "My Queen's Gambit") and a valid PGN sequence (e.g., `1. d4 d5 2. c4`).
    *   Click Save. It will now appear in your training selector list!
