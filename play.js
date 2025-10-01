document.addEventListener("DOMContentLoaded", function () {
    let playerCell = document.querySelector(".player");
    let playerx = Array.from(playerCell.parentElement.children).indexOf(playerCell);
    let playery = Array.from(playerCell.parentElement.parentElement.children).indexOf(playerCell.parentElement);

    const rows = document.querySelectorAll("#gameBoard tr").length;
    const cols = document.querySelectorAll("#gameBoard tr:first-child td").length;

    // ========== Move counter + timer ==========
    let moveCount = 0;
    let startTime = null;
    let timerInterval = null;

    const moveDisplay = document.getElementById("moveCount");
    const timeDisplay = document.getElementById("timeElapsed");

    function updateHUD() {
        if (moveDisplay) moveDisplay.textContent = `Current moves: ${moveCount}`;
        if (timeDisplay) {
            if (startTime) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                timeDisplay.textContent = `Current time: ${elapsed}s`;
            } else {
                timeDisplay.textContent = "Current time: 0s";
            }
        }
    }

    function startTimer() {
        if (!startTime) {
            startTime = Date.now();
            timerInterval = setInterval(updateHUD, 1000);
        }
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        updateHUD();
    }

    // ========== Save initial board state ==========
    const initialBoardHTML = document.getElementById("gameBoard").innerHTML;

    function resetLevel() {
        // Reset board HTML
        document.getElementById("gameBoard").innerHTML = initialBoardHTML;

        // Reset player reference
        playerCell = document.querySelector(".player");
        playerx = Array.from(playerCell.parentElement.children).indexOf(playerCell);
        playery = Array.from(playerCell.parentElement.parentElement.children).indexOf(playerCell.parentElement);

        // Reset move count and timer
        moveCount = 0;
        startTime = null;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        updateHUD();

        // Reinitialize cells
        document.querySelectorAll("#gameBoard td").forEach(cell => {
            updateCell(cell);
            addHoverHighlight(cell);
        });

        checkPressurePlates();
        checkFuses();
    }

    // ========== Utility functions ==========
    function getCell(x, y) {
        if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
        return document.querySelector(`.y${y} .x${x}`);
    }

    function updateCell(cell) {
        cell.innerHTML = "";
        cell.style.fontWeight = "bold";
        cell.style.textAlign = "center";

        if (cell.classList.contains("player")) {
            cell.style.backgroundColor = "red";
            cell.innerHTML = "P";
        } else if (cell.classList.contains("box")) {
            cell.style.backgroundColor = "brown";
            cell.innerHTML = "B";
        } else if (cell.classList.contains("wall") || cell.classList.contains("nopass")) {
            cell.style.backgroundColor = "rgb(110,110,110)";
            cell.innerHTML = "W";
        } else if (cell.classList.contains("pressureplate")) {
            cell.style.backgroundColor = "tan";
            cell.innerHTML = "PP";
        } else if (cell.classList.contains("fuse")) {
            cell.style.backgroundColor = "bisque";
            cell.innerHTML = "F";
        } else if (cell.classList.contains("cannon")) {
            cell.style.backgroundColor = "black";
            cell.style.color = "white";
            const dir = cell.dataset.direction;
            if (dir) {
                const mapping = { up: "U", down: "D", left: "L", right: "R" };
                cell.innerHTML = mapping[dir] || "C";
            } else {
                cell.innerHTML = "C";
            }
        } else if (cell.classList.contains("exit")) {
            cell.style.backgroundColor = "white";
            cell.style.color = "black";
            cell.innerHTML = "E";
        } else {
            cell.style.backgroundColor = "transparent";
        }
    }

    function checkPressurePlates() {
        document.querySelectorAll(".pressureplate").forEach(pp => {
            const targetX = pp.dataset.targetX ? parseInt(pp.dataset.targetX) : null;
            const targetY = pp.dataset.targetY ? parseInt(pp.dataset.targetY) : null;
            const targetCell = targetX !== null && targetY !== null ? getCell(targetX, targetY) : null;

            const pressed = pp.classList.contains("player") || pp.classList.contains("box");
            pp.style.opacity = pressed ? "0.6" : "1";
            if (targetCell && !targetCell.classList.contains("cannon")) {
                if (pressed) {
                    targetCell.classList.remove("nopass");
                    targetCell.classList.remove("wall");
                } else {
                    targetCell.classList.add("nopass");
                    targetCell.classList.add("wall");
                }
                updateCell(targetCell);
            }
        });
    }

    async function checkFuses() {
        const fuseCells = Array.from(document.querySelectorAll(".fuse"));
        for (const fuse of fuseCells) {
            const activated = fuse.classList.contains("player") || fuse.classList.contains("box");
            fuse.style.opacity = activated ? "0.6" : "1";
            if (!activated) continue;

            const targetX = parseInt(fuse.dataset.targetX);
            const targetY = parseInt(fuse.dataset.targetY);
            const cannon = getCell(targetX, targetY);
            if (!cannon || !cannon.classList.contains("cannon")) continue;

            const direction = cannon.dataset.direction;
            if (!direction) continue;

            let dx = 0, dy = 0;
            if (direction === "up") dy = -1;
            if (direction === "down") dy = 1;
            if (direction === "left") dx = -1;
            if (direction === "right") dx = 1;

            let x = targetX + dx;
            let y = targetY + dy;
            let movingBoxCell = getCell(x, y);

            if (!movingBoxCell || !movingBoxCell.classList.contains("box")) continue;

            while (movingBoxCell) {
                const nextCell = getCell(x + dx, y + dy);

                if (!nextCell || nextCell.classList.contains("box") || nextCell.classList.contains("nopass") || nextCell.classList.contains("wall")) {
                    if (nextCell && nextCell.classList.contains("wall")) {
                        nextCell.classList.remove("wall");
                        nextCell.classList.remove("nopass");
                        updateCell(nextCell);
                    }
                    movingBoxCell.classList.remove("box");
                    updateCell(movingBoxCell);
                    if (nextCell && nextCell.classList.contains("box")) {
                        nextCell.classList.remove("box");
                        updateCell(nextCell);
                    }
                    break;
                }

                movingBoxCell.classList.remove("box");
                updateCell(movingBoxCell);

                x += dx;
                y += dy;
                movingBoxCell = getCell(x, y);

                movingBoxCell.classList.add("box");
                updateCell(movingBoxCell);

                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }

    function move(dx, dy) {
        const nextCell = getCell(playerx + dx, playery + dy);
        if (!nextCell) return;

        if (nextCell.classList.contains("wall") || nextCell.classList.contains("nopass") || nextCell.classList.contains("cannon")) return;

        const nextNextCell = getCell(playerx + 2 * dx, playery + 2 * dy);

        if (nextCell.classList.contains("box")) {
            if (!nextNextCell || nextNextCell.classList.contains("wall") || nextNextCell.classList.contains("nopass") || nextNextCell.classList.contains("box") || nextNextCell.classList.contains("cannon")) return;

            nextCell.classList.remove("box");
            updateCell(nextCell);

            nextNextCell.classList.add("box");
            updateCell(nextNextCell);
        }

        if (!startTime) startTimer();
        moveCount++;
        updateHUD();

        playerCell.classList.remove("player");
        updateCell(playerCell);

        playerx += dx;
        playery += dy;

        playerCell = getCell(playerx, playery);
        playerCell.classList.add("player");
        updateCell(playerCell);

        checkPressurePlates();
        checkFuses();

        if (playerCell.classList.contains("exit")) {
            stopTimer();
            showWinMessage();
        }
    }

    function showWinMessage() {
        const overlay = document.createElement("div");
        overlay.id = "winOverlay";
        overlay.textContent = "🎉 You Win! 🎉";
        overlay.style.position = "fixed";
        overlay.style.top = "50%";
        overlay.style.left = "50%";
        overlay.style.transform = "translate(-50%, -50%)";
        overlay.style.padding = "2rem";
        overlay.style.fontSize = "2rem";
        overlay.style.background = "rgba(0, 0, 0, 0.8)";
        overlay.style.color = "white";
        overlay.style.borderRadius = "12px";
        overlay.style.zIndex = "9999";
        document.body.appendChild(overlay);
    }

    // ============================ Controls ============================
    document.addEventListener("keydown", event => {
        switch(event.key) {
            case "ArrowRight":
            case "d": move(1, 0); break;
            case "ArrowLeft":
            case "a": move(-1, 0); break;
            case "ArrowUp":
            case "w": move(0, -1); break;
            case "ArrowDown":
            case "s": move(0, 1); break;
            case "r": resetLevel(); break; // RESET LEVEL
        }
    });

    function addHoverHighlight(cell) {
        if (cell.classList.contains("pressureplate") || cell.classList.contains("fuse")) {
            cell.addEventListener("mouseenter", () => {
                const targetX = parseInt(cell.dataset.targetX);
                const targetY = parseInt(cell.dataset.targetY);
                const targetCell = getCell(targetX, targetY);
                if (targetCell) targetCell.classList.add("highlight");
            });
            cell.addEventListener("mouseleave", () => {
                const targetX = parseInt(cell.dataset.targetX);
                const targetY = parseInt(cell.dataset.targetY);
                const targetCell = getCell(targetX, targetY);
                if (targetCell) targetCell.classList.remove("highlight");
            });
        }
    }

    // ============================ Initialize ============================
    document.querySelectorAll("#gameBoard td").forEach(cell => {
        updateCell(cell);
        addHoverHighlight(cell);
    });
    checkPressurePlates();
    checkFuses();
    updateHUD();
});
