// To-Do List Logic
const taskList = document.getElementById("task-list");
const newTaskInput = document.getElementById("new-task");
const addTaskButton = document.getElementById("add-task");
let tasks = [];

// Add Task
addTaskButton.addEventListener("click", () => {
  const task = newTaskInput.value.trim();
  if (task) {
    tasks.push(task);
    renderTasks();
    newTaskInput.value = "";
  }
});

// Render Task List
function renderTasks() {
  taskList.innerHTML = tasks
    .map(
      (task, index) =>
        `<li>${task} <button onclick="removeTask(${index})">Delete</button></li>`
    )
    .join("");
}

// Remove Task
window.removeTask = function (index) {
  tasks.splice(index, 1);
  renderTasks();
};

// On Top Mode Logic
const onTopModeRadios = document.querySelectorAll("input[name='on-top-mode']");

onTopModeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = radio.value;
    chrome.runtime.sendMessage({ action: "updateMode", mode });
  });
});
