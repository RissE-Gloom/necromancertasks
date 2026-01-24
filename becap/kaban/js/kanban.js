// Core Kanban Board Application
class KanbanBoard {
  constructor() {
    this.tasks = this.loadTasks()
    this.columns = this.loadColumns()
    this.currentEditingColumn = null
    this.lucide = window.lucide // Declare the lucide variable
    this.draggedTask = null
    this.draggedElement = null
    this.ws = null;
    this.setupWebSocket();
    this.retryCount = 0;
    this.maxRetries = 5;

    this.init()
  }

setupWebSocket() {
    try {
        this.ws = new WebSocket('ws://localhost:8080');
        
        this.ws.onopen = () => {
            console.log('✅ Connected to bot server');
            this.retryCount = 0;
            
            // Отправить ping для проверки соединения
            this.ws.send(JSON.stringify({ type: 'PING' }));
        };

        this.ws.onmessage = (event) => {
            this.handleBotMessage(event.data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('❌ Disconnected from bot server');
            this.attemptReconnect();
        };

    } catch (error) {
        console.error('WebSocket setup error:', error);
    }
}

attemptReconnect() {
    if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`🔁 Attempting reconnect (${this.retryCount}/${this.maxRetries})...`);
        setTimeout(() => this.setupWebSocket(), 3000);
    } else {
        console.log('❌ Max reconnection attempts reached');
    }
}

handleBotMessage(data) {
    try {
        const message = JSON.parse(data);
        console.log('📨 Received from bot:', message.type);
        
        switch (message.type) {
            case 'REQUEST_STATUS':
                this.sendStatus(message.chatId);
                break;
                
            case 'REQUEST_COLUMN_STATUS':
                this.sendColumnStatus(message.chatId, message.columnStatus);
                break;
                
            case 'CONNECTION_ESTABLISHED':
                console.log('✅ Connection confirmed by bot server');
                break;
        }
    } catch (error) {
        console.error('Message handling error:', error);
    }
}

sendColumnStatus(chatId, columnStatus) {
    try {
        const column = this.columns.find(col => col.status === columnStatus);
        if (!column) return;

        const tasks = this.getTasksByStatus(columnStatus);
        const columnData = {
            id: column.id,
            title: column.title,
            status: column.status,
            taskCount: tasks.length,
            tasks: tasks.map(task => ({
                id: task.id,
                title: task.title,
                priority: task.priority,
                label: task.label || '',
                description: task.description || ''
            }))
        };

        const response = {
            type: 'COLUMN_STATUS_RESPONSE',
            chatId: chatId,
            column: columnData,
            timestamp: new Date().toISOString()
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(response));
            console.log('📤 Column status sent:', columnStatus);
        }
    } catch (error) {
        console.error('Error sending column status:', error);
    }
}

sendStatus(chatId = null) {
    try {
        const status = {
            type: 'STATUS_RESPONSE',
            chatId: chatId,
            columns: this.columns.map(column => {
                const tasks = this.getTasksByStatus(column.status);
                return {
                    id: column.id,
                    title: column.title,
                    status: column.status,
                    taskCount: tasks.length
                };
            }),
            timestamp: new Date().toISOString()
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(status));
            console.log('📤 Status sent to bot');
        }
    } catch (error) {
        console.error('Error sending status:', error);
    }
}

trackTaskMovement(taskId, fromStatus, toStatus) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    const activity = {
        type: 'TASK_MOVED',
        taskId,
        fromStatus,
        toStatus,
        timestamp: new Date().toISOString(),
        task: {
            id: task.id,
            title: task.title,
            priority: task.priority,
            label: task.label || ''
        }
    };
    
    console.log('🔄 Tracking task movement:', activity);
    this.sendToBot(activity);
}

sendToBot(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
        console.log('📤 Sent to bot:', message.type);
    }
}

  init() {
    this.setupEventListeners()
    this.setupDragAndDrop()

    // 👇 Проверяем и удаляем старые задачи при запуске
    this.checkAndRemoveOldTasks()

    this.render()
    this.lucide.createIcons()

    // 👇 Проверяем каждые 5 минут (300000 мс)
    setInterval(() => {
        this.checkAndRemoveOldTasks()
    }, 300000)
}

  // Data Management
  loadTasks() {
    const saved = localStorage.getItem("kanban-tasks")
    return saved ? JSON.parse(saved) : []
  }

  saveTasks() {
    localStorage.setItem("kanban-tasks", JSON.stringify(this.tasks))
  }

  loadColumns() {
    const saved = localStorage.getItem("kanban-columns")
    return saved
      ? JSON.parse(saved)
      : [
          { id: "todo", title: "To Do", status: "todo" },
          { id: "in-progress", title: "In Progress", status: "in-progress" },
          { id: "done", title: "Done", status: "done" },
        ]
  }

  saveColumns() {
    localStorage.setItem("kanban-columns", JSON.stringify(this.columns))
  }

  // Task Management
