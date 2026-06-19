# Chess Opening Repertoire Trainer

A comprehensive, interactive web application designed to help chess players master their opening repertoires. Whether you are learning classical theory, practicing against automated responses, or building your own custom variations, this tool provides real-time feedback, deep engine analysis, and an engaging interface.

## 🚀 Features

The application is structured into four distinct modes to cover every aspect of opening preparation:

### 1. Observation Mode
- A free-play sandbox that allows you to explore moves on the board.
- **Dynamic Opening Detection:** Instantly identifies and displays the name of the opening or variation you are playing by matching it against the comprehensive Encyclopedia of Chess Openings (ECO) database.

### 2. Trainer Mode
- Practice specific openings against an automated opponent. 
- **Move Tree Visualization:** A dynamic D3.js tree tracks your progress through the opening line, highlighting played, current, and pending moves.
- **Multi-Branch Analysis:** If you deviate from the target line, the app first checks the ECO database. If your move is a valid theoretical alternative (e.g., you played a Sicilian instead of a Caro-Kann), it praises your theory knowledge before gently reminding you of the target practice line.
- **Stockfish Evaluation:** If your move is an actual mistake (not theoretical), a background Stockfish 16.1 Web Worker evaluates the position and dynamically labels the deviation (Inaccuracy, Mistake, or Blunder) based on the centipawn drop.

### 3. Quiz Mode
- **Interactive Scenarios:** Randomly drops you into a random point in a popular opening and challenges you to find the exact theoretical next move.
- **Mastery Dashboard:** Tracks your correct guesses vs total attempts to give you a live mastery percentage.
- **Adaptive Feedback:** Gives you 5 attempts to find the correct move. It will provide hints along the way if you stumble into valid alternative theories.

### 4. Custom Repertoire Builder (Editor Mode)
- **Create Your Own Lines:** Play out any sequence of moves on the board and save it with a custom name.
- **Local Storage Integration:** Your custom lines are saved to your browser's local storage and injected directly into the Trainer Mode's dropdown menu so you can practice your secret variations.
- **Easy Management:** Delete outdated repertoires directly from the Trainer Mode UI.

---

## 🛠️ Technology Stack

- **Framework:** React + Vite
- **Styling:** TailwindCSS
- **Chess Logic:** `chess.js` for move validation and PGN/FEN parsing
- **UI Board:** `react-chessboard`
- **Database:** `@chess-openings/eco.json`
- **Visuals:** `react-d3-tree` for move hierarchies, `lucide-react` for icons
- **Engine:** `stockfish.js` via Web Workers for non-blocking analysis

---

## 📁 File Structure

The project was recently refactored to ensure highly modular, maintainable code:

```
src/
├── components/
│   └── SharedLayout.jsx    # Global UI skeleton, mode switcher, and sidebar
├── modes/
│   ├── ObservationMode.jsx # Logic and UI for Observation
│   ├── TrainerMode.jsx     # Logic, Stockfish integration, and Tree UI for Trainer
│   ├── QuizMode.jsx        # Quiz generation and Dashboard UI
│   └── EditorMode.jsx      # Saving custom PGNs to localStorage
├── App.jsx                 # Main orchestrator; loads ECO database and renders modes
├── constants.js            # Hardcoded popular openings for easy access
├── stockfishWorker.js      # Web Worker file to run Stockfish asynchronously
├── main.jsx                # React entry point
└── index.css               # Tailwind directives and global CSS variables
```

---

## ⚙️ Requirements

To run this project locally, you will need:
- **Node.js** (v18.0.0 or higher recommended)
- **npm** (Node Package Manager)

---

## 🏃‍♂️ How to Run

1. **Clone the repository**
   ```bash
   git clone https://github.com/Sikki-Codez/Chess-Opening-Repertoire-Trainer.git
   cd Chess-Opening-Repertoire-Trainer
   ```

2. **Install the dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open in Browser**
   - The terminal will display a local URL (usually `http://localhost:5173`).
   - Ctrl+Click the link to open the app and start practicing!
