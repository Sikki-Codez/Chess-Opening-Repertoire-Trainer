# Contributing to Chess Opening Repertoire Trainer

Thank you for your interest in contributing to the Chess Opening Repertoire Trainer! We welcome contributions from everyone.

To ensure a smooth collaboration, please read and follow these guidelines.

## Code of Conduct

Please be respectful and welcoming to all contributors. Focus on constructive feedback and collaboration.

## Getting Started

1. **Fork the Repository**: Fork this repository to your own GitHub account.
2. **Clone the Repo**: Clone your fork locally:
   ```bash
   git clone https://github.com/MuhammadAhmadF2005/Chess-Opening-Repertoire-Trainer.git
   cd Chess-Opening-Repertoire-Trainer
   ```
3. **Install Dependencies**: Install the project's dependencies:
   ```bash
   npm install
   ```
4. **Run Locally**: Start the Vite development server:
   ```bash
   npm run dev
   ```

## Development Workflow

### Creating a Branch
Create a descriptive branch name before making any changes:
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b bugfix/your-bugfix-name
```

### Coding Guidelines
*   **Aesthetics and HCI**: Keep the dark mode slate-based dashboard clean, responsive, and intuitive.
*   **Framework**: Write React components using functional styles and standard React hooks.
*   **Styling**: Use Tailwind CSS for utility styles and vanilla CSS (`src/index.css`) for design system overrides.
*   **Clean Code**: Avoid unused imports, check for console logs, and follow the project's ESLint rules.

### Testing and Linting
Before committing your changes, make sure they lint and build correctly:
```bash
# Run lint check
npm run lint

# Run production build compilation
npm run build
```

## Submitting a Pull Request

1. **Commit Message**: Write a meaningful, descriptive commit message. Keep it clear and concise (e.g., `feat: add live Stockfish evaluation bar`).
2. **Push to Your Fork**: Push the branch to your fork on GitHub.
3. **Create the PR**: Go to the original repository and click "New Pull Request".
4. **Description**: Describe your changes in detail—what problem did you solve, what features did you add, and how was it verified.
5. **Review**: Wait for reviewers to check your pull request. Proactively address any feedback!

Thank you for making this project better!
