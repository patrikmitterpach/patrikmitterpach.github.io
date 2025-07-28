// Create grid
const numRows = 12;
const numCols = 12;

var mapCorrectCount = 0;
var globalMappedArr;
var direction = "h";
var focusColor = "#fff3e0"
var plusColor = "#e3f2fd"
var perpColor = "white"

var acrossIds = new Set();
var downIds = new Set();

function createGrid() {
  const crosswordGrid = document.getElementById('crosswordGrid');
  for (let i = 0; i < numRows; i++) {
    const row = document.createElement('tr');
    for (let j = 0; j < numCols; j++) {
      const cell = row.insertCell();
      const input = document.createElement('input');

      // Key attributes for all the squares
      input.setAttribute('type', 'text');
      input.setAttribute('maxlength', '3');
      input.setAttribute('data-row', i);
      input.setAttribute('data-col', j);

      input.setAttribute('oninput', 'handleInput(event)')

      input.addEventListener('keydown', handleArrowKeys);
      input.addEventListener('focus', handleOnFocus)

      cell.appendChild(input);


    }
    crosswordGrid.appendChild(row);
  }
}

function handleOnFocus(event) {
  const currentInput = event.target;
  const currentRow = parseInt(currentInput.getAttribute('data-row'));
  const currentCol = parseInt(currentInput.getAttribute('data-col'));

  // Erase previous + paint blocks
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      var currentVal = document.querySelector(`input[data-row="${i}"][data-col="${j}"]`)
      if (currentVal.parentElement.classList[0] == "noselect") {
        currentVal.parentElement.style["background"] == "black"
      }
      else {
        currentVal.parentElement.style["background"] = "white"
      }
    }
  }

  // Highlight current word
  // Down
  for (let i = 0; i < numRows; i++) {
    var currentVal = document.querySelector(`input[data-row="${currentRow + i}"][data-col="${currentCol}"]`)
    if (!currentVal) break
    if (currentVal.parentElement.classList[0] == "noselect") break
    currentVal.parentElement.style["background"] = direction == "v" ? plusColor : perpColor;
  }
  // Up
  for (let i = 0; i < numRows; i++) {
    var currentVal = document.querySelector(`input[data-row="${currentRow - i}"][data-col="${currentCol}"]`)
    if (!currentVal) break
    if (currentVal.parentElement.classList[0] == "noselect") break
    currentVal.parentElement.style["background"] = direction == "v" ? plusColor : perpColor;
  }
  // Left
  for (let i = 0; i < numRows; i++) {
    var currentVal = document.querySelector(`input[data-row="${currentRow}"][data-col="${currentCol - i}"]`)
    if (!currentVal) break
    if (currentVal.parentElement.classList[0] == "noselect") break
    currentVal.parentElement.style["background"] = direction == "h" ? plusColor : perpColor;
  }
  // Right
  for (let i = 0; i < numRows; i++) {
    var currentVal = document.querySelector(`input[data-row="${currentRow}"][data-col="${currentCol + i}"]`)
    if (!currentVal) break
    if (currentVal.parentElement.classList[0] == "noselect") break
    currentVal.parentElement.style["background"] = direction == "h" ? plusColor : perpColor;
  }

  // highlight current letter
  var currentVal = document.querySelector(`input[data-row="${currentRow}"][data-col="${currentCol}"]`)
  if (checkCellFree(currentVal)) currentVal.parentElement.style["background"] = focusColor;

  var ul = document.querySelector(`ul[id="hints-vertical"]`)
  var listItems = ul.getElementsByTagName("li")
  for (var i = 0; i < listItems.length; i++) {
    listItems[i].style["background"] = "white"
    listItems[i].className = ""

  }
  var ul = document.querySelector(`ul[id="hints"]`)
  var listItems = ul.getElementsByTagName("li")
  for (var i = 0; i < listItems.length; i++) {
    listItems[i].style["background"] = "white"
    listItems[i].className = ""
    
  }

  // highlight hints
  var currentAcrossID = currentVal.getAttribute("acrossid")
  var currentAcrossHint = document.querySelector(`li[acrossid="${currentAcrossID}"]`)
  var currentDownID = currentVal.getAttribute("downid")
  var currentDownHint = document.querySelector(`li[downid="${currentDownID}"]`)
  // var acrossWindow = document.getElementById()

  
  if (direction == "h") {
    currentAcrossHint.style["background"] = plusColor;
    currentDownHint.className = "highlight"
  } else {
    currentDownHint.style["background"] = plusColor; 
    currentAcrossHint.className = "highlight"
  }

  // change main hint
  var main_hint_text = document.querySelector(`p[class=main-hint-text]`)
  main_hint_text.textContent = direction == "h" ? currentAcrossHint.textContent : currentDownHint.textContent;

  var arrow = document.getElementById("directionArrow")
  arrow.src = direction == "h" ? "right_arrow.png" : "down_arrow.png"

  currentAcrossHint.focus();
  currentDownHint.focus();

  document.getElementsByClassName("main-hint-highlight")[0].focus();
}