addTask(taskData) {
    const task = {
        id: this.generateId(),
        title: taskData.title,
        description: taskData.description,
        status: taskData.status,
        priority: taskData.priority,
        label: taskData.label || '',
        createdAt: new Date().toISOString(),
    };

    this.tasks.push(task);
    this.saveTasks();
    
    // Отправляем уведомление о создании
    this.sendToBot({
        type: 'TASK_CREATED',
        taskId: task.id,
        status: task.status,
        timestamp: task.createdAt,
        task: {
            id: task.id,
            title: task.title,
            label: task.label || ''
        }
    });
    
    this.render();
}

  deleteTask(taskId) {
    this.tasks = this.tasks.filter((t) => t.id !== taskId)
    this.saveTasks()
    this.render()
  }

  getTasksByStatus(status) {
    return this.tasks.filter((task) => task.status === status)
  }

  // Column Management
  addColumn(title) {
    const status = title.toLowerCase().replace(/\s+/g, "-")
    const column = {
      id: status,
      title: title,
      status: status,
    }

    this.columns.push(column)
    this.saveColumns()
    this.render()
  }

  updateColumnTitle(status, newTitle) {
    const column = this.columns.find((c) => c.status === status)
    if (column) {
      column.title = newTitle
      this.saveColumns()
      this.render()
    }
  }

  deleteColumn(status) {
    if (this.columns.length <= 1) return

    // Move tasks from deleted column to first available column
    const tasksInColumn = this.getTasksByStatus(status)
    if (tasksInColumn.length > 0) {
      const remainingColumns = this.columns.filter((c) => c.status !== status)
      const targetStatus = remainingColumns[0].status

      tasksInColumn.forEach((task) => {
        task.status = targetStatus
      })
      this.saveTasks()
    }

    this.columns = this.columns.filter((c) => c.status !== status)
    this.saveColumns()
    this.render()
  }

  // Utility Methods
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  // Event Listeners
  setupEventListeners() {
    // Add Task Modal
    document.getElementById("add-task-btn").addEventListener("click", () => {
      this.openAddTaskModal()
    })

    document.getElementById("close-task-modal").addEventListener("click", () => {
      this.closeModal("add-task-modal")
    })

    document.getElementById("cancel-task").addEventListener("click", () => {
      this.closeModal("add-task-modal")
    })

    document.getElementById("add-task-form").addEventListener("submit", (e) => {
      e.preventDefault()
      this.handleAddTask(e)
    })

    // Edit Task Modal
document.getElementById("close-edit-task-modal").addEventListener("click", () => {
    this.closeModal("edit-task-modal")
})

document.getElementById("cancel-edit-task").addEventListener("click", () => {
    this.closeModal("edit-task-modal")
})

document.getElementById("edit-task-form").addEventListener("submit", (e) => {
    e.preventDefault()
    this.handleEditTask(e)
})

    // Add Column Modal
    document.getElementById("add-column-btn").addEventListener("click", () => {
      this.openAddColumnModal()
    })

    document.getElementById("close-column-modal").addEventListener("click", () => {
      this.closeModal("add-column-modal")
    })

    document.getElementById("cancel-column").addEventListener("click", () => {
      this.closeModal("add-column-modal")
    })

    document.getElementById("add-column-form").addEventListener("submit", (e) => {
      e.preventDefault()
      this.handleAddColumn(e)
    })

    // Edit Column Modal
    document.getElementById("close-edit-column-modal").addEventListener("click", () => {
      this.closeModal("edit-column-modal")
    })

    document.getElementById("cancel-edit-column").addEventListener("click", () => {
      this.closeModal("edit-column-modal")
    })

    document.getElementById("edit-column-form").addEventListener("submit", (e) => {
      e.preventDefault()
      this.handleEditColumn(e)
    })

    document.addEventListener("click", (e) => {
      // Handle dropdown toggles
      if (e.target.closest(".dropdown-toggle")) {
        e.preventDefault()
        const dropdown = e.target.closest(".dropdown")
        const isOpen = dropdown.classList.contains("open")

        // Close all dropdowns
        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"))

        // Toggle current dropdown
        if (!isOpen) {
          dropdown.classList.add("open")
        }
      } else if (!e.target.closest(".dropdown")) {
        // Close all dropdowns when clicking outside
        document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"))
      }

      // Close modals when clicking outside
      if (e.target.classList.contains("modal")) {
        this.closeModal(e.target.id)
      }
    })
  }

  // Modal Management
  openAddTaskModal() {
    this.populateStatusOptions()
    this.openModal("add-task-modal")
  }

  openAddColumnModal() {
    this.openModal("add-column-modal")
  }

  openEditColumnModal(status, currentTitle) {
    this.currentEditingColumn = status
    document.getElementById("edit-column-title").value = currentTitle
    this.openModal("edit-column-modal")
  }

  openModal(modalId) {
    document.getElementById(modalId).classList.add("active")
    document.body.classList.add("modal-open")
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove("active")
    document.body.classList.remove("modal-open")

    // Reset forms
    const form = document.querySelector(`#${modalId} form`)
    if (form) form.reset()

    this.currentEditingColumn = null
  }

  populateStatusOptions() {
    const select = document.getElementById("task-status")
    select.innerHTML = ""

    this.columns.forEach((column) => {
      const option = document.createElement("option")
      option.value = column.status
      option.textContent = column.title
      select.appendChild(option)
    })
  }

  // Form Handlers
  handleAddTask(e) {
    const formData = new FormData(e.target)
    const taskData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status"),
        label: formData.get("label") || "", // 👈 Добавляем метку (если пусто — пустая строка)
    }

    this.addTask(taskData)
    this.closeModal("add-task-modal")
}

