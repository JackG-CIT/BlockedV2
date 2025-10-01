document.addEventListener("DOMContentLoaded", function() {
    const boardTable = document.getElementById("createTable");
    const levelWidthInput = document.getElementById("levelWidth");
    const levelHeightInput = document.getElementById("levelHeight");
    const tileTypeRadios = document.querySelectorAll('input[name="tileType"]');
    let selectedTile = null;

    let board = [];
    
    const tileTypes = ["Empty", "Player", "Wall", "Box", "PressurePlate", "Cannon", "Fuse", "Exit"];

    tileTypeRadios.forEach(radio => {
        radio.addEventListener('change', e => selectedTile = e.target.value);
    });

    const CELL_SIZE = 40; // fixed size for all cells

    function createBoard(width, height, preserve = true) {
        const oldBoard = preserve ? JSON.parse(JSON.stringify(board)) : null;
        board = [];
        boardTable.innerHTML = "";

        for (let y = 0; y < height; y++) {
            const tr = document.createElement("tr");
            const row = [];
            for (let x = 0; x < width; x++) {
                const td = document.createElement("td");
                td.dataset.x = x;
                td.dataset.y = y;
                td.style.width = `${CELL_SIZE}px`;
                td.style.height = `${CELL_SIZE}px`;
                td.style.padding = "0";
                td.style.border = "2px solid black";
                tr.appendChild(td);

                let oldCell = oldBoard && oldBoard[y] ? oldBoard[y][x] : null;
                row.push(oldCell || { type: null, direction: null, aX: null, aY: null, fixed: false });

                td.addEventListener("click", () => placeTile(x, y));
            }
            boardTable.appendChild(tr);
            board.push(row);
        }

        updateTableColors();
        updateTileDropdowns();
    }

    function placeTile(x, y) {
        if (!selectedTile) return;

        const cell = board[y][x];

        if (selectedTile.toLowerCase() === "player") {
            for (let r = 0; r < board.length; r++)
                for (let c = 0; c < board[r].length; c++)
                    if (board[r][c].type?.toLowerCase() === "player")
                        board[r][c] = { type: null, direction: null, aX: null, aY: null, fixed: false };
        }

        if (selectedTile.toLowerCase() === "empty") {
            board[y][x] = { type: null, direction: null, aX: null, aY: null, fixed: false };
        } else {
            const newCell = { type: selectedTile, direction: null, aX: null, aY: null, fixed: false };
            if (selectedTile.toLowerCase() === "cannon") newCell.direction = "up";
            board[y][x] = newCell;
        }

        updateTableColors();
        updateTileDropdowns();
    }

    function updateTableColors() {
        for (let y = 0; y < board.length; y++) {
            const row = boardTable.rows[y];
            for (let x = 0; x < board[y].length; x++) {
                const td = row.cells[x];
                const cell = board[y][x];
                td.style.backgroundColor = getTileColor(cell.type);
                td.textContent = "";

                if (!cell.type) continue;

                switch(cell.type.toLowerCase()) {
                    case "cannon":
                        td.textContent = cell.direction ? cell.direction[0].toUpperCase() : "C";
                        break;
                    case "exit":
                        td.textContent = "E";
                        break;
                    case "pressureplate":
                        td.textContent = "PP";
                        break;
                    case "fuse":
                        td.textContent = "F";
                        break;
                    case "wall":
                        td.textContent = "W";
                        break;
                    case "box":
                        td.textContent = "B";
                        break;
                    case "player":
                        td.textContent = "P";
                        break;
                    case "exit":
                        td.textContent = "E";
                        td.style.backgroundColor = "white";
                        break;

                }
            }
        }
    }

    function getTileColor(type) {
        if (!type) return "white";
        switch(type.toLowerCase()) {
            case "wall": return "grey";
            case "box": return "brown";
            case "player": return "red";
            case "pressureplate": return "orange";
            case "cannon": return "blue";
            case "fuse": return "purple";
            case "exit": return "white";
            default: return "lightgrey";
        }
    }

    function updateTileDropdowns() {
        tileTypes.forEach(type => {
            if (type.toLowerCase() === "empty") return;
            const listDiv = document.getElementById(`list_${type}`);
            if (!listDiv) return;
            const addBtn = listDiv.querySelector(".addTile");
            listDiv.querySelectorAll(".tileItem").forEach(el => el.remove());

            board.forEach((row, y) => row.forEach((cell, x) => {
                if (cell.type === type) {
                    const div = document.createElement("div");
                    div.className = "tileItem";
                    let content = `x:${x} y:${y}`;

                    if (type.toLowerCase() === "cannon") {
                        const select = document.createElement("select");
                        ["up", "down", "left", "right"].forEach(d => {
                            const opt = document.createElement("option");
                            opt.value = d;
                            opt.textContent = d;
                            if (cell.direction === d) opt.selected = true;
                            select.appendChild(opt);
                        });
                        select.addEventListener("change", e => {
                            board[y][x].direction = e.target.value;
                            updateTableColors();
                        });
                        div.textContent = content + " ";
                        div.appendChild(select);
                    } else if (type.toLowerCase() === "pressureplate" || type.toLowerCase() === "fuse") {
                        const inputX = document.createElement("input");
                        inputX.type = "number";
                        inputX.value = cell.aX ?? "";
                        inputX.style.width = "40px";
                        inputX.addEventListener("input", e => cell.aX = parseInt(e.target.value) || null);

                        const inputY = document.createElement("input");
                        inputY.type = "number";
                        inputY.value = cell.aY ?? "";
                        inputY.style.width = "40px";
                        inputY.addEventListener("input", e => cell.aY = parseInt(e.target.value) || null);

                        div.textContent = content + " effect: ";
                        div.appendChild(inputX);
                        div.appendChild(inputY);
                    } else {
                        div.textContent = content;
                    }

                    listDiv.insertBefore(div, addBtn);
                }
            }));
        });
    }

    // Adjust columns independently
    levelWidthInput.addEventListener("input", () => {
        const newWidth = parseInt(levelWidthInput.value);
        const oldWidth = board[0].length;
        if (newWidth > oldWidth) {
            board.forEach(row => {
                for (let i = oldWidth; i < newWidth; i++) {
                    row.push({ type: null, direction: null, aX: null, aY: null, fixed: false });
                }
            });
        } else if (newWidth < oldWidth) {
            board.forEach(row => row.splice(newWidth));
        }
        createBoard(newWidth, board.length);
    });

    // Adjust rows independently
    levelHeightInput.addEventListener("input", () => {
        const newHeight = parseInt(levelHeightInput.value);
        const oldHeight = board.length;
        const width = board[0].length;
        if (newHeight > oldHeight) {
            for (let i = oldHeight; i < newHeight; i++) {
                const newRow = [];
                for (let x = 0; x < width; x++) newRow.push({ type: null, direction: null, aX: null, aY: null, fixed: false });
                board.push(newRow);
            }
        } else if (newHeight < oldHeight) {
            board.splice(newHeight);
        }
        createBoard(board[0].length, newHeight);
    });

    const levelForm = document.getElementById("levelForm");
    levelForm.addEventListener("submit", e => {
        document.getElementById("data").value = JSON.stringify(board);
    });

    createBoard(parseInt(levelWidthInput.value), parseInt(levelHeightInput.value));
});