// Mobile focus management


function handleArrowKeys(event) {
  const currentInput = event.target;
  const currentRow = parseInt(currentInput.getAttribute('data-row'));
  const currentCol = parseInt(currentInput.getAttribute('data-col'));

  var nextRow = currentRow;
  var nextCol = currentCol;

  var currentVal = document.querySelector(`input[data-row="${currentRow}"][data-col="${currentCol}"]`)

  // Check for backspace
  const old_direction = direction;
  // Handle arrow key presses
  switch (event.key) {
    case 'ArrowUp':
      direction = "v"
      nextRow = Math.max(0, currentRow - 1);
      break;
    case 'ArrowDown':
      direction = "v"
      nextRow = Math.min(numRows - 1, currentRow + 1);
      break;
    case 'ArrowLeft':
      direction = "h"
      nextCol = Math.max(0, currentCol - 1);
      break;
    case 'ArrowRight':
      direction = "h"
      nextCol = Math.min(numCols - 1, currentCol + 1);
      break;
    case 'Backspace':
      if (!currentVal.value) {
        var nextRow = direction == "v" ? currentRow - 1 : currentRow;
        var nextCol = direction == "h" ? currentCol - 1 : currentCol;

        var currentVal = document.querySelector(`input[data-row="${nextRow}"][data-col="${nextCol}"]`)
        }
        currentVal.value = ""

      break;
      case 'Delete':
        currentVal.value = ""
  
        break;
    case " ":
      direction = direction == "h" ? "v" : "h";
      handleOnFocus(event);
      event.preventDefault();

      return;
    default:
      return; // Exit function for other key presses
  }
  // Focus on the next input field
  if (old_direction == direction) {
    const nextInput = document.querySelector(`input[data-row="${nextRow}"][data-col="${nextCol}"]`);
    if (!nextInput) return
    if (checkCellFree(nextInput)) {
      nextInput.focus()
      
    
    } else if (nextInput.parentElement.classList[0] == "noselect" && event.key != "Backspace"){
      const nextInput = document.querySelector(`input[data-row="${nextRow+(nextRow-currentRow)}"][data-col="${nextCol+(nextCol-currentCol)}"]`);
      if (checkCellFree(nextInput)) nextInput.focus()

    }
  } else {
    handleOnFocus(event)
  }
  event.preventDefault();
  validateMap();
  // currentVal.scrollIntoView();

}

function findWords(grid) {
  const words = [];

  // Helper function to check if a character is a word boundary
  function isWordBoundary(char) {
    return char === '#' || char === undefined;
  }

  // Iterate over each row
  for (let row = 0; row < grid.length; row++) {
    let word = '';
    // Iterate over each column in the row
    for (let col = 0; col < grid[row].length; col++) {
      const char = grid[row][col];
      // If the character is a word boundary or the start of a row, add the current word to the result
      if (isWordBoundary(char)) {
        if (word.length > 0) {
          words.push(word);
          word = '';
        }
      } else {
        // Append non-boundary characters to the current word
        word += char;
      }
    }
    // If there's a word left at the end of the row, add it to the result
    if (word.length > 0) {
      words.push(word);
    }
  }

  return words;
}

function findWordsVertical(grid) {
  let words = []; // Array to hold the found words

  // Assuming grid is a 2D array where grid[row][col] gives a character
  const rows = grid.length;
  const cols = grid[0].length; // Assuming all rows are of equal length

  // Iterate over each row
  for (let row = 0; row < rows; row++) {
    // Iterate over each column in the current row
    for (let col = 0; col < cols; col++) {
      let word = ''; // Accumulator for the current word being constructed
      if (row === 0 || grid[row - 1][col] === '#') {
        for (let scanRow = row; scanRow < rows; scanRow++) {
          const char = grid[scanRow][col];
          if (char === '#' || scanRow === rows - 1) {
            // If we hit a boundary or the last row, check if we have a word
            // If the char is not '#', add it to the word before ending the word
            if (char !== '#' && scanRow === rows - 1) {
              word += char;
            }
            // Check if the word length is greater than 1 to add
            if (word.length) {
              words.push(word);
            }
            break; // Stop scanning downwards for the current column
          } else {
            // Accumulate letters into the word
            word += char;
          }
        }
      }
    }
  }

  return words;
}

