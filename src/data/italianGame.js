export const italianGameData = {
  id: "root",
  name: "Starting Position",
  move: "",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  children: [
    {
      id: "e4",
      name: "e4",
      move: "e4",
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      children: [
        {
          id: "e5",
          name: "e5",
          move: "e5",
          fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
          children: [
            {
              id: "Nf3",
              name: "Nf3",
              move: "Nf3",
              fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
              children: [
                {
                  id: "Nc6",
                  name: "Nc6",
                  move: "Nc6",
                  fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
                  children: [
                    {
                      id: "Bc4",
                      name: "Bc4",
                      move: "Bc4",
                      fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
                      children: [
                        {
                          id: "Bc5",
                          name: "Bc5",
                          move: "Bc5",
                          fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
                          children: []
                        },
                        {
                          id: "Nf6",
                          name: "Nf6",
                          move: "Nf6",
                          fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
                          children: []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};
