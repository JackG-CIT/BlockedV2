function showLevels() {
    const levelSelect = document.getElementById("levelSelect");
    levelSelect.style.setProperty("display", "flex", "important");
    levelSelect.style.setProperty("position", "fixed", "important");
    levelSelect.style.setProperty("top", "0", "important");
    levelSelect.style.setProperty("left", "0", "important");
    levelSelect.style.setProperty("width", "100%", "important");
    levelSelect.style.setProperty("height", "100%", "important");
    levelSelect.style.setProperty("background-color", "rgba(255,255,255,0.95)", "important");
    levelSelect.style.setProperty("flex-direction", "column", "important");
    levelSelect.style.setProperty("overflow-y", "auto", "important");
    levelSelect.style.setProperty("z-index", "1000", "important");
}


function clearPage(){
    document.getElementById("levelSelect").style.setProperty("display", "none", "important");
}