function validateMap() {
  var correctCount = 0;
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      var currentCell = document.querySelector(`input[data-row="${i}"][data-col="${j}"]`);
      // currentCell.value = globalMappedArr[i][j]
      if (currentCell.value != "#") {
        if (decodeHint(globalMappedArr[i][j]).toLowerCase() == currentCell.value.toLowerCase())  {
          correctCount += 1;
        } 

      }
    }
    document.getElementById("score").childNodes[0].textContent = correctCount
  }
}

function checkCellFree(nextInput) {
  return (nextInput && nextInput.parentElement.classList[0] != "noselect")
}

function handleInput(event) {
  const inputVal = event.data; // Get the input value
  const target = event.target; // Get the event target input element

  const currentRow = parseInt(target.getAttribute('data-row'));
  const currentCol = parseInt(target.getAttribute('data-col'));

  const currentVal = document.querySelector(`input[data-row="${currentRow}"][data-col="${currentCol}"]`)
  const originalVal = currentVal.value;

  var previousRow = direction == "v" ? currentRow - 1 : currentRow;
  var previousCol = direction == "h" ? currentCol - 1 : currentCol;
  previousCell = document.querySelector(`input[data-row="${previousRow}"][data-col="${previousCol}"]`)
  var newRow = direction == "v" ? currentRow + 1 : currentRow;
  var newCol = direction == "h" ? currentCol + 1 : currentCol;
  nextInput = document.querySelector(`input[data-row="${newRow}"][data-col="${newCol}"]`);
  
  var double_letter_map = {
    "h": "c",
    "ž": "d",
    "z": "d"
  };

  if (currentVal.value) {
    var current = currentVal.value.toLowerCase()
    if ((current == "ch" || current == "dz" || current == "dž") && !checkCellFree(nextInput) ) {
      validateMap();
      return
    }
  }
  if (previousCell) {
    var current = inputVal.toLowerCase();
    var previous = previousCell.value.toLowerCase()
    if (current && previous == double_letter_map[current]) {
      previousCell.value = previous+current;
      
      currentVal.value = originalVal.length == 1 ? "" : originalVal.slice(0, -1) ;
      event.preventDefault();
      validateMap();
      
      return
    }  else {
      currentVal.value = inputVal
    }
  }

  if (currentCol >= numCols) {
    return
  }
 
  if (checkCellFree(nextInput)) nextInput.focus();

  validateMap();
}

async function prepareMap() {
  let contents = '';
  globalMappedArr = await fetch('grid.txt')
   

  return globalMappedArr.text();
}

async function prepareGrid() {
  var out = await prepareMap();

  var lines = out.split(/\r\n/);
  if (lines.length <= 1) {
    lines = out.split(/\n/)
  }
  // Initialize a 2D array
  var mappedArr = [];

  // Iterate over each line
  for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var characters = line.split('');
      mappedArr.push(characters);
  }

  mappedArr.pop();

  globalMappedArr = mappedArr

  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      var currentCell = document.querySelector(`input[data-row="${i}"][data-col="${j}"]`);
      if (mappedArr && mappedArr[i] && mappedArr[i][j] == "#") {
        currentCell.value = "#";
        currentCell.classList.add("noselect");
        currentCell.parentElement.classList.add("noselect");
      }
    }
  }

  // Horizontal starting marks
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      var previousCell = document.querySelector(`input[data-row="${i}"][data-col="${j - 1}"]`);

      if (!previousCell || previousCell.classList[0] == "noselect") {

        var currentCell = document.querySelector(`input[data-row="${i}"][data-col="${j}"]`).parentElement;
        if (checkCellFree(currentCell.childNodes[0])) currentCell.setAttribute('is_starting', true);
      }
    }
  }
  // Vertical starting marks
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      var previousCell = document.querySelector(`input[data-row="${j - 1}"][data-col="${i}"]`);
      if (!previousCell || previousCell.classList[0] == "noselect") {
        var currentCell = document.querySelector(`input[data-row="${j}"][data-col="${i}"]`).parentElement;
        if (checkCellFree(currentCell.childNodes[0])) currentCell.setAttribute('is_starting', true);
      }
    }
  }

  // Add numbers

  counter = 1;
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      var currentCell = document.querySelector(`input[data-row="${i}"][data-col="${j}"]`).parentElement;
      if (currentCell.getAttribute("is_starting")) {
        const span = document.createElement('span');
        span.textContent = counter;

        for (let x = 0; x < numCols; x++) {
          var focusedCell = document.querySelector(`input[data-row="${i}"][data-col="${j + x}"]`)
          if (!checkCellFree(focusedCell)) break;
          if (focusedCell.hasAttribute("acrossId")) break;

          acrossIds.add(counter)
          focusedCell.setAttribute("acrossId", counter)
        }

        for (let y = 0; y < numCols; y++) {
          var focusedCell = document.querySelector(`input[data-row="${i + y}"][data-col="${j}"]`)
          if (!checkCellFree(focusedCell)) break;
          if (focusedCell.hasAttribute("downId")) break;
          downIds.add(counter)
          focusedCell.setAttribute("downId", counter)
        }
        currentCell.insertBefore(span, currentCell.firstChild);
        counter += 1;
      }
    }
  }
  console.log(downIds)
}