openEditTaskModal(taskId) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    document.getElementById("edit-task-id").value = task.id
    document.getElementById("edit-task-title").value = task.title
    document.getElementById("edit-task-description").value = task.description || ""
    document.getElementById("edit-task-priority").value = task.priority
    document.getElementById("edit-task-status").value = task.status

    this.populateEditStatusOptions()
    this.openModal("edit-task-modal")
}

populateEditStatusOptions() {
    const select = document.getElementById("edit-task-status")
    select.innerHTML = ""

    this.columns.forEach((column) => {
        const option = document.createElement("option")
        option.value = column.status
        option.textContent = column.title
        select.appendChild(option)
    })
}

handleEditTask(e) {
    const formData = new FormData(e.target)
    const taskId = formData.get("id")
    const updatedData = {
        title: formData.get("title"),
        description: formData.get("description"),
        priority: formData.get("priority"),
        status: formData.get("status")
    }

    const taskIndex = this.tasks.findIndex(t => t.id === taskId)
    if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updatedData }
        this.saveTasks()
        this.render()
        this.closeModal("edit-task-modal")
    }
}

  handleAddColumn(e) {
    const formData = new FormData(e.target)
    const title = formData.get("title")

    if (title.trim()) {
      this.addColumn(title.trim())
      this.closeModal("add-column-modal")
    }
  }

  handleEditColumn(e) {
    const formData = new FormData(e.target)
    const newTitle = formData.get("title")

    if (newTitle.trim() && this.currentEditingColumn) {
      this.updateColumnTitle(this.currentEditingColumn, newTitle.trim())
      this.closeModal("edit-column-modal")
    }
  }

  // Rendering
  render() {
    this.renderColumns()
    this.lucide.createIcons() // Use the declared lucide variable
  }

  renderColumns() {
    const wrapper = document.getElementById("columns-wrapper")
    wrapper.innerHTML = ""

    this.columns.forEach((column) => {
      const columnElement = this.createColumnElement(column)
      wrapper.appendChild(columnElement)
    })
  }

  createColumnElement(column) {
    const tasks = this.getTasksByStatus(column.status)

    const columnDiv = document.createElement("div")
    columnDiv.className = "kanban-column"
    columnDiv.dataset.status = column.status

    columnDiv.innerHTML = `
            <div class="column-header">
                <div class="column-title-wrapper">
                    <h3 class="column-title">${column.title}</h3>
                    <span class="task-count">${tasks.length}</span>
                </div>
                <div class="column-actions">
                    <button class="btn-icon" onclick="kanban.openEditColumnModal('${column.status}', '${column.title}')" title="Edit column">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button class="btn-icon" onclick="kanban.deleteColumn('${column.status}')" title="Delete column">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
            <div class="column-content" data-status="${column.status}">
                ${tasks.map((task) => this.createTaskElement(task)).join("")}
            </div>
        `

    return columnDiv
  }

  createTaskElement(task) {
    const priorityClass = `priority-${task.priority}`

    return `
            <div class="task-card ${priorityClass}" data-task-id="${task.id}" draggable="true">
                <div class="task-header">
                    <h4 class="task-title">${task.title}</h4>
                    <div class="task-actions">
                        <div class="dropdown">
                            <button class="btn-icon dropdown-toggle" title="Task options">
                                <i data-lucide="more-horizontal"></i>
                            </button>
                            <div class="dropdown-menu">
                                ${this.columns
                                  .map((col) =>
                                    col.status !== task.status
                                      ? `<button class="dropdown-item" onclick="kanban.updateTaskStatus('${task.id}', '${col.status}')">
                                             <i data-lucide="arrow-right"></i>
                                             Перекинуть ${col.title}
                                           </button>`
                                      : "",
                                  )
                                  .join("")}
                                  <button class="dropdown-item" onclick="kanban.openEditTaskModal('${task.id}')">
                                     <i data-lucide="edit"></i>
                                     Редактировать
                                  </button>
                                <button class="dropdown-item delete" onclick="kanban.deleteTask('${task.id}')">
                                    <i data-lucide="trash-2"></i>
                                    Удалить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                ${task.description ? `<p class="task-description">${task.description}</p>` : ""}
                <div class="task-footer">
                    <span class="task-priority priority-${task.priority}">${task.priority}</span>
                    ${task.label ? `<span class="task-label">${task.label}</span>` : ''} 
                </div>
            </div>
        `
}

  setupDragAndDrop() {
    // Привязываем контекст ко всем обработчикам
    document.addEventListener("dragstart", (e) => {
        if (e.target.classList.contains("task-card")) {
            this.handleDragStart(e)
        }
    })

    document.addEventListener("dragover", (e) => {
        e.preventDefault()
        this.handleDragOver(e)
    })

    document.addEventListener("dragenter", (e) => {
        e.preventDefault()
        this.handleDragEnter(e)
    })

    document.addEventListener("dragleave", (e) => {
        this.handleDragLeave(e)
    })

    document.addEventListener("drop", (e) => {
        e.preventDefault()
        this.handleDrop(e) // Используем метод класса вместо анонимной функции
    })

    document.addEventListener("dragend", (e) => {
        this.handleDragEnd(e) // Используем метод класса вместо анонимной функции
    })
}

  handleDragStart(e) {
    this.draggedTask = e.target.dataset.taskId
    this.draggedElement = e.target
    e.target.classList.add("dragging")

    // Set drag effect
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/html", e.target.outerHTML)
  }

  handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"

    const columnContent = e.target.closest(".column-content")
    if (columnContent && this.draggedTask) {
      const afterElement = this.getDragAfterElement(columnContent, e.clientY)
      const draggingElement = document.querySelector(".dragging")

      if (afterElement == null) {
        columnContent.appendChild(draggingElement)
      } else {
        columnContent.insertBefore(draggingElement, afterElement)
      }
    }
  }

  handleDragEnter(e) {
    const columnContent = e.target.closest(".column-content")
    if (columnContent) {
      columnContent.classList.add("drag-over")
    }
  }

  handleDragLeave(e) {
    const columnContent = e.target.closest(".column-content")
    if (columnContent && !columnContent.contains(e.relatedTarget)) {
      columnContent.classList.remove("drag-over")
    }
  }

  handleDrop(e) {
    console.log('🖱️ Drop event triggered');
    const columnContent = e.target.closest(".column-content")
    console.log('Column content:', columnContent);
    console.log('Dragged task:', this.draggedTask);
    
    if (columnContent && this.draggedTask) {
        const newStatus = columnContent.dataset.status
        console.log('New status:', newStatus);
        this.updateTaskStatus(this.draggedTask, newStatus)
        columnContent.classList.remove("drag-over")
    }
}

  handleDragEnd(e) {
    if (e.target.classList.contains("task-card")) {
        e.target.classList.remove("dragging")
    }

    // Clean up drag over states
    document.querySelectorAll(".column-content").forEach((column) => {
        column.classList.remove("drag-over")
    })

    this.draggedTask = null
    this.draggedElement = null
}

  updateTaskStatus(taskId, newStatus) {
    const task = this.tasks.find(t => t.id === taskId)
    if (!task) return

    const oldStatus = task.status
    task.status = newStatus
    this.saveTasks()
    this.render()

    // Отправляем уведомление о перемещении
    if (oldStatus !== newStatus) {
        this.trackTaskMovement(taskId, oldStatus, newStatus)
    }
}

  getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".task-card:not(.dragging)")]

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child }
        } else {
          return closest
        }
      },
      { offset: Number.NEGATIVE_INFINITY },
    ).element
  }

  checkAndRemoveOldTasks() {
    const now = new Date()
    const threeDaysAgo = new Date(now)
    threeDaysAgo.setDate(now.getDate() - 3)

    let tasksRemoved = false

    this.tasks = this.tasks.filter(task => {
        if (task.status === "done") { // 👈 если статус "done" — проверяем дату
            const createdAt = new Date(task.createdAt)
            if (createdAt < threeDaysAgo) {
                tasksRemoved = true
                return false // удаляем задачу
            }
        }
        return true // оставляем задачу
    })

    if (tasksRemoved) {
        this.saveTasks()
        this.render()
    }
}
}



// Initialize the application
let kanban
document.addEventListener("DOMContentLoaded", () => {
  kanban = new KanbanBoard()
})


