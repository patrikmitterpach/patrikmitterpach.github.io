var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { ChessBoard, Color, PieceType } from './chessboard.js';
// Use the chess board
let board;
let selectedSquare = null;
let turn = Color.White;
document.addEventListener('DOMContentLoaded', () => {
    board = new ChessBoard();
    renderBoard(board);
});
function highlightValidMoves(board, selectedRow, selectedCol, highlight) {
    const chessboardElement = document.getElementById('chessboard');
    if (!chessboardElement)
        return;
    // Clear any previous highlights
    const squares = chessboardElement.getElementsByClassName('square');
    for (const square of squares) {
        square.classList.remove('highlight');
    }
    const selectedPiece = board.getPiece(selectedRow, selectedCol);
    if (!selectedPiece)
        return; // No piece selected
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (board.isValidMove(selectedRow, selectedCol, row, col)) {
                const square = document.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
                if (square) {
                    if (highlight) {
                        square.classList.add('highlight');
                    }
                    else {
                        square.classList.remove('highlight');
                    }
                }
            }
        }
    }
}
function renderBoard(board) {
    const chessboardElement = document.getElementById('chessboard');
    if (!chessboardElement)
        return;
    chessboardElement.innerHTML = ''; // Clear existing board
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('img');
            square.classList.add('square');
            square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
            square.dataset.row = row.toString();
            square.dataset.col = col.toString();
            const piece = board.getPiece(row, col);
            if (piece) {
                square.src = getPieceSymbol(piece, piece.color);
            }
            square.addEventListener('click', handleSquareClick);
            chessboardElement.appendChild(square);
        }
    }
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function activateGravity(board) {
    return __awaiter(this, void 0, void 0, function* () {
        let hasMoved = true;
        while (hasMoved) {
            hasMoved = false;
            for (let row = 6; row >= 0; row--) { // Start from the second last row upwards
                for (let col = 0; col < 8; col++) {
                    const piece = board.getPiece(row, col);
                    if (piece && !board.getPiece(row + 1, col)) { // If there is a piece and space below is empty
                        board.movePiece(row, col, row + 1, col);
                        renderBoard(board); // Re-render the board to show the movement
                        yield delay(20); // Add a delay of 100ms
                        hasMoved = true;
                    }
                }
            }
        }
    });
}
function handleSquareClick(event) {
    var _a, _b;
    const clickedSquare = event.target;
    const row = parseInt(clickedSquare.dataset.row || '0');
    const col = parseInt(clickedSquare.dataset.col || '0');
    if (selectedSquare === null) {
        // No piece is currently selected
        if (((_a = board.getPiece(row, col)) === null || _a === void 0 ? void 0 : _a.color) == turn) {
            selectedSquare = { row, col };
            clickedSquare.classList.add('highlight');
            highlightValidMoves(board, row, col, true);
        }
    }
    else {
        // A piece is already selected
        const fromRow = selectedSquare.row;
        const fromCol = selectedSquare.col;
        if (board.isValidMove(fromRow, fromCol, row, col)) {
            // Move the piece
            board.movePiece(fromRow, fromCol, row, col);
            turn = turn == Color.White ? Color.Black : Color.White;
            activateGravity(board);
            renderBoard(board);
        }
        // Deselect the piece
        highlightValidMoves(board, row, col, false);
        (_b = document.querySelector('.highlight')) === null || _b === void 0 ? void 0 : _b.classList.remove('highlight');
        selectedSquare = null;
    }
}
function getPieceSymbol(piece, color) {
    const symbols = {
        [PieceType.Pawn]: { white: 'wP.svg', black: 'bP.svg' },
        [PieceType.Rook]: { white: 'wR.svg', black: 'bR.svg' },
        [PieceType.Knight]: { white: 'wN.svg', black: 'bN.svg' }, // N is the standard abbreviation for Knight
        [PieceType.Bishop]: { white: 'wB.svg', black: 'bB.svg' },
        [PieceType.Queen]: { white: 'wQ.svg', black: 'bQ.svg' },
        [PieceType.King]: { white: 'wK.svg', black: 'bK.svg' }
    };
    const pieceFileName = color === Color.White ? symbols[piece.type].white : symbols[piece.type].black;
    return `img/${pieceFileName}`;
}