// Stopwatch JS
let timer;
let time = 0;

function startStopwatch() {
  if (!timer) {
    timer = setInterval(updateStopwatch, 1000);
  }
}

function stopStopwatch() {
  clearInterval(timer);
  timer = null;
}

function resetStopwatch() {
  stopStopwatch();
  time = 0;
  updateDisplay();
}

function updateStopwatch() {
  time++;
  updateDisplay();
}

function updateDisplay() {
  const minutes = Math.floor((time) / 60);
  const seconds = time % 60;
  document.getElementById("clock").textContent = minutes + ':' + formatTime(seconds);
}

function formatTime(time) {
  return time < 10 ? '0' + time : time;
}

function decodeHint(hint) {
  return hint.replace(/3/g, "ch").replace(/2/g, "dz").replace(/1/g, "dž")
}

function updateDate() {
  const days = ["Nedeľa", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"];
  const now = new Date();
  
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0'); // Add 1 because getMonth() returns 0-11
  const year = now.getFullYear()
  const week_day = now.getDay()
  const dayMonthStr = `${day}.${month}.${year}, ${days[week_day]}`;
  document.getElementById("date").textContent = dayMonthStr; // Output format: "DD/MM"
}

async function prepareHints() {
  const response = await fetch('out.json');
  const hints = await response.json();

  const hint_arr = findWords(globalMappedArr)
  const hintsList = document.getElementById('hints');
  counter = 0;
  hint_arr.forEach(hint => {
    const listItem = document.createElement('li');
    listItem.textContent = Array.from(acrossIds)[counter] + '. ' + hints[decodeHint(hint)];
    listItem.setAttribute("acrossId", Array.from(acrossIds)[counter]);
    counter += 1;
    hintsList.appendChild(listItem);
  });

  const hint_arr_vertical = findWordsVertical(globalMappedArr);
  const hintsListVertical = document.getElementById('hints-vertical');
  counter = 0;

  hint_arr_vertical.forEach(hint => {
    const listItem = document.createElement('li');
    listItem.textContent = Array.from(downIds)[counter] + '. ' + hints[decodeHint(hint)];
    listItem.setAttribute("downId", Array.from(downIds)[counter]);
    counter += 1;
    hintsListVertical.appendChild(listItem);
  });

  var hintlist = document.getElementById("hints");
  var firstHint = Array.from(hintlist.children)[0].textContent
  document.getElementsByClassName("main-hint-text")[0].textContent = firstHint
  // document.querySelector(`input[data-row="0"][data-col="0"]`).focus();

  // window.scrollTo({ top: 0});


  
}


// -- //
window.addEventListener('DOMContentLoaded', () => {
  prepareGrid();
  createGrid();
  updateDate();
  prepareHints();
  startStopwatch();
  

  
  
  // for (let i = 0; i < numRows; i++) {
  //   for (let j = 0; j < numCols; j++) {
  //     var currentCell = document.querySelector(`input[data-row="${i}"][data-col="${j}"]`);
  //     currentCell.value = globalMappedArr[i][j]
  //   }
  // }
});


