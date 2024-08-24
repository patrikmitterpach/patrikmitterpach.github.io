// Enum for piece colors
export var Color;
(function (Color) {
    Color[Color["White"] = 0] = "White";
    Color[Color["Black"] = 1] = "Black";
})(Color || (Color = {}));
// Enum for piece types
export var PieceType;
(function (PieceType) {
    PieceType[PieceType["Pawn"] = 0] = "Pawn";
    PieceType[PieceType["Rook"] = 1] = "Rook";
    PieceType[PieceType["Knight"] = 2] = "Knight";
    PieceType[PieceType["Bishop"] = 3] = "Bishop";
    PieceType[PieceType["Queen"] = 4] = "Queen";
    PieceType[PieceType["King"] = 5] = "King";
})(PieceType || (PieceType = {}));
// Class representing the chess board
export class ChessBoard {
    constructor() {
        this.board = this.initializeBoard();
    }
    initializeBoard() {
        // Create an 8x8 empty board
        const board = new Array(8).fill(null).map(() => new Array(8).fill(null));
        // Set up initial piece positions (example setup)
        this.setupInitialPosition(board);
        return board;
    }
    isValidMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.getPiece(fromRow, fromCol);
        if (!piece) {
            return false; // No piece at the source location
        }
        const targetPiece = this.getPiece(toRow, toCol);
        if (targetPiece && targetPiece.color === piece.color) {
            return false; // Cannot capture a piece of the same color
        }
        const rowDiff = toRow - fromRow;
        const colDiff = toCol - fromCol;
        switch (piece.type) {
            case PieceType.Pawn:
                if (piece.color === Color.White) {
                    if (fromCol === 1 && colDiff === 2 && rowDiff === 0 && !targetPiece) {
                        return true; // White pawn double step forward from initial position (column 2)
                    }
                    if (colDiff === 1 && rowDiff === 0 && !targetPiece) {
                        return true; // White pawn single step forward
                    }
                    if (colDiff === 1 && Math.abs(rowDiff) === 1 && targetPiece) {
                        return true; // White pawn capture diagonally
                    }
                }
                else {
                    if (fromCol === 6 && colDiff === -2 && rowDiff === 0 && !targetPiece) {
                        return true; // Black pawn double step forward from initial position (column 7)
                    }
                    if (colDiff === -1 && rowDiff === 0 && !targetPiece) {
                        return true; // Black pawn single step forward
                    }
                    if (colDiff === -1 && Math.abs(rowDiff) === 1 && targetPiece) {
                        return true; // Black pawn capture diagonally
                    }
                }
                break;
            case PieceType.Rook:
                if (rowDiff === 0 || colDiff === 0) {
                    return this.isPathClear(fromRow, fromCol, toRow, toCol); // Rook moves in straight lines
                }
                break;
            case PieceType.Knight:
                if ((Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 1) || (Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 2)) {
                    return true; // Knight moves in "L" shapes
                }
                break;
            case PieceType.Bishop:
                if (Math.abs(rowDiff) === Math.abs(colDiff)) {
                    return this.isPathClear(fromRow, fromCol, toRow, toCol); // Bishop moves diagonally
                }
                break;
            case PieceType.Queen:
                if (rowDiff === 0 || colDiff === 0 || Math.abs(rowDiff) === Math.abs(colDiff)) {
                    return this.isPathClear(fromRow, fromCol, toRow, toCol); // Queen moves like both Rook and Bishop
                }
                break;
            case PieceType.King:
                if (Math.abs(rowDiff) <= 1 && Math.abs(colDiff) <= 1) {
                    return true; // King moves one square in any direction
                }
                // Add logic for castling if necessary
                break;
            default:
                return false;
        }
        return false;
    }
    isPathClear(fromRow, fromCol, toRow, toCol) {
        const rowDirection = Math.sign(toRow - fromRow); // 1, -1, or 0 for row direction
        const colDirection = Math.sign(toCol - fromCol); // 1, -1, or 0 for column direction
        let currentRow = fromRow + rowDirection;
        let currentCol = fromCol + colDirection;
        while (currentRow !== toRow || currentCol !== toCol) {
            if (this.getPiece(currentRow, currentCol) !== null) {
                return false; // There's a piece blocking the path
            }
            currentRow += rowDirection;
            currentCol += colDirection;
        }
        return true; // Path is clear
    }
    setupInitialPosition(board) {
        // Set up pawns
        for (let i = 0; i < 8; i++) {
            board[i][1] = { type: PieceType.Pawn, color: Color.White };
            board[i][6] = { type: PieceType.Pawn, color: Color.Black };
        }
        // Set up other pieces (example: rooks)
        board[0][0] = board[7][0] = { type: PieceType.Rook, color: Color.White };
        board[0][7] = board[7][7] = { type: PieceType.Rook, color: Color.Black };
        board[1][0] = board[6][0] = { type: PieceType.Knight, color: Color.White };
        board[1][7] = board[6][7] = { type: PieceType.Knight, color: Color.Black };
        board[2][0] = board[5][0] = { type: PieceType.Bishop, color: Color.White };
        board[2][7] = board[5][7] = { type: PieceType.Bishop, color: Color.Black };
        board[3][0] = { type: PieceType.King, color: Color.White };
        board[3][7] = { type: PieceType.King, color: Color.Black };
        board[4][0] = { type: PieceType.Queen, color: Color.White };
        board[4][7] = { type: PieceType.Queen, color: Color.Black };
    }
    // Method to get a piece at a specific position
    getPiece(row, col) {
        return this.board[row][col];
    }
    // Method to move a piece
    movePiece(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        if (piece) {
            this.board[toRow][toCol] = piece;
            this.board[fromRow][fromCol] = null;
        }
    }
}
